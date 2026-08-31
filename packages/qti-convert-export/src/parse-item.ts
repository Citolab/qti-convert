import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { innerHtml, labelFromIndex, loadXml, resolveAssetRef, textContent } from './xml-utils.js';
import type {
  PaperAnswerKey,
  PaperAsset,
  PaperChoiceOption,
  PaperContentBlock,
  PaperGapPart,
  PaperHottextPart,
  PaperInteraction,
  PaperItem,
  PaperMatchOption,
} from './types.js';
import { getLocaleStrings } from './locale.js';

function isElement(node: AnyNode): node is Element {
  return (node as Element).type === 'tag' || (node as Element).tagName !== undefined;
}

function nodeName(el: Element): string {
  return (el.tagName || el.name || '').toLowerCase();
}

function collectCorrectValues($: CheerioAPI, responseId?: string): string[] {
  const values: string[] = [];
  const decls = responseId
    ? $(`qti-response-declaration[identifier="${responseId}"], responseDeclaration[identifier="${responseId}"]`)
    : $('qti-response-declaration, responseDeclaration');

  decls.each((_, decl) => {
    $(decl)
      .find('qti-correct-response qti-value, correctResponse value, qti-value')
      .each((__, v) => {
        // Only direct correct-response values
        const parent = $(v).parent();
        const pName = nodeName(parent.get(0) as Element);
        if (pName === 'qti-correct-response' || pName === 'correctresponse') {
          const t = textContent($, v);
          if (t) values.push(t);
        }
      });
  });

  // Fallback: any qti-correct-response under matching declaration
  if (values.length === 0) {
    decls.find('qti-correct-response, correctResponse').each((_, cr) => {
      $(cr)
        .children('qti-value, value')
        .each((__, v) => {
          const t = textContent($, v);
          if (t) values.push(t);
        });
    });
  }
  return values;
}

function choiceOptions($: CheerioAPI, interaction: AnyNode): PaperChoiceOption[] {
  const choices: PaperChoiceOption[] = [];
  $(interaction)
    .children('qti-simple-choice, simpleChoice')
    .each((i, el) => {
      const identifier = $(el).attr('identifier') || `C${i + 1}`;
      // Kennisnet style: always A, B, C by order (not QTI identifier)
      choices.push({
        identifier,
        label: labelFromIndex(i),
        contentHtml: innerHtml($, el) || textContent($, el),
      });
    });
  return choices;
}

function matchOptions($: CheerioAPI, set: AnyNode): PaperMatchOption[] {
  const options: PaperMatchOption[] = [];
  $(set)
    .find('qti-simple-associable-choice, simpleAssociableChoice')
    .each((i, el) => {
      options.push({
        identifier: $(el).attr('identifier') || `M${i + 1}`,
        contentHtml: innerHtml($, el) || textContent($, el),
      });
    });
  return options;
}

function htmlToBlocks(html: string, itemHref = ''): PaperContentBlock[] {
  if (!html.trim()) return [];
  const $ = loadXml(`<root>${html}</root>`);
  const blocks: PaperContentBlock[] = [];

  const root = $('root').get(0);
  if (!root) return [{ type: 'paragraph', html }];

  const children = $(root).contents().toArray();
  let buffer = '';

  const flush = () => {
    const t = buffer.trim();
    if (t) blocks.push({ type: 'paragraph', html: t });
    buffer = '';
  };

  const pushImage = (imgEl: AnyNode) => {
    const raw = $(imgEl).attr('src') || '';
    const src = resolveAssetRef(raw, itemHref);
    if (!src) return;
    blocks.push({
      type: 'image',
      assetPath: src,
      alt: $(imgEl).attr('alt') || undefined,
      width: parseInt($(imgEl).attr('width') || '', 10) || undefined,
      height: parseInt($(imgEl).attr('height') || '', 10) || undefined,
    });
  };

  for (const child of children) {
    if (child.type === 'text') {
      buffer += $(child).text();
      continue;
    }
    if (!isElement(child)) continue;
    const name = nodeName(child);
    if (name === 'img') {
      flush();
      pushImage(child);
    } else if (name === 'p' || name === 'div' || name === 'blockquote') {
      flush();
      $(child)
        .find('img')
        .each((_, img) => pushImage(img));
      const clone = $(child).clone();
      clone.find('img').remove();
      const text = (clone.html() || clone.text() || '').trim();
      if (text) blocks.push({ type: 'paragraph', html: text });
    } else {
      buffer += $.html(child) || '';
    }
  }
  flush();
  if (blocks.length === 0 && html.trim()) {
    blocks.push({ type: 'paragraph', html });
  }
  return blocks;
}

