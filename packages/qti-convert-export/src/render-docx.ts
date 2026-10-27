import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type FileChild,
  type IBorderOptions,
  type ParagraphChild
} from 'docx';
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
  type LayoutImage
} from './layout.js';
import type { DocxExportResult, ExportOptions, PaperAssessment, PaperAsset, PaperDocumentKind } from './types.js';
import { resolveCorrectionPlacement } from './types.js';
import { escapeHtml, toBase64 } from './xml-utils.js';

const TWIP = 20;
const PT_TO_PX = 4 / 3;
const SYMBOL_FONT = 'Segoe UI Symbol';
/** Rough width of a non-breaking space at 11pt, for padding boxes and blanks. */
const NBSP_WIDTH = 2.8;
/** 1×1 transparent PNG: fallback for SVG-only images in Word versions without SVG support. */
const BLANK_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130
]);

type Ctx = { assets: Map<string, PaperAsset>; width: number };

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: COLOR.rule };
const DARK: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: '000000' };

function nbsp(width: number): string {
  return ' '.repeat(Math.max(1, Math.round(width / NBSP_WIDTH)));
}

function imageRun(asset: PaperAsset, width: number, height: number): ImageRun | undefined {
  const type = rasterType(asset);
  const transformation = { width: Math.round(width * PT_TO_PX), height: Math.round(height * PT_TO_PX) };
  const altText = { title: asset.path, description: asset.path, name: asset.path };
  if (type === 'png' || type === 'jpg' || type === 'gif') {
    return new ImageRun({ type, data: asset.bytes, transformation, altText });
  }
  if (type === 'svg') {
    return new ImageRun({
      type: 'svg',
      data: asset.bytes,
      fallback: { type: 'png', data: BLANK_PNG },
      transformation,
      altText
    });
  }
  return undefined;
}

function overlaySvg(o: ImageOverlay, unit: number): string {
  const [a = 0, b = 0, c = 0, d = 0] = o.coords;
  let shape = '';
  let cx = a;
  let cy = b;
  const outline = `fill="#C00000" fill-opacity="0.15" stroke="#C00000" stroke-width="${2 * unit}" stroke-dasharray="${4 * unit} ${2 * unit}"`;
  if (o.shape === 'circle') {
    if (o.outline) shape = `<circle cx="${a}" cy="${b}" r="${c}" ${outline}/>`;
  } else if (o.shape === 'ellipse') {
    if (o.outline) shape = `<ellipse cx="${a}" cy="${b}" rx="${c}" ry="${d}" ${outline}/>`;
  } else if (o.shape === 'rect') {
    cx = (a + c) / 2;
    cy = (b + d) / 2;
    if (o.outline)
      shape = `<rect x="${Math.min(a, c)}" y="${Math.min(b, d)}" width="${Math.abs(c - a)}" height="${Math.abs(d - b)}" ${outline}/>`;
  } else if (o.shape === 'poly') {
    const pts: string[] = [];
    let sx = 0;
    let sy = 0;
    const n = Math.floor(o.coords.length / 2);
    for (let i = 0; i < n; i++) {
      pts.push(`${o.coords[2 * i]},${o.coords[2 * i + 1]}`);
      sx += o.coords[2 * i];
      sy += o.coords[2 * i + 1];
    }
    cx = n ? sx / n : 0;
    cy = n ? sy / n : 0;
    if (o.outline) shape = `<polygon points="${pts.join(' ')}" ${outline}/>`;
  }
  if (!o.label) return shape;
  const r = 9 * unit;
  return (
    `${shape}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" stroke="#000000" stroke-width="${1.5 * unit}"/>` +
    `<text x="${cx}" y="${cy}" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${11 * unit}">${escapeHtml(o.label)}</text>`
  );
}

