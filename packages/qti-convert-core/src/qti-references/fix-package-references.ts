import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { dirname, joinPath, normalizePath, relativePath } from '../qti-downgrader/path-utils';

// Repairs broken file references in the items, tests and stimuli of a QTI package (QTI 2.x or 3).
// Every reference (src, href, data, poster, template-location, ...) is resolved in this order:
// 1. relative to the file that contains it, as the specs require (a case-only mismatch is corrected);
// 2. relative to the package root, the folder of imsmanifest.xml. Many exports write package-root-relative paths
//    (mediafiles/a.png in questions/q1.xml) or root-absolute ones (/templates/rp.xml);
// 3. by file name among all files in the package, when exactly one file matches best.
// A reference found in step 2 or 3 is rewritten to the correct path relative to its file; only the attribute value
// changes, the rest of the file stays byte-for-byte the same. References that can't be found are reported.
// PackageReferenceResolver does the resolving with only the file paths, for code that reads a package file by file.
// Environment-agnostic; the Python package (qti-convert on PyPI) has the same function.

/** Attributes that hold a file reference. */
export const REFERENCE_ATTRIBUTES = [
  'src',
  'href',
  'data',
  'poster',
  'primary-path',
  'fallback-path',
  'template-location',
  'templateLocation',
  'backgroundimg',
  'background-img',
  'template-src',
  'templateSrc',
  'template-url',
  'templateurl',
  'value',
  'file',
  'sound',
  'video',
  'image'
];
/** Attributes that only count as a reference when the value looks like a file name (<param value="true"/> doesn't). */
const LOOSE_ATTRIBUTES = new Set(['value', 'file', 'sound', 'video', 'image']);
/** Module paths may leave out the .js extension. */
const MODULE_ATTRIBUTES = new Set(['primary-path', 'fallback-path']);
const QTI_ROOTS = new Set([
  'assessmentItem',
  'assessmentTest',
  'assessmentStimulus',
  'qti-assessment-item',
  'qti-assessment-test',
  'qti-assessment-stimulus'
]);
const NOT_A_PATH = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
/** Paths on the author's computer (C:\media\a.png, file:///C:/media/a.png): only found by file name. */
const LOCAL_PATH = /^(file:|[a-z]:[\\/])/i;
const FILE_NAME = /^[^\s?#]*\.[A-Za-z0-9]{1,5}([?#].*)?$/;

export type ReferenceFixMethod = 'case' | 'package-root' | 'file-name';

export interface FixedReference {
  /** Package path of the file that holds the reference. */
  file: string;
  element: string;
  attribute: string;
  value: string;
  newValue: string;
  /** Package path of the file the reference now points to. */
  target: string;
  method: ReferenceFixMethod;
}

export interface UnresolvedReference {
  file: string;
  element: string;
  attribute: string;
  value: string;
  /** Files with the same name that matched equally well (empty when nothing matched). */
  candidates: string[];
}

export type ReferencePackageFiles<T = string | Uint8Array> = Map<string, T>;

export interface ReferenceFixResult<T = string | Uint8Array> {
  files: ReferencePackageFiles<T>;
  fixed: FixedReference[];
  unresolved: UnresolvedReference[];
}

export interface FixPackageReferencesOptions {
  /** Attribute names that hold references. Default REFERENCE_ATTRIBUTES. */
  attributes?: string[];
  /** Also look for a reference by its file name anywhere in the package. Default true. */
  searchByFileName?: boolean;
}

const isManifest = (path: string) => path === 'imsmanifest.xml' || path.endsWith('/imsmanifest.xml');
const isElement = (node: AnyNode): node is Element => node.type === 'tag';
const localName = (name: string) => name.split(':').pop() || name;
const fileName = (path: string) => path.split('/').pop()!.toLowerCase();

const rootLocalName = (xml: string) =>
  localName(/<([A-Za-z_][\w.:-]*)/.exec(xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ''))?.[1] || '');

const decodeUri = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
/** Percent-encodes a path, keeping / and the other characters that are safe in a URL path. */
const encodePath = (path: string) =>
  encodeURIComponent(path).replace(/%(2F|24|26|2B|2C|3B|3D|3A|40)/gi, match => decodeURIComponent(match));

/** Where a reference points, as found by `PackageReferenceResolver.resolve`. */
export interface ReferenceResolution {
  /** Package path of the file it points to; undefined when no file was found. */
  target?: string;
  /** '' when the reference is right as written, else how it was found. */
  method: ReferenceFixMethod | '';
  /** The value to write instead, relative to the referencing file; undefined when it needs no change or wasn't found. */
  newValue?: string;
  /** When not found: files with the same name that matched equally well. */
  candidates: string[];
}

