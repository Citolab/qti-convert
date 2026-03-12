import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';
import { convert as convertTaoPci } from '@citolab/qti-convert-tao-pci';
import { getUpgraderStylesheetBlobUrl } from './upgrader-stylesheet';
import * as cheerio3 from 'cheerio';
import JSZip from 'jszip';
import {
  deletePackageCache,
  makePackageUrl,
  normalizeZipPath,
  putBlobFileInPackageCache,
  putTextFileInPackageCache,
  QTI_PKG_URL_PREFIX,
} from './qti-package-cache';

export interface ImportedItemInfo {
  identifier: string;
  itemRefIdentifier?: string;
  title: string;
  type: string;
  categories: string[];
  href: string;
  originalHref?: string;
}

export interface ImportedAssessmentInfo {
  id: string;
  content: string;
  packageId: string;
  assessmentHref: string;
  name: string;
  items: ImportedItemInfo[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  testUrl: string;
}

export interface ImportQtiPackageOptions {
  removeStylesheets?: boolean;
  skipValidation?: boolean;
  packageId?: string;
  previousPackageId?: string;
}

export interface ImportQtiPackageResult {
  packageId: string;
  assessments: ImportedAssessmentInfo[];
  importErrors: string[];
  itemsPerAssessment: { assessmentId: string; items: ImportedItemInfo[] }[];
}

const upsertPciAttribute = (
  xmlString: string,
  attributeName: string,
  attributeValue: string,
): string => {
  const openTagRegex = /<qti-portable-custom-interaction\b[^>]*>/g;
  if (!openTagRegex.test(xmlString)) return xmlString;

  return xmlString.replace(openTagRegex, (tag) => {
    const attrRegex = new RegExp(`\\s${attributeName}="[^"]*"`, 'i');
    const nextAttr = ` ${attributeName}="${attributeValue}"`;
    if (attrRegex.test(tag)) {
      return tag.replace(attrRegex, nextAttr);
    }
    return tag.replace(/>$/, `${nextAttr}>`);
  });
};

const forcePciIframeMode = (xmlString: string): string => {
  return upsertPciAttribute(xmlString, 'data-use-iframe', 'true');
};

const makePackageBaseUrlForXmlPath = (packageId: string, relativePath: string): string => {
  const encodedPackageId = encodeURIComponent(packageId);
  const normalizedPath = normalizeZipPath(relativePath);
  const slashIndex = normalizedPath.lastIndexOf('/');
  const folder = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : '';
  return `${QTI_PKG_URL_PREFIX}/${encodedPackageId}/${folder}`;
};

const ensurePciBaseUrlInXml = (xmlString: string, packageId: string, relativePath: string): string => {
  const baseUrl = makePackageBaseUrlForXmlPath(packageId, relativePath);
  return upsertPciAttribute(xmlString, 'data-base-url', baseUrl);
};

function getRelativePath(source: string, target: string): string {
  const sourceParts = source.replace(/\/$/, '').split('/');
  const targetParts = target.replace(/\/$/, '').split('/');

  sourceParts.pop();

  let commonParts = 0;
  for (let i = 0; i < Math.min(sourceParts.length, targetParts.length); i++) {
    if (sourceParts[i] === targetParts[i]) {
      commonParts++;
    } else {
      break;
    }
  }

  const upDirs = sourceParts.length - commonParts;
  const remainingTarget = targetParts.slice(commonParts);

  let relativePath = '';
  for (let i = 0; i < upDirs; i++) {
    relativePath += '../';
  }

  relativePath += remainingTarget.join('/');

  return relativePath;
}

const resolveHref = (baseFilePath: string, href: string | undefined) => {
  if (!href) return null;
  try {
    const resolved = new URL(href, `https://example.com/${baseFilePath}`).pathname.replace(/^\/+/, '');
    return resolved;
  } catch {
    return null;
  }
};

export async function importQtiPackage(
  file: File,
  options: ImportQtiPackageOptions = {},
): Promise<ImportQtiPackageResult> {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.ready;
    } catch {
      // ignore
    }
  }

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('qti-pkg-'))
        .map((k) => caches.delete(k)),
    );
  } catch {
    if (options.previousPackageId) {
      try {
        await deletePackageCache(options.previousPackageId);
      } catch {
        // ignore
      }
    }
  }

  const packageId =
    options.packageId ||
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const skipValidation = options.skipValidation === false ? false : true;
  const removeStylesheets = options.removeStylesheets || false;

  const zip = await JSZip.loadAsync(file);

  const zipFilePaths = Object.keys(zip.files).filter(
    (p) =>
      !p.includes('__MACOSX') &&
      !p.includes('.DS_Store') &&
      !zip.files[p].dir,
  );
  const normalizedToZipKey = new Map<string, string>();
  for (const zipKey of zipFilePaths) {
    normalizedToZipKey.set(normalizeZipPath(zipKey), zipKey);
  }

  const xmlContentsByPath = new Map<string, string>();
  for (const relativePath of zipFilePaths) {
    const normalizedPath = normalizeZipPath(relativePath);
    const entry = zip.files[relativePath];
    const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xml') {
      const rawText = await entry.async('string');
      const text = rawText.replace(/<[^>]+>/g, (tag) =>
        tag.replace(/("[^"]*"|'[^']*')|(\s)([\w:-]+)(?!\s*=)(?=[\s/>])/g,
          (m, quoted, space, attr) => quoted !== undefined ? m : `${space}${attr}=""`),
      );
      xmlContentsByPath.set(normalizedPath, text);
      await putTextFileInPackageCache(packageId, normalizedPath, text);
    } else {
      const blob = await entry.async('blob');
      await putBlobFileInPackageCache(packageId, normalizedPath, blob);
    }
  }

  const ensureAliasedModuleResolution = async (
    filename: 'module_resolution' | 'fallback_module_resolution',
  ) => {
    const rootJs = `modules/${filename}.js`;
    const rootJson = `modules/${filename}.json`;
    const hasRoot =
      normalizedToZipKey.has(rootJs) || normalizedToZipKey.has(rootJson);
    if (hasRoot) return;

    const candidates = Array.from(normalizedToZipKey.keys()).filter(
      (p) =>
        p.endsWith(`/modules/${filename}.js`) ||
        p.endsWith(`/modules/${filename}.json`),
    );
    if (candidates.length === 0) return;
    if (candidates.length !== 1) return;

    const pick = candidates[0];
    const zipKey = normalizedToZipKey.get(pick);
    if (!zipKey) return;
    try {
      const entry = zip.files[zipKey];
      if (!entry) return;
      const ext = pick.endsWith('.json') ? 'json' : 'js';
      if (ext === 'json') {
        const text = await entry.async('string');
        await putTextFileInPackageCache(
          packageId,
          rootJson,
          text,
          'application/json',
        );
      } else {
        const blob = await entry.async('blob');
        await putBlobFileInPackageCache(packageId, rootJs, blob);
      }
    } catch {
      // ignore
    }
  };

  await ensureAliasedModuleResolution('module_resolution');
  await ensureAliasedModuleResolution('fallback_module_resolution');

  const assessments: ImportedAssessmentInfo[] = [];
  const importErrors: string[] = [];

  const itemPaths = new Map<string, string>();
  let testFilePath: string | null = null;
  let testIdentifier: string | null = null;

  const xmlPaths = Array.from(xmlContentsByPath.keys());
  for (const relativePath of xmlPaths) {
    const content = xmlContentsByPath.get(relativePath) || '';

    if (!skipValidation) {
      try {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        const hasParseError =
          doc.getElementsByTagName('parsererror').length > 0;
        if (hasParseError) {
          importErrors.push(`Invalid XML structure in ${relativePath}`);
        }
      } catch {
        importErrors.push(`Invalid XML structure in ${relativePath}`);
      }
    }

    const $ = cheerio3.load(content, { xmlMode: true, xml: true });

    if (
      $('qti-assessment-test').length > 0 ||
      $('assessmentTest').length > 0
    ) {
      if (!testFilePath) {
        testFilePath = relativePath;
        testIdentifier =
          $('qti-assessment-test').attr('identifier') ||
          $('assessmentTest').attr('identifier') ||
          null;
      }
    }

    if (
      $('qti-assessment-item').length > 0 ||
      $('assessmentItem').length > 0
    ) {
      const identifier =
        $('qti-assessment-item').attr('identifier') ||
        $('assessmentItem').attr('identifier') ||
        $('assessmentItem').attr('identifier') ||
        '';
      if (identifier) {
        itemPaths.set(identifier, relativePath);
      }
    }
  }

  const xsltJsonUrl = await getUpgraderStylesheetBlobUrl();

  const convertedItems: {
    identifier: string;
    relativePath: string;
    content: string;
    type: string;
  }[] = [];

  for (const [identifier, relativePath] of itemPaths.entries()) {
    const originalContent = xmlContentsByPath.get(relativePath);
    if (!originalContent) continue;

    let qti3Xml = await convertQti2toQti3(originalContent, xsltJsonUrl);
    const folderPath =
      relativePath.substring(0, relativePath.lastIndexOf('/') + 1) || '';

    let transformResult = qtiTransform(qti3Xml)
      .objectToImg()
      .objectToVideo()
      .objectToAudio()
      .ssmlSubToSpan()
      .minChoicesToOne()
      .externalScored()
      .customInteraction('', folderPath)
      .qbCleanup()
      .depConvert()
      .upgradePci();

    if (removeStylesheets) {
      transformResult = transformResult.stripStylesheets();
    }

    qti3Xml = forcePciIframeMode(transformResult.xml());
    qti3Xml = ensurePciBaseUrlInXml(qti3Xml, packageId, relativePath);
    await putTextFileInPackageCache(packageId, relativePath, qti3Xml);

    convertedItems.push({
      identifier,
      relativePath,
      content: qti3Xml,
      type: qti3Xml.includes('interaction>') ? 'regular' : 'info',
    });
  }

  let effectiveTestPath = testFilePath;
  let effectiveTestIdentifier = testIdentifier;
  let convertedTestXml = '';
  let itemRefs: { itemRefIdentifier?: string; identifier: string }[] = [];

  if (testFilePath && testIdentifier) {
    const originalContent = xmlContentsByPath.get(testFilePath) || '';
    const qti3Xml = await convertQti2toQti3(originalContent, xsltJsonUrl);
    const testBaseRef = `${QTI_PKG_URL_PREFIX}/${encodeURIComponent(packageId)}/`;
    let transformResult = qtiTransform(qti3Xml)
      .objectToImg()
      .objectToVideo()
      .objectToAudio()
      .ssmlSubToSpan()
      .minChoicesToOne()
      .externalScored()
      .customInteraction(testBaseRef, '')
      .qbCleanup()
      .depConvert()
      .upgradePci();
    if (removeStylesheets) {
      transformResult = transformResult.stripStylesheets();
    }
    convertedTestXml = forcePciIframeMode(transformResult.xml());
    convertedTestXml = ensurePciBaseUrlInXml(convertedTestXml, packageId, testFilePath);
    await putTextFileInPackageCache(
      packageId,
      testFilePath,
      convertedTestXml,
    );

    const $ = cheerio3.load(originalContent, {
      xmlMode: true,
      xml: true,
    });
    const refs: { itemRefIdentifier?: string; identifier: string }[] = [];
    $('qti-assessment-item-ref, assessmentItemRef').each((_, el) => {
      const itemRefIdentifierAttr = $(el).attr('identifier');
      const href = $(el).attr('href');
      const resolvedHref = resolveHref(testFilePath!, href);
      if (!resolvedHref) return;
      itemPaths.forEach((itemPath, itemIdentifier) => {
        if (itemPath === resolvedHref) {
          refs.push({
            itemRefIdentifier: itemRefIdentifierAttr,
            identifier: itemIdentifier,
          });
        }
      });
    });
    itemRefs = refs;
  } else if (convertedItems.length > 0) {
    effectiveTestPath = 'all-items.xml';
    effectiveTestIdentifier = 'All';
    itemRefs = convertedItems.map((it) => ({
      itemRefIdentifier: it.identifier,
      identifier: it.identifier,
    }));

    convertedTestXml = `<?xml version="1.0" encoding="utf-8"?>
<qti-assessment-test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
  identifier="All" title="ALL items"
  tool-name="CitoLab" tool-version="qti-playground"
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
    <qti-default-value><qti-value>0</qti-value></qti-default-value>
  </qti-outcome-declaration>
  <qti-test-part identifier="RES-ALL" title="Testpart-1" navigation-mode="nonlinear" submission-mode="simultaneous">
    <qti-assessment-section identifier="section_1" title="section 1" visible="true" keep-together="false">
      ${convertedItems
        .map(
          (item) =>
            `<qti-assessment-item-ref identifier="${item.identifier}" href="${item.relativePath}"><qti-weight identifier="WEIGHT" value="1" /></qti-assessment-item-ref>`,
        )
        .join('')}
    </qti-assessment-section>
  </qti-test-part>
  <qti-outcome-processing>
    <qti-set-outcome-value identifier="SCORE">
      <qti-sum>
        <qti-test-variables variable-identifier="SCORE" weight-identifier="WEIGHT" />
      </qti-sum>
    </qti-set-outcome-value>
  </qti-outcome-processing>
</qti-assessment-test>`;

    await putTextFileInPackageCache(
      packageId,
      effectiveTestPath,
      convertedTestXml,
    );
  }

  const taoConversionInput = new Map<
    string,
    { content: string; type: 'item' | 'test' | 'manifest' | 'other' }
  >();
  for (const item of convertedItems) {
    taoConversionInput.set(item.relativePath, {
      content: item.content,
      type: 'item',
    });
  }
  if (effectiveTestPath && convertedTestXml) {
    taoConversionInput.set(effectiveTestPath, {
      content: convertedTestXml,
      type: 'test',
    });
  }

  const taoConversionOutput = await convertTaoPci(taoConversionInput);
  for (const [path, file] of taoConversionOutput.entries()) {
    if (file.type === 'item') {
      if (typeof file.content !== 'string') continue;
      const item = convertedItems.find((candidate) => candidate.relativePath === path);
      if (item) {
        item.content = file.content;
      }
      await putTextFileInPackageCache(packageId, path, file.content);
      continue;
    }

    if (file.type === 'test' && effectiveTestPath === path) {
      if (typeof file.content !== 'string') continue;
      convertedTestXml = file.content;
      await putTextFileInPackageCache(packageId, path, file.content);
      continue;
    }

    if (file.type === 'other') {
      const normalizedOutPath = normalizeZipPath(path);
      const modulesIdx = normalizedOutPath.indexOf('modules/');
      const rootModuleAlias =
        modulesIdx > 0 ? normalizedOutPath.slice(modulesIdx) : null;

      if (typeof file.content === 'string') {
        const lowerPath = path.toLowerCase();
        const contentType = lowerPath.endsWith('.css')
          ? 'text/css'
          : lowerPath.endsWith('.js')
            ? 'application/javascript'
            : lowerPath.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream';
        await putTextFileInPackageCache(
          packageId,
          path,
          file.content,
          contentType,
        );
        if (rootModuleAlias) {
          await putTextFileInPackageCache(
            packageId,
            rootModuleAlias,
            file.content,
            contentType,
          );
        }
      } else {
        await putBlobFileInPackageCache(
          packageId,
          path,
          new Blob([file.content as BlobPart]),
        );
        if (rootModuleAlias) {
          await putBlobFileInPackageCache(
            packageId,
            rootModuleAlias,
            new Blob([file.content as BlobPart]),
          );
        }
      }
    }
  }

  if (effectiveTestPath && effectiveTestIdentifier) {
    const itemsWithRefs = itemRefs
      .map((ref) => {
        const itemPath = itemPaths.get(ref.identifier);
        if (!itemPath) return null;
        const originalHref = getRelativePath(
          effectiveTestPath!,
          itemPath,
        );
        const hrefResolved =
          resolveHref(effectiveTestPath!, originalHref) || itemPath;
        const itemUrl = makePackageUrl(packageId, hrefResolved);
        return {
          identifier: ref.identifier,
          itemRefIdentifier: ref.itemRefIdentifier || ref.identifier,
          title: ref.identifier,
          type:
            convertedItems.find((i) => i.identifier === ref.identifier)
              ?.type || 'regular',
          categories: [],
          href: itemUrl,
          originalHref,
        } as ImportedItemInfo;
      })
      .filter(Boolean) as ImportedItemInfo[];

    assessments.push({
      id: effectiveTestIdentifier,
      content: convertedTestXml,
      packageId,
      assessmentHref: effectiveTestPath,
      name: effectiveTestIdentifier,
      items: itemsWithRefs,
      createdAt: new Date().getTime(),
      updatedAt: new Date().getTime(),
      createdBy: 'user',
      testUrl: makePackageUrl(packageId, effectiveTestPath),
    });
  }

  return {
    packageId,
    assessments,
    importErrors,
    itemsPerAssessment: assessments.map((a) => ({
      assessmentId: a.id,
      items: a.items || [],
    })),
  };
}