/** Raster image with labels or answer areas drawn on top, as SVG with the plain image as fallback. */
function overlayImageRun(asset: PaperAsset, block: LayoutImage): ImageRun | undefined {
  const type = rasterType(asset);
  const cw = block.coordWidth ?? block.width;
  const ch = block.coordHeight ?? block.height;
  const unit = cw / block.width; // coordinate units per printed point
  const mime = type === 'svg' ? 'image/svg+xml' : type === 'jpg' ? 'image/jpeg' : `image/${type}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(block.width * PT_TO_PX)}" height="${Math.round(block.height * PT_TO_PX)}" viewBox="0 0 ${cw} ${ch}">` +
    `<image x="0" y="0" width="${cw}" height="${ch}" preserveAspectRatio="none" xlink:href="data:${mime};base64,${toBase64(asset.bytes)}" href="data:${mime};base64,${toBase64(asset.bytes)}"/>` +
    (block.overlays ?? []).map(o => overlaySvg(o, unit)).join('') +
    `</svg>`;
  const fallback =
    type === 'png' || type === 'jpg' || type === 'gif'
      ? { type, data: asset.bytes }
      : { type: 'png' as const, data: BLANK_PNG };
  return new ImageRun({
    type: 'svg',
    data: new TextEncoder().encode(svg),
    fallback,
    transformation: { width: Math.round(block.width * PT_TO_PX), height: Math.round(block.height * PT_TO_PX) },
    altText: { title: asset.path, description: asset.path, name: asset.path }
  });
}

function inlineRuns(ctx: Ctx, nodes: InlineNode[], size: number, baseColor?: string): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  const half = (pt: number) => Math.round(pt * 2);
  for (const node of nodes) {
    switch (node.t) {
      case 'text': {
        const s = node.style ?? {};
        runs.push(
          new TextRun({
            text: node.text,
            bold: s.bold,
            italics: s.italic,
            underline: s.underline ? {} : undefined,
            superScript: s.sup,
            subScript: s.sub,
            color: s.color ?? baseColor,
            size: half(s.size ?? size),
            font: s.mono ? 'Consolas' : undefined
          })
        );
        break;
      }
      case 'break':
        runs.push(new TextRun({ break: 1 }));
        break;
      case 'space':
        runs.push(new TextRun({ text: nbsp(node.width), size: half(size) }));
        break;
      case 'gap':
        if (node.label) runs.push(new TextRun({ text: `(${node.label}) `, bold: true, size: half(size) }));
        if (node.fill !== undefined) {
          runs.push(
            new TextRun({ text: ` ${node.fill} `, bold: true, underline: {}, size: half(size), color: COLOR.mark })
          );
        } else {
          runs.push(
            new TextRun({
              text: '_'.repeat(Math.max(4, Math.round(node.width / 5.6))),
              color: '888888',
              size: half(size)
            })
          );
        }
        break;
      case 'mark': {
        const glyph = node.shape === 'circle' ? (node.filled ? '●' : '○') : node.filled ? '☒' : '☐';
        runs.push(
          new TextRun({
            text: glyph,
            font: SYMBOL_FONT,
            size: half(size + 2),
            color: node.filled ? COLOR.mark : undefined
          })
        );
        if (node.label)
          runs.push(
            new TextRun({
              text: ` ${node.label}`,
              bold: node.filled,
              size: half(size),
              color: node.filled ? COLOR.mark : undefined
            })
          );
        break;
      }
      case 'box': {
        const content = node.text ?? '';
        const pad = nbsp(Math.max(NBSP_WIDTH, ((node.width ?? 22) - content.length * 6.5) / 2));
        runs.push(
          new TextRun({
            text: `${pad}${content}${pad}`,
            bold: true,
            color: content ? COLOR.mark : undefined,
            size: half(size),
            border: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 }
          })
        );
        break;
      }
      case 'image': {
        const asset = ctx.assets.get(node.path);
        const run = asset && imageRun(asset, node.width, node.height);
        runs.push(run ?? new TextRun({ text: `[${node.path}]`, italics: true, color: COLOR.muted }));
        break;
      }
    }
  }
  return runs;
}

