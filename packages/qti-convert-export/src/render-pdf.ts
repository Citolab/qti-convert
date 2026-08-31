import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatPoints, getLocaleStrings } from './locale.js';
import { exportDownloadNames, resolveFileNameBase } from './file-names.js';
import { plainFromHtml } from './html-to-docx.js';
import type { ExportOptions, PaperAssessment, PaperItem, PdfExportResult } from './types.js';
import { resolveCorrectionPlacement } from './types.js';

type DrawCtx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
  margin: number;
  width: number;
  locale: ReturnType<typeof getLocaleStrings>;
  assessment: PaperAssessment;
};

function ensureSpace(ctx: DrawCtx, needed: number) {
  if (ctx.y - needed < ctx.margin) {
    ctx.page = ctx.doc.addPage();
    const { height } = ctx.page.getSize();
    ctx.y = height - ctx.margin;
  }
}

/** Standard PDF fonts (WinAnsi) cannot encode many Unicode characters. */
function sanitizePdfText(text: string): string {
  const decoded = text
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
    .replace(/&deg;/gi, '\u00B0')
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'");

  return decoded
    .replace(/[→⟶]/g, '->')
    .replace(/[←⟵]/g, '<-')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[…]/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/[☐□]/g, '[ ]')
    .replace(/[○◯]/g, 'O')
    .replace(/[✓✔☑]/g, '[x]')
    .replace(/\u00B0/g, ' graden')
    .replace(/[^\x00-\xFF]/g, '?');
}

function drawText(
  ctx: DrawCtx,
  text: string,
  opts: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; indent?: number } = {}
) {
  const size = opts.size ?? 11;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const maxWidth = ctx.width - ctx.margin * 2 - (opts.indent || 0);
  const words = sanitizePdfText(text).split(/\s+/);
  let line = '';
  const lines: string[] = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  for (const l of lines) {
    ensureSpace(ctx, size + 4);
    ctx.page.drawText(l, {
      x: ctx.margin + (opts.indent || 0),
      y: ctx.y,
      size,
      font,
      color: opts.color || rgb(0.1, 0.1, 0.1),
    });
    ctx.y -= size + 4;
  }
}

function drawSpacer(ctx: DrawCtx, n = 8) {
  ctx.y -= n;
}

function drawBlank(ctx: DrawCtx, width = 40) {
  drawText(ctx, '_'.repeat(width), { size: 10, color: rgb(0.55, 0.55, 0.55) });
}

async function drawImage(ctx: DrawCtx, path: string, maxW = 280, maxH = 200) {
  const asset = ctx.assessment.assets.get(path);
  if (!asset) {
    drawText(ctx, `[image: ${path}]`, { size: 10, color: rgb(0.4, 0.4, 0.4) });
    return;
  }
  try {
    const img = asset.contentType.includes('png')
      ? await ctx.doc.embedPng(asset.bytes)
      : await ctx.doc.embedJpg(asset.bytes);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ensureSpace(ctx, h + 8);
    ctx.page.drawImage(img, { x: ctx.margin, y: ctx.y - h, width: w, height: h });
    ctx.y -= h + 8;
  } catch {
    drawText(ctx, `[image: ${path}]`, { size: 10, color: rgb(0.4, 0.4, 0.4) });
  }
}

function itemHeading(item: PaperItem, index: number, locale: DrawCtx['locale']): string {
  const pts = formatPoints(item.points, locale);
  return pts ? `${locale.question} ${index + 1}  ${pts}` : `${locale.question} ${index + 1}`;
}

