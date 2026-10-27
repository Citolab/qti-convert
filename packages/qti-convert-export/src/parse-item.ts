import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import {
  escapeHtml,
  rawInnerHtml,
  labelFromIndex,
  loadXml,
  normalizeQti2,
  resolveAssetRef,
  seededShuffle,
  stripTags,
  textContent
} from './xml-utils.js';
import type {
  PaperArea,
  PaperAsset,
  PaperBodyNode,
  PaperHotspot,
  PaperImageRef,
  PaperInteraction,
  PaperItem,
  PaperItemPart,
  PaperOption,
  PaperPair,
  PaperShape,
  ParseOptions
} from './types.js';

type Decl = {
  identifier: string;
  baseType: string;
  correct: string[];
  /** Mapping keys with a positive score, best first. */
  mapped: string[];
  areas: PaperArea[];
};

type Ctx = {
  $: CheerioAPI;
  decls: Map<string, Decl>;
  itemId: string;
  itemHref: string;
  options: ParseOptions;
  body: PaperBodyNode[];
  parts: PaperItemPart[];
  gapCount: number;
  /** Inline parts still collecting gaps from following paragraphs. */
  open: { textEntry?: number; inlineChoice?: number };
};

/** Interactions that occupy their own block in the item body. */
const BLOCK_INTERACTIONS = new Set([
  'qti-choice-interaction',
  'qti-order-interaction',
  'qti-match-interaction',
  'qti-associate-interaction',
  'qti-gap-match-interaction',
  'qti-hottext-interaction',
  'qti-hotspot-interaction',
  'qti-graphic-order-interaction',
  'qti-graphic-associate-interaction',
  'qti-graphic-gap-match-interaction',
  'qti-select-point-interaction',
  'qti-position-object-stage',
  'qti-position-object-interaction',
  'qti-slider-interaction',
  'qti-drawing-interaction',
  'qti-upload-interaction',
  'qti-extended-text-interaction',
  'qti-portable-custom-interaction',
  'qti-custom-interaction',
  'qti-media-interaction',
  'qti-end-attempt-interaction'
]);

const INLINE_SELECTOR = 'qti-text-entry-interaction, qti-inline-choice-interaction';
const BLOCK_SELECTOR = [...BLOCK_INTERACTIONS].join(', ');
const DROPPED_SELECTOR = [
  'qti-feedback-block',
  'qti-feedback-inline',
  'qti-modal-feedback',
  'qti-printed-variable',
  'qti-end-attempt-interaction',
  'qti-response-processing'
].join(', ');

