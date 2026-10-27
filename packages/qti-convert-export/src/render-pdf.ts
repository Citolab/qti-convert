import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { composeDocument } from './compose.js';
import { exportDownloadNames, resolveFileNameBase } from './file-names.js';
import { rasterType } from './image-size.js';
import {
  COLOR,
  FONT_SIZE,
  PAGE,
  type ImageOverlay,
  type InlineNode,
  type LayoutBlock,
  type LayoutDocument,
  type LayoutImage,
  type TextStyle
} from './layout.js';
import type { ExportOptions, PaperAssessment, PaperAsset, PaperDocumentKind, PdfExportResult } from './types.js';
import { resolveCorrectionPlacement } from './types.js';

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont; mono: PDFFont };

type Ctx = {
  fonts: Fonts;
  images: Map<string, PDFImage | null>;
};

/** An unbreakable vertical slice of content; the flow puts boxes on pages. */
type Box = {
  height: number;
  /** Boxes sharing a group id move to a new page together when they fit on one. */
  group?: number;
  draw: (page: PDFPage, x: number, top: number) => void;
  keepNext?: boolean;
  spacer?: boolean;
  pageBreak?: boolean;
};

function hex(color: string): RGB {
  const n = parseInt(color, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ---------------------------------------------------------------------------
// Text encoding: the standard PDF fonts only cover Windows-1252.

const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const SUBSTITUTES: Record<string, string> = {
  '→': '->',
  '⟶': '->',
  '⇒': '=>',
  '←': '<-',
  '↔': '<->',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '−': '-',
  '√': 'sqrt',
  '∞': 'inf',
  π: 'pi',
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  Δ: 'Delta',
  θ: 'theta',
  λ: 'lambda',
  σ: 'sigma',
  Σ: 'Sigma',
  Ω: 'Ohm',
  ω: 'omega',
  μ: 'µ',
  '○': 'o',
  '●': '*',
  '☐': '[ ]',
  '☒': '[x]',
  '✓': 'v',
  '✔': 'v',
  ' ': ' ',
  '​': '',
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁰': '0',
  '­': ''
};

export function sanitizePdfText(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch)) out += ch;
    else if (ch === '\t' || ch === '\n') out += ' ';
    else out += SUBSTITUTES[ch] ?? '?';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline layout

type Atom = {
  width: number;
  /** Above / below the baseline */
  ascent: number;
  descent: number;
  space?: boolean;
  lineBreak?: boolean;
  draw: (page: PDFPage, x: number, baseline: number) => void;
};

function fontFor(ctx: Ctx, style: TextStyle = {}): PDFFont {
  if (style.mono) return ctx.fonts.mono;
  if (style.bold && style.italic) return ctx.fonts.boldItalic;
  if (style.bold) return ctx.fonts.bold;
  if (style.italic) return ctx.fonts.italic;
  return ctx.fonts.regular;
}

function textAtom(ctx: Ctx, value: string, style: TextStyle, size: number, color: RGB): Atom {
  const font = fontFor(ctx, style);
  const s = style.sup || style.sub ? size * 0.7 : size;
  const rise = style.sup ? size * 0.38 : style.sub ? -size * 0.15 : 0;
  const t = sanitizePdfText(value);
  const width = font.widthOfTextAtSize(t, s);
  const fill = style.color ? hex(style.color) : color;
  return {
    width,
    ascent: size * 0.92 + Math.max(0, rise),
    descent: size * 0.28,
    draw: (page, x, baseline) => {
      page.drawText(t, { x, y: baseline + rise, size: s, font, color: fill });
      if (style.underline) {
        page.drawLine({
          start: { x, y: baseline - 1.6 },
          end: { x: x + width, y: baseline - 1.6 },
          thickness: 0.6,
          color: fill
        });
      }
    }
  };
}

function spaceAtom(width: number): Atom {
  return { width, ascent: 0, descent: 0, space: true, draw: () => undefined };
}

/** A word wider than the line is cut into pieces that fit, with break points between them. */
function wordAtoms(ctx: Ctx, word: string, style: TextStyle, size: number, color: RGB, maxWidth: number): Atom[] {
  const atom = textAtom(ctx, word, style, size, color);
  if (atom.width <= maxWidth || word.length < 2) return [atom];
  const font = fontFor(ctx, style);
  const atoms: Atom[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && font.widthOfTextAtSize(sanitizePdfText(piece + ch), size) > maxWidth) {
      atoms.push(textAtom(ctx, piece, style, size, color), spaceAtom(0));
      piece = '';
    }
    piece += ch;
  }
  if (piece) atoms.push(textAtom(ctx, piece, style, size, color));
  return atoms;
}