async function drawItem(ctx: DrawCtx, item: PaperItem, index: number) {
  drawSpacer(ctx, 12);
  drawText(ctx, itemHeading(item, index, ctx.locale), { bold: true, size: 13 });
  drawSpacer(ctx, 4);

  for (const block of item.stimulus) {
    if (block.type === 'paragraph') {
      drawText(ctx, plainFromHtml(block.html));
    } else {
      await drawImage(ctx, block.assetPath, 280, 180);
    }
  }

  const ix = item.interaction;
  switch (ix.kind) {
    case 'choice':
      for (const c of ix.choices) {
        drawText(ctx, `${c.label}.  ${plainFromHtml(c.contentHtml)}`);
      }
      break;
    case 'textEntry':
      if (!ix.inline) {
        for (let i = 0; i < ix.blanks; i++) drawBlank(ctx);
      }
      break;
    case 'extendedText':
      for (let i = 0; i < ix.lines; i++) drawBlank(ctx, 56);
      break;
    case 'match':
      if (ix.mode === 'matrix') {
        drawText(
          ctx,
          ix.columns.map(c => plainFromHtml(c.contentHtml)).join('          '),
          { bold: true, size: 10 }
        );
        for (const row of ix.rows) {
          drawText(ctx, plainFromHtml(row.contentHtml));
          drawText(ctx, ix.columns.map(() => 'O').join('                    '));
        }
      } else {
        const bankTop = ix.bankPlacement !== 'answers';
        if (bankTop) {
          const bank = ix.rows.map(r => plainFromHtml(r.contentHtml)).join('   ');
          if (bank) drawText(ctx, bank, { size: 10 });
        }
        for (const col of ix.columns) {
          drawText(ctx, `${plainFromHtml(col.contentHtml)}:`);
          drawBlank(ctx, 40);
        }
        if (!bankTop) {
          drawText(ctx, ctx.locale.answersHeader, { bold: true, size: 10 });
          for (const row of ix.rows) {
            drawText(ctx, `-  ${plainFromHtml(row.contentHtml)}`, { size: 10 });
          }
        }
      }
      break;
    case 'inlineChoice':
      for (const slot of ix.slots) {
        const opts = slot.options
          .map(o => `${o.label}.  ${plainFromHtml(o.contentHtml)}`)
          .join('   ');
        drawText(ctx, `(${slot.number}):  ${opts}`);
      }
      break;
    case 'order':
      for (const c of ix.items) {
        drawText(ctx, `${c.label}.  ${plainFromHtml(c.contentHtml)}`);
      }
      drawText(ctx, ctx.locale.orderLabel, { bold: true, size: 10 });
      for (let i = 1; i <= ix.items.length; i++) {
        drawText(ctx, String(i));
        drawBlank(ctx, 24);
      }
      break;
    case 'gapMatch': {
      const bank = ix.options.map(o => plainFromHtml(o.contentHtml)).join('  /  ');
      if (bank) drawText(ctx, bank, { size: 10 });
      let line = '';
      for (const part of ix.parts) {
        if (part.type === 'text') {
          if (part.html.includes('\n')) {
            line += plainFromHtml(part.html.replace(/\n/g, ''));
            if (line.trim()) drawText(ctx, line.trim());
            line = '';
          } else {
            line += plainFromHtml(part.html);
          }
        } else {
          line += ' _________ ';
        }
      }
      if (line.trim()) drawText(ctx, line.trim());
      break;
    }
    case 'hottext':
      drawText(ctx, ctx.locale.hottextInstruction, { size: 9, color: rgb(0.35, 0.35, 0.35) });
      drawText(
        ctx,
        ix.parts.map(p => (p.type === 'hottext' ? `  ${p.text}  ` : p.text)).join('')
      );
      break;
    case 'selectPoint':
      await drawImage(ctx, ix.imageAsset, Math.min(ix.width || 360, 400), Math.min(ix.height || 280, 320));
      drawText(ctx, ix.instruction || ctx.locale.selectPointInstruction, {
        size: 9,
        color: rgb(0.35, 0.35, 0.35),
      });
      break;
    case 'unsupported':
      drawText(ctx, ix.fallbackNote, { size: 10, color: rgb(0.6, 0.3, 0) });
      break;
  }
}

function drawLearnerCover(ctx: DrawCtx) {
  const { locale, assessment } = ctx;
  drawText(ctx, locale.nameLabel);
  drawBlank(ctx, 40);
  drawText(ctx, locale.classLabel);
  drawBlank(ctx, 40);
  drawText(ctx, locale.dateLabel);
  drawBlank(ctx, 40);
  drawSpacer(ctx, 10);
  drawText(ctx, assessment.title, { bold: true, size: 18 });
  drawSpacer(ctx, 6);
  for (const line of assessment.instructions || []) {
    drawText(ctx, line, { size: 10 });
  }
  drawSpacer(ctx, 16);
}

function drawAnswerKey(ctx: DrawCtx) {
  const { locale, assessment } = ctx;
  drawText(ctx, assessment.title, { bold: true, size: 16 });
  drawText(ctx, locale.scoringGuidelines, { bold: true, size: 13 });
  drawText(ctx, locale.answerKeySubtitle, { size: 10, color: rgb(0.35, 0.35, 0.35) });
  if (assessment.author) {
    drawText(ctx, assessment.author, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  }
  drawSpacer(ctx, 12);

  assessment.items.forEach((item, i) => {
    drawSpacer(ctx, 8);
    drawText(ctx, itemHeading(item, i, locale), { bold: true, size: 11 });
    const summary = item.answerKey?.summary || locale.noAnswerKey;
    for (const line of summary.split('\n')) {
      drawText(ctx, line || ' ', { size: 10 });
    }
  });
}

async function buildPdf(
  assessment: PaperAssessment,
  options: ExportOptions,
  answerKeyOnly: boolean
): Promise<Uint8Array> {
  const locale = getLocaleStrings(options.locale || 'en');
  const doc = await PDFDocument.create();
  doc.setTitle(assessment.title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage();
  const { width, height } = page.getSize();
  const margin = 50;

  const ctx: DrawCtx = {
    doc,
    page,
    font,
    fontBold,
    y: height - margin,
    margin,
    width,
    locale,
    assessment,
  };

  if (answerKeyOnly) {
    drawAnswerKey(ctx);
  } else {
    drawLearnerCover(ctx);
    for (let i = 0; i < assessment.items.length; i++) {
      await drawItem(ctx, assessment.items[i], i);
    }
    drawSpacer(ctx, 20);
    drawText(ctx, locale.endOfTest, { size: 10, color: rgb(0.4, 0.4, 0.4) });

    const { inDocument } = resolveCorrectionPlacement(options);
    if (inDocument) {
      drawSpacer(ctx, 24);
      drawAnswerKey(ctx);
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = locale.pageOf(i + 1, pages.length);
    p.drawText(label, {
      x: margin,
      y: 24,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  });

  return doc.save();
}

export async function renderPdf(
  assessment: PaperAssessment,
  options: ExportOptions = {}
): Promise<PdfExportResult> {
  const { separate } = resolveCorrectionPlacement(options);
  const base = resolveFileNameBase(options.fileNameBase, assessment.title);
  const names = exportDownloadNames(base, 'pdf', options.locale || 'en');

  const assessmentBytes = await buildPdf(assessment, options, false);

  const result: PdfExportResult = {
    assessment: assessmentBytes,
    fileName: names.fileName,
  };

  if (separate) {
    result.answerKey = await buildPdf(assessment, options, true);
    result.answerKeyFileName = names.answerKeyFileName;
  }

  return result;
}
