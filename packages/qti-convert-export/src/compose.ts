/**
 * Paper designs. Every interaction has
 *  - content: what the student reads (options, word bank, image with letters),
 *  - an answer area: where the answer goes (bubbles, boxes, blanks, lines),
 *  - the same answer area filled in, for the answer key.
 * The workbook puts content and answer area together; the booklet + answer
 * sheet split them; the answer key mirrors the answer sheet.
 */
import { htmlToBlocks, htmlToInline, imageBox, plainFromHtml, type HtmlContext } from './html-to-layout.js';
import {
  COLOR,
  PAGE,
  para,
  text,
  type ImageOverlay,
  type InlineNode,
  type LayoutBlock,
  type LayoutDocument,
  type LayoutRow
} from './layout.js';
import { formatPoints, getLocaleStrings, type LocaleStrings } from './locale.js';
import type {
  ExportOptions,
  PaperAssessment,
  PaperDocumentKind,
  PaperHotspot,
  PaperImageRef,
  PaperInteraction,
  PaperItem,
  PaperItemPart,
  PaperOption
} from './types.js';

type Ix<K extends PaperInteraction['kind']> = Extract<PaperInteraction, { kind: K }>;

type Ctx = {
  paper: PaperAssessment;
  locale: LocaleStrings;
  html: HtmlContext;
};

type Mode = 'workbook' | 'questions';

const OPTION_INDENT = 22;
/** Width of the answer column on the answer sheet and answer key. */
const AREA_WIDTH = PAGE.contentWidth * 0.8;
const MAX_GRID_COLUMNS = 6;

function muted(value: string): LayoutBlock {
  return para([text(value, { italic: true })], { style: 'muted', spaceAfter: 4 });
}

function note(value: string): LayoutBlock {
  return para([text(value, { italic: true })], { style: 'note' });
}

function ctxWithWidth(ctx: Ctx, maxWidth: number): Ctx {
  return { ...ctx, html: { ...ctx.html, maxWidth } };
}

// ---------------------------------------------------------------------------
// Building blocks

/** "A.  option text" (optionally preceded by a bubble), images indented underneath. */
function optionList(ctx: Ctx, options: PaperOption[], mark?: 'circle' | 'square'): LayoutBlock[] {
  const out: LayoutBlock[] = [];
  for (const option of options) {
    const blocks = htmlToBlocks(option.html, ctx.html, { indent: OPTION_INDENT + (mark ? 16 : 0) });
    const prefix: InlineNode[] = [
      ...(mark ? [{ t: 'mark', shape: mark } as InlineNode, { t: 'space', width: 4 } as InlineNode] : []),
      text(`${option.label}.`, { bold: true }),
      { t: 'space', width: 8 }
    ];
    const first = blocks[0];
    if (first?.t === 'para') {
      first.content = [...prefix, ...first.content];
      first.indent = 0;
      first.hanging = OPTION_INDENT + (mark ? 16 : 0);
      first.spaceAfter = 3;
    } else {
      blocks.unshift(para(prefix, { spaceAfter: 3 }));
    }
    out.push(...blocks);
  }
  return out;
}

/** Two option lists side by side: numbered sources left, lettered targets right. */
function sideBySide(ctx: Ctx, left: PaperOption[], right: PaperOption[]): LayoutBlock {
  const half = ctxWithWidth(ctx, PAGE.contentWidth / 2 - 12);
  return {
    t: 'table',
    widths: [1, 1],
    borders: 'none',
    rows: [{ cells: [{ blocks: optionList(half, left) }, { blocks: optionList(half, right) }] }]
  };
}

