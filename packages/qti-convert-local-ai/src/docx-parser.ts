import JSZip from 'jszip';
import { createWebLlmEngine, inferQuestionsFromRawResponse, type WebLlmLikeEngine } from './mapping';
import { GenerateQtiPackageOptions, StructuredMediaAsset, StructuredQuestion } from './types';
import { generateQtiPackageFromQuestions } from './qti-generator';
import {
  buildBatchedNormalizationPrompt,
  buildSingleItemNormalizationPrompt,
  buildSegmentationPrompt
} from './shared-prompts';

type DocxInput = File | Blob | ArrayBuffer | Uint8Array;
type DocxBlock = { type: 'text'; text: string } | { type: 'image'; asset: StructuredMediaAsset };
type DocxSegmentation = {
  ignoredBlocks?: number[];
  items?: Array<{
    blockIndexes?: number[];
  }>;
};

export type DocxDocumentData = {
  paragraphs: string[];
  blocks: DocxBlock[];
  images: StructuredMediaAsset[];
  fileName?: string;
};

export type DocxPreview = {
  paragraphCount: number;
  sampleParagraphs: string[];
  fileName?: string;
};

export type DocxToQtiResult = {
  document: DocxDocumentData;
  preview: DocxPreview;
  questions: StructuredQuestion[];
  packageBlob: Blob;
  packageName: string;
  summary: Awaited<ReturnType<typeof generateQtiPackageFromQuestions>>['summary'];
};

const EMPTY = '';
const DOCX_SEGMENTATION_CHUNK_SIZE = 36;
const DOCX_NORMALIZATION_BATCH_SIZE = 8; // Normalize multiple items per LLM call
const DOCX_IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
};

const logDocxDebug = (label: string, data: unknown): void => {
  console.log(`[qti-convert-local-ai][docx] ${label}`, data);
};

const decodeXmlEntities = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));

const getInputFileName = (input: DocxInput): string | undefined => {
  if (typeof File !== 'undefined' && input instanceof File) {
    return input.name;
  }
  return undefined;
};

const toArrayBuffer = async (input: DocxInput): Promise<ArrayBuffer> => {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (input instanceof Uint8Array) {
    return new Uint8Array(input).buffer.slice(0) as ArrayBuffer;
  }
  return input.arrayBuffer();
};

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const extractJsonString = (rawResponse: string): string => {
  const fencedMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const start = rawResponse.indexOf('{');
  const end = rawResponse.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('LLM response did not contain JSON.');
  }
  return rawResponse.slice(start, end + 1);
};

const parseDocxJson = (rawResponse: string): unknown => JSON.parse(extractJsonString(rawResponse)) as unknown;

const extractResponseContent = (rawContent: string | Array<{ text?: string }> | undefined): string =>
  typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => part.text || '').join('')
      : '';

const requestLlmJson = async (
  engine: WebLlmLikeEngine,
  systemPrompt: string,
  userPrompt: string,
  options: GenerateQtiPackageOptions = {}
): Promise<string> => {
  const response = await engine.chat.completions.create({
    temperature: options.llmSettings?.temperature ?? 0,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ]
  });

  const content = extractResponseContent(response.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error('WebLLM returned an empty DOCX response.');
  }
  return content;
};

const buildDocxSystemPrompt = (basePrompt: string, options: GenerateQtiPackageOptions = {}): string => {
  const prompt = options.llmSettings?.systemPrompt?.trim() || basePrompt;
  const instructions = options.llmSettings?.instructions?.trim();

  return instructions ? `${prompt}\n\nAdditional import instructions:\n${instructions}` : prompt;
};

const paragraphXmlToText = (paragraphXml: string): string => {
  const tokens = Array.from(
    paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g)
  );

  if (tokens.length === 0) {
    return EMPTY;
  }

  const text = tokens
    .map(match => {
      const token = match[0];
      if (token.startsWith('<w:tab')) {
        return '\t';
      }
      if (token.startsWith('<w:br') || token.startsWith('<w:cr')) {
        return '\n';
      }
      return decodeXmlEntities(match[1] || '');
    })
    .join('');

  return normalizeWhitespace(text);
};

const fileNameFromPath = (value: string): string => value.split('/').pop() || value;

const mimeTypeFromPath = (value: string): string => {
  const extension = fileNameFromPath(value).split('.').pop()?.toLowerCase() || '';
  return DOCX_IMAGE_MIME_TYPES[extension] || 'application/octet-stream';
};

const parseRelationshipTargets = (xml: string): Map<string, string> => {
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    const id = match[1];
    const target = match[2];
    relationships.set(id, target.startsWith('media/') ? `word/${target}` : target);
  }
  return relationships;
};

const splitEmbeddedQuestionMarkers = (value: string): string[] => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return [];
  }

  const withBreaks = normalized
    .replace(/\s+(?=\d{1,3}[.)]\s+(?:[a-h][.)]?\s+)?\S)/g, '\n')
    .replace(/\s+(?=(question|vraag)\s+\d{1,3}\b)/gi, '\n')
    .replace(/\s+(?=[a-h](?:[.)])?\s+[A-Z])/g, '\n');

  return withBreaks
    .split('\n')
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);
};

const parseDocumentXml = (xml: string): string[] =>
  Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .flatMap(match =>
      paragraphXmlToText(match[0])
        .split('\n')
        .flatMap(line => splitEmbeddedQuestionMarkers(line))
    )
    .filter(Boolean);