function tableBorders(kind: Extract<LayoutBlock, { t: 'table' }>['borders']) {
  switch (kind) {
    case 'grid':
      return { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };
    case 'rows':
      return { top: LINE, bottom: LINE, left: NONE, right: NONE, insideHorizontal: LINE, insideVertical: NONE };
    case 'outer':
      return { top: DARK, bottom: DARK, left: DARK, right: DARK, insideHorizontal: NONE, insideVertical: NONE };
    case 'none':
      return { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
  }
}

/** Word keeps a question together through "keep with next" on all but its last paragraph. */
function keepTogether(blocks: LayoutBlock[]): LayoutBlock[] {
  return blocks.map((b, i) => (b.t === 'para' && i < blocks.length - 1 ? { ...b, keepNext: true } : b));
}

function blockChildren(ctx: Ctx, blocks: LayoutBlock[]): FileChild[] {
  const out: FileChild[] = [];
  for (const block of blocks) {
    switch (block.t) {
      case 'para': {
        const style = block.style ?? 'body';
        const color = style === 'muted' ? COLOR.muted : style === 'note' ? COLOR.note : undefined;
        const hanging = block.hanging ?? 0;
        out.push(
          new Paragraph({
            children: inlineRuns(ctx, block.content, FONT_SIZE[style], color),
            alignment: block.align === 'center' ? AlignmentType.CENTER : undefined,
            keepNext: block.keepNext,
            indent:
              block.indent || hanging
                ? { left: ((block.indent ?? 0) + hanging) * TWIP, hanging: hanging * TWIP }
                : undefined,
            spacing: { before: (block.spaceBefore ?? 0) * TWIP, after: (block.spaceAfter ?? 6) * TWIP },
            border:
              style === 'note'
                ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'CC6600', space: 8 } }
                : undefined
          })
        );
        break;
      }
      case 'table': {
        // Word rejects a table without rows
        if (!block.rows.length) break;
        const total = (ctx.width - (block.indent ?? 0)) * (block.fill ?? 1);
        const sum = block.widths.reduce((a, b) => a + b, 0);
        const columns = block.widths.map(w => Math.round(((total * w) / sum) * TWIP));
        out.push(
          new Table({
            width: { size: Math.round(total * TWIP), type: WidthType.DXA },
            columnWidths: columns,
            indent: block.indent ? { size: block.indent * TWIP, type: WidthType.DXA } : undefined,
            borders: tableBorders(block.borders),
            rows: block.rows.map(
              row =>
                new TableRow({
                  cantSplit: true,
                  tableHeader: row.header,
                  children: row.cells.map((cell, i) => {
                    const cellCtx = { ...ctx, width: columns[i] / TWIP - 10 };
                    const children = blockChildren(cellCtx, cell.blocks);
                    // Word requires a cell to end in a paragraph
                    if (!children.length || children[children.length - 1] instanceof Table)
                      children.push(new Paragraph({}));
                    return new TableCell({
                      width: { size: columns[i], type: WidthType.DXA },
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                      shading: cell.shade ? { fill: COLOR.shade } : undefined,
                      verticalAlign: cell.align === 'center' ? VerticalAlignTable.CENTER : undefined,
                      children: children as (Paragraph | Table)[]
                    });
                  })
                })
            )
          })
        );
        break;
      }
      case 'image': {
        const asset = ctx.assets.get(block.path);
        const run =
          asset &&
          (block.overlays?.length ? overlayImageRun(asset, block) : imageRun(asset, block.width, block.height));
        out.push(
          new Paragraph({
            spacing: { before: 80, after: 120 },
            indent: block.indent ? { left: block.indent * TWIP } : undefined,
            children: [run ?? new TextRun({ text: `[${block.path}]`, italics: true, color: COLOR.muted })]
          })
        );
        break;
      }
      case 'lines':
        out.push(
          new Table({
            width: { size: Math.round((ctx.width - (block.indent ?? 0)) * TWIP), type: WidthType.DXA },
            columnWidths: [Math.round((ctx.width - (block.indent ?? 0)) * TWIP)],
            indent: block.indent ? { size: block.indent * TWIP, type: WidthType.DXA } : undefined,
            borders: { top: NONE, left: NONE, right: NONE, bottom: LINE, insideHorizontal: LINE, insideVertical: NONE },
            rows: Array.from(
              { length: block.count },
              (_, i) =>
                new TableRow({
                  height: { value: 26 * TWIP, rule: HeightRule.EXACT },
                  children: [
                    new TableCell({
                      verticalAlign: VerticalAlignTable.BOTTOM,
                      children: [new Paragraph({ children: [new TextRun({ text: block.texts?.[i] ?? '', size: 22 })] })]
                    })
                  ]
                })
            )
          })
        );
        out.push(new Paragraph({ spacing: { after: 80 } }));
        break;
      case 'box':
        out.push(
          new Table({
            width: { size: Math.round((ctx.width - (block.indent ?? 0)) * TWIP), type: WidthType.DXA },
            columnWidths: [Math.round((ctx.width - (block.indent ?? 0)) * TWIP)],
            borders: { top: DARK, bottom: DARK, left: DARK, right: DARK, insideHorizontal: NONE, insideVertical: NONE },
            rows: [
              new TableRow({
                height: { value: block.height * TWIP, rule: HeightRule.EXACT },
                children: [new TableCell({ children: [new Paragraph({})] })]
              })
            ]
          })
        );
        out.push(new Paragraph({ spacing: { after: 80 } }));
        break;
      case 'spacer':
        out.push(
          new Paragraph({
            spacing: { before: 0, after: 0, line: Math.max(1, block.height) * TWIP, lineRule: LineRuleType.EXACT }
          })
        );
        break;
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'group':
        out.push(...blockChildren(ctx, keepTogether(block.blocks)));
        break;
    }
  }
  return out;
}

