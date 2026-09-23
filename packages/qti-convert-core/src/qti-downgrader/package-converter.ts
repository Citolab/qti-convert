import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import JSZip from 'jszip';
import { convertQti3toQti21, type Qti21ConversionResult, type Qti21Warning } from './convert-qti3-to-qti21';
import {
  IMSCP21_NAMESPACE,
  IMSCP21_SCHEMA_LOCATION,
  QTI21_METADATA_NAMESPACE,
  qti3ResourceTypeToQti21
} from './name-map';
import { dirname, joinPath, normalizePath } from './path-utils';

export type PackageFiles = Map<string, string | Uint8Array>;

export interface Qti21PackageResult {
  files: PackageFiles;
  warnings: Qti21Warning[];
}

const QTI3_IMSCP_NAMESPACE = 'http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1';
const QTI3_METADATA_NAMESPACE = 'http://www.imsglobal.org/xsd/imsqti_metadata_v3p0';
const STIMULUS_RESOURCE_TYPE = /stimulus/i;

const localName = (name: string) => name.split(':').pop() || name;
const byLocalName = ($: cheerio.CheerioAPI, name: string, scope?: Element) =>
  (scope ? $(scope).find('*') : $('*'))
    .toArray()
    .filter((el): el is Element => el.type === 'tag' && localName(el.name) === name);

const rootLocalName = (xml: string) =>
  localName(/<([A-Za-z_][\w.:-]*)/.exec(xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ''))?.[1] || '');
const isManifest = (path: string) => path === 'imsmanifest.xml' || path.endsWith('/imsmanifest.xml');

/**
 * Converts a QTI 3 imsmanifest.xml to QTI 2.1. Stimulus resources whose file was inlined into the
 * items are removed; their dependencies and files are moved to the items that depended on them.
 */