function nodeName(node: AnyNode): string {
  const el = node as Element;
  return (el.tagName || el.name || '').toLowerCase();
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function intAttr($el: Cheerio<AnyNode>, name: string, fallback: number): number {
  const n = parseInt($el.attr(name) || '', 10);
  return Number.isNaN(n) ? fallback : n;
}

function numAttr($el: Cheerio<AnyNode>, name: string): number | undefined {
  const raw = $el.attr(name) || '';
  if (raw.includes('%')) return undefined;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? undefined : n;
}

function parseShape(raw: string | undefined): PaperShape {
  const s = (raw || '').toLowerCase();
  if (s === 'circle' || s === 'poly' || s === 'ellipse' || s === 'default') return s;
  if (s.startsWith('rect')) return 'rect';
  return 'default';
}

function parseCoords(raw: string | undefined): number[] {
  return (raw || '')
    .split(/[\s,]+/)
    .map(v => parseFloat(v))
    .filter(n => !Number.isNaN(n));
}

function readDeclarations($: CheerioAPI): Map<string, Decl> {
  const decls = new Map<string, Decl>();
  $('qti-response-declaration').each((_, el) => {
    const $el = $(el);
    const identifier = $el.attr('identifier') || '';
    const baseType = ($el.attr('base-type') || '').toLowerCase();
    const correct = $el
      .children('qti-correct-response')
      .children('qti-value')
      .map((__, v) => textContent($, v))
      .get()
      .filter(Boolean);
    const mapped = $el
      .find('qti-mapping qti-map-entry')
      .map((__, e) => ({ key: $(e).attr('map-key') || '', value: parseFloat($(e).attr('mapped-value') || '0') }))
      .get()
      .filter(e => e.key && e.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(e => e.key);
    const areas: PaperArea[] = $el
      .find('qti-area-mapping qti-area-map-entry')
      .filter((__, e) => parseFloat($(e).attr('mapped-value') || '0') > 0)
      .map((__, e) => ({ shape: parseShape($(e).attr('shape')), coords: parseCoords($(e).attr('coords')) }))
      .get();
    if (baseType === 'point') {
      for (const value of correct) {
        const [x, y] = parseCoords(value);
        if (x !== undefined && y !== undefined) areas.push({ shape: 'circle', coords: [x, y, 6] });
      }
    }
    decls.set(identifier, { identifier, baseType, correct, mapped, areas });
  });
  return decls;
}

/** Correct values, falling back to positively scored mapping keys. */
function correctValues(ctx: Ctx, responseId: string): string[] {
  const decl = ctx.decls.get(responseId);
  if (!decl) return [];
  return decl.correct.length ? decl.correct : decl.mapped;
}

function correctPairs(ctx: Ctx, responseId: string): PaperPair[] {
  return correctValues(ctx, responseId)
    .map(v => v.split(/\s+/))
    .filter(p => p.length === 2)
    .map(([a, b]) => [a, b] as PaperPair);
}

function responseIdOf($el: Cheerio<AnyNode>): string {
  return $el.attr('response-identifier') || '';
}

function wrap(ctx: Ctx, el: AnyNode): Cheerio<Element> {
  const { $ } = ctx;
  const root = $('<paper-root></paper-root>');
  root.append($(el).clone());
  return root as Cheerio<Element>;
}

/**
 * Turn raw QTI content into the HTML the layout step expects: feedback and
 * scoring markup removed, image paths resolved, image objects as <img>, and
 * audio/video replaced by a marker.
 */
function cleanContent(ctx: Ctx, root: Cheerio<Element>): void {
  const { $ } = ctx;
  root.find(DROPPED_SELECTOR).remove();
  root.find('qti-rubric-block').each((_, el) => {
    const view = ($(el).attr('view') || '').toLowerCase();
    if (view && !view.includes('candidate')) $(el).remove();
    else $(el).replaceWith($(el).find('qti-content-body').html() ?? $(el).html() ?? '');
  });
  root.find('img').each((_, img) => {
    $(img).attr('src', resolveAssetRef($(img).attr('src') || '', ctx.itemHref));
  });
  root.find('object').each((_, obj) => {
    const $obj = $(obj);
    const data = $obj.attr('data') || '';
    const type = ($obj.attr('type') || '').toLowerCase();
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|svg|webp)$/i.test(data)) {
      const img = $('<img/>');
      img.attr('src', resolveAssetRef(data, ctx.itemHref));
      for (const a of ['width', 'height']) if ($obj.attr(a)) img.attr(a, $obj.attr(a)!);
      const alt = textContent($, obj);
      if (alt) img.attr('alt', alt);
      $obj.replaceWith(img);
    } else if (type.startsWith('audio/') || type.startsWith('video/')) {
      $obj.replaceWith(`<paper-media type="${type.startsWith('audio/') ? 'audio' : 'video'}"/>`);
    } else {
      $obj.replaceWith(escapeHtml(textContent($, obj)));
    }
  });
  root.find('audio, video').each((_, el) => {
    $(el).replaceWith(`<paper-media type="${nodeName(el)}"/>`);
  });
}

function innerContent(ctx: Ctx, el: AnyNode | undefined): string {
  if (!el) return '';
  const root = wrap(ctx, el);
  cleanContent(ctx, root);
  return rawInnerHtml(ctx.$, root.children().get(0));
}

function promptOf(ctx: Ctx, el: AnyNode): string | undefined {
  const prompt = ctx.$(el).children('qti-prompt').get(0);
  const html = innerContent(ctx, prompt).trim();
  return html || undefined;
}

function shouldShuffle(ctx: Ctx, $el: Cheerio<AnyNode>): boolean {
  return !ctx.options.keepSourceOrder && ($el.attr('shuffle') || '').toLowerCase() === 'true';
}

