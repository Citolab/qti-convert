import type { AnyNode, Element } from 'domhandler';
import type { CheerioAPI } from 'cheerio';
import { imageSize } from './image-size.js';
import {
  COLOR,
  type InlineNode,
  type LayoutBlock,
  type LayoutCell,
  type LayoutRow,
  type ParaStyle,
  type TextStyle
} from './layout.js';
import type { LocaleStrings } from './locale.js';
import type { PaperAsset } from './types.js';
import { decodeHtmlEntities, decodeHtmlNamedEntities, loadXml } from './xml-utils.js';

export type HtmlContext = {
  assets: Map<string, PaperAsset>;
  locale: LocaleStrings;
  /** Available width in points for images and tables. */
  maxWidth: number;
};

export type ImageBox = { width: number; height: number; coordWidth: number; coordHeight: number };

const PX_TO_PT = 0.75;

/**
 * Printed size of an image in points. Declared HTML sizes win; missing sides
 * follow the image's real aspect ratio instead of a guessed 4:3.
 */
export function imageBox(
  assets: Map<string, PaperAsset>,
  path: string,
  declared: { width?: number; height?: number },
  limits: { maxWidth: number; maxHeight?: number; minWidth?: number }
): ImageBox | undefined {
  const asset = assets.get(path);
  if (!asset) return undefined;
  const intrinsic = imageSize(asset);
  const ratio = intrinsic ? intrinsic.height / intrinsic.width : 0.75;
  const w = declared.width ?? (declared.height ? declared.height / ratio : (intrinsic?.width ?? 320));
  const h = declared.height ?? w * ratio;
  let width = w * PX_TO_PT;
  let height = h * PX_TO_PT;
  if (limits.minWidth && width < limits.minWidth) {
    height *= limits.minWidth / width;
    width = limits.minWidth;
  }
  const maxHeight = limits.maxHeight ?? 340;
  const scale = Math.min(1, limits.maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale, coordWidth: w, coordHeight: h };
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'pre',
  'hr',
  'address',
  'center',
  'details',
  'summary',
  'paper-media',
  'qti-content-body',
  'qti-stimulus-body',
  'qti-template-block'
]);

const MATH_OPERATORS = new Set(['=', '+', '-', '−', '×', '÷', '<', '>', '≤', '≥', '≠', '≈', '±', '·', '→', '⇒']);

function nameOf(node: AnyNode): string {
  const el = node as Element;
  return (el.tagName || el.name || '').toLowerCase();
}

function isTag(node: AnyNode): node is Element {
  return node.type === 'tag';
}

function intAttr(el: Element, name: string): number | undefined {
  const raw = el.attribs?.[name] ?? '';
  if (raw.includes('%')) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n <= 0 ? undefined : n;
}

class HtmlWalker {
  readonly blocks: LayoutBlock[] = [];
  private buffer: InlineNode[] = [];

  constructor(
    private readonly $: CheerioAPI,
    private readonly ctx: HtmlContext,
    private readonly indent: number,
    private readonly paraStyle: ParaStyle
  ) {}

  flush(extra: Partial<Extract<LayoutBlock, { t: 'para' }>> = {}): void {
    const content = trimInline(this.buffer);
    this.buffer = [];
    if (!content.length) return;
    this.blocks.push({
      t: 'para',
      content,
      style: this.paraStyle,
      indent: this.indent || undefined,
      ...extra
    });
  }

  private pushText(value: string, style: TextStyle): void {
    let t = decodeHtmlNamedEntities(value).replace(/\s+/g, ' ');
    if (!t) return;
    const last = this.buffer[this.buffer.length - 1];
    const lastEndsSpace = !last || last.t === 'break' || (last.t === 'text' && /\s$/.test(last.text));
    if (lastEndsSpace) t = t.replace(/^ /, '');
    if (!t) return;
    this.buffer.push(Object.keys(style).length ? { t: 'text', text: t, style: { ...style } } : { t: 'text', text: t });
  }