export const convertManifestToQti21 = (manifestXml: string, inlinedStimulusHrefs: Set<string> = new Set()) => {
  const $ = cheerio.load(manifestXml, { xml: { xmlMode: true, decodeEntities: false } });

  $('*').each((_, el: Element) => {
    for (const [name, value] of Object.entries(el.attribs || {})) {
      if (value.trim() === QTI3_IMSCP_NAMESPACE) el.attribs[name] = IMSCP21_NAMESPACE;
      if (value.trim() === QTI3_METADATA_NAMESPACE) el.attribs[name] = QTI21_METADATA_NAMESPACE;
    }
  });

  const manifest = byLocalName($, 'manifest')[0];
  if (manifest) {
    manifest.attribs['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
    manifest.attribs['xsi:schemaLocation'] = IMSCP21_SCHEMA_LOCATION;
    const metadata = $(manifest)
      .children()
      .toArray()
      .find((el): el is Element => el.type === 'tag' && localName(el.name) === 'metadata');
    if (metadata) {
      for (const [name, value] of [
        ['schema', 'QTIv2.1 Package'],
        ['schemaversion', '1.0.0']
      ]) {
        const existing = byLocalName($, name, metadata)[0];
        if (existing) $(existing).text(value);
        else $(metadata).append(`<${name}>${value}</${name}>`);
      }
    }
  }

  const resources = byLocalName($, 'resource');
  const inlinedStimuli = new Map<string, Element>();
  for (const resource of resources) {
    const type = resource.attribs.type || '';
    if (STIMULUS_RESOURCE_TYPE.test(type)) {
      if (inlinedStimulusHrefs.has(normalizePath(resource.attribs.href || ''))) {
        inlinedStimuli.set(resource.attribs.identifier, resource);
      } else {
        resource.attribs.type = 'webcontent';
      }
    } else {
      resource.attribs.type = qti3ResourceTypeToQti21(type);
    }
  }

  for (const resource of resources) {
    for (const dependency of byLocalName($, 'dependency', resource)) {
      const stimulus = inlinedStimuli.get(dependency.attribs.identifierref);
      if (!stimulus) continue;
      const existingDeps = new Set(byLocalName($, 'dependency', resource).map(d => d.attribs.identifierref));
      const existingFiles = new Set(byLocalName($, 'file', resource).map(f => normalizePath(f.attribs.href || '')));
      for (const file of byLocalName($, 'file', stimulus)) {
        const href = normalizePath(file.attribs.href || '');
        if (href !== normalizePath(stimulus.attribs.href || '') && !existingFiles.has(href)) {
          $(resource).append(`<file href="${href}"/>`);
        }
      }
      for (const stimulusDependency of byLocalName($, 'dependency', stimulus)) {
        if (!existingDeps.has(stimulusDependency.attribs.identifierref)) {
          $(dependency).before(`<dependency identifierref="${stimulusDependency.attribs.identifierref}"/>`);
        }
      }
      $(dependency).remove();
    }
  }
  for (const stimulus of inlinedStimuli.values()) {
    $(stimulus).remove();
  }
  return $.xml();
};

const decode = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : new TextDecoder('utf-8').decode(content);

export interface Qti21FileContext {
  /** Path of the file inside the package. */
  path: string;
  /** Resolves a stimulus href relative to this file to its QTI 3 XML (and marks it as inlined). */
  resolveStimulus: (href: string) => string | undefined;
}

type Awaitable<T> = T | Promise<T>;

/** Overrides for the default conversions, like the callbacks of the QTI 2 to 3 package converters. */
export interface Qti21PackageOptions {
  convertItem?: (xml: string, context: Qti21FileContext) => Awaitable<Qti21ConversionResult>;
  convertAssessment?: (xml: string, context: Qti21FileContext) => Awaitable<Qti21ConversionResult>;
  /** Receives the package paths of the stimuli that were inlined into items. */
  convertManifest?: (xml: string, inlinedStimulusHrefs: Set<string>) => Awaitable<string>;
}

export const defaultConvertFileToQti21 = (xml: string, context: Qti21FileContext) =>
  convertQti3toQti21(xml, { filePath: context.path, resolveStimulus: context.resolveStimulus });

/**
 * Converts all files of a QTI 3 package to QTI 2.1. Shared stimuli are inlined into the items that
 * reference them and removed from the package. Non-QTI files are passed through unchanged.
 */
export const convertPackageFilesToQti21 = async (
  files: PackageFiles,
  {
    convertItem = defaultConvertFileToQti21,
    convertAssessment = defaultConvertFileToQti21,
    convertManifest = convertManifestToQti21
  }: Qti21PackageOptions = {}
): Promise<Qti21PackageResult> => {
  const warnings: Qti21Warning[] = [];
  const xmlFiles = new Map<string, string>();
  for (const [path, content] of files) {
    if (path.toLowerCase().endsWith('.xml')) xmlFiles.set(path, decode(content));
  }
  const byNormalizedPath = new Map([...xmlFiles.keys()].map(path => [normalizePath(path), path]));

  const inlinedStimulusHrefs = new Set<string>();
  const output: PackageFiles = new Map();
  const stimulusPaths: string[] = [];

  for (const [path, content] of files) {
    const xml = xmlFiles.get(path);
    const root = xml === undefined ? '' : rootLocalName(xml);
    if (root === 'qti-assessment-stimulus') {
      stimulusPaths.push(path);
      continue;
    }
    // Non-QTI files (and QTI 2.x files) are passed through; the manifest is converted last
    if (xml === undefined || isManifest(path) || !root.startsWith('qti-')) {
      output.set(path, content);
      continue;
    }
    const context: Qti21FileContext = {
      path,
      resolveStimulus: href => {
        const stimulusPath = byNormalizedPath.get(joinPath(dirname(path), href));
        if (!stimulusPath) return undefined;
        inlinedStimulusHrefs.add(normalizePath(stimulusPath));
        return xmlFiles.get(stimulusPath);
      }
    };
    const convert = root === 'qti-assessment-test' ? convertAssessment : convertItem;
    const result = await convert(xml, context);
    output.set(path, result.xml);
    warnings.push(...result.warnings);
  }

  // Stimuli that no item referenced are kept (as a QTI 2.2 assessmentStimulus)
  for (const path of stimulusPaths) {
    if (inlinedStimulusHrefs.has(normalizePath(path))) continue;
    const result = convertQti3toQti21(xmlFiles.get(path)!, { filePath: path });
    output.set(path, result.xml);
    warnings.push(...result.warnings);
  }

  for (const path of xmlFiles.keys()) {
    if (isManifest(path)) {
      output.set(path, await convertManifest(xmlFiles.get(path)!, inlinedStimulusHrefs));
    }
  }

  return { files: output, warnings };
};

type ZipInput = Blob | ArrayBuffer | Uint8Array;

/**
 * Converts a zipped QTI 3 package to QTI 2.1. Works in Node and the browser.
 * @param outputType 'uint8array' (default, Node) or 'blob' (browser)
 */
export async function convertPackageToQti21(
  input: ZipInput,
  outputType?: 'uint8array',
  options?: Qti21PackageOptions
): Promise<{ zip: Uint8Array; warnings: Qti21Warning[] }>;
export async function convertPackageToQti21(
  input: ZipInput,
  outputType: 'blob',
  options?: Qti21PackageOptions
): Promise<{ zip: Blob; warnings: Qti21Warning[] }>;
export async function convertPackageToQti21(
  input: ZipInput,
  outputType: 'uint8array' | 'blob' = 'uint8array',
  options: Qti21PackageOptions = {}
) {
  const zip = await JSZip.loadAsync(input);
  const files: PackageFiles = new Map();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.includes('__MACOSX') || path.endsWith('.DS_Store')) continue;
    files.set(path, await entry.async('uint8array'));
  }
  const { files: converted, warnings } = await convertPackageFilesToQti21(files, options);
  const outZip = new JSZip();
  for (const [path, content] of converted) {
    outZip.file(path, content);
  }
  const output = await outZip.generateAsync({ type: outputType, compression: 'DEFLATE' });
  return { zip: output, warnings };
}