/** Options from child elements, shuffled per the interaction and labelled. */
function optionsOf(
  ctx: Ctx,
  el: AnyNode,
  selector: string,
  labels: 'letters' | 'numbers',
  seedSuffix = '',
  shuffle = shouldShuffle(ctx, ctx.$(el))
): PaperOption[] {
  const { $ } = ctx;
  const raw = $(el)
    .find(selector)
    .toArray()
    .map((child, i) => ({
      identifier: $(child).attr('identifier') || `${i + 1}`,
      html: innerContent(ctx, child),
      fixed: ($(child).attr('fixed') || '').toLowerCase() === 'true'
    }));
  const ordered = shuffle ? seededShuffle(raw, `${ctx.itemId}:${responseIdOf($(el))}${seedSuffix}`, o => o.fixed) : raw;
  return ordered.map((o, i) => ({
    identifier: o.identifier,
    label: labels === 'letters' ? labelFromIndex(i) : String(i + 1),
    html: o.html
  }));
}

function imageOf(ctx: Ctx, el: AnyNode): PaperImageRef | undefined {
  const { $ } = ctx;
  const img = $(el)
    .find('img, object')
    .filter((_, n) => !$(n).closest('qti-gap-img, qti-gap-text, qti-prompt, qti-position-object-interaction').length)
    .first();
  if (!img.length) return undefined;
  const src = img.attr('src') || img.attr('data') || '';
  const path = resolveAssetRef(src, ctx.itemHref);
  if (!path) return undefined;
  return {
    path,
    alt: img.attr('alt') || textContent($, img.get(0)) || undefined,
    width: numAttr(img, 'width'),
    height: numAttr(img, 'height')
  };
}

function hotspotsOf(ctx: Ctx, el: AnyNode, labels: 'letters' | 'numbers'): PaperHotspot[] {
  const { $ } = ctx;
  return $(el)
    .find('qti-hotspot-choice, qti-associable-hotspot')
    .toArray()
    .map((h, i) => ({
      identifier: $(h).attr('identifier') || `H${i + 1}`,
      label: labels === 'letters' ? labelFromIndex(i) : String(i + 1),
      shape: parseShape($(h).attr('shape')),
      coords: parseCoords($(h).attr('coords'))
    }));
}

function parseOrder(ctx: Ctx, el: AnyNode): PaperInteraction {
  const { $ } = ctx;
  const responseId = responseIdOf($(el));
  const correct = correctValues(ctx, responseId);
  let options = optionsOf(ctx, el, 'qti-simple-choice', 'letters');
  // A shuffled order item must never print in its correct order.
  const isCorrectOrder = (opts: PaperOption[]) =>
    opts.length > 1 && opts.map(o => o.identifier).join(' ') === correct.join(' ');
  for (let attempt = 1; shouldShuffle(ctx, $(el)) && isCorrectOrder(options) && attempt < 10; attempt++) {
    options = optionsOf(ctx, el, 'qti-simple-choice', 'letters', `#${attempt}`);
  }
  if (shouldShuffle(ctx, $(el)) && isCorrectOrder(options)) {
    options = [...options.slice(1), options[0]].map((o, i) => ({ ...o, label: labelFromIndex(i) }));
  }
  return { kind: 'order', responseId, options, correct };
}

function parseGapMatch(ctx: Ctx, el: AnyNode): PaperInteraction {
  const { $ } = ctx;
  const responseId = responseIdOf($(el));
  const options = optionsOf(ctx, el, 'qti-gap-text, qti-gap-img', 'letters');
  const root = wrap(ctx, el);
  root.find('qti-prompt, qti-gap-text, qti-gap-img').remove();
  cleanContent(ctx, root);
  const gaps: { identifier: string; label: string }[] = [];
  root.find('qti-gap').each((_, gap) => {
    const label = String(++ctx.gapCount);
    gaps.push({ identifier: $(gap).attr('identifier') || label, label });
    $(gap).replaceWith(`<paper-gap n="${label}" len="10"/>`);
  });
  return {
    kind: 'gapMatch',
    responseId,
    options,
    passageHtml: rawInnerHtml($, root.children().get(0)),
    gaps,
    correct: correctPairs(ctx, responseId)
  };
}

