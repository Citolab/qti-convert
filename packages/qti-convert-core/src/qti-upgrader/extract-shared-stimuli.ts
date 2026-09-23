import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { dirname, isRelativeUrl, joinPath, normalizePath, relativePath } from '../qti-downgrader/path-utils';
import { QTI3_NAMESPACE } from '../qti-names/qti-names';

// Detects content that is repeated across QTI 3 items (typically a reading passage copied into every item of
// a cluster) and moves it into a shared qti-assessment-stimulus referenced by the items. Environment-agnostic.

export interface ExtractSharedStimuliOptions {
  /** Minimum text length of shared content without images/tables to be worth extracting. Default 150. */
  minTextLength?: number;
  /** Word overlap (0-1) from which non-identical content is reported as a near-duplicate. Default 0.9. */
  similarityThreshold?: number;
  /** Package folder for the created stimulus files. Default 'stimuli'. */
  stimulusFolder?: string;
}

export interface ExtractedStimulus {
  identifier: string;
  path: string;
  title: string;
  /** Paths of the items that now reference the stimulus. */
  items: string[];
}

export interface NearDuplicateContent {
  items: [string, string];
  similarity: number;
}

export interface SharedStimuliReport {
  stimuli: ExtractedStimulus[];
  /** Similar but not identical content; reported only, never extracted. */
  nearDuplicates: NearDuplicateContent[];
}

type FileType = 'test' | 'item' | 'manifest' | 'other';
/** Package files by path; binary content (Uint8Array/Buffer, or Blob in the browser) is passed through. */
export type SharedStimulusPackageFiles = Map<string, { content: string | Uint8Array | Blob; type: FileType }>;

/** Package converter options for shared stimulus extraction (off by default). */
export interface SharedStimuliPackageOptions {
  extractSharedStimuli?: boolean | ExtractSharedStimuliOptions;
  onSharedStimuliReport?: (report: SharedStimuliReport) => void;
}

const BLOCK_ELEMENTS = new Set(
  'p div table img figure blockquote h1 h2 h3 h4 h5 h6 ul ol dl pre object audio video picture section article aside hr'.split(' ')
);
const RICH_ELEMENTS = new Set(['img', 'table', 'figure', 'object', 'audio', 'video', 'picture', 'svg', 'math']);
const ASSET_ATTRIBUTES = ['src', 'href', 'data', 'poster'];
const IGNORED_ATTRIBUTES = new Set(['id', 'identifier']);
const REF_INSERT_BEFORE = ['qti-companion-materials-info', 'qti-stylesheet', 'qti-item-body'];

const isElement = (node: AnyNode): node is Element => node.type === 'tag';
const localName = (name: string) => name.split(':').pop() || name;
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const hasClass = (el: Element, pattern: RegExp) => (el.attribs.class || '').split(/\s+/).some(c => pattern.test(c));
const descendants = (el: Element): Element[] =>
  el.children.filter(isElement).flatMap(child => [child, ...descendants(child)]);
const isQti = (el: Element) => localName(el.name).startsWith('qti-');
const containsQti = (el: Element) => isQti(el) || descendants(el).some(isQti);
const isRich = (el: Element) => RICH_ELEMENTS.has(localName(el.name)) || descendants(el).some(d => RICH_ELEMENTS.has(localName(d.name)));

/** FNV-1a, for short stable identifiers without a crypto dependency. */
const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const decode = (content: string | Uint8Array | Blob) =>
  typeof content === 'string' ? content : content instanceof Uint8Array ? new TextDecoder('utf-8').decode(content) : '';
const load = (xml: string) => cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: false } });

interface Candidate {
  path: string;
  $: cheerio.CheerioAPI;
  blocks: Element[];
  keys: string[];
  /** The layout column holding the blocks, when the stimulus is one column of a qti-layout-row. */
  column?: Element;
}

