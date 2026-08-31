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

export function labelFromIndex(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