function parseHottext(ctx: Ctx, el: AnyNode): PaperInteraction {
  const { $ } = ctx;
  const responseId = responseIdOf($(el));
  const root = wrap(ctx, el);
  root.find('qti-prompt').remove();
  cleanContent(ctx, root);
  const options: PaperOption[] = [];
  root.find('qti-hottext').each((i, h) => {
    const label = labelFromIndex(i);
    const html = $(h).html() || '';
    options.push({ identifier: $(h).attr('identifier') || label, label, html });
    $(h).replaceWith(`<paper-hottext label="${label}">${html}</paper-hottext>`);
  });
  return {
    kind: 'hottext',
    responseId,
    passageHtml: rawInnerHtml($, root.children().get(0)),
    options,
    maxChoices: intAttr($(el), 'max-choices', 1),
    correct: correctValues(ctx, responseId)
  };
}

/** Parse a block-level interaction; undefined for ones that have no paper form at all. */
function parseBlockInteraction(ctx: Ctx, el: AnyNode, name: string, stage?: AnyNode): PaperInteraction | undefined {
  const { $ } = ctx;
  const $el = $(el);
  const responseId = responseIdOf($el);
  const image = () => imageOf(ctx, el) ?? { path: '' };

  switch (name) {
    case 'qti-choice-interaction': {
      const maxChoices = intAttr($el, 'max-choices', 1);
      return {
        kind: 'choice',
        responseId,
        multi: maxChoices !== 1,
        minChoices: intAttr($el, 'min-choices', 0),
        maxChoices,
        options: optionsOf(ctx, el, 'qti-simple-choice', 'letters'),
        correct: correctValues(ctx, responseId)
      };
    }
    case 'qti-order-interaction':
      return parseOrder(ctx, el);
    case 'qti-match-interaction': {
      const sets = $el.children('qti-simple-match-set').toArray();
      const shuffle = shouldShuffle(ctx, $el);
      return {
        kind: 'match',
        responseId,
        rows: sets[0] ? optionsOf(ctx, sets[0], 'qti-simple-associable-choice', 'numbers', ':rows', shuffle) : [],
        columns: sets[1] ? optionsOf(ctx, sets[1], 'qti-simple-associable-choice', 'letters', ':cols', shuffle) : [],
        maxAssociations: intAttr($el, 'max-associations', 1),
        correct: correctPairs(ctx, responseId)
      };
    }
    case 'qti-associate-interaction':
      return {
        kind: 'associate',
        responseId,
        options: optionsOf(ctx, el, 'qti-simple-associable-choice', 'letters'),
        maxAssociations: intAttr($el, 'max-associations', 1),
        correct: correctPairs(ctx, responseId)
      };
    case 'qti-gap-match-interaction':
      return parseGapMatch(ctx, el);
    case 'qti-hottext-interaction':
      return parseHottext(ctx, el);
    case 'qti-hotspot-interaction':
      return {
        kind: 'hotspot',
        responseId,
        image: image(),
        hotspots: hotspotsOf(ctx, el, 'letters'),
        maxChoices: intAttr($el, 'max-choices', 1),
        correct: correctValues(ctx, responseId)
      };
    case 'qti-graphic-order-interaction':
      return {
        kind: 'graphicOrder',
        responseId,
        image: image(),
        hotspots: hotspotsOf(ctx, el, 'letters'),
        correct: correctValues(ctx, responseId)
      };
    case 'qti-graphic-associate-interaction':
      return {
        kind: 'graphicAssociate',
        responseId,
        image: image(),
        hotspots: hotspotsOf(ctx, el, 'letters'),
        maxAssociations: intAttr($el, 'max-associations', 1),
        correct: correctPairs(ctx, responseId)
      };
    case 'qti-graphic-gap-match-interaction':
      return {
        kind: 'graphicGapMatch',
        responseId,
        image: image(),
        hotspots: hotspotsOf(ctx, el, 'numbers'),
        options: optionsOf(ctx, el, 'qti-gap-img, qti-gap-text', 'letters'),
        correct: correctPairs(ctx, responseId)
      };
    case 'qti-select-point-interaction':
      return {
        kind: 'selectPoint',
        responseId,
        image: image(),
        maxChoices: intAttr($el, 'max-choices', 1),
        correctAreas: ctx.decls.get(responseId)?.areas ?? []
      };
    case 'qti-position-object-interaction':
      return {
        kind: 'positionObject',
        responseId,
        image: (stage && imageOf(ctx, stage)) || { path: '' },
        objectHtml: innerContent(ctx, el),
        maxChoices: intAttr($el, 'max-choices', 1),
        correctAreas: ctx.decls.get(responseId)?.areas ?? []
      };
    case 'qti-slider-interaction': {
      const correct = parseFloat(correctValues(ctx, responseId)[0] ?? '');
      return {
        kind: 'slider',
        responseId,
        min: numAttr($el, 'lower-bound') ?? 0,
        max: numAttr($el, 'upper-bound') ?? 100,
        step: numAttr($el, 'step'),
        correct: Number.isNaN(correct) ? undefined : correct
      };
    }
    case 'qti-drawing-interaction':
      return { kind: 'drawing', responseId, image: imageOf(ctx, el) };
    case 'qti-upload-interaction':
      return { kind: 'upload', responseId };
    case 'qti-extended-text-interaction': {
      const expectedLines = intAttr($el, 'expected-lines', 0);
      const expectedLength = intAttr($el, 'expected-length', 0);
      const lines = expectedLines || (expectedLength ? Math.ceil(expectedLength / 60) : 6);
      return {
        kind: 'extendedText',
        responseId,
        lines: Math.min(20, Math.max(3, lines)),
        correct: correctValues(ctx, responseId)
      };
    }
    case 'qti-end-attempt-interaction':
      return undefined;
    default:
      return { kind: 'unsupported', interactionType: name };
  }
}