const parseDocumentBlocks = (xml: string, imageByRelationshipId: Map<string, StructuredMediaAsset>): DocxBlock[] =>
  Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).flatMap(match => {
    const paragraphXml = match[0];
    const blocks: DocxBlock[] = [];
    const text = paragraphXmlToText(paragraphXml);

    for (const line of text.split('\n').flatMap(splitEmbeddedQuestionMarkers)) {
      if (line) {
        blocks.push({ type: 'text', text: line });
      }
    }

    for (const imageMatch of paragraphXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"[^>]*\/?>/g)) {
      const asset = imageByRelationshipId.get(imageMatch[1]);
      if (asset) {
        blocks.push({ type: 'image', asset });
      }
    }

    return blocks;
  });

const isQuestionStart = (value: string): boolean =>
  /^((question|vraag)\s*)?\d{1,3}[.)]\s+\S+/i.test(value) ||
  /^\(\d{1,3}\)\s+\S+/i.test(value) ||
  /^((question|vraag)\s*)?\d{1,3}\s*[:.-]\s+\S+/i.test(value) ||
  /^(question|vraag)\s+\d{1,3}\b[:.)-]?\s*/i.test(value);

const isBareQuestionNumber = (value: string): boolean => /^\d{1,3}[.)]$/.test(value);

const isCombinedQuestionSubQuestionStart = (value: string): boolean => /^\d{1,3}[.)]\s+[a-h][.)]?\s+\S+/i.test(value);

const isSubQuestionStart = (value: string): boolean =>
  /^[a-h](?:[.)])?\s+\S+/.test(value) || /^\(?\d{1,3}[.)]?\s*[a-h](?:[.)])?\s+\S+/.test(value);

const stripQuestionPrefix = (value: string): string =>
  value
    .replace(/^((question|vraag)\s*)?\d{1,3}[.)]\s*/i, '')
    .replace(/^\(\d{1,3}\)\s*/i, '')
    .replace(/^((question|vraag)\s*)?\d{1,3}\s*[:.-]\s*/i, '')
    .replace(/^(question|vraag)\s+\d{1,3}\b[:.)-]?\s*/i, '')
    .trim();

const stripSubQuestionPrefix = (value: string): string =>
  value
    .replace(/^[a-h](?:[.)])?\s+/, '')
    .replace(/^\(?\d{1,3}[.)]?\s*[a-h](?:[.)])?\s+/, '')
    .trim();

const optionMatch = (value: string): RegExpMatchArray | null =>
  value.match(/^([A-H]|[1-8])[.)]\s+(.+)$/) ||
  value.match(/^([A-H]|[1-8])\s*[:.-]\s+(.+)$/) ||
  value.match(/^([A-H])\s+(.+)$/) ||
  value.match(/^[•●▪◦○\-–]\s+(.+)$/);

