import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  ImageRun,
  type FileChild,
} from 'docx';
import { blocksToParagraphs, plainFromHtml } from './html-to-docx.js';
import { formatPoints, getLocaleStrings } from './locale.js';
import { exportDownloadNames, resolveFileNameBase } from './file-names.js';
import type {
  DocxExportResult,
  ExportOptions,
  PaperAssessment,
  PaperAsset,
  PaperItem,
} from './types.js';
import { resolveCorrectionPlacement } from './types.js';

function blankLine(width = 48): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: '_'.repeat(width), color: '888888' })],
  });
}

function heading(text: string, size = 28): Paragraph {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    children: [new TextRun({ text, bold: true, size })],
  });
}

function normal(text: string, opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size || 22,
        color: opts.color,
      }),
    ],
  });
}

function imageParagraph(
  assets: Map<string, PaperAsset>,
  path: string,
  width = 320,
  height = 240
): Paragraph | null {
  const asset = assets.get(path);
  if (!asset) return null;
  const type = asset.contentType.includes('png') ? 'png' : asset.contentType.includes('gif') ? 'gif' : 'jpg';
  try {
    return new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [
        new ImageRun({
          type,
          data: asset.bytes,
          transformation: { width, height },
          altText: { title: path, description: path, name: path },
        }),
      ],
    });
  } catch {
    return null;
  }
}

function renderInteraction(
  item: PaperItem,
  assets: Map<string, PaperAsset>,
  locale: ReturnType<typeof getLocaleStrings>
): FileChild[] {
  const out: FileChild[] = [];
  const ix = item.interaction;

  switch (ix.kind) {
    case 'choice': {
      // Kennisnet: "A.  Tin (Sn)" — no circle prefix
      for (const c of ix.choices) {
        out.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `${c.label}.  `, bold: true, size: 22 }),
              new TextRun({ text: plainFromHtml(c.contentHtml), size: 22 }),
            ],
          })
        );
      }
      break;
    }
    case 'textEntry': {
      if (!ix.inline) {
        for (let i = 0; i < ix.blanks; i++) out.push(blankLine());
      }
      break;
    }
    case 'extendedText': {
      for (let i = 0; i < ix.lines; i++) out.push(blankLine(56));
      break;
    }
    case 'match': {
      if (ix.mode === 'matrix') {
        // Juist / Onjuist header + circles per statement
        out.push(
          new Paragraph({
            spacing: { after: 80 },
            children: ix.columns.map(
              (c, i) =>
                new TextRun({
                  text: `${plainFromHtml(c.contentHtml)}${i < ix.columns.length - 1 ? '          ' : ''}`,
                  bold: true,
                  size: 20,
                })
            ),
          })
        );
        for (const row of ix.rows) {
          out.push(normal(plainFromHtml(row.contentHtml), { size: 22 }));
          out.push(
            new Paragraph({
              spacing: { after: 120 },
              children: ix.columns.flatMap((_, i) => [
                new TextRun({ text: '◯', size: 24 }),
                new TextRun({ text: i < ix.columns.length - 1 ? '                    ' : '', size: 22 }),
              ]),
            })
          );
        }
      } else {
        // Kennisnet:
        // - bank top (default): show rows as bank, columns as "label:" blanks
        // - bank answers (qti-choices-right): columns as blanks, rows under ANTWOORDEN
        const bankTop = ix.bankPlacement !== 'answers';
        if (bankTop) {
          const bank = ix.rows.map(r => plainFromHtml(r.contentHtml)).join('   ');
          if (bank) out.push(normal(bank, { size: 20 }));
        }
        for (const col of ix.columns) {
          out.push(
            new Paragraph({
              spacing: { after: 60 },
              children: [
                new TextRun({ text: `${plainFromHtml(col.contentHtml)}:`, size: 22 }),
              ],
            })
          );
          out.push(blankLine(40));
        }
        if (!bankTop) {
          out.push(normal(locale.answersHeader, { bold: true, size: 20 }));
          for (const row of ix.rows) {
            out.push(normal(`•  ${plainFromHtml(row.contentHtml)}`, { size: 20 }));
          }
        }
      }
      break;
    }
    case 'inlineChoice': {
      for (const slot of ix.slots) {
        const opts = slot.options
          .map(o => `${o.label}.  ${plainFromHtml(o.contentHtml)}`)
          .join('   ');
        out.push(normal(`(${slot.number}):  ${opts}`, { size: 22 }));
      }
      break;
    }
    case 'order': {
      for (const c of ix.items) {
        out.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `${c.label}.  `, bold: true, size: 22 }),
              new TextRun({ text: plainFromHtml(c.contentHtml), size: 22 }),
            ],
          })
        );
      }
      out.push(normal(locale.orderLabel, { bold: true, size: 20 }));
      for (let i = 1; i <= ix.items.length; i++) {
        out.push(normal(String(i), { size: 22 }));
        out.push(blankLine(24));
      }
      break;
    }
    case 'gapMatch': {
      const bank = ix.options.map(o => plainFromHtml(o.contentHtml)).join('  /  ');
      if (bank) out.push(normal(bank, { size: 20 }));
      let line = '';
      const flush = () => {
        if (line.trim()) out.push(normal(line.trim(), { size: 22 }));
        line = '';
      };
      for (const part of ix.parts) {
        if (part.type === 'text') {
          if (part.html.includes('\n')) {
            line += plainFromHtml(part.html.replace(/\n/g, ''));
            flush();
          } else {
            line += plainFromHtml(part.html);
          }
        } else {
          line += ' _________ ';
        }
      }
      flush();
      break;
    }
    case 'hottext': {
      out.push(normal(locale.hottextInstruction, { italics: true, size: 18, color: '555555' }));
      const runs: TextRun[] = [];
      for (const part of ix.parts) {
        if (part.type === 'text') {
          runs.push(new TextRun({ text: part.text, size: 22 }));
        } else {
          runs.push(new TextRun({ text: `  ${part.text}  `, size: 22 }));
        }
      }
      out.push(new Paragraph({ spacing: { after: 120 }, children: runs }));
      break;
    }
    case 'selectPoint': {
      const img = imageParagraph(
        assets,
        ix.imageAsset,
        Math.min(ix.width || 400, 480),
        Math.min(ix.height || 300, 360)
      );
      if (img) out.push(img);
      out.push(normal(ix.instruction || locale.selectPointInstruction, { italics: true, size: 18, color: '555555' }));
      break;
    }
    case 'unsupported': {
      out.push(
        new Paragraph({
          spacing: { after: 100 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: 'CC6600', space: 8 },
          },
          children: [new TextRun({ text: ix.fallbackNote, italics: true, color: '994400', size: 20 })],
        })
      );
      break;
    }
  }
  return out;
}