/** Word bank in a box: "A  zuur    B  basisch". */
function bank(ctx: Ctx, options: PaperOption[]): LayoutBlock {
  const content: InlineNode[] = [];
  options.forEach((option, i) => {
    if (i) content.push({ t: 'space', width: 18 });
    content.push(
      text(`${option.label}`, { bold: true }),
      { t: 'space', width: 5 },
      ...htmlToInline(option.html, ctx.html)
    );
  });
  return {
    t: 'table',
    widths: [1],
    borders: 'outer',
    rows: [{ cells: [{ blocks: [para(content, { spaceAfter: 0 })] }] }]
  };
}

function marks(
  labels: string[],
  shape: 'circle' | 'square',
  filled: (label: string) => boolean = () => false
): InlineNode[] {
  return labels.flatMap((label, i) => [
    ...(i ? [{ t: 'space', width: 14 } as InlineNode] : []),
    { t: 'mark', shape, label, filled: filled(label) } as InlineNode
  ]);
}

function boxes(count: number, fill: (i: number) => string | undefined, numbered = true): InlineNode[] {
  return Array.from({ length: count }, (_, i) => [
    ...(i ? [{ t: 'space', width: 12 } as InlineNode] : []),
    ...(numbered ? [text(`${i + 1}`, { color: COLOR.muted }), { t: 'space', width: 4 } as InlineNode] : []),
    { t: 'box', text: fill(i), width: 22 } as InlineNode
  ]).flat();
}

function pairBoxes(count: number, fill: (i: number) => [string, string] | undefined): InlineNode[] {
  return Array.from({ length: count }, (_, i) => {
    const pair = fill(i);
    return [
      ...(i ? [{ t: 'space', width: 18 } as InlineNode] : []),
      { t: 'box', text: pair?.[0], width: 22 } as InlineNode,
      text(' – '),
      { t: 'box', text: pair?.[1], width: 22 } as InlineNode
    ];
  }).flat();
}

function labelOf(options: { identifier: string; label: string }[], id: string): string {
  return options.find(o => o.identifier === id)?.label ?? id;
}

function choiceInstruction(locale: LocaleStrings, min: number, max: number): string | undefined {
  if (max === 1) return undefined;
  if (max > 1 && min === max) return locale.chooseExactly(max);
  if (max > 1) return locale.chooseUpTo(max);
  return locale.chooseAny;
}

/** Image with letters/numbers on its hotspots, or outlined answer areas. */
function graphicImage(
  ctx: Ctx,
  image: PaperImageRef,
  overlays: ImageOverlay[],
  maxWidth = ctx.html.maxWidth
): LayoutBlock {
  const box = imageBox(ctx.paper.assets, image.path, image, {
    maxWidth,
    maxHeight: 360,
    minWidth: Math.min(260, maxWidth)
  });
  if (!box) return note(ctx.locale.imageMissing(image.alt || image.path || '?'));
  return {
    t: 'image',
    path: image.path,
    width: box.width,
    height: box.height,
    coordWidth: box.coordWidth,
    coordHeight: box.coordHeight,
    overlays
  };
}

function hotspotOverlays(hotspots: PaperHotspot[]): ImageOverlay[] {
  return hotspots.map(h => ({ shape: h.shape, coords: h.coords, label: h.label }));
}

function isCompactMatrix(ix: Ix<'match'>): boolean {
  return (
    ix.columns.length > 0 &&
    ix.columns.length <= 5 &&
    ix.columns.every(c => !/<img/i.test(c.html) && plainFromHtml(c.html).length <= 24)
  );
}