const BLOCK_INTERACTION_SEL = [
  'qti-choice-interaction',
  'qti-order-interaction',
  'qti-match-interaction',
  'qti-associate-interaction',
  'qti-gap-match-interaction',
  'qti-hottext-interaction',
  'qti-select-point-interaction',
  'qti-extended-text-interaction',
  'qti-portable-custom-interaction',
  'qti-media-interaction',
  'qti-upload-interaction',
  'qti-hotspot-interaction',
  'qti-graphic-gap-match-interaction',
  'qti-graphic-order-interaction',
  'qti-graphic-associate-interaction',
  'qti-slider-interaction',
  'qti-position-object-interaction',
  'qti-custom-interaction',
  'choiceInteraction',
  'orderInteraction',
  'matchInteraction',
  'associateInteraction',
  'gapMatchInteraction',
  'hottextInteraction',
  'selectPointInteraction',
  'extendedTextInteraction',
].join(', ');

function bodyStimulusOutsideInteractions($: CheerioAPI, itemHref = ''): PaperContentBlock[] {
  const body = $('qti-item-body, itemBody').first();
  if (!body.length) return [];
  const blocks: PaperContentBlock[] = [];
  body.contents().each((_, child) => {
    if (child.type === 'text') {
      const t = $(child).text().trim();
      if (t) blocks.push({ type: 'paragraph', html: t });
      return;
    }
    if (!isElement(child)) return;
    const name = nodeName(child);
    if (name.startsWith('qti-') && name.includes('interaction')) return;
    if (name.endsWith('interaction')) return;
    if (name === 'qti-feedback-block' || name === 'feedbackblock') return;
    if (name === 'qti-rubric-block' || name === 'rubricblock') return;
    if (name === 'img') {
      const src = resolveAssetRef($(child).attr('src') || '', itemHref);
      if (src) {
        blocks.push({
          type: 'image',
          assetPath: src,
          alt: $(child).attr('alt') || undefined,
        });
      }
      return;
    }
    // Inline text/dropdown items are handled by parseInlineTextEntries
    if (
      $(child).find(
        'qti-text-entry-interaction, textEntryInteraction, qti-inline-choice-interaction, inlineChoiceInteraction'
      ).length &&
      !$(child).find(BLOCK_INTERACTION_SEL).length
    ) {
      return;
    }
    // Nested block interactions: keep surrounding prompt/images, strip the interaction itself
    if ($(child).find(BLOCK_INTERACTION_SEL).length) {
      const clone = $(child).clone();
      clone.find(BLOCK_INTERACTION_SEL).remove();
      clone.find('qti-rubric-block, rubricBlock, qti-feedback-block, feedbackBlock').remove();
      const html = (clone.html() || '').trim();
      if (html) blocks.push(...htmlToBlocks(html, itemHref));
      return;
    }
    blocks.push(...htmlToBlocks($.html(child) || '', itemHref));
  });
  return blocks;
}

function promptBlocks($: CheerioAPI, interaction: AnyNode, itemHref = ''): PaperContentBlock[] {
  const prompt = $(interaction).children('qti-prompt, prompt').first();
  if (!prompt.length) return [];
  return htmlToBlocks(innerHtml($, prompt.get(0)) || textContent($, prompt.get(0)), itemHref);
}

function parseChoice($: CheerioAPI, el: AnyNode): PaperInteraction {
  const maxChoices = parseInt($(el).attr('max-choices') || $(el).attr('maxChoices') || '1', 10);
  const multi = maxChoices === 0 || maxChoices > 1;
  return {
    kind: 'choice',
    multi,
    choices: choiceOptions($, el),
  };
}