/** Order-independent form of a block: sorted attributes, no ids, collapsed text, package-absolute asset paths. */
const canonical = (node: AnyNode, itemDir: string): string => {
  if (node.type === 'text') return collapse(node.data);
  if (!isElement(node)) return '';
  const attrs = Object.entries(node.attribs)
    .filter(([name]) => !IGNORED_ATTRIBUTES.has(name) && !name.startsWith('xmlns'))
    .map(([name, value]) =>
      ASSET_ATTRIBUTES.includes(name) && isRelativeUrl(value) ? [name, normalizePath(joinPath(itemDir, value))] : [name, value]
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return `<${localName(node.name)}${attrs}>${node.children.map(child => canonical(child, itemDir)).join('')}</${localName(node.name)}>`;
};

/** The item content that could be a stimulus: its non-interaction layout column, or the leading blocks. */
const findCandidate = (path: string, xml: string): Candidate | null => {
  const $ = load(xml);
  const itemBody = $('qti-item-body').get(0);
  if (!itemBody) return null;
  const itemDir = dirname(path);
  const make = (blocks: Element[], column?: Element): Candidate | null =>
    blocks.length ? { path, $, blocks, keys: blocks.map(block => canonical(block, itemDir)), column } : null;

  const row = itemBody.children.find((node): node is Element => isElement(node) && hasClass(node, /^qti-layout-row$/));
  if (row) {
    const columns = row.children.filter((node): node is Element => isElement(node) && hasClass(node, /^qti-layout-col/));
    const column = columns.find(col => !containsQti(col));
    if (column && columns.some(col => col !== column && containsQti(col))) {
      return make(column.children.filter(isElement), column);
    }
  }

  const blocks: Element[] = [];
  for (const node of itemBody.children) {
    if (node.type === 'text' && !node.data.trim()) continue;
    if (!isElement(node) || !BLOCK_ELEMENTS.has(node.name) || containsQti(node)) break;
    blocks.push(node);
  }
  return make(blocks);
};

/** Longest run of consecutive equal keys in a and b: [startA, startB, length]. */
const longestCommonRun = (a: string[], b: string[]): [number, number, number] => {
  let best: [number, number, number] = [0, 0, 0];
  const lengths = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = b.length; j >= 1; j--) {
      lengths[j] = a[i - 1] === b[j - 1] ? lengths[j - 1] + 1 : 0;
      if (lengths[j] > best[2]) best = [i - lengths[j], j - lengths[j], lengths[j]];
    }
  }
  return best;
};

const indexOfRun = (keys: string[], run: string[]) => {
  for (let i = 0; i + run.length <= keys.length; i++) {
    if (run.every((key, k) => keys[i + k] === key)) return i;
  }
  return -1;
};

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return a.size + b.size === 0 ? 1 : shared / (a.size + b.size - shared);
};

const rebaseAssets = ($: cheerio.CheerioAPI, el: Element, fromDir: string, toDir: string, assets: Set<string>) => {
  for (const node of [el, ...descendants(el)]) {
    for (const attr of ASSET_ATTRIBUTES) {
      const value = node.attribs[attr];
      if (!value || !isRelativeUrl(value) || (attr === 'href' && localName(node.name) === 'a' && !/\.\w+$/.test(value))) continue;
      const absolute = normalizePath(joinPath(fromDir, value));
      assets.add(absolute);
      $(node).attr(attr, relativePath(toDir, absolute));
    }
  }
};

const removeWithLeadingWhitespace = ($: cheerio.CheerioAPI, el: Element) => {
  const previous = el.prev;
  if (previous?.type === 'text' && !previous.data.trim()) $(previous).remove();
  $(el).remove();
};