/** Rows × columns grid of bubbles; row and column headers vary per use. */
function matchGrid(
  ctx: Ctx,
  ix: Ix<'match'>,
  opts: { rowText: boolean; columnText: boolean; filled: boolean }
): LayoutBlock {
  const shape = 'circle';
  const header: LayoutRow = {
    header: true,
    cells: [
      { blocks: [] },
      ...ix.columns.map(c => ({
        align: 'center' as const,
        blocks: [
          para(opts.columnText ? htmlToInline(c.html, ctx.html) : [text(c.label, { bold: true })], {
            style: 'small',
            align: 'center',
            spaceAfter: 0
          })
        ]
      }))
    ]
  };
  const rows: LayoutRow[] = ix.rows.map(row => ({
    cells: [
      {
        blocks: [
          para(
            [
              text(`${row.label}`, { bold: true }),
              ...(opts.rowText ? [{ t: 'space', width: 8 } as InlineNode, ...htmlToInline(row.html, ctx.html)] : [])
            ],
            { spaceAfter: 0 }
          )
        ]
      },
      ...ix.columns.map(col => ({
        align: 'center' as const,
        blocks: [
          para(
            [
              {
                t: 'mark',
                shape,
                filled: opts.filled && ix.correct.some(([r, c]) => r === row.identifier && c === col.identifier)
              }
            ],
            {
              align: 'center',
              spaceAfter: 0
            }
          )
        ]
      }))
    ]
  }));
  const first = opts.rowText ? 4 : 0.6;
  return {
    t: 'table',
    widths: [first, ...ix.columns.map(() => 1)],
    rows: [header, ...rows],
    borders: 'rows',
    fill: opts.rowText ? 1 : Math.min(1, (opts.columnText ? 0.17 : 0.1) * (ix.columns.length + 1))
  };
}

// ---------------------------------------------------------------------------
// Answer areas (answer sheet, answer key, and workbook where needed)

type AreaOpts = { filled: boolean; hasRubric: boolean };

