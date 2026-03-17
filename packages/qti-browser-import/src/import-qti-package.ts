import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';
import { convert as convertTaoPci } from '@citolab/qti-convert-tao-pci';
import { getUpgraderStylesheetBlobUrl } from './upgrader-stylesheet';
import * as cheerio3 from 'cheerio';
import JSZip from 'jszip';
import { createModuleResolutionFetcher, detectPciBaseUrl } from './pci-helpers';
import {
  deletePackageCache,
  ensurePackageServiceWorkerReady,
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

export interface PrepareQtiPackageOptions extends ImportQtiPackageOptions {
  saxonJsUrl?: string;
  componentsCdnUrl?: string;
  componentsCssUrl?: string;
}

export interface PreparedQtiPackage {
  packageId: string;
  testUrl: string;
  itemRefs: { identifier: string; title: string }[];
  convertedItemCount: number;
  assessments: ImportedAssessmentInfo[];
  importErrors: string[];
  itemsPerAssessment: { assessmentId: string; items: ImportedItemInfo[] }[];
}

function getDirname(path: string): string {
  const normalized = normalizeZipPath(path);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx + 1) : '';
}

function detectPackageRootDir(paths: string[]): string {
  const manifestCandidates = paths
    .map(normalizeZipPath)
    .filter(path => path.toLowerCase().endsWith('imsmanifest.xml'))
    .sort((a, b) => a.length - b.length);

  if (manifestCandidates.length === 0) return '';
  return getDirname(manifestCandidates[0]);
}

function rebaseToPackageRoot(path: string, packageRootDir: string): string {
  const normalized = normalizeZipPath(path);
  const root = normalizeZipPath(packageRootDir);
  if (!root) return normalized;
  if (normalized === root) return '';
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
}

function pickAliasedModuleResolutionPath(
  paths: string[],
  filename: 'module_resolution' | 'fallback_module_resolution',
): string | null {
  const candidates = paths.filter(
    (p) =>
      p.endsWith(`/modules/${filename}.js`) ||
      p.endsWith(`/modules/${filename}.json`),
  );

  if (candidates.length !== 1) return null;
  return candidates[0];
}

function repairBareAttributesInXml(text: string): string {
  return text.replace(/<[^>]+>/g, (tag) => {
    if (
      tag.startsWith('<!--') ||
      tag.startsWith('<?') ||
      tag.startsWith('<![CDATA[') ||
      tag.startsWith('<!DOCTYPE')
    ) {
      return tag;
    }

    return tag.replace(
      /("[^"]*"|'[^']*')|(\s)([\w:-]+)(?!\s*=)(?=[\s/>])/g,
      (match, quoted, space, attr) => (quoted !== undefined ? match : `${space}${attr}=""`),
    );
  });
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

type XmlKind = 'item' | 'test' | 'other';

function classifyXmlKind(xml: string): XmlKind {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement?.localName;
    if (root === 'qti-assessment-item' || root === 'assessmentItem') return 'item';
    if (root === 'qti-assessment-test' || root === 'assessmentTest') return 'test';
    return 'other';
  } catch {
    return 'other';
  }
}

function isQti3Xml(xml: string): boolean {
  if (
    /<qti-assessment-item\b/i.test(xml) ||
    /<qti-assessment-test\b/i.test(xml) ||
    /imsqtiasi_v3p0|qtiv3p0/i.test(xml)
  ) {
    return true;
  }

  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    const localName = root?.localName || '';
    const namespace = root?.namespaceURI || '';

    if (localName === 'qti-assessment-item' || localName === 'qti-assessment-test') {
      return true;
    }

    return /imsqtiasi_v3p0|qtiv3p0/i.test(namespace);
  } catch {
    return false;
  }
}

export const __test__ = {
  detectPackageRootDir,
  rebaseToPackageRoot,
  pickAliasedModuleResolutionPath,
  repairBareAttributesInXml,
  isQti3Xml,
};

function getIdentifierFromItem(xml: string, fallback: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return doc.documentElement.getAttribute('identifier') || fallback;
  } catch {
    return fallback;
  }
}

function extractItemRefs(testXml: string): { identifier: string; href: string }[] {
  try {
    const doc = new DOMParser().parseFromString(testXml, 'text/xml');
    return Array.from(doc.getElementsByTagName('*'))
      .filter(el => el.localName === 'qti-assessment-item-ref' || el.localName === 'assessmentItemRef')
      .map(el => ({
        identifier: el.getAttribute('identifier') || '',
        href: el.getAttribute('href') || '',
      }))
      .filter(el => Boolean(el.href));
  } catch {
    return [];
  }
}