// Text is read with entities intact (decodeEntities: false), so only quotes need escaping for attributes
const escapeAttribute = (value: string) => value.replace(/"/g, '&quot;');

const byLocalName = ($: cheerio.CheerioAPI, name: string) =>
  $('*')
    .toArray()
    .filter((el): el is Element => isElement(el) && localName(el.name) === name);

/**
 * Moves content that is identical in two or more QTI 3 items into shared qti-assessment-stimulus files,
 * references them from the items and registers them in the manifest. Items without shared content are
 * returned unchanged (same content).
 */
export const extractSharedStimuli = (
  files: SharedStimulusPackageFiles,
  { minTextLength = 150, similarityThreshold = 0.9, stimulusFolder = 'stimuli' }: ExtractSharedStimuliOptions = {}
): { files: SharedStimulusPackageFiles; report: SharedStimuliReport } => {
  const candidates: Candidate[] = [];
  for (const [path, file] of files) {
    if (file.type !== 'item' && !(path.endsWith('.xml') && /<qti-assessment-item[\s>]/.test(decode(file.content)))) continue;
    const candidate = findCandidate(path, decode(file.content));
    if (candidate) candidates.push(candidate);
  }

  const runText = (candidate: Candidate, start: number, length: number) =>
    collapse(candidate.blocks.slice(start, start + length).map(block => candidate.$(block).text()).join(' '));
  // Enough text, or rich content (image, table, ...) with at least some text; a lone shared logo is not a stimulus
  const isWorthSharing = (candidate: Candidate, start: number, length: number) => {
    const textLength = runText(candidate, start, length).length;
    return textLength >= minTextLength || (textLength >= 40 && candidate.blocks.slice(start, start + length).some(isRich));
  };

  // Shared runs of blocks, longest (by text) first
  const runs = new Map<string, { keys: string[]; textLength: number }>();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const [start, , length] = longestCommonRun(candidates[i].keys, candidates[j].keys);
      if (length === 0 || !isWorthSharing(candidates[i], start, length)) continue;
      const keys = candidates[i].keys.slice(start, start + length);
      runs.set(keys.join('\u0000'), { keys, textLength: runText(candidates[i], start, length).length });
    }
  }

  const output: SharedStimulusPackageFiles = new Map(files);
  const report: SharedStimuliReport = { stimuli: [], nearDuplicates: [] };
  const assigned = new Map<Candidate, string>();
  const extractedText = new Map<Candidate, string>();
  const stimulusAssets = new Map<string, Set<string>>();

  for (const { keys } of [...runs.values()].sort((a, b) => b.textLength - a.textLength || b.keys.length - a.keys.length)) {
    const members = candidates
      .filter(candidate => !assigned.has(candidate))
      .map(candidate => ({ candidate, start: indexOfRun(candidate.keys, keys) }))
      .filter(({ start }) => start !== -1);
    if (members.length < 2) continue;

    let identifier = `STIM_${hash(keys.join('\u0000'))}`;
    while (output.has(normalizePath(`${stimulusFolder}/${identifier}.xml`))) identifier += '_';
    const stimulusPath = normalizePath(`${stimulusFolder}/${identifier}.xml`);
    const stimulusDir = dirname(stimulusPath);

    // The stimulus is built from the first item; the others have the same content
    const first = members[0];
    const $first = first.candidate.$;
    const firstDir = dirname(first.candidate.path);
    const assets = new Set<string>();
    const blocks = first.candidate.blocks.slice(first.start, first.start + keys.length);
    const heading = blocks.map(block => $first(block)).find($b => /^h[1-6]$/.test(($b.get(0) as Element).name));
    const text = collapse(blocks.map(block => $first(block).text()).join(' '));
    const title = heading ? collapse(heading.text()) : text.length > 60 ? `${text.slice(0, 57)}...` : text || identifier;

    const cloneRebased = (el: Element) => {
      const $clone = $first(el).clone();
      rebaseAssets($first, $clone.get(0) as Element, firstDir, stimulusDir, assets);
      return $first.xml($clone);
    };
    const body = blocks.map(cloneRebased).join('\n    ');
    const stylesheets = $first('qti-stylesheet').toArray().filter(isElement).map(cloneRebased);
    const itemRoot = $first('qti-assessment-item').get(0) as Element;
    const namespaces = Object.entries(itemRoot.attribs)
      .filter(([name]) => name.startsWith('xmlns:'))
      .map(([name, value]) => ` ${name}="${value}"`)
      .join('');
    const lang = itemRoot.attribs['xml:lang'] ? ` xml:lang="${itemRoot.attribs['xml:lang']}"` : '';
    output.set(stimulusPath, {
      type: 'other',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-stimulus xmlns="${QTI3_NAMESPACE}"${namespaces} identifier="${identifier}" title="${escapeAttribute(title)}"${lang}>
  ${stylesheets.map(s => `${s}\n  `).join('')}<qti-stimulus-body>
    ${body}
  </qti-stimulus-body>
</qti-assessment-stimulus>
`
    });
    stimulusAssets.set(identifier, assets);

    for (const { candidate, start } of members) {
      const { $, path } = candidate;
      extractedText.set(candidate, runText(candidate, start, keys.length));
      for (const block of candidate.blocks.slice(start, start + keys.length)) removeWithLeadingWhitespace($, block);
      if (candidate.column && !candidate.column.children.some(node => isElement(node) || (node.type === 'text' && node.data.trim()))) {
        const row = candidate.column.parent as Element;
        removeWithLeadingWhitespace($, candidate.column);
        const remaining = row.children.filter(isElement);
        if (remaining.length === 1) {
          $(row).replaceWith($(remaining[0]).contents());
        }
      }
      const root = $('qti-assessment-item').get(0) as Element;
      const insertBefore = root.children.find(
        (node): node is Element => isElement(node) && REF_INSERT_BEFORE.includes(node.name)
      );
      const ref = `<qti-assessment-stimulus-ref identifier="${identifier}" href="${relativePath(dirname(path), stimulusPath)}" title="${escapeAttribute(title)}"/>`;
      if (insertBefore) $(insertBefore).before(`${ref}\n  `);
      else $(root).append(ref);
      output.set(path, { ...files.get(path)!, content: $.xml() });
      assigned.set(candidate, identifier);
    }
    report.stimuli.push({ identifier, path: stimulusPath, title, items: members.map(m => m.candidate.path) });
  }

  // Report content that is almost, but not exactly, the same
  // Items that got a stimulus are compared on the extracted content, others on their whole candidate content
  const fullText = new Map(
    candidates.map(c => [c, extractedText.get(c) ?? collapse(c.blocks.map(b => c.$(b).text()).join(' '))])
  );
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const [a, b] = [candidates[i], candidates[j]];
      if (assigned.has(a) && assigned.get(a) === assigned.get(b)) continue;
      const [textA, textB] = [fullText.get(a)!, fullText.get(b)!];
      if (textA === textB || Math.min(textA.length, textB.length) < minTextLength) continue;
      const similarity = jaccard(words(textA), words(textB));
      if (similarity >= similarityThreshold) {
        report.nearDuplicates.push({ items: [a.path, b.path], similarity: Math.round(similarity * 100) / 100 });
      }
    }
  }

  if (report.stimuli.length > 0) updateManifest(output, report, stimulusAssets);
  return { files: output, report };
};

const updateManifest = (
  files: SharedStimulusPackageFiles,
  report: SharedStimuliReport,
  stimulusAssets: Map<string, Set<string>>
) => {
  const manifestPath = [...files.keys()].find(path => path === 'imsmanifest.xml' || path.endsWith('/imsmanifest.xml'));
  if (!manifestPath) return;
  const manifestDir = dirname(manifestPath);
  const $ = load(decode(files.get(manifestPath)!.content));
  const resources = byLocalName($, 'resources')[0];
  if (!resources) return;
  const prefix = resources.name.includes(':') ? `${resources.name.split(':')[0]}:` : '';
  const relative = (packagePath: string) => relativePath(manifestDir, packagePath);

  for (const stimulus of report.stimuli) {
    const fileEntries = [stimulus.path, ...[...stimulusAssets.get(stimulus.identifier)!].filter(asset => files.has(asset))]
      .map(path => `<${prefix}file href="${relative(path)}"/>`)
      .join('');
    $(resources).append(
      `<${prefix}resource identifier="${stimulus.identifier}" type="imsqti_stimulus_xmlv3p0" href="${relative(stimulus.path)}">${fileEntries}</${prefix}resource>`
    );
    for (const itemPath of stimulus.items) {
      const resource = byLocalName($, 'resource').find(
        el => normalizePath(joinPath(manifestDir, el.attribs.href || '')) === normalizePath(itemPath)
      );
      if (!resource) continue;
      const dependencies = $(resource)
        .children()
        .toArray()
        .filter((el): el is Element => isElement(el) && localName(el.name) === 'dependency');
      if (!dependencies.some(d => d.attribs.identifierref === stimulus.identifier)) {
        $(resource).append(`<${prefix}dependency identifierref="${stimulus.identifier}"/>`);
      }
    }
  }
  files.set(manifestPath, { ...files.get(manifestPath)!, content: $.xml() });
};

/** Runs extractSharedStimuli when the package options ask for it; returns the (possibly updated) files. */
export const extractSharedStimuliIfEnabled = <T extends SharedStimulusPackageFiles>(
  files: T,
  { extractSharedStimuli: enabled, onSharedStimuliReport }: SharedStimuliPackageOptions = {}
): T => {
  if (!enabled) return files;
  const result = extractSharedStimuli(files, typeof enabled === 'object' ? enabled : {});
  onSharedStimuliReport?.(result.report);
  return result.files as T;
};