function answerArea(ctx: Ctx, ix: PaperInteraction, opts: AreaOpts): LayoutBlock[] {
  const { locale } = ctx;
  const { filled } = opts;
  const key = (lines: LayoutBlock[]) => (filled ? lines : []);

  switch (ix.kind) {
    case 'choice': {
      const correct = new Set(ix.correct.map(id => labelOf(ix.options, id)));
      return [
        para(
          marks(
            ix.options.map(o => o.label),
            ix.multi ? 'square' : 'circle',
            l => filled && correct.has(l)
          ),
          { spaceAfter: 4 }
        ),
        ...key(ix.correct.length ? [] : [muted(locale.noAnswerKey)])
      ];
    }
    case 'textEntry':
      return ix.gaps.map(gap => {
        const content: InlineNode[] = [
          {
            t: 'gap',
            label: gap.label || undefined,
            width: Math.min(220, Math.max(110, (gap.expectedLength ?? 15) * 7)),
            fill: filled ? (gap.accepted[0] ?? '') : undefined
          }
        ];
        if (filled && gap.accepted.length > 1) {
          content.push(
            text(`   ${locale.alsoAccept} ${gap.accepted.slice(1).join(', ')}`, { italic: true, color: COLOR.muted })
          );
        }
        return para(content, { spaceAfter: 6 });
      });
    case 'inlineChoice':
      return ix.gaps.map(gap => {
        const correct = new Set(gap.correct.map(id => labelOf(gap.options, id)));
        return para(
          [
            ...(gap.label ? [text(`(${gap.label})`, { bold: true }), { t: 'space', width: 10 } as InlineNode] : []),
            ...marks(
              gap.options.map(o => o.label),
              'circle',
              l => filled && correct.has(l)
            )
          ],
          { spaceAfter: 4 }
        );
      });
    case 'extendedText':
      if (!filled) return [{ t: 'lines', count: ix.lines }];
      if (ix.correct.length) return ix.correct.map(c => para(c));
      return opts.hasRubric ? [] : [muted(locale.noAnswerKey)];
    case 'match': {
      if (ix.columns.length <= MAX_GRID_COLUMNS) {
        const compact = isCompactMatrix(ix);
        return [matchGrid(ctx, ix, { rowText: false, columnText: compact, filled })];
      }
      return ix.rows.map(row =>
        para(
          [
            text(`${row.label}`, { bold: true }),
            { t: 'space', width: 10 },
            {
              t: 'box',
              width: 44,
              text: filled
                ? ix.correct
                    .filter(([r]) => r === row.identifier)
                    .map(([, c]) => labelOf(ix.columns, c))
                    .join(' ')
                : undefined
            }
          ],
          { spaceAfter: 4 }
        )
      );
    }
    case 'associate':
    case 'graphicAssociate': {
      const labels = ix.kind === 'associate' ? ix.options : ix.hotspots;
      const count = ix.maxAssociations || Math.max(ix.correct.length, 3);
      const pairs = filled
        ? ix.correct.map(([a, b]) => [labelOf(labels, a), labelOf(labels, b)] as [string, string])
        : [];
      return [
        para(
          pairBoxes(Math.max(count, pairs.length), i => pairs[i]),
          { spaceAfter: 4 }
        )
      ];
    }
    case 'order':
    case 'graphicOrder': {
      const labels = ix.kind === 'order' ? ix.options : ix.hotspots;
      const count = ix.kind === 'order' ? ix.options.length : ix.correct.length || ix.hotspots.length;
      return [
        para(
          boxes(count, i => (filled ? ix.correct[i] && labelOf(labels, ix.correct[i]) : undefined)),
          { spaceAfter: 4 }
        )
      ];
    }
    case 'gapMatch':
    case 'graphicGapMatch': {
      const slots =
        ix.kind === 'gapMatch' ? ix.gaps : ix.hotspots.map(h => ({ identifier: h.identifier, label: h.label }));
      return [
        para(
          slots.flatMap((slot, i) => {
            const option = ix.correct.find(([, target]) => target === slot.identifier)?.[0];
            const optionLabel = option ? labelOf(ix.options, option) : undefined;
            const word = option ? plainFromHtml(ix.options.find(o => o.identifier === option)?.html ?? '') : '';
            return [
              ...(i ? [{ t: 'space', width: 16 } as InlineNode] : []),
              ...(slot.label ? [text(`(${slot.label})`, { bold: true }), { t: 'space', width: 4 } as InlineNode] : []),
              { t: 'box', width: 22, text: filled ? optionLabel : undefined } as InlineNode,
              ...(filled && word ? [text(` ${word}`, { color: COLOR.muted })] : [])
            ];
          }),
          { spaceAfter: 4 }
        )
      ];
    }
    case 'hottext': {
      const correct = new Set(ix.correct.map(id => labelOf(ix.options, id)));
      const words = ix.options.filter(o => correct.has(o.label)).map(o => plainFromHtml(o.html));
      return [
        para(
          marks(
            ix.options.map(o => o.label),
            ix.maxChoices === 1 ? 'circle' : 'square',
            l => filled && correct.has(l)
          ),
          {
            spaceAfter: 4
          }
        ),
        ...key(words.length ? [muted(words.join(', '))] : [])
      ];
    }
    case 'hotspot': {
      const correct = new Set(ix.correct.map(id => labelOf(ix.hotspots, id)));
      return [
        para(
          marks(
            ix.hotspots.map(h => h.label),
            ix.maxChoices === 1 ? 'circle' : 'square',
            l => filled && correct.has(l)
          ),
          {
            spaceAfter: 4
          }
        )
      ];
    }
    case 'selectPoint':
    case 'positionObject': {
      const sheetCtx = ctxWithWidth(ctx, AREA_WIDTH - 8);
      if (!filled) return [graphicImage(sheetCtx, ix.image, [], AREA_WIDTH - 8)];
      if (!ix.correctAreas.length) return opts.hasRubric ? [] : [muted(locale.noAnswerKey)];
      return [
        graphicImage(
          sheetCtx,
          ix.image,
          ix.correctAreas.map(a => ({ ...a, outline: true })),
          AREA_WIDTH - 8
        ),
        muted(locale.correctArea)
      ];
    }
    case 'slider':
      return [
        para([
          text(`${locale.answer} `),
          { t: 'gap', width: 90, fill: filled && ix.correct !== undefined ? String(ix.correct) : undefined }
        ])
      ];
    case 'drawing':
      if (filled) return opts.hasRubric ? [] : [muted(locale.noAnswerKey)];
      return ix.image
        ? [graphicImage(ctxWithWidth(ctx, AREA_WIDTH - 8), ix.image, [], AREA_WIDTH - 8)]
        : [{ t: 'box', height: 180 }];
    case 'upload':
      return filled ? (opts.hasRubric ? [] : [muted(locale.noAnswerKey)]) : [muted(locale.upload)];
    case 'unsupported':
      return [muted(locale.digitalOnly)];
  }
}