function nodeAtoms(ctx: Ctx, node: InlineNode, size: number, color: RGB, maxWidth = Infinity): Atom[] {
  switch (node.t) {
    case 'text': {
      const atoms: Atom[] = [];
      const style = node.style ?? {};
      const spaceWidth = fontFor(ctx, style).widthOfTextAtSize(' ', size);
      for (const piece of node.text.split(/( +)/)) {
        if (!piece) continue;
        if (/^ +$/.test(piece)) atoms.push(spaceAtom(spaceWidth * piece.length));
        else atoms.push(...wordAtoms(ctx, piece.replace(/ /g, ' '), style, size, color, maxWidth));
      }
      return atoms;
    }
    case 'break':
      return [{ width: 0, ascent: 0, descent: 0, lineBreak: true, draw: () => undefined }];
    case 'space':
      return [spaceAtom(node.width)];
    case 'gap': {
      const label = node.label ? textAtom(ctx, `(${node.label})`, { bold: true }, size, color) : undefined;
      const fill =
        node.fill !== undefined ? textAtom(ctx, node.fill, { bold: true }, size, hex(COLOR.mark)) : undefined;
      const lineWidth = Math.max(node.width, (fill?.width ?? 0) + 8);
      const offset = label ? label.width + 3 : 0;
      return [
        {
          width: offset + lineWidth,
          ascent: size * 0.92,
          descent: size * 0.3,
          draw: (page, x, baseline) => {
            label?.draw(page, x, baseline);
            page.drawLine({
              start: { x: x + offset, y: baseline - 2 },
              end: { x: x + offset + lineWidth, y: baseline - 2 },
              thickness: 0.7,
              color: fill ? hex(COLOR.mark) : rgb(0.45, 0.45, 0.45)
            });
            fill?.draw(page, x + offset + 4, baseline);
          }
        }
      ];
    }
    case 'mark': {
      const d = size * 0.85;
      const label = node.label
        ? textAtom(ctx, node.label, { bold: node.filled }, size, node.filled ? hex(COLOR.mark) : color)
        : undefined;
      const stroke = node.filled ? hex(COLOR.mark) : rgb(0.1, 0.1, 0.1);
      return [
        {
          width: d + (label ? 3 + label.width : 0),
          ascent: d + 1,
          descent: 2,
          draw: (page, x, baseline) => {
            const cy = baseline + size * 0.32;
            if (node.shape === 'circle') {
              page.drawCircle({
                x: x + d / 2,
                y: cy,
                size: d / 2,
                borderWidth: 0.9,
                borderColor: stroke,
                color: node.filled ? stroke : undefined
              });
            } else {
              page.drawRectangle({
                x,
                y: cy - d / 2,
                width: d,
                height: d,
                borderWidth: 0.9,
                borderColor: stroke,
                color: node.filled ? stroke : undefined
              });
            }
            label?.draw(page, x + d + 3, baseline);
          }
        }
      ];
    }
    case 'box': {
      const inner = node.text ? textAtom(ctx, node.text, { bold: true }, size, hex(COLOR.mark)) : undefined;
      const width = Math.max(node.width ?? 22, (inner?.width ?? 0) + 8);
      return [
        {
          width,
          ascent: size + 3,
          descent: 5,
          draw: (page, x, baseline) => {
            page.drawRectangle({
              x,
              y: baseline - 4.5,
              width,
              height: size + 7,
              borderWidth: 0.8,
              borderColor: rgb(0, 0, 0)
            });
            inner?.draw(page, x + (width - inner.width) / 2, baseline);
          }
        }
      ];
    }
    case 'image': {
      const image = ctx.images.get(node.path);
      if (!image) return [textAtom(ctx, '[image]', { italic: true }, size, hex(COLOR.muted))];
      return [
        {
          width: node.width,
          ascent: node.height,
          descent: 1,
          draw: (page, x, baseline) => page.drawImage(image, { x, y: baseline, width: node.width, height: node.height })
        }
      ];
    }
  }
}