function normalizeTestItemRefIdentifiers(
  testXml: string,
  testPath: string,
  convertedXmlByPath: Map<string, string>,
): string {
  try {
    const doc = new DOMParser().parseFromString(testXml, 'application/xml');
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) return testXml;

    const refs = Array.from(doc.getElementsByTagName('*')).filter(
      el => el.localName === 'qti-assessment-item-ref' || el.localName === 'assessmentItemRef',
    );

    let changed = false;
    for (const ref of refs) {
      const href = ref.getAttribute('href') || '';
      const resolvedPath = resolveHref(testPath, href) || href;
      const itemXml = convertedXmlByPath.get(resolvedPath);
      if (!itemXml) continue;
      const actualIdentifier = getIdentifierFromItem(itemXml, resolvedPath);
      if (!actualIdentifier) continue;
      if (ref.getAttribute('identifier') !== actualIdentifier) {
        ref.setAttribute('identifier', actualIdentifier);
        changed = true;
      }
    }

    return changed ? new XMLSerializer().serializeToString(doc) : testXml;
  } catch {
    return testXml;
  }
}

function getDirPath(filePath: string): string {
  const normalized = normalizeZipPath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx + 1) : '';
}

function getItemStemDirPath(filePath: string): string | null {
  const normalized = normalizeZipPath(filePath);
  const last = normalized.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return null;

  const withoutExt = last.slice(0, dot);
  const baseDir = normalized.slice(0, normalized.length - last.length).replace(/\/+$/, '');
  const parent = baseDir.split('/').filter(Boolean).pop() || '';
  if (parent.toLowerCase() !== 'items') return null;

  return `${baseDir}/${withoutExt}`;
}

const runtimeBlobUrlCache = new Map<string, string>();