const plainUppercaseOptionMatch = (value: string): RegExpMatchArray | null => value.match(/^([A-H])\s+(.+)$/);
const unlabeledOptionCandidate = (value: string): boolean =>
  /^(?:\d{3,4}|[A-ZÀ-ÖØ-Þ][\p{L}\p{M}\d' -]{2,60})$/u.test(value) &&
  !/[?=:]$/.test(value) &&
  !isQuestionStart(value) &&
  !isSubQuestionStart(value);

const blankPlaceholderPattern = /_{3,}/g;
const blankPlaceholderDetector = /_{3,}/;
const scorePattern = /(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*(?:p|pt|pts|punt(?:en)?)\)?$/i;

const parseScore = (value: string): number | undefined => {
  const match = value.match(scorePattern);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number(match[1].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const stripTrailingScore = (value: string): string =>
  value.replace(/\s*\(?\d+(?:[.,]\d+)?\s*(?:p|pt|pts|punt(?:en)?)\)?$/i, '').trim();

const hasBlankPlaceholder = (value: string): boolean => blankPlaceholderDetector.test(value);

const stripBlankPlaceholders = (value: string): string =>
  value
    .replace(blankPlaceholderPattern, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const isLikelyBoilerplate = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return [
    /^booklet\b/i,
    /^this booklet\b/i,
    /^the booklet\b/i,
    /^number of questions\b/i,
    /^\d+\s+questions?\b/i,
    /^instructions?\b/i,
    /^page\s+\d+\b/i,
    /^student name\b/i,
    /^candidate\b/i,
    /^do not write\b/i,
    /^you have \d+/i
  ].some(pattern => pattern.test(trimmed));
};

const shouldKeepAsStimulus = (paragraphs: string[]): boolean => {
  if (paragraphs.length === 0) {
    return false;
  }
  const combined = paragraphs.join('\n\n').trim();
  if (combined.length < 30) {
    return false;
  }
  return !paragraphs.every(paragraph => isLikelyBoilerplate(paragraph));
};

type WorkingQuestion = {
  identifier: string;
  promptParts: string[];
  stimulusParts: string[];
  stimulusImages: StructuredMediaAsset[];
  options: Array<{ id: string; text: string }>;
  points?: number;
  kind: 'question' | 'subquestion';
  preserveStimulus?: boolean;
};

const finalizeQuestion = (question: WorkingQuestion): StructuredQuestion | null => {
  const prompt = normalizeWhitespace(stripBlankPlaceholders(question.promptParts.join('\n\n')));
  if (!prompt) {
    return null;
  }

  const containsBlankInteraction = question.promptParts.some(part => hasBlankPlaceholder(part));

  return {
    type: containsBlankInteraction || question.options.length < 2 ? 'extended_text' : 'multiple_choice',
    identifier: question.identifier,
    prompt,
    stimulus:
      question.preserveStimulus || shouldKeepAsStimulus(question.stimulusParts)
        ? normalizeWhitespace(stripBlankPlaceholders(question.stimulusParts.join('\n\n')))
        : undefined,
    stimulusImages: question.stimulusImages.length > 0 ? question.stimulusImages : undefined,
    options:
      !containsBlankInteraction && question.options.length >= 2
        ? question.options.map(option => ({
            id: option.id,
            text: normalizeWhitespace(stripTrailingScore(stripBlankPlaceholders(option.text)))
          }))
        : undefined,
    layout: question.stimulusParts.length > 0 ? 'auto' : 'single_column',
    points: question.points
  };
};

const buildDocxSegmentationPrompt = (blocks: Array<{ index: number; text: string }>): string =>
  buildSegmentationPrompt('DOCX', blocks);

const normalizeSegmentation = (rawValue: unknown, rangeStart: number, rangeEnd: number): number[][] => {
  const items =
    typeof rawValue === 'object' && rawValue && Array.isArray((rawValue as DocxSegmentation).items)
      ? (rawValue as DocxSegmentation).items || []
      : [];

  const normalized = items
    .map(item => {
      if (!Array.isArray(item.blockIndexes)) {
        return [];
      }
      const rawIndexes = item.blockIndexes.map(value => Number(value)).filter(index => Number.isInteger(index));
      const looksLocal = rawIndexes.every(index => index >= 0 && index < rangeEnd - rangeStart);
      const resolvedIndexes = looksLocal ? rawIndexes.map(index => index + rangeStart) : rawIndexes;
      return resolvedIndexes.filter(index => index >= rangeStart && index < rangeEnd);
    })
    .filter(blockIndexes => blockIndexes.length > 0);

  if (normalized.length === 0) {
    throw new Error('LLM DOCX segmentation did not produce any item groups.');
  }

  return normalized;
};

const isSegmentationBoundary = (value: string): boolean =>
  isBareQuestionNumber(value) ||
  isQuestionStart(value) ||
  isCombinedQuestionSubQuestionStart(value) ||
  isSubQuestionStart(value);

const findSegmentationChunkEnd = (blocks: string[], startIndex: number, chunkSize: number): number => {
  const maxEnd = Math.min(blocks.length, startIndex + chunkSize);
  if (maxEnd >= blocks.length) {
    return blocks.length;
  }

  const minimumEnd = Math.min(blocks.length, startIndex + Math.max(8, Math.floor(chunkSize / 2)));
  for (let index = maxEnd; index > minimumEnd; index -= 1) {
    if (isSegmentationBoundary(blocks[index] || '')) {
      return index;
    }
  }

  return maxEnd;
};

const findPreviousTextBlockIndex = (blocks: DocxBlock[], imageIndex: number): number | undefined => {
  for (let index = imageIndex - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === 'text') {
      return index;
    }
  }
  return undefined;
};

const findNextTextBlockIndex = (blocks: DocxBlock[], imageIndex: number): number | undefined => {
  for (let index = imageIndex + 1; index < blocks.length; index += 1) {
    if (blocks[index]?.type === 'text') {
      return index;
    }
  }
  return undefined;
};

const findItemIndexContainingBlock = (groupedBlockIndexes: number[][], blockIndex: number | undefined): number => {
  if (blockIndex === undefined) {
    return -1;
  }
  return groupedBlockIndexes.findIndex(blockIndexes => blockIndexes.includes(blockIndex));
};

const assignImageBlocksToSegmentedItems = (blocks: DocxBlock[], itemBlockIndexes: number[][]): number[][] => {
  const assigned = itemBlockIndexes.map(blockIndexes => [...blockIndexes].sort((a, b) => a - b));
  const imageIndexes = blocks
    .map((block, index) => ({ block, index }))
    .filter(
      (entry): entry is { block: Extract<DocxBlock, { type: 'image' }>; index: number } => entry.block.type === 'image'
    )
    .map(entry => entry.index);

  for (const imageIndex of imageIndexes) {
    const previousTextBlockIndex = findPreviousTextBlockIndex(blocks, imageIndex);
    const nextTextBlockIndex = findNextTextBlockIndex(blocks, imageIndex);
    const previousItemIndex = findItemIndexContainingBlock(assigned, previousTextBlockIndex);
    const nextItemIndex = findItemIndexContainingBlock(assigned, nextTextBlockIndex);

    if (previousItemIndex >= 0 && previousItemIndex === nextItemIndex) {
      logDocxDebug('Assigning image block by matching previous/next text anchors', {
        imageIndex,
        previousTextBlockIndex,
        nextTextBlockIndex,
        itemIndex: previousItemIndex
      });
      if (!assigned[previousItemIndex].includes(imageIndex)) {
        assigned[previousItemIndex].push(imageIndex);
        assigned[previousItemIndex].sort((a, b) => a - b);
      }
      continue;
    }

    if (previousItemIndex >= 0 && nextItemIndex === -1) {
      logDocxDebug('Assigning image block by previous text anchor', {
        imageIndex,
        previousTextBlockIndex,
        itemIndex: previousItemIndex
      });
      if (!assigned[previousItemIndex].includes(imageIndex)) {
        assigned[previousItemIndex].push(imageIndex);
        assigned[previousItemIndex].sort((a, b) => a - b);
      }
      continue;
    }

    if (nextItemIndex >= 0 && previousItemIndex === -1) {
      logDocxDebug('Assigning image block by next text anchor', {
        imageIndex,
        nextTextBlockIndex,
        itemIndex: nextItemIndex
      });
      if (!assigned[nextItemIndex].includes(imageIndex)) {
        assigned[nextItemIndex].push(imageIndex);
        assigned[nextItemIndex].sort((a, b) => a - b);
      }
      continue;
    }

    let bestItemIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [itemIndex, blockIndexes] of assigned.entries()) {
      if (blockIndexes.includes(imageIndex)) {
        bestItemIndex = itemIndex;
        bestDistance = -1;
        break;
      }
      if (blockIndexes.length === 0) {
        continue;
      }
      const distance = Math.min(...blockIndexes.map(blockIndex => Math.abs(blockIndex - imageIndex)));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestItemIndex = itemIndex;
      }
    }

    if (bestItemIndex >= 0 && !assigned[bestItemIndex].includes(imageIndex)) {
      logDocxDebug('Assigning image block by nearest item fallback', {
        imageIndex,
        previousTextBlockIndex,
        nextTextBlockIndex,
        itemIndex: bestItemIndex,
        distance: bestDistance
      });
      assigned[bestItemIndex].push(imageIndex);
      assigned[bestItemIndex].sort((a, b) => a - b);
    }
  }

  return assigned;
};

const buildDocxNormalizationPrompt = (blocks: string[]): string => buildSingleItemNormalizationPrompt('DOCX', blocks);

// Batched version that processes multiple items at once
const buildBatchedDocxNormalizationPrompt = (itemGroups: Array<{ itemIndex: number; blocks: string[] }>): string =>
  buildBatchedNormalizationPrompt('DOCX', itemGroups);

const segmentDocxParagraphsWithLlm = async (
  engine: WebLlmLikeEngine,
  paragraphs: string[],
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
): Promise<number[][]> => {
  const segmentedItems: number[][] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < paragraphs.length) {
    const endIndex = findSegmentationChunkEnd(paragraphs, startIndex, DOCX_SEGMENTATION_CHUNK_SIZE);
    const chunk = paragraphs.slice(startIndex, endIndex).map((text, localIndex) => ({
      index: startIndex + localIndex,
      text
    }));

    onProgress?.({
      stage: 'chunk_started',
      message: `Segmenting DOCX blocks ${startIndex + 1}-${endIndex} of ${paragraphs.length}.`
    });

    const rawResponse = await requestLlmJson(
      engine,
      buildDocxSystemPrompt(
        'You segment DOCX document blocks into assessment items. Return strict JSON only.',
        options
      ),
      buildDocxSegmentationPrompt(chunk),
      options
    );
    const parsed = parseDocxJson(rawResponse);
    const chunkItems = normalizeSegmentation(parsed, startIndex, endIndex);
    logDocxDebug('DOCX segmentation chunk result', {
      chunkIndex,
      startIndex,
      endIndex,
      chunk,
      chunkItems
    });
    segmentedItems.push(...chunkItems);

    onProgress?.({
      stage: 'chunk_completed',
      message: `Segmented DOCX blocks ${startIndex + 1}-${endIndex} of ${paragraphs.length}.`,
      data: {
        chunkIndex: chunkIndex + 1,
        rangeStart: startIndex,
        rangeEnd: endIndex,
        itemCount: chunkItems.length
      }
    });

    startIndex = endIndex;
    chunkIndex += 1;
  }

  if (segmentedItems.length === 0) {
    throw new Error('LLM DOCX segmentation did not produce any item groups.');
  }

  onProgress?.({
    stage: 'mapping_started',
    message: 'Segmented DOCX blocks into candidate items with the local LLM.'
  });
  return segmentedItems;
};