// ---------------------------------------------------------------------------
// Interaction content in the question document

function interactionBlocks(ctx: Ctx, ix: PaperInteraction, mode: Mode): LayoutBlock[] {
  const { locale } = ctx;
  const workbook = mode === 'workbook';
  const area = () => answerArea(ctx, ix, { filled: false, hasRubric: false });
  const instruction = (value: string | undefined) => (value ? [muted(value)] : []);

  switch (ix.kind) {
    case 'choice':
      return [
        ...instruction(choiceInstruction(locale, ix.minChoices, ix.maxChoices)),
        ...optionList(ctx, ix.options, workbook ? (ix.multi ? 'square' : 'circle') : undefined)
      ];
    case 'textEntry':
      // The numbered gaps are in the passage itself.
      return [];
    case 'inlineChoice':
      return [
        ...instruction(ix.gaps.length > 1 ? locale.inlineChoiceInstruction : undefined),
        ...ix.gaps.map(gap => {
          const content: InlineNode[] = gap.label
            ? [text(`(${gap.label})`, { bold: true }), { t: 'space', width: 10 }]
            : [];
          gap.options.forEach((o, i) => {
            if (i) content.push({ t: 'space', width: 16 });
            if (workbook) content.push({ t: 'mark', shape: 'circle' }, { t: 'space', width: 3 });
            content.push(
              text(`${o.label}.`, { bold: true }),
              { t: 'space', width: 5 },
              ...htmlToInline(o.html, ctx.html)
            );
          });
          return para(content, { spaceAfter: 4 });
        })
      ];
    case 'extendedText':
      return workbook ? area() : [];
    case 'match':
      if (workbook && isCompactMatrix(ix)) {
        return [
          muted(locale.matrixInstruction),
          matchGrid(ctx, ix, { rowText: true, columnText: true, filled: false })
        ];
      }
      return [
        muted(ix.columns.length <= MAX_GRID_COLUMNS ? locale.matrixInstruction : locale.matchInstruction),
        sideBySide(ctx, ix.rows, ix.columns),
        ...(workbook ? area() : [])
      ];
    case 'associate':
      return [
        muted(locale.associateInstruction(ix.maxAssociations || ix.correct.length || 1)),
        ...optionList(ctx, ix.options),
        ...(workbook ? area() : [])
      ];
    case 'order':
      return [muted(locale.orderInstruction), ...optionList(ctx, ix.options), ...(workbook ? area() : [])];
    case 'gapMatch':
      return [
        muted(locale.gapMatchInstruction),
        bank(ctx, ix.options),
        { t: 'spacer', height: 6 },
        ...htmlToBlocks(ix.passageHtml, ctx.html)
      ];
    case 'hottext':
      return [
        muted(workbook ? locale.hottextWorkbook(ix.maxChoices) : locale.hottextBooklet),
        ...(workbook ? [] : instruction(choiceInstruction(locale, 0, ix.maxChoices))),
        ...htmlToBlocks(ix.passageHtml, ctx.html)
      ];
    case 'hotspot':
      return [
        muted([locale.hotspotInstruction, choiceInstruction(locale, 0, ix.maxChoices)].filter(Boolean).join(' ')),
        graphicImage(ctx, ix.image, hotspotOverlays(ix.hotspots)),
        ...(workbook ? area() : [])
      ];
    case 'graphicOrder':
      return [
        muted(locale.graphicOrderInstruction),
        graphicImage(ctx, ix.image, hotspotOverlays(ix.hotspots)),
        ...(workbook ? area() : [])
      ];
    case 'graphicAssociate':
      return [
        muted(locale.graphicAssociateInstruction(ix.maxAssociations || ix.correct.length || 1)),
        graphicImage(ctx, ix.image, hotspotOverlays(ix.hotspots)),
        ...(workbook ? area() : [])
      ];
    case 'graphicGapMatch':
      return [
        muted(locale.graphicGapMatchInstruction),
        graphicImage(ctx, ix.image, hotspotOverlays(ix.hotspots)),
        bank(ctx, ix.options),
        ...(workbook ? [{ t: 'spacer', height: 6 } as LayoutBlock, ...area()] : [])
      ];
    case 'selectPoint':
      return [
        muted(
          workbook ? locale.selectPoint(ix.maxChoices) : `${locale.selectPoint(ix.maxChoices)} ${locale.onAnswerSheet}`
        ),
        graphicImage(ctx, ix.image, [])
      ];
    case 'positionObject':
      return [
        muted(locale.positionObject),
        ...htmlToBlocks(ix.objectHtml, ctx.html, { indent: OPTION_INDENT }),
        ...(workbook ? [graphicImage(ctx, ix.image, [])] : [muted(locale.onAnswerSheet)])
      ];
    case 'slider':
      return [muted(locale.slider(ix.min, ix.max, ix.step)), ...(workbook ? area() : [])];
    case 'drawing':
      return [muted(locale.drawing), ...(workbook ? area() : [])];
    case 'upload':
      return [note(locale.upload)];
    case 'unsupported':
      return [note(locale.unsupported(ix.interactionType))];
  }
}