function rebaseCssUrls(cssText: string, sourceUrl: string): string {
  return cssText.replace(/url\(([^)]+)\)/gi, (match, rawValue: string) => {
    const unquoted = rawValue.trim().replace(/^['"]|['"]$/g, '');
    if (!unquoted || /^(data:|blob:|https?:|#)/i.test(unquoted)) {
      return match;
    }

    try {
      const rebased = new URL(unquoted, sourceUrl).toString();
      return `url("${rebased}")`;
    } catch {
      return match;
    }
  });
}

async function materializeRuntimeAssetUrl(url: string): Promise<string> {
  if (!/^(https?:)/i.test(url)) return url;

  const cached = runtimeBlobUrlCache.get(url);
  if (cached) return cached;

  const parsed = new URL(url, window.location.origin);
  const hasFileExtension = /\.(?:js|json|mjs|cjs|css|html)$/i.test(parsed.pathname);
  const candidates = hasFileExtension ? [url] : [url, `${url}.js`, `${url}.json`];

  let response: Response | null = null;
  let resolvedUrl = url;
  let lastStatus: number | null = null;

  for (const candidate of candidates) {
    const attempt = await fetch(candidate, { cache: 'no-store' });
    if (attempt.ok) {
      response = attempt;
      resolvedUrl = candidate;
      break;
    }
    lastStatus = attempt.status;
  }

  if (!response) {
    throw new Error(`Runtime asset missing for ${url} (${lastStatus ?? 'network error'})`);
  }

  let blob: Blob;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/css') || resolvedUrl.toLowerCase().endsWith('.css')) {
    const cssText = rebaseCssUrls(await response.text(), resolvedUrl);
    blob = new Blob([cssText], { type: 'text/css' });
  } else {
    blob = await response.blob();
  }
  const blobUrl = URL.createObjectURL(blob);
  runtimeBlobUrlCache.set(resolvedUrl, blobUrl);
  runtimeBlobUrlCache.set(url, blobUrl);
  return blobUrl;
}

async function tryMaterializeRuntimeAssetUrl(url: string): Promise<string | null> {
  try {
    return await materializeRuntimeAssetUrl(url);
  } catch {
    return null;
  }
}

async function prepareItemXmlForRuntime(
  xmlString: string,
  itemPath: string,
  packageId: string,
  options: Pick<PrepareQtiPackageOptions, 'componentsCdnUrl' | 'componentsCssUrl'> = {},
): Promise<string> {
  const packageRootUrl = makePackageUrl(packageId, '');
  const itemDir = getDirPath(itemPath);
  const itemDirUrl = itemDir ? makePackageUrl(packageId, itemDir) : null;
  const itemStemDir = getItemStemDirPath(itemPath);
  const itemStemDirUrl = itemStemDir ? makePackageUrl(packageId, itemStemDir) : null;

  if (xmlString.includes('qti-portable-custom-interaction')) {
    const pciBaseUrl = await detectPciBaseUrl({
      packageRootUrl,
      itemDirUrl,
      itemStemDirUrl,
      xmlText: xmlString,
    });
    const getModuleResolutionConfig = createModuleResolutionFetcher({
      packageRootUrl,
      itemDirUrl,
      itemStemDirUrl,
    });

    xmlString = (
      await qtiTransform(xmlString).configurePciAsync(
        pciBaseUrl,
        getModuleResolutionConfig,
        { packageRootUrl, itemDirUrl, itemStemDirUrl },
      )
    ).xml();
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  } catch {
    return Promise.resolve(xmlString);
  }

  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) return Promise.resolve(xmlString);

  const baseUrl = makePackageUrl(packageId, itemDir);
  const origin = window.location.origin;
  const toAbsoluteModulePath = (value: string | null): string | null => {
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed || /^(data:|blob:|https?:)/i.test(trimmed)) return trimmed;

    const resolved = resolveHref(itemPath, trimmed);
    if (!resolved) return trimmed;
    return `${origin}${makePackageUrl(packageId, resolved)}`;
  };

  const all = Array.from(doc.getElementsByTagName('*'));
  const pcis = all.filter(
    el => el.localName === 'qti-portable-custom-interaction' || el.localName === 'portableCustomInteraction',
  );
  const interactionModules = all.filter(el => el.localName === 'qti-interaction-module' || el.localName === 'module');
  const interactionModuleContainers = all.filter(
    el => el.localName === 'qti-interaction-modules' || el.localName === 'modules',
  );

  for (const moduleEl of interactionModules) {
    const primary = toAbsoluteModulePath(moduleEl.getAttribute('primary-path'));
    const fallback = toAbsoluteModulePath(moduleEl.getAttribute('fallback-path'));
    const hasFallback = Boolean(fallback);

    if (primary !== null) {
      if (hasFallback) {
        const materializedPrimary = await tryMaterializeRuntimeAssetUrl(primary);
        if (materializedPrimary) {
          moduleEl.setAttribute('primary-path', materializedPrimary);
        }
      } else {
        moduleEl.setAttribute('primary-path', await materializeRuntimeAssetUrl(primary));
      }
    }

    if (fallback !== null) {
      const materializedFallback = await tryMaterializeRuntimeAssetUrl(fallback);
      if (materializedFallback) {
        moduleEl.setAttribute('fallback-path', materializedFallback);
      }
    }
  }

  for (const modulesEl of interactionModuleContainers) {
    modulesEl.removeAttribute('primary-configuration');
    modulesEl.removeAttribute('secondary-configuration');
  }

  for (const pci of pcis) {
    pci.setAttribute('data-base-url', `${origin}${baseUrl}`);
    pci.setAttribute('data-forward-console', 'true');
    if (options.componentsCdnUrl) {
      pci.setAttribute('data-components-cdn-url', options.componentsCdnUrl);
    }
    if (options.componentsCssUrl) {
      pci.setAttribute('data-components-css-url', options.componentsCssUrl);
    }
  }

  const stylesheets = all.filter(el => el.localName === 'qti-stylesheet' || el.localName === 'stylesheet');
  for (const stylesheet of stylesheets) {
    const href = stylesheet.getAttribute('href')?.trim() || '';
    if (!href || /^(data:|blob:|https?:)/i.test(href)) continue;
    const resolved = resolveHref(itemPath, href);
    if (!resolved) continue;
    const absoluteUrl = `${origin}${makePackageUrl(packageId, resolved)}`;
    stylesheet.setAttribute('href', await materializeRuntimeAssetUrl(absoluteUrl));
  }

  return new XMLSerializer().serializeToString(doc);
}