type DocxBatchedNormalizationResult = {
  items: Array<{
    itemIndex: number;
    questions: StructuredQuestion[];
  }>;
};

const parseDocxBatchedNormalizationResponse = (rawResponse: string): DocxBatchedNormalizationResult => {
  const parsed = parseDocxJson(rawResponse);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM batch normalization response is not an object.');
  }
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    // Fallback: try to treat as single item response
    const questions = inferQuestionsFromRawResponse(rawResponse).questions;
    return { items: [{ itemIndex: 0, questions }] };
  }
  return {
    items: items.map((item: unknown, fallbackIndex: number) => {
      if (typeof item !== 'object' || item === null) {
        return { itemIndex: fallbackIndex, questions: [] };
      }
      const itemObj = item as Record<string, unknown>;
      const itemIndex = typeof itemObj.itemIndex === 'number' ? itemObj.itemIndex : fallbackIndex;
      let questions: StructuredQuestion[] = [];
      if (Array.isArray(itemObj.questions)) {
        questions = inferQuestionsFromRawResponse(JSON.stringify({ questions: itemObj.questions })).questions;
      }
      return { itemIndex, questions };
    })
  };
};

const normalizeDocxItemsWithLlm = async (
  engine: WebLlmLikeEngine,
  blocks: DocxBlock[],
  itemBlockIndexes: number[][],
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
): Promise<StructuredQuestion[]> => {
  const groupedBlockIndexes = assignImageBlocksToSegmentedItems(blocks, itemBlockIndexes);
  logDocxDebug(
    'LLM segmented DOCX item groups',
    groupedBlockIndexes.map((blockIndexes, itemIndex) => ({
      itemIndex,
      blockIndexes,
      blocks: blockIndexes.map(blockIndex =>
        blocks[blockIndex]?.type === 'text'
          ? { index: blockIndex, type: 'text', text: (blocks[blockIndex] as Extract<DocxBlock, { type: 'text' }>).text }
          : {
              index: blockIndex,
              type: 'image',
              fileName: (blocks[blockIndex] as Extract<DocxBlock, { type: 'image' }>).asset.fileName
            }
      )
    }))
  );
  const questions: StructuredQuestion[] = [];
  const totalItems = groupedBlockIndexes.length;
  let batchIndex = 0;

  // Process items in batches
  for (let startIdx = 0; startIdx < totalItems; startIdx += DOCX_NORMALIZATION_BATCH_SIZE) {
    const endIdx = Math.min(startIdx + DOCX_NORMALIZATION_BATCH_SIZE, totalItems);
    const batchItems = groupedBlockIndexes.slice(startIdx, endIdx);
    batchIndex += 1;
    const totalBatches = Math.ceil(totalItems / DOCX_NORMALIZATION_BATCH_SIZE);

    onProgress?.({
      stage: 'chunk_started',
      message: `Normalizing DOCX items ${startIdx + 1}-${endIdx} of ${totalItems} (batch ${batchIndex}/${totalBatches}).`
    });

    // Prepare batch data: each item has its block texts
    const itemGroups = batchItems.map((blockIndexes, localIdx) => {
      const globalIdx = startIdx + localIdx;
      const itemBlocks = blockIndexes.map(blockIndex => blocks[blockIndex]).filter(Boolean);
      const blockTexts = itemBlocks.map(block =>
        block.type === 'text' ? block.text : `[Image: ${block.asset.fileName}]`
      );
      return { itemIndex: globalIdx, blocks: blockTexts, blockIndexes, itemBlocks };
    });

    let batchQuestionCount = 0;
    try {
      const rawResponse = await requestLlmJson(
        engine,
        buildDocxSystemPrompt(
          'You convert DOCX item blocks into structured assessment question JSON. Return strict JSON only.',
          options
        ),
        buildBatchedDocxNormalizationPrompt(itemGroups.map(g => ({ itemIndex: g.itemIndex, blocks: g.blocks }))),
        options
      );
      logDocxDebug('DOCX batch normalization raw response', {
        batchIndex,
        itemRange: [startIdx, endIdx],
        itemGroups: itemGroups.map(g => ({ itemIndex: g.itemIndex, blockCount: g.blocks.length })),
        rawResponse
      });

      let batchResult: DocxBatchedNormalizationResult;
      try {
        batchResult = parseDocxBatchedNormalizationResponse(rawResponse);
      } catch (error) {
        console.warn('[qti-convert-local-ai][docx] Failed to parse batch response, falling back to heuristic.', {
          batchIndex,
          error
        });
        // Fallback: heuristic extraction for each item in batch
        for (const group of itemGroups) {
          const fallbackQuestions = extractQuestionsFromParagraphs(group.blocks).map((question, questionIndex) => ({
            ...question,
            identifier: question.identifier || `item-${group.itemIndex + 1}-${questionIndex + 1}`
          }));
          questions.push(...fallbackQuestions);
          batchQuestionCount += fallbackQuestions.length;
        }
        onProgress?.({
          stage: 'chunk_completed',
          message: `Normalized DOCX items ${startIdx + 1}-${endIdx} of ${totalItems}.`,
          data: {
            chunkIndex: batchIndex,
            chunkCount: totalBatches,
            questionCount: batchQuestionCount
          }
        });
        continue;
      }

      // Process each item in the batch result
      for (const itemResult of batchResult.items) {
        const group = itemGroups.find(g => g.itemIndex === itemResult.itemIndex);
        if (!group) continue;

        const normalized = itemResult.questions;
        const itemImages = group.itemBlocks
          .filter((block): block is Extract<DocxBlock, { type: 'image' }> => block.type === 'image')
          .map(block => block.asset);
        const normalizedWithImages =
          itemImages.length === 0
            ? normalized
            : normalized.map((question, questionIndex) =>
                questionIndex === 0
                  ? {
                      ...question,
                      stimulusImages: [...(question.stimulusImages || []), ...itemImages]
                    }
                  : question
              );
        logDocxDebug('Normalized DOCX item result', {
          itemIndex: group.itemIndex,
          blockIndexes: group.blockIndexes,
          blockTexts: group.blocks,
          imageFileNames: itemImages.map(image => image.fileName),
          questionCount: normalizedWithImages.length,
          questions: normalizedWithImages.map(question => ({
            identifier: question.identifier,
            prompt: question.prompt,
            stimulusImageFileNames: (question.stimulusImages || []).map(image => image.fileName)
          }))
        });
        questions.push(...normalizedWithImages);
        batchQuestionCount += normalizedWithImages.length;
      }
    } catch (error) {
      console.warn('[qti-convert-local-ai][docx] Falling back to heuristic normalization for DOCX batch.', {
        batchIndex,
        itemRange: [startIdx, endIdx],
        error
      });
      // Fallback: heuristic extraction for each item in batch
      for (const group of itemGroups) {
        const fallbackQuestions = extractQuestionsFromParagraphs(group.blocks).map((question, questionIndex) => ({
          ...question,
          identifier: question.identifier || `item-${group.itemIndex + 1}-${questionIndex + 1}`
        }));
        questions.push(...fallbackQuestions);
        batchQuestionCount += fallbackQuestions.length;
      }
    }

    onProgress?.({
      stage: 'chunk_completed',
      message: `Normalized DOCX items ${startIdx + 1}-${endIdx} of ${totalItems}.`,
      data: {
        chunkIndex: batchIndex,
        chunkCount: totalBatches,
        questionCount: batchQuestionCount
      }
    });
  }

  return questions.map((question, index) => ({
    ...question,
    identifier: question.identifier || `item-${index + 1}`
  }));
};