/** "Pagina {n} van {total}" with live page fields. */
function pageLabelRuns(doc: LayoutDocument): TextRun[] {
  const sample = doc.pageLabel(9991, 9992);
  const runs: TextRun[] = [];
  for (const piece of sample.split(/(9991|9992)/)) {
    if (piece === '9991') runs.push(new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLOR.muted }));
    else if (piece === '9992')
      runs.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: COLOR.muted }));
    else if (piece) runs.push(new TextRun({ text: piece, size: 16, color: COLOR.muted }));
  }
  return runs;
}

/** Layout → .docx bytes. */
export async function layoutToDocx(doc: LayoutDocument, assets: Map<string, PaperAsset>): Promise<Uint8Array> {
  const ctx: Ctx = { assets, width: PAGE.contentWidth };
  const document = new Document({
    title: doc.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: Math.round(PAGE.width * TWIP), height: Math.round(PAGE.height * TWIP) },
            margin: {
              top: PAGE.margin * TWIP,
              bottom: PAGE.margin * TWIP,
              left: PAGE.margin * TWIP,
              right: PAGE.margin * TWIP,
              header: 24 * TWIP,
              footer: 24 * TWIP
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({ children: [new TextRun({ text: doc.header ?? '', size: 16, color: '888888' })] })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: pageLabelRuns(doc) })]
          })
        },
        children: blockChildren(ctx, doc.blocks)
      }
    ]
  });
  // Browsers and Web Workers have no Buffer; Packer.toBuffer only works in Node
  if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
    const blob = await Packer.toBlob(document);
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await Packer.toBuffer(document));
}

/** Render one paper document (workbook, questions, answer sheet or answer key) to Word. */
export async function renderDocxDocument(
  assessment: PaperAssessment,
  kind: PaperDocumentKind,
  options: ExportOptions = {}
): Promise<Uint8Array> {
  return layoutToDocx(composeDocument(assessment, kind, options), assessment.assets);
}

/**
 * Classic export: one Word document with answer space in place, plus the answer
 * key appended and/or as a separate document.
 */
export async function renderDocx(assessment: PaperAssessment, options: ExportOptions = {}): Promise<DocxExportResult> {
  const { inDocument, separate } = resolveCorrectionPlacement(options);
  const base = resolveFileNameBase(options.fileNameBase, assessment.title);
  const names = exportDownloadNames(base, 'docx', options.locale || 'en');
  const result: DocxExportResult = {
    assessment: await layoutToDocx(
      composeDocument(assessment, 'workbook', { ...options, appendAnswerKey: inDocument }),
      assessment.assets
    ),
    fileName: names.fileName
  };
  if (separate) {
    result.answerKey = await renderDocxDocument(assessment, 'answerKey', options);
    result.answerKeyFileName = names.answerKeyFileName;
  }
  return result;
}