function addPart(ctx: Ctx, interaction: PaperInteraction, promptHtml?: string): number {
  ctx.parts.push({ label: '', promptHtml, interaction });
  const index = ctx.parts.length - 1;
  ctx.body.push({ type: 'part', index });
  return index;
}

function addBlockInteraction(ctx: Ctx, el: AnyNode, name: string): void {
  const { $ } = ctx;
  ctx.open = {};
  if (name === 'qti-media-interaction') {
    const prompt = promptOf(ctx, el);
    if (prompt) ctx.body.push({ type: 'html', html: prompt });
    const obj = $(el).find('object, audio, video').first();
    const type = (obj.attr('type') || nodeName(obj.get(0) ?? el)).toLowerCase();
    ctx.body.push({
      type: 'media',
      mediaType: type.includes('audio') ? 'audio' : type.includes('video') ? 'video' : 'media'
    });
    return;
  }
  if (name === 'qti-position-object-stage') {
    $(el)
      .find('qti-position-object-interaction')
      .each((_, ix) => {
        const interaction = parseBlockInteraction(ctx, ix, 'qti-position-object-interaction', el);
        if (interaction) addPart(ctx, interaction, promptOf(ctx, ix));
      });
    return;
  }
  const interaction = parseBlockInteraction(ctx, el, name);
  if (interaction) addPart(ctx, interaction, promptOf(ctx, el));
}

/**
 * Add a piece of body content. Text entries and dropdowns inside it become
 * numbered gaps; consecutive paragraphs share one part so the answer sheet
 * lists all their gaps together.
 */
function addContent(ctx: Ctx, el: AnyNode): void {
  const { $ } = ctx;
  const root = wrap(ctx, el);
  cleanContent(ctx, root);

  const added: { textEntry: boolean; inlineChoice: boolean } = { textEntry: false, inlineChoice: false };
  root.find(INLINE_SELECTOR).each((_, ix) => {
    const $ix = $(ix);
    const responseId = responseIdOf($ix);
    const label = String(++ctx.gapCount);
    if (nodeName(ix) === 'qti-text-entry-interaction') {
      const expectedLength = intAttr($ix, 'expected-length', 0) || undefined;
      const decl = ctx.decls.get(responseId);
      const accepted = [...new Set([...(decl?.correct ?? []), ...(decl?.mapped ?? [])])];
      const part = openPart(ctx, 'textEntry');
      const interaction = ctx.parts[part].interaction as Extract<PaperInteraction, { kind: 'textEntry' }>;
      interaction.gaps.push({ label, responseId, expectedLength, accepted });
      added.textEntry = true;
      $ix.replaceWith(`<paper-gap n="${label}" len="${expectedLength ?? 10}"/>`);
    } else {
      const options = optionsOf(ctx, ix, 'qti-inline-choice', 'letters');
      const part = openPart(ctx, 'inlineChoice');
      const interaction = ctx.parts[part].interaction as Extract<PaperInteraction, { kind: 'inlineChoice' }>;
      interaction.gaps.push({ label, responseId, options, correct: correctValues(ctx, responseId) });
      added.inlineChoice = true;
      $ix.replaceWith(`<paper-gap n="${label}" len="8"/>`);
    }
  });

  const html = (root.html() || '').trim();
  if (html) ctx.body.push({ type: 'html', html });

  // Keep the open inline parts right after the content that feeds them.
  for (const kind of ['textEntry', 'inlineChoice'] as const) {
    const index = ctx.open[kind];
    if (!added[kind] || index === undefined) continue;
    ctx.body = ctx.body.filter(n => !(n.type === 'part' && n.index === index));
    ctx.body.push({ type: 'part', index });
  }
}