function learnerCover(
  assessment: PaperAssessment,
  locale: ReturnType<typeof getLocaleStrings>
): FileChild[] {
  const out: FileChild[] = [
    normal(locale.nameLabel, { size: 22 }),
    blankLine(40),
    normal(locale.classLabel, { size: 22 }),
    blankLine(40),
    normal(locale.dateLabel, { size: 22 }),
    blankLine(40),
    new Paragraph({
      spacing: { before: 200, after: 160 },
      children: [new TextRun({ text: assessment.title, bold: true, size: 36 })],
    }),
  ];
  for (const line of assessment.instructions || []) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: line, size: 20 })],
      })
    );
  }
  out.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  return out;
}

function itemChildren(
  item: PaperItem,
  index: number,
  assets: Map<string, PaperAsset>,
  locale: ReturnType<typeof getLocaleStrings>
): FileChild[] {
  const pts = formatPoints(item.points, locale);
  const title = pts
    ? `${locale.question} ${index + 1}  ${pts}`
    : `${locale.question} ${index + 1}`;
  const out: FileChild[] = [heading(title, 24)];
  out.push(...blocksToParagraphs(item.stimulus, assets));
  out.push(...renderInteraction(item, assets, locale));
  return out;
}

function answerKeyChildren(
  assessment: PaperAssessment,
  locale: ReturnType<typeof getLocaleStrings>
): FileChild[] {
  const out: FileChild[] = [
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: assessment.title, bold: true, size: 32 })],
    }),
    normal(locale.scoringGuidelines, { bold: true, size: 24 }),
    normal(locale.answerKeySubtitle, { italics: true, size: 18, color: '555555' }),
  ];
  if (assessment.author) {
    out.push(normal(`${assessment.author}`, { size: 18, color: '555555' }));
  }
  out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

  assessment.items.forEach((item, i) => {
    const pts = formatPoints(item.points, locale);
    const title = pts
      ? `${locale.question} ${i + 1}  ${pts}`
      : `${locale.question} ${i + 1}`;
    out.push(heading(title, 22));
    const summary = item.answerKey?.summary || locale.noAnswerKey;
    for (const line of summary.split('\n')) {
      out.push(normal(line || ' ', { size: 20 }));
    }
  });
  return out;
}

async function buildDoc(children: FileChild[], title: string): Promise<Uint8Array> {
  const doc = new Document({
    title,
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: title, size: 14, color: '888888' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], size: 14 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  if (typeof Packer.toBlob === 'function' && typeof window !== 'undefined') {
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

export async function renderDocx(
  assessment: PaperAssessment,
  options: ExportOptions = {}
): Promise<DocxExportResult> {
  const locale = getLocaleStrings(options.locale || 'en');
  const { inDocument, separate } = resolveCorrectionPlacement(options);

  const learnerChildren: FileChild[] = [...learnerCover(assessment, locale)];
  assessment.items.forEach((item, i) => {
    learnerChildren.push(...itemChildren(item, i, assessment.assets, locale));
  });
  learnerChildren.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: locale.endOfTest, italics: true, size: 20, color: '666666' })],
    })
  );

  if (inDocument) {
    learnerChildren.push(new Paragraph({ children: [] }));
    learnerChildren.push(...answerKeyChildren(assessment, locale));
  }

  const base = resolveFileNameBase(options.fileNameBase, assessment.title);
  const names = exportDownloadNames(base, 'docx', options.locale || 'en');
  const assessmentBytes = await buildDoc(learnerChildren, assessment.title);
  const result: DocxExportResult = {
    assessment: assessmentBytes,
    fileName: names.fileName,
  };

  if (separate) {
    const keyChildren = answerKeyChildren(assessment, locale);
    result.answerKey = await buildDoc(keyChildren, `${assessment.title} — ${locale.answerKeyTitle}`);
    result.answerKeyFileName = names.answerKeyFileName;
  }

  return result;
}