export interface PackageReferenceResolverOptions {
  /** The package root; default the folder of imsmanifest.xml, or the top when there is none. */
  rootDir?: string;
  /** Also look for a reference by its file name anywhere in the package. Default true. */
  searchByFileName?: boolean;
}

/**
 * Resolves file references against the paths of a package, without needing the file contents.
 *
 * Use it where a package is read file by file (e.g. the entries of a zip); `fixPackageReferences` uses it for whole
 * packages. A resolved target is always one of the given paths, so a reference can never point outside the package.
 */
export class PackageReferenceResolver {
  readonly rootDir: string;
  readonly searchByFileName: boolean;
  private paths = new Set<string>();
  private lower = new Map<string, string>();
  private byName = new Map<string, string[]>();

  /** @param paths the file paths of the package (folder entries ending in / are ignored) */
  constructor(paths: Iterable<string>, { rootDir, searchByFileName = true }: PackageReferenceResolverOptions = {}) {
    for (const path of paths) {
      if (path.endsWith('/') || this.paths.has(path)) continue;
      this.paths.add(path);
      if (!this.lower.has(path.toLowerCase())) this.lower.set(path.toLowerCase(), path);
      this.byName.set(fileName(path), [...(this.byName.get(fileName(path)) ?? []), path]);
    }
    const manifest = [...this.paths].filter(isManifest).sort((a, b) => a.length - b.length)[0];
    this.rootDir = normalizePath(rootDir ?? (manifest ? dirname(manifest) : ''));
    this.searchByFileName = searchByFileName;
  }