function partPrompt(ctx: Ctx, part: PaperItemPart): LayoutBlock[] {
  const blocks = htmlToBlocks(part.promptHtml, ctx.html);
  if (!part.label) return blocks;
  const label = [text(`${part.label}`, { bold: true }), { t: 'space', width: 8 } as InlineNode];
  const first = blocks[0];
  if (first?.t === 'para') first.content = [...label, ...first.content];
  else blocks.unshift(para(label, { spaceAfter: 2 }));
  return blocks;
}

function questionHeading(ctx: Ctx, number: number, item: PaperItem): LayoutBlock {
  const pts = formatPoints(item.points, ctx.locale);
  return para(
    [
      text(`${ctx.locale.question} ${number}`, { bold: true }),
      ...(pts ? [text(`  ${pts}`, { color: COLOR.muted, size: 10 })] : [])
    ],
    { style: 'heading', spaceBefore: 16, spaceAfter: 6, keepNext: true }
  );
}

function stimulusBlocks(ctx: Ctx, item: PaperItem, printed: Set<string>): LayoutBlock[] {
  const out: LayoutBlock[] = [];
  for (const href of item.stimulusRefs) {
    const stimulus = ctx.paper.stimuli.get(href);
    if (!stimulus || printed.has(href)) continue;
    printed.add(href);
    out.push(
      para([text(stimulus.title || ctx.locale.text, { bold: true })], {
        style: 'heading',
        spaceBefore: 16,
        keepNext: true
      })
    );
    out.push(...htmlToBlocks(stimulus.html, ctx.html));
  }
  return out;
}

/** Numbers only the items that ask something; information-only items print without one. */
function numberItems(paper: PaperAssessment): Map<PaperItem, number> {
  const numbers = new Map<PaperItem, number>();
  let n = 0;
  for (const item of paper.items) if (item.parts.length) numbers.set(item, ++n);
  return numbers;
}

