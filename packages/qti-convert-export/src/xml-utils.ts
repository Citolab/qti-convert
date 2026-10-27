import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Strip QTI/XML namespaces so we can query with simple tag names. */
export function loadXml(xml: string): cheerio.CheerioAPI {
  const stripped = xml
    .replace(/\sxmlns(:\w+)?="[^"]*"/g, '')
    .replace(/\sxsi:schemaLocation="[^"]*"/g, '')
    .replace(/(<\/?)([\w]+):/g, '$1');
  return cheerio.load(stripped, { xmlMode: true, xml: { xmlMode: true } });
}

/** Decode numeric/named HTML entities that cheerio may leave in serialized HTML. */
export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes('&')) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rdquo;/gi, '\u201D')
    .replace(/&ldquo;/gi, '\u201C')
    .replace(/&deg;/gi, '\u00B0');
}

export function textContent($: cheerio.CheerioAPI, el: AnyNode | null | undefined): string {
  if (!el) return '';
  return decodeHtmlEntities(
    $(el)
      .text()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Inner HTML as serialized, entities intact, for content that is parsed again. */
export function rawInnerHtml($: cheerio.CheerioAPI, el: AnyNode | null | undefined): string {
  if (!el) return '';
  return ($(el).html() || '').replace(/\u00a0/g, ' ').trim();
}

const HTML_NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201D',
  ldquo: '\u201C',
  deg: '\u00B0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  euro: '\u20AC',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  times: '\u00D7',
  divide: '\u00F7',
  plusmn: '\u00B1',
  middot: '\u00B7',
  laquo: '\u00AB',
  raquo: '\u00BB',
  shy: '\u00AD',
  minus: '\u2212',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260'
};

/**
 * Decode HTML named entities that an XML parser leaves as text (`&nbsp;`).
 * XML entities (`&lt;`, `&amp;`) are already decoded by the parser and must
 * not be decoded twice.
 */
export function decodeHtmlNamedEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([a-z]+);/gi, (m, name: string) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function innerHtml($: cheerio.CheerioAPI, el: AnyNode | null | undefined): string {
  if (!el) return '';
  return decodeHtmlEntities(($(el).html() || '').replace(/\u00a0/g, ' ').trim());
}

export function guessContentType(pathOrUrl: string): string {
  const lower = pathOrUrl.toLowerCase().split('?')[0];
  if (lower.endsWith('.png') || lower.includes('image/png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.includes('image/jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('data:');
}

export function normalizePath(path: string): string {
  if (isRemoteUrl(path)) return path;
  return path.replace(/^\.\//, '').replace(/\\/g, '/');
}

/** Resolve a relative asset href against the item XML path inside the package. */
export function resolveAssetRef(src: string, itemHref: string): string {
  const trimmed = (src || '').trim();
  if (!trimmed || isRemoteUrl(trimmed)) return trimmed;
  const base = itemHref.includes('/') ? itemHref.slice(0, itemHref.lastIndexOf('/') + 1) : '';
  const joined = `${base}${trimmed.replace(/^\.\//, '')}`;
  const parts = joined.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** A, B, … Z, AA, AB, … */
export function labelFromIndex(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const QTI2_ELEMENTS = new Set([
  'assessmentItem',
  'assessmentStimulusRef',
  'responseDeclaration',
  'outcomeDeclaration',
  'templateDeclaration',
  'correctResponse',
  'defaultValue',
  'value',
  'mapping',
  'mapEntry',
  'areaMapping',
  'areaMapEntry',
  'itemBody',
  'rubricBlock',
  'feedbackBlock',
  'feedbackInline',
  'modalFeedback',
  'templateBlock',
  'templateInline',
  'printedVariable',
  'prompt',
  'simpleChoice',
  'simpleAssociableChoice',
  'simpleMatchSet',
  'gapText',
  'gapImg',
  'gap',
  'hottext',
  'hotspotChoice',
  'associableHotspot',
  'inlineChoice',
  'responseProcessing',
  'positionObjectStage',
  'stylesheet'
]);

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Rename QTI 2.x elements and attributes to their QTI 3 spelling in place
 * (`choiceInteraction maxChoices` → `qti-choice-interaction max-choices`), so
 * the parser only has to know one vocabulary. HTML content is left alone.
 */
export function normalizeQti2($: cheerio.CheerioAPI): void {
  $('*').each((_, node) => {
    const el = node as unknown as { name: string; attribs: Record<string, string> };
    if (!QTI2_ELEMENTS.has(el.name) && !/^[a-z][A-Za-z]*Interaction$/.test(el.name)) return;
    el.name = `qti-${kebab(el.name)}`;
    const attribs: Record<string, string> = {};
    for (const [key, value] of Object.entries(el.attribs)) {
      attribs[key.includes(':') ? key : kebab(key)] = value;
    }
    el.attribs = attribs;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Deterministic shuffle: the same item always prints in the same order. */
export function seededShuffle<T>(items: T[], seed: string, isFixed: (item: T) => boolean = () => false): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const random = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Fixed options keep their position; only the free slots are permuted.
  const freeSlots = items.map((item, i) => (isFixed(item) ? -1 : i)).filter(i => i >= 0);
  const free = freeSlots.map(i => items[i]);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const out = [...items];
  freeSlots.forEach((slot, i) => (out[slot] = free[i]));
  return out;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Buffer/btoa so it runs the same in Node and the browser. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64[c & 63] : '=';
  }
  return out;
}