  /**
   * Whether a value is a reference to a file in the package (not a URL, data: URI or fragment).
   * For the loose attributes (value, file, sound, video, image) the value must also look like a file name.
   */
  static isReference(value: string, attribute?: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || (NOT_A_PATH.test(trimmed) && !LOCAL_PATH.test(trimmed))) return false;
    return !attribute || !LOOSE_ATTRIBUTES.has(attribute) || FILE_NAME.test(trimmed);
  }

  /**
   * Resolves a reference found in the file at `filePath`; undefined when the value is not a file reference.
   * @param attribute the attribute the value came from: primary-path and fallback-path may leave out .js, and the
   *   loose attributes only count when the value looks like a file name.
   */
  resolve(filePath: string, value: string, attribute?: string): ReferenceResolution | undefined {
    if (!PackageReferenceResolver.isReference(value, attribute)) return undefined;
    const module = !!attribute && MODULE_ATTRIBUTES.has(attribute);
    const fileDir = dirname(filePath);
    let { target, method, encode, candidates } = this.findTarget(fileDir, value, module);
    if (method === 'file-name' && !this.searchByFileName) {
      target = undefined;
      method = '';
      candidates = [];
    }
    if (!target) return { method: '', candidates };
    if (!method) return { target, method, candidates: [] };
    const suffix = value.trim().match(/[?#][\s\S]*$/)?.[0] ?? '';
    const targetRef =
      module && !hasExtension(value) && target.endsWith('.js') ? target.slice(0, -'.js'.length) : target;
    const newPath = relativePath(fileDir, targetRef);
    return { target, method, newValue: (encode ? encodePath(newPath) : newPath) + suffix, candidates: [] };
  }

  /** The package path of a file, trying a .js extension for modules; exact is false for a case mismatch. */
  private find(path: string, module: boolean): { target?: string; exact: boolean } {
    for (const candidate of module ? [path, `${path}.js`] : [path]) {
      if (this.paths.has(candidate)) return { target: candidate, exact: true };
      const lower = this.lower.get(candidate.toLowerCase());
      if (lower) return { target: lower, exact: false };
    }
    return { exact: false };
  }

  private findByFileName(path: string, module: boolean): string[] {
    let matches = [...(this.byName.get(fileName(path)) ?? [])];
    if (module && matches.length === 0) matches = [...(this.byName.get(`${fileName(path)}.js`) ?? [])];
    if (matches.length <= 1) return matches;
    // prefer the files whose folders match the most trailing folders of the reference
    const wanted = path
      .split('/')
      .filter(part => part && part !== '.' && part !== '..')
      .map(part => part.toLowerCase());
    const score = (match: string) => {
      const parts = match.toLowerCase().split('/');
      let common = 0;
      while (
        common < Math.min(parts.length, wanted.length) &&
        parts[parts.length - 1 - common] === wanted[wanted.length - 1 - common]
      ) {
        common++;
      }
      return common;
    };
    const best = Math.max(...matches.map(score));
    return matches.filter(match => score(match) === best).sort();
  }

  private findTarget(
    fileDir: string,
    value: string,
    module: boolean
  ): { target?: string; method: ReferenceFixMethod | ''; encode: boolean; candidates: string[] } {
    const raw = value.trim();
    const path = raw.split(/[?#]/)[0].replace(/\\/g, '/');
    const decoded = decodeUri(path);
    const byName = () => {
      const matches = this.findByFileName(decoded, module);
      return matches.length === 1
        ? { target: matches[0], method: 'file-name' as const, encode: decoded !== path, candidates: [] }
        : { method: '' as const, encode: false, candidates: matches };
    };
    if (LOCAL_PATH.test(raw)) return byName();

    const candidates: [string, boolean][] = [
      [path, false],
      ...(decoded !== path ? [[decoded, true] as [string, boolean]] : [])
    ];
    if (!path.startsWith('/')) {
      for (const [candidate, encode] of candidates) {
        const { target, exact } = this.find(normalizePath(joinPath(fileDir, candidate)), module);
        if (target) return { target, method: exact ? '' : 'case', encode, candidates: [] };
      }
    }
    for (const [candidate, encode] of candidates) {
      const { target } = this.find(normalizePath(joinPath(this.rootDir, candidate.replace(/^\/+/, ''))), module);
      if (target) return { target, method: 'package-root', encode, candidates: [] };
    }
    return byName();
  }
}

const hasExtension = (value: string) => /\.[^./]+$/.test(value.split(/[?#]/)[0]);

const escapeAttribute = (value: string, quote: string) => {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&apos;');
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces only the changed attribute values, so the rest of the file stays byte-for-byte the same. */
const rewrite = (text: string, replacements: Map<string, { name: string; value: string; newValue: string }>) => {
  for (const { name, value, newValue } of replacements.values()) {
    const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'g');
    text = text.replace(pattern, (match, before: string, quote: string, written: string) =>
      written === value || written === escapeAttribute(value, quote)
        ? `${before}${quote}${escapeAttribute(newValue, quote)}${quote}`
        : match
    );
  }
  return text;
};

/**
 * Repairs the file references in the items, tests and stimuli of a package (QTI 2.x or 3).
 * Files without broken references are returned unchanged (the same content); run it before or after a conversion.
 */
export const fixPackageReferences = <T extends string | Uint8Array>(
  files: ReferencePackageFiles<T>,
  { attributes = REFERENCE_ATTRIBUTES, searchByFileName = true }: FixPackageReferencesOptions = {}
): ReferenceFixResult<T | string | Uint8Array> => {
  const resolver = new PackageReferenceResolver(files.keys(), { searchByFileName });
  const wanted = new Set(attributes);
  const result: ReferenceFixResult<T | string | Uint8Array> = { files: new Map(files), fixed: [], unresolved: [] };

  for (const [path, content] of files) {
    if (!path.toLowerCase().endsWith('.xml')) continue;
    let text: string;
    try {
      text =
        typeof content === 'string'
          ? content
          : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      continue; // not UTF-8; left alone
    }
    if (!QTI_ROOTS.has(rootLocalName(text))) continue;
    const $ = cheerio.load(text, { xml: { xmlMode: true, decodeEntities: true } });
    const replacements = new Map<string, { name: string; value: string; newValue: string }>();

    for (const el of $('*').toArray().filter(isElement)) {
      for (const [name, value] of Object.entries(el.attribs)) {
        const attribute = localName(name);
        if (name.startsWith('xmlns') || !wanted.has(attribute)) continue;
        const resolution = resolver.resolve(path, value, attribute);
        if (!resolution) continue;
        const element = localName(el.name);
        if (!resolution.target) {
          result.unresolved.push({ file: path, element, attribute, value, candidates: resolution.candidates });
          continue;
        }
        if (resolution.newValue === undefined || !resolution.method) continue;
        const { target, method, newValue } = resolution;
        replacements.set(`${name}\u0000${value}`, { name, value, newValue });
        result.fixed.push({ file: path, element, attribute, value, newValue, target, method });
      }
    }
    if (replacements.size > 0) {
      const fixed = rewrite(text, replacements);
      result.files.set(path, typeof content === 'string' ? fixed : new TextEncoder().encode(fixed));
    }
  }
  return result;
};