  /** Nested block content (list items, table cells) rendered by a fresh walker. */
  private sub(nodes: AnyNode[], indent: number, maxWidth = this.ctx.maxWidth): LayoutBlock[] {
    const walker = new HtmlWalker(this.$, { ...this.ctx, maxWidth }, indent, this.paraStyle);
    walker.walk(nodes, {});
    walker.flush();
    return walker.blocks;
  }

  walk(nodes: AnyNode[], style: TextStyle): void {
    for (const node of nodes) {
      if (node.type === 'text') {
        this.pushText(this.$(node).text(), style);
        continue;
      }
      if (!isTag(node)) continue;
      const name = nameOf(node);
      if (BLOCK_TAGS.has(name)) this.block(node, name, style);
      else this.inline(node, name, style);
    }
  }

  private children(node: Element): AnyNode[] {
    return this.$(node).contents().toArray();
  }

  private block(node: Element, name: string, style: TextStyle): void {
    this.flush();
    switch (name) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        this.walk(this.children(node), { ...style, bold: true });
        this.flush({ style: name === 'h1' || name === 'h2' ? 'heading' : 'subheading', keepNext: true });
        return;
      case 'blockquote':
        this.blocks.push(...this.sub(this.children(node), this.indent + 18));
        return;
      case 'ul':
      case 'ol':
        this.list(node, name === 'ol');
        return;
      case 'table':
        this.table(node);
        return;
      case 'hr':
        this.blocks.push({ t: 'spacer', height: 8 });
        return;
      case 'pre':
        this.walk(this.children(node), { ...style, mono: true });
        this.flush();
        return;
      case 'paper-media': {
        const type = (node.attribs.type || 'media') as 'audio' | 'video' | 'media';
        this.blocks.push({
          t: 'para',
          content: [
            { t: 'text', text: this.ctx.locale.media[type] ?? this.ctx.locale.media.media, style: { italic: true } }
          ],
          style: 'note'
        });
        return;
      }
      default:
        this.walk(this.children(node), style);
        this.flush();
    }
  }

  private list(node: Element, ordered: boolean): void {
    let n = 0;
    const start = intAttr(node, 'start') ?? 1;
    for (const li of this.children(node)) {
      if (!isTag(li) || nameOf(li) !== 'li') continue;
      const marker = ordered ? `${start + n}.` : '•';
      n++;
      const blocks = this.sub(this.children(li), this.indent + 18, this.ctx.maxWidth - 18);
      const first = blocks[0];
      if (first?.t === 'para') {
        first.content = [{ t: 'text', text: `${marker}  ` }, ...first.content];
        first.hanging = 14;
      } else {
        blocks.unshift({ t: 'para', content: [{ t: 'text', text: marker }], indent: this.indent + 18, hanging: 14 });
      }
      this.blocks.push(...blocks);
    }
  }

  private table(node: Element): void {
    const $ = this.$;
    const rows: LayoutRow[] = [];
    const trs = $(node)
      .find('tr')
      .filter((_, tr) => $(tr).closest('table').get(0) === node);
    const columnCount = Math.max(1, ...trs.toArray().map(tr => $(tr).children('td, th').length));
    const cellWidth = (this.ctx.maxWidth - this.indent) / columnCount - 12;
    trs.each((_, tr) => {
      const cells: LayoutCell[] = [];
      let allHeader = true;
      $(tr)
        .children('td, th')
        .each((__, cell) => {
          const isHeader = nameOf(cell) === 'th';
          allHeader &&= isHeader;
          const walker = new HtmlWalker($, { ...this.ctx, maxWidth: cellWidth }, 0, this.paraStyle);
          walker.walk(this.children(cell), isHeader ? { bold: true } : {});
          walker.flush();
          cells.push({ blocks: walker.blocks, shade: isHeader });
          // Approximate colspan by padding; paper tables rarely need true spans
          for (let i = 1; i < (intAttr(cell as Element, 'colspan') ?? 1); i++)
            cells.push({ blocks: [], shade: isHeader });
        });
      if (cells.length) rows.push({ cells, header: allHeader });
    });
    if (!rows.length) return;
    const columns = Math.max(...rows.map(r => r.cells.length));
    for (const row of rows) while (row.cells.length < columns) row.cells.push({ blocks: [] });
    this.blocks.push({
      t: 'table',
      widths: Array(columns).fill(1),
      rows,
      borders: 'grid',
      indent: this.indent || undefined
    });
  }

  private image(node: Element): void {
    const path = node.attribs.src || '';
    const box = imageBox(
      this.ctx.assets,
      path,
      { width: intAttr(node, 'width'), height: intAttr(node, 'height') },
      { maxWidth: this.ctx.maxWidth - this.indent }
    );
    if (!box) {
      this.pushText(this.ctx.locale.imageMissing(node.attribs.alt || path), { italic: true, color: COLOR.muted });
      return;
    }
    // Small images (icons, formulas) stay in the line; others get their own block.
    if (box.height <= 24) {
      this.buffer.push({ t: 'image', path, width: box.width, height: box.height });
      return;
    }
    this.flush();
    this.blocks.push({ t: 'image', path, width: box.width, height: box.height, indent: this.indent || undefined });
  }

  private inline(node: Element, name: string, style: TextStyle): void {
    const kids = () => this.children(node);
    switch (name) {
      case 'br':
        this.buffer.push({ t: 'break' });
        return;
      case 'b':
      case 'strong':
        this.walk(kids(), { ...style, bold: true });
        return;
      case 'i':
      case 'em':
      case 'cite':
      case 'var':
        this.walk(kids(), { ...style, italic: true });
        return;
      case 'u':
      case 'ins':
        this.walk(kids(), { ...style, underline: true });
        return;
      case 'sup':
        this.walk(kids(), { ...style, sup: true });
        return;
      case 'sub':
        this.walk(kids(), { ...style, sub: true });
        return;
      case 'code':
      case 'kbd':
      case 'samp':
        this.walk(kids(), { ...style, mono: true });
        return;
      case 'img':
        this.image(node);
        return;
      case 'math':
        this.buffer.push(...mathInline(this.$, node, style));
        return;
      case 'paper-gap': {
        const len = intAttr(node, 'len') ?? 10;
        this.buffer.push({ t: 'gap', label: node.attribs.n || undefined, width: Math.min(200, Math.max(56, len * 7)) });
        return;
      }
      case 'paper-hottext':
        this.walk(kids(), { ...style, underline: true });
        this.buffer.push({ t: 'text', text: node.attribs.label || '', style: { ...style, sup: true, bold: true } });
        return;
      case 'script':
      case 'style':
      case 'annotation':
      case 'annotation-xml':
        return;
      default:
        this.walk(kids(), style);
    }
  }
}