function itemBlocks(ctx: Ctx, item: PaperItem, number: number | undefined, mode: Mode): LayoutBlock[] {
  const out: LayoutBlock[] = number ? [questionHeading(ctx, number, item)] : [{ t: 'spacer', height: 12 }];
  for (const node of item.body) {
    if (node.type === 'html') out.push(...htmlToBlocks(node.html, ctx.html));
    else if (node.type === 'media') out.push(note(ctx.locale.media[node.mediaType]));
    else {
      const part = item.parts[node.index];
      out.push(...partPrompt(ctx, part), ...interactionBlocks(ctx, part.interaction, mode));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Documents

function nameFields(ctx: Ctx): LayoutBlock {
  const field = (label: string): InlineNode[] => [text(label), { t: 'space', width: 4 }, { t: 'gap', width: 92 }];
  return {
    t: 'table',
    widths: [1, 1, 1],
    borders: 'none',
    rows: [
      {
        cells: [ctx.locale.nameLabel, ctx.locale.classLabel, ctx.locale.dateLabel].map(label => ({
          blocks: [para(field(label), { spaceAfter: 0 })]
        }))
      }
    ]
  };
}

function titleBlocks(ctx: Ctx, subtitle?: string): LayoutBlock[] {
  return [
    para([text(ctx.paper.title, { bold: true })], { style: 'title', spaceBefore: 12, spaceAfter: subtitle ? 2 : 8 }),
    ...(subtitle ? [para([text(subtitle, { bold: true })], { style: 'subheading', spaceAfter: 8 })] : [])
  ];
}

function instructionBlocks(ctx: Ctx): LayoutBlock[] {
  return (ctx.paper.instructions || []).map(line => para(line, { style: 'small', spaceAfter: 4 }));
}

function questionDocument(ctx: Ctx, mode: Mode): LayoutBlock[] {
  const numbers = numberItems(ctx.paper);
  const printed = new Set<string>();
  const out: LayoutBlock[] = [];
  if (mode === 'workbook') out.push(nameFields(ctx), { t: 'spacer', height: 8 });
  out.push(...titleBlocks(ctx, mode === 'questions' ? ctx.locale.documentTitle.questions : undefined));
  out.push(...instructionBlocks(ctx));
  if (mode === 'questions') out.push(muted(ctx.locale.bookletInstruction));
  for (const item of ctx.paper.items) {
    // A shared text stays on the page with the first question that uses it
    out.push({
      t: 'group',
      blocks: [...stimulusBlocks(ctx, item, printed), ...itemBlocks(ctx, item, numbers.get(item), mode)]
    });
  }
  out.push(para([text(ctx.locale.endOfTest, { italic: true })], { style: 'muted', align: 'center', spaceBefore: 24 }));
  return out;
}

function partAreas(ctx: Ctx, item: PaperItem, opts: AreaOpts): LayoutBlock[] {
  const out: LayoutBlock[] = [];
  const areaCtx = ctxWithWidth(ctx, AREA_WIDTH - 8);
  for (const part of item.parts) {
    const blocks = answerArea(areaCtx, part.interaction, opts);
    if (part.label) {
      const first = blocks[0];
      const label = [text(part.label, { bold: true }), { t: 'space', width: 8 } as InlineNode];
      if (first?.t === 'para') first.content = [...label, ...first.content];
      else blocks.unshift(para(label, { spaceAfter: 2 }));
    }
    out.push(...blocks);
  }
  return out;
}

function answerSheetDocument(ctx: Ctx): LayoutBlock[] {
  const numbers = numberItems(ctx.paper);
  const rows: LayoutRow[] = [];
  for (const item of ctx.paper.items) {
    const number = numbers.get(item);
    if (!number) continue;
    rows.push({
      cells: [
        { blocks: [para([text(String(number), { bold: true })], { style: 'heading', spaceAfter: 0 })] },
        { blocks: partAreas(ctx, item, { filled: false, hasRubric: false }) }
      ]
    });
  }
  return [
    nameFields(ctx),
    { t: 'spacer', height: 8 },
    ...titleBlocks(ctx, ctx.locale.documentTitle.answerSheet),
    muted(ctx.locale.answerSheetInstruction),
    { t: 'spacer', height: 4 },
    ...(rows.length ? [{ t: 'table', widths: [0.09, 0.91], borders: 'rows', rows } as LayoutBlock] : [])
  ];
}

function answerKeyBlocks(ctx: Ctx): LayoutBlock[] {
  const { locale } = ctx;
  const numbers = numberItems(ctx.paper);
  const cell = (value: string, bold = false) => ({
    blocks: [para([text(value, { bold })], { style: 'small' as const, spaceAfter: 0 })],
    shade: true
  });
  const rows: LayoutRow[] = [
    {
      header: true,
      cells: [
        cell(locale.keyColumns.question, true),
        cell(locale.keyColumns.answer, true),
        cell(locale.keyColumns.points, true)
      ]
    }
  ];
  let total = 0;
  let allPoints = true;
  for (const item of ctx.paper.items) {
    const number = numbers.get(item);
    if (!number) continue;
    if (item.points !== undefined) total += item.points;
    else allPoints = false;
    const answer = partAreas(ctx, item, { filled: true, hasRubric: !!item.rubricHtml });
    if (item.rubricHtml) {
      answer.push(para([text(locale.scoring, { bold: true })], { style: 'small', spaceBefore: 4, spaceAfter: 2 }));
      answer.push(...htmlToBlocks(item.rubricHtml, { ...ctx.html, maxWidth: AREA_WIDTH - 8 }, { style: 'small' }));
    }
    rows.push({
      cells: [
        { blocks: [para([text(String(number), { bold: true })], { style: 'heading', spaceAfter: 0 })] },
        { blocks: answer },
        {
          blocks: [para(item.points !== undefined ? String(item.points) : '–', { align: 'center', spaceAfter: 0 })],
          align: 'center'
        }
      ]
    });
  }
  // A total over only some questions would mislead
  if (allPoints && rows.length > 1) {
    rows.push({
      cells: [
        { blocks: [] },
        { blocks: [para([text(locale.total, { bold: true })], { spaceAfter: 0 })] },
        {
          blocks: [
            para([text(String(Math.round(total * 100) / 100), { bold: true })], { align: 'center', spaceAfter: 0 })
          ],
          align: 'center'
        }
      ]
    });
  }
  return [
    ...titleBlocks(ctx, locale.answerKeyTitle),
    muted(locale.answerKeySubtitle),
    ...(ctx.paper.author ? [para(ctx.paper.author, { style: 'muted' })] : []),
    { t: 'spacer', height: 6 },
    { t: 'table', widths: [0.09, 0.8, 0.11], borders: 'rows', rows }
  ];
}

export function composeDocument(
  paper: PaperAssessment,
  kind: PaperDocumentKind,
  options: ExportOptions & { appendAnswerKey?: boolean } = {}
): LayoutDocument {
  const locale = getLocaleStrings(options.locale || 'en');
  const ctx: Ctx = { paper, locale, html: { assets: paper.assets, locale, maxWidth: PAGE.contentWidth } };
  let blocks: LayoutBlock[];
  switch (kind) {
    case 'workbook':
      blocks = questionDocument(ctx, 'workbook');
      break;
    case 'questions':
      blocks = questionDocument(ctx, 'questions');
      break;
    case 'answerSheet':
      blocks = answerSheetDocument(ctx);
      break;
    case 'answerKey':
      blocks = answerKeyBlocks(ctx);
      break;
  }
  if (options.appendAnswerKey && kind !== 'answerKey') {
    blocks.push({ t: 'pageBreak' }, ...answerKeyBlocks(ctx));
  }
  const title = kind === 'workbook' ? paper.title : `${paper.title} — ${locale.documentTitle[kind]}`;
  return { title, header: title, pageLabel: locale.pageOf, blocks };
}