type Line = { atoms: Atom[]; x: number; width: number };

/** Greedy line breaking; breaks only at spaces so "Door" + superscript "A" stay together. */
function breakLines(atoms: Atom[], firstWidth: number, restWidth: number, firstX: number, restX: number): Line[] {
  const lines: Line[] = [];
  let current: Atom[] = [];
  let currentWidth = 0;
  const avail = () => (lines.length ? restWidth : firstWidth);
  const push = () => {
    while (current.length && current[current.length - 1].space) current.pop();
    lines.push({ atoms: current, x: lines.length ? restX : firstX, width: current.reduce((w, a) => w + a.width, 0) });
    current = [];
    currentWidth = 0;
  };
  let i = 0;
  while (i < atoms.length) {
    const atom = atoms[i];
    if (atom.lineBreak) {
      push();
      i++;
      continue;
    }
    if (atom.space) {
      if (current.length) {
        current.push(atom);
        currentWidth += atom.width;
      }
      i++;
      continue;
    }
    // Next unbreakable group
    let j = i;
    let groupWidth = 0;
    while (j < atoms.length && !atoms[j].space && !atoms[j].lineBreak) groupWidth += atoms[j++].width;
    if (current.length && currentWidth + groupWidth > avail()) push();
    for (let k = i; k < j; k++) {
      current.push(atoms[k]);
      currentWidth += atoms[k].width;
    }
    i = j;
  }
  if (current.length || !lines.length) push();
  return lines;
}

function paraBoxes(ctx: Ctx, block: Extract<LayoutBlock, { t: 'para' }>, width: number): Box[] {
  const style = block.style ?? 'body';
  const size = FONT_SIZE[style];
  const color = style === 'muted' ? hex(COLOR.muted) : style === 'note' ? hex(COLOR.note) : hex(COLOR.text);
  const atoms = block.content.flatMap(n =>
    nodeAtoms(ctx, n, size, color, width - (block.indent ?? 0) - (block.hanging ?? 0))
  );
  const indent = block.indent ?? 0;
  const hanging = block.hanging ?? 0;
  const noteBar = style === 'note' ? 10 : 0;
  const x0 = indent + noteBar;
  const lines = breakLines(atoms, width - x0, width - x0 - hanging, x0, x0 + hanging);
  const boxes: Box[] = [];
  if (block.spaceBefore) boxes.push({ height: block.spaceBefore, spacer: true, draw: () => undefined });
  lines.forEach((line, i) => {
    const ascent = Math.max(size * 0.92, ...line.atoms.map(a => a.ascent));
    const descent = Math.max(size * 0.28, ...line.atoms.map(a => a.descent));
    const height = ascent + descent + size * 0.2;
    const shift = block.align === 'center' ? (width - line.width - line.x) / 2 : 0;
    boxes.push({
      height,
      keepNext: block.keepNext,
      draw: (page, x, top) => {
        const baseline = top - ascent;
        let cx = x + line.x + shift;
        for (const atom of line.atoms) {
          atom.draw(page, cx, baseline);
          cx += atom.width;
        }
        if (noteBar) {
          page.drawLine({
            start: { x: x + indent + 2, y: top },
            end: { x: x + indent + 2, y: top - height },
            thickness: 1.5,
            color: hex('CC6600')
          });
        }
      }
    });
  });
  const after = block.spaceAfter ?? 6;
  if (after) boxes.push({ height: after, spacer: true, draw: () => undefined });
  return boxes;
}

// ---------------------------------------------------------------------------
// Images with overlays

function overlayCenter(o: ImageOverlay): [number, number] {
  const [a = 0, b = 0, c = 0, d = 0] = o.coords;
  if (o.shape === 'rect') return [(a + c) / 2, (b + d) / 2];
  if (o.shape === 'poly') {
    const n = Math.floor(o.coords.length / 2);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += o.coords[2 * i];
      sy += o.coords[2 * i + 1];
    }
    return n ? [sx / n, sy / n] : [0, 0];
  }
  return [a, b];
}