function openPart(ctx: Ctx, kind: 'textEntry' | 'inlineChoice'): number {
  const existing = ctx.open[kind];
  if (existing !== undefined) return existing;
  const index = addPart(ctx, kind === 'textEntry' ? { kind, gaps: [] } : { kind, gaps: [] });
  ctx.open[kind] = index;
  return index;
}

function walkBody(ctx: Ctx, nodes: AnyNode[]): void {
  const { $ } = ctx;
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = $(node).text().trim();
      if (text) ctx.body.push({ type: 'html', html: escapeHtml(text) });
      continue;
    }
    if (!isElement(node)) continue;
    const name = nodeName(node);
    if ($(node).is(DROPPED_SELECTOR)) continue;
    if (BLOCK_INTERACTIONS.has(name)) {
      addBlockInteraction(ctx, node, name);
    } else if ($(node).find(BLOCK_SELECTOR).length) {
      // Layout wrappers around interactions: keep the content, drop the wrapper.
      walkBody(ctx, $(node).contents().toArray());
    } else {
      addContent(ctx, node);
    }
  }
}

function extractPoints($: CheerioAPI): number | undefined {
  const maxScore = $('qti-outcome-declaration[identifier="MAXSCORE"]').first();
  if (maxScore.length) {
    const v = textContent($, maxScore.find('qti-value').first().get(0));
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  const score = $('qti-outcome-declaration[identifier="SCORE"]').first();
  const n = parseFloat(score.attr('normal-maximum') || '');
  return Number.isNaN(n) ? undefined : n;
}

function extractScorerRubric(ctx: Ctx): string | undefined {
  const { $ } = ctx;
  const blocks: string[] = [];
  $('qti-rubric-block').each((_, el) => {
    const view = ($(el).attr('view') || '').toLowerCase();
    const use = ($(el).attr('use') || '').toLowerCase();
    if (!view.includes('scorer') && !use.includes('scoring')) return;
    const body = $(el).find('qti-content-body').get(0) ?? el;
    const html = innerContent(ctx, body).trim();
    if (html) blocks.push(html);
  });
  return blocks.length ? blocks.join('\n') : undefined;
}

function optionText(options: PaperOption[], id: string): string {
  const o = options.find(x => x.identifier === id);
  return o ? `${o.label} (${stripTags(o.html)})` : id;
}

function hotspotLabel(hotspots: PaperHotspot[], id: string): string {
  return hotspots.find(h => h.identifier === id)?.label ?? id;
}

/** Locale-neutral, one-line summary of a part's correct answer. */
function summarize(ix: PaperInteraction): string {
  switch (ix.kind) {
    case 'choice':
    case 'order':
      return ix.correct.map(id => optionText(ix.options, id)).join(ix.kind === 'order' ? ' / ' : ', ');
    case 'hottext':
      return ix.correct.map(id => optionText(ix.options, id)).join(', ');
    case 'textEntry':
      return ix.gaps.map(g => `${g.label ? `(${g.label}) ` : ''}${g.accepted.join(' | ') || '?'}`).join(' / ');
    case 'inlineChoice':
      return ix.gaps
        .map(g => `${g.label ? `(${g.label}) ` : ''}${g.correct.map(id => optionText(g.options, id)).join(', ')}`)
        .join(' / ');
    case 'extendedText':
      return ix.correct.join(' | ');
    case 'match':
      return ix.correct
        .map(([r, c]) => {
          const row = ix.rows.find(x => x.identifier === r);
          const col = ix.columns.find(x => x.identifier === c);
          return `${row ? `${row.label} ${stripTags(row.html)}` : r} → ${col ? `${col.label} ${stripTags(col.html)}` : c}`;
        })
        .join('; ');
    case 'associate':
      return ix.correct.map(([a, b]) => `${optionText(ix.options, a)} – ${optionText(ix.options, b)}`).join('; ');
    case 'gapMatch':
      return ix.gaps
        .map(g => {
          const pair = ix.correct.find(([, gap]) => gap === g.identifier);
          return `${g.label ? `(${g.label}) ` : ''}${pair ? optionText(ix.options, pair[0]) : '?'}`;
        })
        .join(' / ');
    case 'hotspot':
      return ix.correct.map(id => hotspotLabel(ix.hotspots, id)).join(', ');
    case 'graphicOrder':
      return ix.correct.map(id => hotspotLabel(ix.hotspots, id)).join(' / ');
    case 'graphicAssociate':
      return ix.correct.map(([a, b]) => `${hotspotLabel(ix.hotspots, a)} – ${hotspotLabel(ix.hotspots, b)}`).join('; ');
    case 'graphicGapMatch':
      return ix.correct
        .map(([opt, spot]) => `(${hotspotLabel(ix.hotspots, spot)}) ${optionText(ix.options, opt)}`)
        .join(' / ');
    case 'slider':
      return ix.correct !== undefined ? String(ix.correct) : '';
    default:
      return '';
  }
}

function rawValues(ctx: Ctx): string[] {
  const values: string[] = [];
  for (const decl of ctx.decls.values()) values.push(...decl.correct);
  return values;
}

/** Number gaps only when an item has more than one; label parts a, b, c when it has several. */
function finalizeLabels(ctx: Ctx): void {
  // Inline parts move down as later paragraphs feed them; renumber in reading order.
  const order = ctx.body.flatMap(n => (n.type === 'part' ? [n.index] : []));
  ctx.parts = order.map(i => ctx.parts[i]);
  ctx.body = ctx.body.map(n => (n.type === 'part' ? { ...n, index: order.indexOf(n.index) } : n));
  const parts = ctx.parts;
  if (ctx.gapCount === 1) {
    const unlabel = (html: string) => html.replace(/<paper-gap n="1"/g, '<paper-gap n=""');
    ctx.body = ctx.body.map(n => (n.type === 'html' ? { ...n, html: unlabel(n.html) } : n));
    for (const part of parts) {
      const ix = part.interaction;
      if (ix.kind === 'textEntry' || ix.kind === 'inlineChoice' || ix.kind === 'gapMatch') {
        ix.gaps.forEach(g => (g.label = ''));
      }
      if (ix.kind === 'gapMatch') ix.passageHtml = unlabel(ix.passageHtml);
    }
  }
  if (parts.length > 1) parts.forEach((p, i) => (p.label = String.fromCharCode(97 + i)));
}

export function parseItemXml(
  xml: string,
  _assets: Map<string, PaperAsset> = new Map(),
  itemHref = '',
  options: ParseOptions = {}
): PaperItem {
  const $ = loadXml(xml);
  if ($('assessmentItem').length) normalizeQti2($);
  const root = $('qti-assessment-item').first();
  const identifier = root.attr('identifier') || 'item';

  const ctx: Ctx = {
    $,
    decls: readDeclarations($),
    itemId: identifier,
    itemHref,
    options,
    body: [],
    parts: [],
    gapCount: 0,
    open: {}
  };

  const body = $('qti-item-body').first();
  walkBody(ctx, body.contents().toArray());
  finalizeLabels(ctx);

  const rubricHtml = extractScorerRubric(ctx);
  const summary = ctx.parts
    .map(p => {
      const line = summarize(p.interaction);
      return line && p.label ? `${p.label}) ${line}` : line;
    })
    .filter(Boolean)
    .join('\n');
  const values = rawValues(ctx);

  return {
    identifier,
    title: root.attr('title') || identifier,
    points: extractPoints($),
    body: ctx.body,
    parts: ctx.parts,
    stimulusRefs: $('qti-assessment-stimulus-ref')
      .map((_, el) => resolveAssetRef($(el).attr('href') || '', itemHref))
      .get()
      .filter(Boolean),
    rubricHtml,
    answerKey:
      summary || rubricHtml
        ? { summary: summary || stripTags(rubricHtml ?? ''), values: values.length ? values : undefined, rubricHtml }
        : undefined
  };
}