export const extractQuestionsFromParagraphs = (paragraphs: string[]): StructuredQuestion[] => {
  const normalizedParagraphs = paragraphs.flatMap(value => splitEmbeddedQuestionMarkers(value)).filter(Boolean);
  const questions: StructuredQuestion[] = [];
  const pendingParagraphs: string[] = [];
  let current: WorkingQuestion | null = null;
  let questionCounter = 0;
  let sharedStimulusParts: string[] = [];

  const flushCurrent = () => {
    if (!current) {
      return;
    }
    const finalized = finalizeQuestion(current);
    if (finalized) {
      questions.push(finalized);
    }
    current = null;
  };

  for (const [index, paragraph] of normalizedParagraphs.entries()) {
    const isBareNumber = isBareQuestionNumber(paragraph);
    const isCombinedSubQuestion = isCombinedQuestionSubQuestionStart(paragraph);
    const isSubQuestion = isSubQuestionStart(paragraph);
    const option = optionMatch(paragraph);
    const plainUppercaseOption = plainUppercaseOptionMatch(paragraph);
    const score = parseScore(paragraph);
    if (isBareNumber) {
      flushCurrent();
      sharedStimulusParts = [];
      pendingParagraphs.length = 0;
      continue;
    }

    if (isCombinedSubQuestion) {
      flushCurrent();
      sharedStimulusParts = [];
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripSubQuestionPrefix(paragraph))],
        stimulusParts: [],
        stimulusImages: [],
        options: [],
        points: parseScore(paragraph),
        kind: 'subquestion',
        preserveStimulus: false
      };
      continue;
    }

    if (isQuestionStart(paragraph)) {
      flushCurrent();
      questionCounter += 1;
      sharedStimulusParts = [];
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripQuestionPrefix(paragraph))],
        stimulusParts: shouldKeepAsStimulus(pendingParagraphs) ? [...pendingParagraphs] : [],
        stimulusImages: [],
        options: [],
        points: parseScore(paragraph),
        kind: 'question',
        preserveStimulus: false
      };
      pendingParagraphs.length = 0;
      continue;
    }

    if (isSubQuestion) {
      if (current) {
        const currentPromptAsStimulus = normalizeWhitespace(current.promptParts.join('\n\n'));
        if (current.kind === 'subquestion') {
          flushCurrent();
        } else if (current.options.length === 0 && currentPromptAsStimulus) {
          sharedStimulusParts =
            current.stimulusParts.length > 0
              ? [...current.stimulusParts, currentPromptAsStimulus]
              : [currentPromptAsStimulus];
        } else {
          flushCurrent();
        }
      }
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripSubQuestionPrefix(paragraph))],
        stimulusParts: [...sharedStimulusParts],
        stimulusImages: [],
        options: [],
        points: parseScore(paragraph),
        kind: 'subquestion',
        preserveStimulus: sharedStimulusParts.length > 0
      };
      continue;
    }

    const nextParagraph = normalizedParagraphs[index + 1] || '';
    const nextNextParagraph = normalizedParagraphs[index + 2] || '';
    const nextThreeParagraph = normalizedParagraphs[index + 3] || '';
    const hasUpcomingUnlabeledOptionBlock =
      unlabeledOptionCandidate(nextParagraph) &&
      (unlabeledOptionCandidate(nextNextParagraph) || unlabeledOptionCandidate(nextThreeParagraph));

    if (
      !current &&
      !isLikelyBoilerplate(paragraph) &&
      !unlabeledOptionCandidate(paragraph) &&
      !isQuestionStart(paragraph) &&
      !isSubQuestionStart(paragraph) &&
      hasUpcomingUnlabeledOptionBlock
    ) {
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(paragraph)],
        stimulusParts: shouldKeepAsStimulus(pendingParagraphs) ? [...pendingParagraphs] : [],
        stimulusImages: [],
        options: [],
        points: parseScore(paragraph),
        kind: 'question',
        preserveStimulus: false
      };
      pendingParagraphs.length = 0;
      continue;
    }

    if (!current) {
      if (!isLikelyBoilerplate(paragraph)) {
        pendingParagraphs.push(paragraph);
      }
      continue;
    }

    const shouldStartPlainUppercaseOptionList =
      Boolean(plainUppercaseOption) &&
      current.options.length === 0 &&
      (Boolean(plainUppercaseOptionMatch(nextParagraph)) || Boolean(plainUppercaseOptionMatch(nextNextParagraph)));
    const shouldStartUnlabeledOptionList =
      current.options.length === 0 &&
      unlabeledOptionCandidate(paragraph) &&
      ((unlabeledOptionCandidate(nextParagraph) && unlabeledOptionCandidate(nextNextParagraph)) ||
        (unlabeledOptionCandidate(nextParagraph) && unlabeledOptionCandidate(nextThreeParagraph)));
    const shouldTreatAsOption =
      Boolean(option) && (!plainUppercaseOption || current.options.length > 0 || shouldStartPlainUppercaseOptionList);

    if (shouldTreatAsOption) {
      const resolvedOption = option as RegExpMatchArray;
      const optionText = (resolvedOption[2] || resolvedOption[1] || '').trim();
      const optionId =
        resolvedOption[2] && resolvedOption[1]
          ? /^[1-8]$/.test(resolvedOption[1])
            ? String.fromCharCode(64 + Number(resolvedOption[1]))
            : resolvedOption[1].toUpperCase()
          : String.fromCharCode(65 + current.options.length);
      current.options.push({
        id: optionId,
        text: stripTrailingScore(optionText)
      });
      continue;
    }

    if (shouldStartUnlabeledOptionList || (current.options.length > 0 && unlabeledOptionCandidate(paragraph))) {
      current.options.push({
        id: String.fromCharCode(65 + current.options.length),
        text: stripTrailingScore(paragraph)
      });
      continue;
    }

    if (score !== undefined && stripTrailingScore(paragraph) === '') {
      current.points = score;
      continue;
    }

    if (current.options.length > 0) {
      current.options[current.options.length - 1].text =
        `${current.options[current.options.length - 1].text} ${stripTrailingScore(paragraph)}`.trim();
      continue;
    }

    if (score !== undefined) {
      current.points = score;
    }
    current.promptParts.push(stripTrailingScore(paragraph));
  }

  flushCurrent();
  return questions;
};