function parseOrder($: CheerioAPI, el: AnyNode): PaperInteraction {
  const orientation = (($(el).attr('orientation') || 'vertical') as string).toLowerCase() === 'horizontal'
    ? 'horizontal'
    : 'vertical';
  return {
    kind: 'order',
    orientation,
    items: choiceOptions($, el),
  };
}

function parseMatch($: CheerioAPI, el: AnyNode): PaperInteraction {
  const sets = $(el).children('qti-simple-match-set, simpleMatchSet').toArray();
  const rows = sets[0] ? matchOptions($, sets[0]) : [];
  const columns = sets[1] ? matchOptions($, sets[1]) : [];
  // Matrix when columns look like judgements (juist/onjuist, true/false)
  const colTexts = columns.map(c => c.contentHtml.replace(/<[^>]+>/g, '').trim().toLowerCase());
  const matrixish =
    columns.length > 0 &&
    columns.length <= 4 &&
    colTexts.every(t => /^(juist|onjuist|true|false|yes|no|waar|niet waar)$/i.test(t));
  const cls = ($(el).attr('class') || '').toLowerCase();
  // Wikiwijs: qti-choices-right → option bank under ANTWOORDEN; otherwise bank above blanks
  const bankPlacement: 'top' | 'answers' = cls.includes('qti-choices-right') ? 'answers' : 'top';
  return {
    kind: 'match',
    mode: matrixish ? 'matrix' : 'pairs',
    bankPlacement: matrixish ? undefined : bankPlacement,
    rows,
    columns,
  };
}

function parseGapMatch($: CheerioAPI, el: AnyNode): PaperInteraction {
  const options: PaperMatchOption[] = [];
  $(el)
    .children('qti-gap-text, gapText')
    .each((i, g) => {
      options.push({
        identifier: $(g).attr('identifier') || `W${i + 1}`,
        contentHtml: innerHtml($, g) || textContent($, g),
      });
    });

  const parts: PaperGapPart[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const t = $(node).text();
        if (t) parts.push({ type: 'text', html: t });
        continue;
      }
      if (!isElement(node)) continue;
      const name = nodeName(node);
      if (name === 'qti-gap' || name === 'gap') {
        parts.push({ type: 'gap', identifier: $(node).attr('identifier') || '' });
      } else if (name === 'qti-gap-text' || name === 'gaptext' || name === 'qti-prompt' || name === 'prompt') {
        continue;
      } else if (name === 'p' || name === 'div') {
        walk($(node).contents().toArray());
        parts.push({ type: 'text', html: '\n' });
      } else {
        walk($(node).contents().toArray());
      }
    }
  };
  walk($(el).contents().toArray());
  return { kind: 'gapMatch', options, parts };
}

function parseHottext($: CheerioAPI, el: AnyNode): PaperInteraction {
  const parts: PaperHottextPart[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const t = $(node).text();
        if (t) parts.push({ type: 'text', text: t });
        continue;
      }
      if (!isElement(node)) continue;
      const name = nodeName(node);
      if (name === 'qti-hottext' || name === 'hottext') {
        parts.push({
          type: 'hottext',
          identifier: $(node).attr('identifier') || '',
          text: textContent($, node),
        });
      } else if (name === 'qti-prompt' || name === 'prompt') {
        continue;
      } else {
        walk($(node).contents().toArray());
      }
    }
  };
  walk($(el).contents().toArray());
  return { kind: 'hottext', parts };
}

function parseSelectPoint($: CheerioAPI, el: AnyNode, itemHref = ''): PaperInteraction {
  const img = $(el).find('img').first();
  const src = resolveAssetRef(img.attr('src') || '', itemHref);
  const prompt = textContent($, $(el).children('qti-prompt, prompt').get(0));
  return {
    kind: 'selectPoint',
    imageAsset: src,
    instruction: prompt || getLocaleStrings('nl').selectPointInstruction,
    alt: img.attr('alt') || undefined,
    width: parseInt(img.attr('width') || '', 10) || undefined,
    height: parseInt(img.attr('height') || '', 10) || undefined,
  };
}