/** Drop leading/trailing whitespace and breaks so paragraphs start and end cleanly. */
function trimInline(nodes: InlineNode[]): InlineNode[] {
  const out = [...nodes];
  while (out.length && (out[0].t === 'break' || (out[0].t === 'text' && !out[0].text.trim()))) out.shift();
  while (
    out.length &&
    (out[out.length - 1].t === 'break' ||
      (out[out.length - 1].t === 'text' && !(out[out.length - 1] as { text: string }).text.trim()))
  ) {
    out.pop();
  }
  if (out[0]?.t === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.t === 'text') out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
  return out;
}

/** MathML → styled text runs (x², H₂O, a/b, √(x)). Good enough for school maths on paper. */
function mathInline($: CheerioAPI, node: AnyNode, style: TextStyle): InlineNode[] {
  const kids = isTag(node) ? $(node).children().toArray() : [];
  const all = (nodes: AnyNode[], s: TextStyle) => nodes.flatMap(n => mathInline($, n, s));
  const plain = (nodes: InlineNode[]) => nodes.map(n => (n.t === 'text' ? n.text : '')).join('');
  const t = (value: string, s: TextStyle = style): InlineNode => ({ t: 'text', text: value, style: { ...s } });

  switch (nameOf(node)) {
    case 'mi': {
      const value = $(node).text().trim();
      const italic =
        value.length === 1 && /[a-zA-Z]/.test(value) && (node as Element).attribs?.mathvariant !== 'normal';
      return [t(value, italic ? { ...style, italic: true } : style)];
    }
    case 'mn':
    case 'mtext':
    case 'ms':
      return [t($(node).text().trim())];
    case 'mo': {
      const op = $(node).text().trim();
      return [t(MATH_OPERATORS.has(op) ? ` ${op} ` : op)];
    }
    case 'mspace':
      return [t(' ')];
    case 'msup':
      return [...mathInline($, kids[0], style), ...all(kids.slice(1, 2), { ...style, sup: true })];
    case 'msub':
      return [...mathInline($, kids[0], style), ...all(kids.slice(1, 2), { ...style, sub: true })];
    case 'msubsup':
      return [
        ...mathInline($, kids[0], style),
        ...all(kids.slice(1, 2), { ...style, sub: true }),
        ...all(kids.slice(2, 3), { ...style, sup: true })
      ];
    case 'mfrac': {
      const num = kids[0] ? mathInline($, kids[0], style) : [];
      const den = kids[1] ? mathInline($, kids[1], style) : [];
      const simple = (n: InlineNode[]) => /^[\w.,]+$/.test(plain(n).trim());
      const wrapIf = (n: InlineNode[]) => (simple(n) ? n : [t('('), ...n, t(')')]);
      return [...wrapIf(num), t('/'), ...wrapIf(den)];
    }
    case 'msqrt':
      return [t('√('), ...all(kids, style), t(')')];
    case 'mroot':
      return [...all(kids.slice(1, 2), { ...style, sup: true }), t('√('), ...all(kids.slice(0, 1), style), t(')')];
    case 'mfenced': {
      const el = node as Element;
      const open = el.attribs?.open ?? '(';
      const close = el.attribs?.close ?? ')';
      const sep = el.attribs?.separators ?? ',';
      const parts = kids.flatMap((k, i) =>
        i ? [t(sep[Math.min(i - 1, sep.length - 1)] || ','), ...mathInline($, k, style)] : mathInline($, k, style)
      );
      return [t(open), ...parts, t(close)];
    }
    case 'mover':
    case 'munderover':
      return [...mathInline($, kids[0], style), ...all(kids.slice(1), { ...style, sup: true })];
    case 'munder':
      return [...mathInline($, kids[0], style), ...all(kids.slice(1), { ...style, sub: true })];
    case 'mtable':
      return kids.flatMap((row, i) => [...(i ? [{ t: 'break' } as InlineNode] : []), ...mathInline($, row, style)]);
    case 'mtd':
      return [...all(kids, style), t('  ')];
    case 'semantics':
      return kids[0] ? mathInline($, kids[0], style) : [];
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
      return [];
    default:
      if (node.type === 'text') {
        const value = $(node).text().trim();
        return value ? [t(value)] : [];
      }
      return all(kids, style);
  }
}

/** Item HTML → layout blocks. */
export function htmlToBlocks(
  html: string | undefined,
  ctx: HtmlContext,
  opts: { indent?: number; style?: ParaStyle } = {}
): LayoutBlock[] {
  if (!html?.trim()) return [];
  const $ = loadXml(`<paper-root>${html}</paper-root>`);
  const walker = new HtmlWalker($, ctx, opts.indent ?? 0, opts.style ?? 'body');
  walker.walk($('paper-root').contents().toArray(), {});
  walker.flush();
  return walker.blocks;
}

/** Item HTML → inline nodes only (option labels, word banks); block structure is flattened. */
export function htmlToInline(html: string | undefined, ctx: HtmlContext): InlineNode[] {
  const blocks = htmlToBlocks(html, { ...ctx, maxWidth: Math.min(ctx.maxWidth, 160) });
  const out: InlineNode[] = [];
  for (const block of blocks) {
    if (out.length) out.push({ t: 'text', text: ' ' });
    if (block.t === 'para') out.push(...block.content);
    else if (block.t === 'image') out.push({ t: 'image', path: block.path, width: block.width, height: block.height });
  }
  return out;
}

/** Plain text of item HTML, for answer key summaries. */
export function plainFromHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