export const extractQuestionsFromBlocks = (blocks: DocxBlock[]): StructuredQuestion[] => {
  const questions: StructuredQuestion[] = [];
  const pendingParagraphs: string[] = [];
  const pendingImages: StructuredMediaAsset[] = [];
  let current: WorkingQuestion | null = null;
  let questionCounter = 0;
  let sharedStimulusParts: string[] = [];
  let sharedStimulusImages: StructuredMediaAsset[] = [];

  const flushCurrent = () => {
    if (!current) {
      return;
    }
    const finalized = finalizeQuestion(current);
    if (finalized) {
      questions.push(finalized);
    }
    current = null;
  };

  const nextTextValues = (startIndex: number, count: number): string[] => {
    const values: string[] = [];
    for (let index = startIndex + 1; index < blocks.length && values.length < count; index += 1) {
      const block = blocks[index];
      if (block?.type === 'text') {
        values.push(block.text);
      }
    }
    while (values.length < count) {
      values.push('');
    }
    return values;
  };

  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image') {
      if (current) {
        current.stimulusImages.push(block.asset);
      } else {
        pendingImages.push(block.asset);
      }
      continue;
    }

    const paragraph = block.text;
    const isBareNumber = isBareQuestionNumber(paragraph);
    const isCombinedSubQuestion = isCombinedQuestionSubQuestionStart(paragraph);
    const isSubQuestion = isSubQuestionStart(paragraph);
    const option = optionMatch(paragraph);
    const plainUppercaseOption = plainUppercaseOptionMatch(paragraph);
    const score = parseScore(paragraph);

    if (isBareNumber) {
      flushCurrent();
      sharedStimulusParts = [];
      sharedStimulusImages = [];
      pendingParagraphs.length = 0;
      pendingImages.length = 0;
      continue;
    }

    if (isCombinedSubQuestion) {
      flushCurrent();
      sharedStimulusParts = [];
      sharedStimulusImages = [];
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripSubQuestionPrefix(paragraph))],
        stimulusParts: [],
        stimulusImages: [],
        options: [],
        points: parseScore(paragraph),
        kind: 'subquestion',
        preserveStimulus: false
      };
      continue;
    }

    if (isQuestionStart(paragraph)) {
      flushCurrent();
      questionCounter += 1;
      sharedStimulusParts = [];
      sharedStimulusImages = [];
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripQuestionPrefix(paragraph))],
        stimulusParts: shouldKeepAsStimulus(pendingParagraphs) ? [...pendingParagraphs] : [],
        stimulusImages: [...pendingImages],
        options: [],
        points: parseScore(paragraph),
        kind: 'question',
        preserveStimulus: false
      };
      pendingParagraphs.length = 0;
      pendingImages.length = 0;
      continue;
    }

    if (isSubQuestion) {
      if (current) {
        const currentPromptAsStimulus = normalizeWhitespace(current.promptParts.join('\n\n'));
        if (current.kind === 'subquestion') {
          flushCurrent();
        } else if (current.options.length === 0 && currentPromptAsStimulus) {
          sharedStimulusParts =
            current.stimulusParts.length > 0
              ? [...current.stimulusParts, currentPromptAsStimulus]
              : [currentPromptAsStimulus];
          sharedStimulusImages = [...current.stimulusImages];
        } else {
          flushCurrent();
        }
      }
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(stripSubQuestionPrefix(paragraph))],
        stimulusParts: [...sharedStimulusParts],
        stimulusImages: [...sharedStimulusImages],
        options: [],
        points: parseScore(paragraph),
        kind: 'subquestion',
        preserveStimulus: sharedStimulusParts.length > 0 || sharedStimulusImages.length > 0
      };
      continue;
    }

    const [nextParagraph, nextNextParagraph, nextThreeParagraph] = nextTextValues(index, 3);
    const hasUpcomingUnlabeledOptionBlock =
      unlabeledOptionCandidate(nextParagraph) &&
      (unlabeledOptionCandidate(nextNextParagraph) || unlabeledOptionCandidate(nextThreeParagraph));

    if (
      !current &&
      !isLikelyBoilerplate(paragraph) &&
      !unlabeledOptionCandidate(paragraph) &&
      !isQuestionStart(paragraph) &&
      !isSubQuestionStart(paragraph) &&
      hasUpcomingUnlabeledOptionBlock
    ) {
      questionCounter += 1;
      current = {
        identifier: `item-${questionCounter}`,
        promptParts: [stripTrailingScore(paragraph)],
        stimulusParts: shouldKeepAsStimulus(pendingParagraphs) ? [...pendingParagraphs] : [],
        stimulusImages: [...pendingImages],
        options: [],
        points: parseScore(paragraph),
        kind: 'question',
        preserveStimulus: false
      };
      pendingParagraphs.length = 0;
      pendingImages.length = 0;
      continue;
    }

    if (!current) {
      if (!isLikelyBoilerplate(paragraph)) {
        pendingParagraphs.push(paragraph);
      }
      continue;
    }

    const shouldStartPlainUppercaseOptionList =
      Boolean(plainUppercaseOption) &&
      current.options.length === 0 &&
      (Boolean(plainUppercaseOptionMatch(nextParagraph)) || Boolean(plainUppercaseOptionMatch(nextNextParagraph)));
    const shouldStartUnlabeledOptionList =
      current.options.length === 0 &&
      unlabeledOptionCandidate(paragraph) &&
      ((unlabeledOptionCandidate(nextParagraph) && unlabeledOptionCandidate(nextNextParagraph)) ||
        (unlabeledOptionCandidate(nextParagraph) && unlabeledOptionCandidate(nextThreeParagraph)));
    const shouldTreatAsOption =
      Boolean(option) && (!plainUppercaseOption || current.options.length > 0 || shouldStartPlainUppercaseOptionList);

    if (shouldTreatAsOption) {
      const resolvedOption = option as RegExpMatchArray;
      const optionText = (resolvedOption[2] || resolvedOption[1] || '').trim();
      const optionId =
        resolvedOption[2] && resolvedOption[1]
          ? /^[1-8]$/.test(resolvedOption[1])
            ? String.fromCharCode(64 + Number(resolvedOption[1]))
            : resolvedOption[1].toUpperCase()
          : String.fromCharCode(65 + current.options.length);
      current.options.push({
        id: optionId,
        text: stripTrailingScore(optionText)
      });
      continue;
    }

    if (shouldStartUnlabeledOptionList || (current.options.length > 0 && unlabeledOptionCandidate(paragraph))) {
      current.options.push({
        id: String.fromCharCode(65 + current.options.length),
        text: stripTrailingScore(paragraph)
      });
      continue;
    }

    if (score !== undefined && stripTrailingScore(paragraph) === '') {
      current.points = score;
      continue;
    }

    if (current.options.length > 0) {
      current.options[current.options.length - 1].text =
        `${current.options[current.options.length - 1].text} ${stripTrailingScore(paragraph)}`.trim();
      continue;
    }

    if (score !== undefined) {
      current.points = score;
    }
    current.promptParts.push(stripTrailingScore(paragraph));
  }

  flushCurrent();
  return questions;
};