function parseExtendedText($: CheerioAPI, el: AnyNode): PaperInteraction {
  const expectedLines = parseInt($(el).attr('expected-lines') || $(el).attr('expectedLines') || '6', 10);
  return { kind: 'extendedText', lines: Math.max(3, expectedLines || 6) };
}

function replaceTextEntriesInHtml($: CheerioAPI, el: AnyNode): { html: string; blanks: number } {
  const clone = $(el).clone();
  let blanks = 0;
  clone.find('qti-text-entry-interaction, textEntryInteraction').each((_, te) => {
    blanks += 1;
    $(te).replaceWith(' ________ ');
  });
  clone.find('qti-inline-choice-interaction, inlineChoiceInteraction').each((_, ic) => {
    blanks += 1;
    $(ic).replaceWith(' ________ ');
  });
  return { html: clone.html() || clone.text() || '', blanks };
}

function parseInlineChoiceSlots($: CheerioAPI): {
  slots: Extract<PaperInteraction, { kind: 'inlineChoice' }>['slots'];
  numberedHtmlByResponse: Map<string, string>;
} {
  const slots: Extract<PaperInteraction, { kind: 'inlineChoice' }>['slots'] = [];
  const numberedHtmlByResponse = new Map<string, string>();
  let n = 0;
  $('qti-inline-choice-interaction, inlineChoiceInteraction').each((_, ic) => {
    n += 1;
    const responseId = $(ic).attr('response-identifier') || $(ic).attr('responseIdentifier') || `R${n}`;
    const options: PaperChoiceOption[] = [];
    $(ic)
      .children('qti-inline-choice, inlineChoice')
      .each((i, ch) => {
        options.push({
          identifier: $(ch).attr('identifier') || `C${i + 1}`,
          label: labelFromIndex(i),
          contentHtml: innerHtml($, ch) || textContent($, ch),
        });
      });
    slots.push({ number: n, responseId, options });
    numberedHtmlByResponse.set(responseId, `(${n})`);
  });
  return { slots, numberedHtmlByResponse };
}

function parseInlineTextEntries(
  $: CheerioAPI,
  itemHref = ''
): { interaction: PaperInteraction; stimulus: PaperContentBlock[] } | null {
  const body = $('qti-item-body, itemBody').first();
  if (!body.length) return null;
  const entries = body.find(
    'qti-text-entry-interaction, textEntryInteraction, qti-inline-choice-interaction, inlineChoiceInteraction'
  );
  if (!entries.length) return null;
  if (body.find(BLOCK_INTERACTION_SEL).length) return null;

  const inlineChoices = body.find('qti-inline-choice-interaction, inlineChoiceInteraction');
  const textEntries = body.find('qti-text-entry-interaction, textEntryInteraction');

  // Pure inline-choice (dropdown) → Kennisnet: (1)/(2) in text + option banks below
  if (inlineChoices.length && !textEntries.length) {
    const { slots, numberedHtmlByResponse } = parseInlineChoiceSlots($);
    const stimulus: PaperContentBlock[] = [];
    body.contents().each((_, child) => {
      if (child.type === 'text') {
        const t = $(child).text().trim();
        if (t) stimulus.push({ type: 'paragraph', html: t });
        return;
      }
      if (!isElement(child)) return;
      const name = nodeName(child);
      if (name === 'qti-feedback-block' || name === 'feedbackblock') return;
      if (name === 'qti-rubric-block' || name === 'rubricblock') return;
      const clone = $(child).clone();
      clone.find('qti-inline-choice-interaction, inlineChoiceInteraction').each((_, ic) => {
        const rid = $(ic).attr('response-identifier') || $(ic).attr('responseIdentifier') || '';
        $(ic).replaceWith(` ${numberedHtmlByResponse.get(rid) || '(?)'} `);
      });
      const html = (clone.html() || clone.text() || '').trim();
      if (html) stimulus.push(...htmlToBlocks(html, itemHref));
    });
    return { interaction: { kind: 'inlineChoice', slots }, stimulus };
  }

  let blanks = 0;
  const stimulus: PaperContentBlock[] = [];
  body.contents().each((_, child) => {
    if (child.type === 'text') {
      const t = $(child).text().trim();
      if (t) stimulus.push({ type: 'paragraph', html: t });
      return;
    }
    if (!isElement(child)) return;
    const name = nodeName(child);
    if (name === 'qti-feedback-block' || name === 'feedbackblock') return;
    if (name === 'qti-rubric-block' || name === 'rubricblock') return;
    const { html, blanks: b } = replaceTextEntriesInHtml($, child);
    blanks += b;
    if (html.trim()) stimulus.push(...htmlToBlocks(html, itemHref));
  });

  return {
    interaction: { kind: 'textEntry', blanks: blanks || 1, inline: true },
    stimulus,
  };
}

