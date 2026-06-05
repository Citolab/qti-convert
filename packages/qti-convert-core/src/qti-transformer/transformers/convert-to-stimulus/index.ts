import * as cheerio from 'cheerio';

const QTI3_NS = 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0';
const STIMULUS_RESOURCE_TYPE = 'imsqti_stimulus_xmlv3p0';

export interface ConvertToStimulusOptions {
  /** Directory (package-root relative) where new stimulus files are written. Default `ref/`. */
  refDir?: string;
  /** Minimum number of items that must share identical left-column content. Default 2. */
  minItems?: number;
}

export interface ManifestFile {
  path: string;
  xml: string;
}

export interface ConvertToStimulusInput {
  /** Map of package-root-relative item path -> item XML. */
  items: Map<string, string>;
  /** Optional manifest to receive stimulus resource entries + dependencies. */
  manifest?: ManifestFile;
}

export interface ConvertToStimulusResult {
  /** All items; entries whose left column was extracted are rewritten, the rest are unchanged. */
  items: Map<string, string>;
  /** New stimulus files (package-root-relative path -> XML). */
  stimuli: Map<string, string>;
  /** The manifest, updated when one was supplied. */
  manifest?: ManifestFile;
}

const loadXml = (xml: string) => cheerio.load(xml, { xmlMode: true, xml: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;

function hasClass($: cheerio.CheerioAPI, el: El, cls: string): boolean {
  return ($(el).attr('class') ?? '').split(/\s+/).includes(cls);
}

/** Collapse insignificant whitespace so two serializations of equal content compare equal. */
function normalizeContent(html: string): string {
  return html
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic, dependency-free FNV-1a hash rendered as base36 (browser + node safe). */
function hashContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Package-root-relative path from the directory of `fromPath` to `toPath`. */
function relativeHref(fromPath: string, toPath: string): string {
  const fromDir = fromPath.split('/').slice(0, -1);
  const to = toPath.split('/');

  let i = 0;
  while (i < fromDir.length && i < to.length - 1 && fromDir[i] === to[i]) i++;

  const ups = fromDir.slice(i).map(() => '..');
  const downs = to.slice(i);
  const parts = [...ups, ...downs];
  return parts.length > 0 ? parts.join('/') : to[to.length - 1];
}

/** Find the left column (first `qti-layout-col6`) of the first two-column row, if any. */
function findLeftColumn($: cheerio.CheerioAPI): El | null {
  const rows = $('div')
    .toArray()
    .filter(e => hasClass($, e, 'qti-layout-row'));

  for (const row of rows) {
    const cols = $(row)
      .children()
      .toArray()
      .filter(e => hasClass($, e, 'qti-layout-col6'));
    if (cols.length >= 2) return cols[0];
  }
  return null;
}

interface ItemCandidate {
  path: string;
  $: cheerio.CheerioAPI;
  leftColumn: El;
  innerXml: string;
  key: string;
}

/**
 * Detects items that share identical left-column content (`div.qti-layout-row >
 * div.qti-layout-col6`), extracts that content into a shared `qti-assessment-stimulus` file, and
 * rewrites each sharing item to reference the stimulus (an in-body `div.qti-shared-stimulus` plus
 * a top-level `qti-assessment-stimulus-ref`). Optionally updates the package manifest.
 */
export async function convertToStimulus(
  input: ConvertToStimulusInput,
  options?: ConvertToStimulusOptions
): Promise<ConvertToStimulusResult> {
  const refDir = (options?.refDir ?? 'ref/').replace(/\/?$/, '/');
  const minItems = options?.minItems ?? 2;

  const items = new Map(input.items);
  const stimuli = new Map<string, string>();
  const stimulusIdByPath = new Map<string, string>(); // stimulus path -> identifier

  // 1. Collect candidate left columns, grouped by normalized content.
  const byKey = new Map<string, ItemCandidate[]>();
  for (const [path, xml] of input.items) {
    const $ = loadXml(xml);

    // Skip items that already reference a stimulus.
    if ($('qti-assessment-stimulus-ref').length > 0) continue;
    if ($('div').toArray().some(e => hasClass($, e, 'qti-shared-stimulus'))) continue;

    const leftColumn = findLeftColumn($);
    if (!leftColumn) continue;

    const innerXml = ($(leftColumn).html() ?? '').trim();
    if (!innerXml) continue;

    const key = normalizeContent(innerXml);
    const candidate: ItemCandidate = { path, $, leftColumn, innerXml, key };
    const bucket = byKey.get(key);
    if (bucket) bucket.push(candidate);
    else byKey.set(key, [candidate]);
  }

  // 2. For each shared group, build a stimulus and rewrite the items.
  const itemStimulusIds = new Map<string, string>(); // item path -> stimulus identifier
  for (const group of byKey.values()) {
    if (group.length < minItems) continue;

    const hash = hashContent(group[0].key);
    const identifier = `RES-stimulus-${hash}`;
    const stimulusPath = `${refDir}stimulus-${hash}.xml`;

    stimuli.set(
      stimulusPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<qti-assessment-stimulus xmlns="${QTI3_NS}" identifier="${identifier}" title="stimulus-${hash}">\n` +
        `  <qti-stimulus-body>${group[0].innerXml}</qti-stimulus-body>\n` +
        `</qti-assessment-stimulus>\n`
    );
    stimulusIdByPath.set(stimulusPath, identifier);

    for (const candidate of group) {
      const { $, leftColumn, path } = candidate;
      const href = relativeHref(path, stimulusPath);

      $(leftColumn)
        .empty()
        .append(`<div class="qti-shared-stimulus" data-stimulus-idref="${identifier}" />`);

      const ref = `<qti-assessment-stimulus-ref identifier="${identifier}" href="${href}" />`;
      const body = $('qti-item-body').first();
      if (body.length > 0) body.before(ref);
      else $.root().children().first().append(ref);

      items.set(path, $.xml());
      itemStimulusIds.set(path, identifier);
    }
  }

  // 3. Update the manifest with stimulus resources + item dependencies.
  let manifest = input.manifest;
  if (manifest && stimuli.size > 0) {
    manifest = {
      path: manifest.path,
      xml: updateManifest(manifest.xml, stimulusIdByPath, itemStimulusIds)
    };
  }

  return { items, stimuli, manifest };
}

function updateManifest(
  manifestXml: string,
  stimulusIdByPath: Map<string, string>,
  itemStimulusIds: Map<string, string>
): string {
  const $ = loadXml(manifestXml);
  const resources = $('resources').first();
  if (resources.length === 0) return manifestXml;

  for (const [stimulusPath, identifier] of stimulusIdByPath) {
    resources.append(
      `<resource identifier="${identifier}" type="${STIMULUS_RESOURCE_TYPE}" href="${stimulusPath}"><file href="${stimulusPath}" /></resource>`
    );
  }

  for (const [itemPath, identifier] of itemStimulusIds) {
    const resource = $('resource')
      .toArray()
      .find(e => $(e).attr('href') === itemPath);
    if (resource) $(resource).append(`<dependency identifierref="${identifier}" />`);
  }

  return $.xml();
}