export const parseDocx = async (input: DocxInput): Promise<DocxDocumentData> => {
  const buffer = await toArrayBuffer(input);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  const relationshipsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) || '';

  if (!documentXml) {
    throw new Error('DOCX file does not contain word/document.xml.');
  }

  const images = await Promise.all(
    Object.keys(zip.files)
      .filter(filePath => filePath.startsWith('word/media/') && !zip.files[filePath].dir)
      .sort()
      .map(async filePath => ({
        fileName: fileNameFromPath(filePath),
        mimeType: mimeTypeFromPath(filePath),
        data: await zip.files[filePath].async('uint8array')
      }))
  );
  const imageByFileName = new Map(images.map(image => [image.fileName, image]));
  const relationshipTargets = parseRelationshipTargets(relationshipsXml);
  const imageByRelationshipId = new Map<string, StructuredMediaAsset>();
  for (const [relationshipId, target] of relationshipTargets.entries()) {
    const image = imageByFileName.get(fileNameFromPath(target));
    if (image) {
      imageByRelationshipId.set(relationshipId, image);
    }
  }
  const blocks = parseDocumentBlocks(documentXml, imageByRelationshipId);
  logDocxDebug(
    'Parsed DOCX blocks',
    blocks.map((block, index) =>
      block.type === 'text'
        ? { index, type: 'text', text: block.text }
        : { index, type: 'image', fileName: block.asset.fileName }
    )
  );

  return {
    paragraphs: parseDocumentXml(documentXml),
    blocks,
    images,
    fileName: getInputFileName(input)
  };
};