function extractPoints($: CheerioAPI): number | undefined {
  const maxScore = $(
    'qti-outcome-declaration[identifier="MAXSCORE"], outcomeDeclaration[identifier="MAXSCORE"]'
  ).first();
  if (maxScore.length) {
    const v = textContent($, maxScore.find('qti-value, value').first().get(0));
    if (v) {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  const score = $(
    'qti-outcome-declaration[identifier="SCORE"], outcomeDeclaration[identifier="SCORE"]'
  ).first();
  const nm = score.attr('normal-maximum') || score.attr('normalMaximum');
  if (nm) {
    const n = parseFloat(nm);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function extractScorerRubric($: CheerioAPI): string | undefined {
  const blocks: string[] = [];
  $('qti-rubric-block, rubricBlock').each((_, el) => {
    const view = ($(el).attr('view') || '').toLowerCase();
    const use = ($(el).attr('use') || '').toLowerCase();
    if (!view.includes('scorer') && !use.includes('scoring')) return;
    const body = $(el).find('qti-content-body, contentBody').first();
    const html = body.length ? innerHtml($, body.get(0)) : innerHtml($, el);
    if (html.trim()) blocks.push(html.trim());
  });
  return blocks.length ? blocks.join('\n') : undefined;
}

function plainListFromHtml(html: string): string {
  return html
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<(td|th)[^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function answerKeyFor(
  kind: PaperInteraction['kind'],
  $: CheerioAPI,
  interaction: PaperInteraction,
  responseId?: string
): PaperAnswerKey | undefined {
  const values = collectCorrectValues($, responseId);
  const rubricHtml = extractScorerRubric($);

  let summary = '';
  if (kind === 'choice' && interaction.kind === 'choice') {
    summary = values
      .map(v => {
        const c = interaction.choices.find(ch => ch.identifier === v);
        return c ? c.contentHtml.replace(/<[^>]+>/g, '').trim() : v;
      })
      .filter(Boolean)
      .join(', ');
  } else if (kind === 'inlineChoice' && interaction.kind === 'inlineChoice') {
    const parts: string[] = [];
    for (const slot of interaction.slots) {
      const vals = collectCorrectValues($, slot.responseId);
      for (const v of vals) {
        const opt = slot.options.find(o => o.identifier === v);
        parts.push(opt ? opt.contentHtml.replace(/<[^>]+>/g, '').trim() : v);
      }
    }
    summary = parts.length ? `Antwoord:  ${parts.join('  /  ')}` : '';
  } else if (kind === 'order' && interaction.kind === 'order') {
    summary = values
      .map(v => {
        const item = interaction.items.find(c => c.identifier === v);
        return item ? item.contentHtml.replace(/<[^>]+>/g, '').trim() : v;
      })
      .join('  /  ');
  } else if (kind === 'match' && interaction.kind === 'match') {
    summary = values
      .map(v => {
        const [a, b] = v.split(/\s+/);
        const row = interaction.rows.find(r => r.identifier === a);
        const col = interaction.columns.find(c => c.identifier === b);
        const rowT = row ? row.contentHtml.replace(/<[^>]+>/g, '').trim() : a;
        const colT = col ? col.contentHtml.replace(/<[^>]+>/g, '').trim() : b;
        return `•  ${rowT} → ${colT}`;
      })
      .join('\n');
  } else if (kind === 'gapMatch' && interaction.kind === 'gapMatch') {
    summary = values
      .map(v => {
        const [wordId] = v.split(/\s+/);
        const word = interaction.options.find(o => o.identifier === wordId);
        return word ? word.contentHtml.replace(/<[^>]+>/g, '').trim() : wordId;
      })
      .join('  /  ');
  } else if (kind === 'hottext' && interaction.kind === 'hottext') {
    summary = values
      .map(v => interaction.parts.find(p => p.type === 'hottext' && p.identifier === v))
      .filter((p): p is Extract<PaperHottextPart, { type: 'hottext' }> => !!p && p.type === 'hottext')
      .map(p => p.text)
      .join('  /  ');
  } else if (kind === 'textEntry') {
    summary = values.join('  /  ');
  } else if (values.length) {
    summary = values.join(', ');
  }

  if (rubricHtml) {
    const fromRubric = plainListFromHtml(rubricHtml);
    return {
      summary: fromRubric || summary,
      values: values.length ? values : undefined,
      rubricHtml,
    };
  }

  if (!summary && kind === 'extendedText') return undefined;
  if (!summary && !values.length) return undefined;
  return { summary: summary || values.join(', '), values: values.length ? values : undefined };
}

const UNSUPPORTED_NOTES: Record<string, string> = {
  'qti-portable-custom-interaction': 'Portable Custom Interaction (PCI) — alleen digitaal beschikbaar.',
  'qti-media-interaction': 'Media-interactie — bekijk digitaal.',
  'qti-upload-interaction': 'Uploadvraag — niet geschikt voor papier.',
  'qti-drawing-interaction': 'Tekenvraag — niet geschikt voor papier.',
  'qti-graphic-gap-match-interaction': 'Grafische sleepvraag — markeer op papier of gebruik de digitale versie.',
  'qti-graphic-order-interaction': 'Grafische volgordevraag — gebruik de digitale versie.',
  'qti-graphic-associate-interaction': 'Grafische associatie — gebruik de digitale versie.',
  'qti-hotspot-interaction': 'Hotspotvraag — markeer op de afbeelding of gebruik digitaal.',
  'qti-position-object-interaction': 'Position-object — gebruik de digitale versie.',
  'qti-slider-interaction': 'Schuifregelaar — noteer de waarde op papier.',
};

function firstInteraction($: CheerioAPI): { el: AnyNode; name: string } | null {
  const body = $('qti-item-body, itemBody').first();
  if (!body.length) return null;
  const candidates = body
    .find(
      [
        'qti-choice-interaction',
        'qti-order-interaction',
        'qti-match-interaction',
        'qti-associate-interaction',
        'qti-gap-match-interaction',
        'qti-hottext-interaction',
        'qti-select-point-interaction',
        'qti-extended-text-interaction',
        'qti-text-entry-interaction',
        'qti-inline-choice-interaction',
        'qti-hotspot-interaction',
        'qti-graphic-gap-match-interaction',
        'qti-graphic-order-interaction',
        'qti-graphic-associate-interaction',
        'qti-portable-custom-interaction',
        'qti-media-interaction',
        'qti-upload-interaction',
        'qti-slider-interaction',
        'qti-position-object-interaction',
        'qti-custom-interaction',
        'choiceInteraction',
        'orderInteraction',
        'matchInteraction',
        'gapMatchInteraction',
        'hottextInteraction',
        'selectPointInteraction',
        'extendedTextInteraction',
        'textEntryInteraction',
      ].join(', ')
    )
    .toArray();

  if (!candidates.length) return null;
  // Prefer block-level over inline text-entry when both exist
  const preferred = candidates.find(c => {
    const n = nodeName(c as Element);
    return !n.includes('text-entry') && !n.includes('textentry') && !n.includes('inline-choice');
  });
  const el = preferred || candidates[0];
  return { el, name: nodeName(el as Element) };
}

export function parseItemXml(xml: string, _assets: Map<string, PaperAsset>, itemHref = ''): PaperItem {
  const $ = loadXml(xml);
  const root = $('qti-assessment-item, assessmentItem').first();
  const identifier = root.attr('identifier') || 'item';
  const title = root.attr('title') || identifier;
  const points = extractPoints($);

  const inline = parseInlineTextEntries($, itemHref);
  if (inline) {
    if (inline.interaction.kind === 'inlineChoice') {
      return {
        identifier,
        title,
        points,
        stimulus: inline.stimulus,
        interaction: inline.interaction,
        answerKey: answerKeyFor('inlineChoice', $, inline.interaction),
      };
    }
    const responseIds = $('qti-text-entry-interaction, textEntryInteraction')
      .map((_, el) => $(el).attr('response-identifier') || $(el).attr('responseIdentifier') || '')
      .get()
      .filter(Boolean);
    const values: string[] = [];
    for (const id of responseIds) {
      values.push(...collectCorrectValues($, id));
    }
    const rubricHtml = extractScorerRubric($);
    return {
      identifier,
      title,
      points,
      stimulus: inline.stimulus,
      interaction: inline.interaction,
      answerKey:
        values.length || rubricHtml
          ? {
              summary: rubricHtml ? plainListFromHtml(rubricHtml) : values.join('  /  '),
              values: values.length ? values : undefined,
              rubricHtml,
            }
          : undefined,
    };
  }

  const found = firstInteraction($);
  if (!found) {
    return {
      identifier,
      title,
      points,
      stimulus: bodyStimulusOutsideInteractions($, itemHref),
      interaction: {
        kind: 'unsupported',
        interactionType: 'none',
        fallbackNote: 'Geen interactie gevonden in dit item.',
      },
      answerKey: (() => {
        const rubricHtml = extractScorerRubric($);
        return rubricHtml
          ? { summary: plainListFromHtml(rubricHtml), rubricHtml }
          : undefined;
      })(),
    };
  }

  const { el, name } = found;
  const responseId = $(el).attr('response-identifier') || $(el).attr('responseIdentifier') || undefined;
  let interaction: PaperInteraction;
  let stimulus = [...bodyStimulusOutsideInteractions($, itemHref), ...promptBlocks($, el, itemHref)];

  if (name.includes('choice-interaction') || name === 'choiceinteraction') {
    interaction = parseChoice($, el);
  } else if (name.includes('order-interaction') || name === 'orderinteraction') {
    interaction = parseOrder($, el);
  } else if (name.includes('gap-match') || name === 'gapmatchinteraction') {
    interaction = parseGapMatch($, el);
  } else if (
    name === 'qti-match-interaction' ||
    name === 'matchinteraction' ||
    name === 'qti-associate-interaction' ||
    name === 'associateinteraction'
  ) {
    interaction = parseMatch($, el);
  } else if (name.includes('hottext') || name === 'hottextinteraction') {
    interaction = parseHottext($, el);
  } else if (name.includes('select-point') || name === 'selectpointinteraction') {
    interaction = parseSelectPoint($, el, itemHref);
  } else if (name.includes('extended-text') || name === 'extendedtextinteraction') {
    interaction = parseExtendedText($, el);
  } else if (name.includes('text-entry') || name === 'textentryinteraction') {
    interaction = { kind: 'textEntry', blanks: 1, inline: false };
  } else {
    const note = UNSUPPORTED_NOTES[name] || `${getLocaleStrings('en').unsupportedPrefix}: ${name}.`;
    const img = $(el).find('img').first();
    if (img.length) {
      const src = resolveAssetRef(img.attr('src') || '', itemHref);
      if (src) {
        stimulus.push({
          type: 'image',
          assetPath: src,
          alt: img.attr('alt') || undefined,
        });
      }
    }
    interaction = { kind: 'unsupported', interactionType: name, fallbackNote: note };
  }

  return {
    identifier,
    title,
    points,
    stimulus,
    interaction,
    answerKey: answerKeyFor(interaction.kind, $, interaction, responseId),
  };
}