function drawOverlay(
  ctx: Ctx,
  page: PDFPage,
  o: ImageOverlay,
  left: number,
  top: number,
  sx: number,
  sy: number
): void {
  const [a = 0, b = 0, c = 0, d = 0] = o.coords;
  const red = hex(COLOR.mark);
  const area = {
    borderColor: red,
    borderWidth: 1.5,
    color: red,
    opacity: 0.15,
    borderOpacity: 1,
    borderDashArray: [4, 2]
  };
  if (o.outline) {
    if (o.shape === 'circle')
      page.drawEllipse({ x: left + a * sx, y: top - b * sy, xScale: c * sx, yScale: c * sy, ...area });
    else if (o.shape === 'ellipse')
      page.drawEllipse({ x: left + a * sx, y: top - b * sy, xScale: c * sx, yScale: d * sy, ...area });
    else if (o.shape === 'rect') {
      page.drawRectangle({
        x: left + Math.min(a, c) * sx,
        y: top - Math.max(b, d) * sy,
        width: Math.abs(c - a) * sx,
        height: Math.abs(d - b) * sy,
        ...area
      });
    } else if (o.shape === 'poly') {
      const n = Math.floor(o.coords.length / 2);
      const path =
        Array.from(
          { length: n },
          (_, i) => `${i ? 'L' : 'M'} ${o.coords[2 * i] * sx} ${o.coords[2 * i + 1] * sy}`
        ).join(' ') + ' Z';
      page.drawSvgPath(path, { x: left, y: top, ...area });
    }
  }
  if (o.label) {
    const [cx, cy] = overlayCenter(o);
    const x = left + cx * sx;
    const y = top - cy * sy;
    page.drawCircle({ x, y, size: 8.5, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    const t = sanitizePdfText(o.label);
    const w = ctx.fonts.bold.widthOfTextAtSize(t, 10);
    page.drawText(t, { x: x - w / 2, y: y - 3.5, size: 10, font: ctx.fonts.bold });
  }
}

function imageBoxes(ctx: Ctx, block: LayoutImage, width: number): Box[] {
  const image = ctx.images.get(block.path);
  if (!image) {
    return paraBoxes(
      ctx,
      { t: 'para', content: [{ t: 'text', text: `[${block.path}]`, style: { italic: true } }], style: 'muted' },
      width
    );
  }
  const scale = Math.min(1, (width - (block.indent ?? 0)) / block.width);
  const w = block.width * scale;
  const h = block.height * scale;
  const sx = w / (block.coordWidth ?? block.width);
  const sy = h / (block.coordHeight ?? block.height);
  return [
    {
      height: h + 12,
      draw: (page, x, top) => {
        const left = x + (block.indent ?? 0);
        const imgTop = top - 4;
        page.drawImage(image, { x: left, y: imgTop - h, width: w, height: h });
        for (const o of block.overlays ?? []) drawOverlay(ctx, page, o, left, imgTop, sx, sy);
      }
    }
  ];
}

// ---------------------------------------------------------------------------
// Blocks

const LINE_COLOR = () => hex(COLOR.rule);

function stack(boxes: Box[]): { height: number; draw: (page: PDFPage, x: number, top: number) => void } {
  // Inside a table cell there is no page flow: drop the trailing spacer and draw top-down.
  const items = [...boxes];
  while (items.length && items[items.length - 1].spacer) items.pop();
  return {
    height: items.reduce((h, b) => h + b.height, 0),
    draw: (page, x, top) => {
      let y = top;
      for (const b of items) {
        b.draw(page, x, y);
        y -= b.height;
      }
    }
  };
}

/** Split a cell's boxes into page-sized slices; one slice when it fits. */
function slices(boxes: Box[], max: number): Box[][] {
  const out: Box[][] = [[]];
  let height = 0;
  for (const box of boxes) {
    if (box.pageBreak) continue;
    if (height + box.height > max && out[out.length - 1].length) {
      out.push([]);
      height = 0;
    }
    out[out.length - 1].push(box);
    height += box.height;
  }
  return out;
}

function tableBoxes(ctx: Ctx, block: Extract<LayoutBlock, { t: 'table' }>, width: number): Box[] {
  const indent = block.indent ?? 0;
  const total = (width - indent) * (block.fill ?? 1);
  const sum = block.widths.reduce((a, b) => a + b, 0);
  const cols = block.widths.map(w => (total * w) / sum);
  const padX = block.borders === 'none' ? 2 : 5;
  const padY = block.borders === 'none' ? 1 : 4;
  const line = {
    thickness: block.borders === 'outer' ? 0.9 : 0.6,
    color: block.borders === 'outer' ? rgb(0, 0, 0) : LINE_COLOR()
  };

  // A row taller than a page continues on the next one, cut between lines.
  const maxSlice = PAGE.height - 2 * PAGE.margin - 2 * padY - 8;

  return block.rows
    .flatMap((row, r): Box[] => {
      const sliced = row.cells.map((cell, i) => slices(layoutBlocks(ctx, cell.blocks, cols[i] - 2 * padX), maxSlice));
      const count = Math.max(1, ...sliced.map(s => s.length));
      return Array.from({ length: count }, (_, s): Box => {
        const cells = sliced.map(cell => stack(cell[s] ?? []));
        const height = Math.max(12, ...cells.map(c => c.height)) + 2 * padY;
        const isFirst = r === 0 && s === 0;
        const isLast = r === block.rows.length - 1 && s === count - 1;
        return {
          height,
          draw: (page: PDFPage, x: number, top: number) => {
            let cx = x + indent;
            row.cells.forEach((cell, i) => {
              if (cell.shade) {
                page.drawRectangle({ x: cx, y: top - height, width: cols[i], height, color: hex(COLOR.shade) });
              }
              const content = cells[i];
              const offset = cell.align === 'center' && count === 1 ? (height - 2 * padY - content.height) / 2 : 0;
              content.draw(page, cx + padX, top - padY - offset);
              cx += cols[i];
            });
            const left = x + indent;
            const right = left + total;
            const h = (y: number) => page.drawLine({ start: { x: left, y }, end: { x: right, y }, ...line });
            const v = (vx: number) =>
              page.drawLine({ start: { x: vx, y: top }, end: { x: vx, y: top - height }, ...line });
            if (block.borders === 'grid') {
              h(top);
              h(top - height);
              let vx = left;
              v(vx);
              for (const c of cols) v((vx += c));
            } else if (block.borders === 'rows') {
              if (s === 0) h(top);
              if (isLast) h(top - height);
            } else if (block.borders === 'outer') {
              if (isFirst) h(top);
              if (isLast) h(top - height);
              v(left);
              v(right);
            }
          }
        };
      });
    })
    .concat([{ height: 6, spacer: true, draw: () => undefined }]);
}

let groupCounter = 0;

function layoutBlocks(ctx: Ctx, blocks: LayoutBlock[], width: number): Box[] {
  const out: Box[] = [];
  for (const block of blocks) {
    switch (block.t) {
      case 'para':
        out.push(...paraBoxes(ctx, block, width));
        break;
      case 'table':
        out.push(...tableBoxes(ctx, block, width));
        break;
      case 'image':
        out.push(...imageBoxes(ctx, block, width));
        break;
      case 'lines':
        for (let i = 0; i < block.count; i++) {
          const filled = block.texts?.[i];
          out.push({
            height: 24,
            draw: (page, x, top) => {
              const left = x + (block.indent ?? 0);
              page.drawLine({
                start: { x: left, y: top - 22 },
                end: { x: x + width, y: top - 22 },
                thickness: 0.6,
                color: LINE_COLOR()
              });
              if (filled)
                page.drawText(sanitizePdfText(filled), { x: left + 2, y: top - 19, size: 11, font: ctx.fonts.regular });
            }
          });
        }
        out.push({ height: 6, spacer: true, draw: () => undefined });
        break;
      case 'box':
        out.push({
          height: block.height + 8,
          draw: (page, x, top) => {
            const left = x + (block.indent ?? 0);
            page.drawRectangle({
              x: left,
              y: top - 4 - block.height,
              width: x + width - left,
              height: block.height,
              borderWidth: 0.9,
              borderColor: rgb(0, 0, 0)
            });
          }
        });
        break;
      case 'spacer':
        out.push({ height: block.height, spacer: true, draw: () => undefined });
        break;
      case 'pageBreak':
        out.push({ height: 0, pageBreak: true, draw: () => undefined });
        break;
      case 'group': {
        const id = ++groupCounter;
        for (const box of layoutBlocks(ctx, block.blocks, width)) out.push({ ...box, group: box.group ?? id });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Document

function imagePaths(blocks: LayoutBlock[], out = new Set<string>()): Set<string> {
  for (const block of blocks) {
    if (block.t === 'image') {
      out.add(block.path);
    } else if (block.t === 'para') {
      for (const n of block.content) if (n.t === 'image') out.add(n.path);
    } else if (block.t === 'table') {
      for (const row of block.rows) for (const cell of row.cells) imagePaths(cell.blocks, out);
    } else if (block.t === 'group') {
      imagePaths(block.blocks, out);
    }
  }
  return out;
}

async function embedImage(doc: PDFDocument, asset: PaperAsset | undefined): Promise<PDFImage | null> {
  if (!asset) return null;
  try {
    const type = rasterType(asset);
    if (type === 'png') return await doc.embedPng(asset.bytes);
    if (type === 'jpg') return await doc.embedJpg(asset.bytes);
  } catch {
    // Unsupported variant (e.g. CMYK JPEG, interlaced PNG): print a placeholder instead
  }
  return null;
}

/** Layout → PDF bytes. */
export async function layoutToPdf(layout: LayoutDocument, assets: Map<string, PaperAsset>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(layout.title);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier)
  };
  const images = new Map<string, PDFImage | null>();
  for (const path of imagePaths(layout.blocks)) images.set(path, await embedImage(doc, assets.get(path)));
  const ctx: Ctx = { fonts, images };

  const width = PAGE.contentWidth;
  const bottom = PAGE.margin;
  const pageTop = PAGE.height - PAGE.margin;
  const boxes = layoutBlocks(ctx, layout.blocks, width);

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = pageTop;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = pageTop;
  };

  let placedGroup: number | undefined;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box.pageBreak) {
      if (y < pageTop) newPage();
      continue;
    }
    if (box.spacer) {
      if (y < pageTop) y -= box.height;
      continue;
    }
    // Start a question on a fresh page rather than split it, when it fits on one
    if (box.group !== undefined && box.group !== placedGroup && y < pageTop) {
      let groupHeight = 0;
      for (let k = i; boxes[k]?.group === box.group; k++) groupHeight += boxes[k].height;
      if (groupHeight <= pageTop - bottom && y - groupHeight < bottom) newPage();
    }
    let needed = box.height;
    // Keep headings with the first line of what follows them
    if (box.keepNext) {
      let k = i + 1;
      while (boxes[k]?.spacer || boxes[k]?.keepNext) needed += boxes[k++].height;
      if (boxes[k]) needed += boxes[k].height;
    }
    if (y - Math.min(needed, pageTop - bottom) < bottom && y < pageTop) newPage();
    box.draw(page, PAGE.margin, y);
    y -= box.height;
    placedGroup = box.group;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (layout.header) {
      p.drawText(sanitizePdfText(layout.header), {
        x: PAGE.margin,
        y: PAGE.height - 32,
        size: 8,
        font: fonts.regular,
        color: rgb(0.53, 0.53, 0.53)
      });
    }
    const label = sanitizePdfText(layout.pageLabel(i + 1, pages.length));
    const w = fonts.regular.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (PAGE.width - w) / 2, y: 28, size: 8, font: fonts.regular, color: rgb(0.45, 0.45, 0.45) });
  });

  return doc.save();
}

/** Render one paper document (workbook, questions, answer sheet or answer key) to PDF. */
export async function renderPdfDocument(
  assessment: PaperAssessment,
  kind: PaperDocumentKind,
  options: ExportOptions = {}
): Promise<Uint8Array> {
  return layoutToPdf(composeDocument(assessment, kind, options), assessment.assets);
}

/**
 * Classic export: one PDF with answer space in place, plus the answer key
 * appended and/or as a separate document.
 */
export async function renderPdf(assessment: PaperAssessment, options: ExportOptions = {}): Promise<PdfExportResult> {
  const { inDocument, separate } = resolveCorrectionPlacement(options);
  const base = resolveFileNameBase(options.fileNameBase, assessment.title);
  const names = exportDownloadNames(base, 'pdf', options.locale || 'en');
  const result: PdfExportResult = {
    assessment: await layoutToPdf(
      composeDocument(assessment, 'workbook', { ...options, appendAnswerKey: inDocument }),
      assessment.assets
    ),
    fileName: names.fileName
  };
  if (separate) {
    result.answerKey = await renderPdfDocument(assessment, 'answerKey', options);
    result.answerKeyFileName = names.answerKeyFileName;
  }
  return result;
}