export const buildDocxPreview = (document: DocxDocumentData, sampleSize = 8): DocxPreview => ({
  paragraphCount: document.paragraphs.length,
  sampleParagraphs: document.paragraphs.slice(0, Math.max(sampleSize, 0)),
  fileName: document.fileName
});

export const convertDocxToQtiPackage = async (
  input: DocxInput,
  options: GenerateQtiPackageOptions = {}
): Promise<DocxToQtiResult> => {
  options.onProgress?.({
    stage: 'parse_started',
    message: 'Parsing DOCX input.'
  });

  const document = await parseDocx(input);

  options.onProgress?.({
    stage: 'parse_completed',
    message: `Parsed ${document.paragraphs.length} paragraph${document.paragraphs.length === 1 ? '' : 's'}.`,
    data: {
      paragraphCount: document.paragraphs.length
    }
  });

  options.onProgress?.({
    stage: 'mapping_started',
    message: 'Extracting likely assessment items from DOCX paragraphs.'
  });

  let questions: StructuredQuestion[];
  try {
    const engine = await createWebLlmEngine(options.llmSettings, event => {
      options.onProgress?.(event);
    });
    const blockTexts = document.blocks.map(block =>
      block.type === 'text' ? block.text : `[Image: ${block.asset.fileName}]`
    );
    const segmentedItems = await segmentDocxParagraphsWithLlm(engine, blockTexts, options.onProgress, options);
    logDocxDebug('Raw DOCX segmentation indexes from LLM', segmentedItems);
    questions = await normalizeDocxItemsWithLlm(engine, document.blocks, segmentedItems, options.onProgress, options);
  } catch (error) {
    console.warn('DOCX LLM parsing failed. Falling back to heuristic extraction.', {
      error,
      blockCount: document.blocks.length,
      blocks: document.blocks.map((block, index) =>
        block.type === 'text'
          ? { index, type: 'text', text: block.text }
          : { index, type: 'image', fileName: block.asset.fileName }
      )
    });
    options.onProgress?.({
      stage: 'mapping_started',
      message: 'Falling back to heuristic DOCX extraction because the local LLM failed.'
    });
    questions = extractQuestionsFromBlocks(document.blocks);
  }

  options.onProgress?.({
    stage: 'mapping_completed',
    message: `Extracted ${questions.length} likely question${questions.length === 1 ? '' : 's'}.`,
    data: questions
  });
  logDocxDebug(
    'Final DOCX question image mapping',
    questions.map((question, index) => ({
      questionIndex: index,
      identifier: question.identifier,
      prompt: question.prompt,
      stimulusImageFileNames: (question.stimulusImages || []).map(image => image.fileName)
    }))
  );

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(questions, options);

  return {
    document,
    preview: buildDocxPreview(document),
    questions,
    packageBlob: blob,
    packageName,
    summary
  };
};