function extractPackagePathFromUrl(packageId: string, url: string): string | null {
  const pathname = new URL(url, window.location.origin).pathname;
  const prefix = `${QTI_PKG_URL_PREFIX}/${encodeURIComponent(packageId)}/`;
  if (!pathname.startsWith(prefix)) return null;

  return pathname
    .slice(prefix.length)
    .split('/')
    .map(segment => decodeURIComponent(segment))
    .join('/');
}

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureSaxonJsLoaded(saxonJsUrl = '/assets/saxon-js/SaxonJS2.rt.js'): Promise<void> {
  const win = window as unknown as { SaxonJS?: unknown };
  if (win.SaxonJS) return;

  const candidates = Array.from(
    new Set([
      saxonJsUrl,
      '/assets/saxon-js/SaxonJS2.rt.js',
      'https://unpkg.com/saxon-js@2.7.0/SaxonJS2.rt.js',
      'https://cdn.jsdelivr.net/npm/saxon-js@2.7.0/SaxonJS2.rt.js',
    ]),
  );

  const errors: string[] = [];
  for (const src of candidates) {
    try {
      await loadScript(src);
      if (win.SaxonJS) return;
      errors.push(`Loaded ${src} but window.SaxonJS is missing`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Failed to load SaxonJS. Attempts: ${errors.join(' | ')}`);
}

export async function prepareQtiPackage(
  file: File,
  options: PrepareQtiPackageOptions = {},
): Promise<PreparedQtiPackage> {
  await ensurePackageServiceWorkerReady();
  await ensureSaxonJsLoaded(options.saxonJsUrl);

  const imported = await importQtiPackage(file, options);
  const assessment = imported.assessments[0];
  if (!assessment) {
    throw new Error('No assessment test could be prepared from the package.');
  }

  const convertedXmlByPath = new Map<string, string>();
  for (const item of assessment.items) {
    const relativePath = extractPackagePathFromUrl(imported.packageId, item.href);
    if (!relativePath) continue;

    const response = await fetch(item.href, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Converted item XML missing for ${item.href} (${response.status})`);
    }

    const xml = await response.text();
    const patched = await prepareItemXmlForRuntime(xml, relativePath, imported.packageId, {
      componentsCdnUrl: options.componentsCdnUrl,
      componentsCssUrl: options.componentsCssUrl,
    });
    convertedXmlByPath.set(relativePath, patched);
    await putTextFileInPackageCache(imported.packageId, relativePath, patched, 'application/xml');
  }

  const testRelativePath = assessment.assessmentHref;
  const testResponse = await fetch(assessment.testUrl, { cache: 'no-store' });
  if (!testResponse.ok) {
    throw new Error(`Converted test XML missing for ${assessment.testUrl} (${testResponse.status})`);
  }

  const normalizedTestXml = normalizeTestItemRefIdentifiers(
    await testResponse.text(),
    testRelativePath,
    convertedXmlByPath,
  );
  await putTextFileInPackageCache(imported.packageId, testRelativePath, normalizedTestXml, 'application/xml');

  const refs = extractItemRefs(normalizedTestXml).map(ref => {
    const resolved = resolveHref(testRelativePath, ref.href) || ref.href;
    return {
      identifier: ref.identifier || resolved,
      title: ref.identifier || resolved,
    };
  });

  // Build a map from resolved item path → normalized itemRefIdentifier so we can
  // keep `assessment.items[*].itemRefIdentifier` in sync with the stored test XML.
  const normalizedRefIdentifierByPath = new Map<string, string>();
  for (const ref of extractItemRefs(normalizedTestXml)) {
    const resolved = resolveHref(testRelativePath, ref.href);
    if (resolved && ref.identifier) {
      normalizedRefIdentifierByPath.set(resolved, ref.identifier);
    }
  }

  const updatedAssessments = imported.assessments.map(a => ({
    ...a,
    items: a.items.map(item => {
      const normalizedId = item.originalHref
        ? normalizedRefIdentifierByPath.get(item.originalHref)
        : undefined;
      return normalizedId ? { ...item, itemRefIdentifier: normalizedId } : item;
    }),
  }));

  return {
    packageId: imported.packageId,
    testUrl: assessment.testUrl,
    itemRefs: refs,
    convertedItemCount: assessment.items.length,
    assessments: updatedAssessments,
    importErrors: imported.importErrors,
    itemsPerAssessment: updatedAssessments.map(a => ({ assessmentId: a.id, items: a.items })),
  };
}

export async function prepareQtiPackageFromUrl(
  packageUrl: string,
  options: PrepareQtiPackageOptions = {},
): Promise<PreparedQtiPackage> {
  const response = await fetch(packageUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ZIP from ${packageUrl} (${response.status})`);
  }

  const blob = await response.blob();
  const fileName = packageUrl.split('/').pop() || 'package.zip';
  const file = new File([blob], fileName, { type: blob.type || 'application/zip' });
  return prepareQtiPackage(file, options);
}

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
  const packageRootDir = detectPackageRootDir(zipFilePaths);
  const normalizedToZipKey = new Map<string, string>();
  for (const zipKey of zipFilePaths) {
    normalizedToZipKey.set(rebaseToPackageRoot(zipKey, packageRootDir), zipKey);
  }

  const xmlContentsByPath = new Map<string, string>();
  for (const zipKey of zipFilePaths) {
    const normalizedPath = rebaseToPackageRoot(zipKey, packageRootDir);
    const entry = zip.files[zipKey];
    const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xml') {
      const rawText = await entry.async('string');
      const text = repairBareAttributesInXml(rawText);
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

    const pick = pickAliasedModuleResolutionPath(Array.from(normalizedToZipKey.keys()), filename);
    if (!pick) return;
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

    let qti3Xml = isQti3Xml(originalContent)
      ? originalContent
      : await convertQti2toQti3(originalContent, xsltJsonUrl);
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
    const qti3Xml = isQti3Xml(originalContent)
      ? originalContent
      : await convertQti2toQti3(originalContent, xsltJsonUrl);
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
