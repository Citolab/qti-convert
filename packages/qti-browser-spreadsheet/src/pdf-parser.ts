import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWebLlmEngine, inferQuestionsFromRawResponse, type WebLlmLikeEngine } from './mapping';
import { extractQuestionsFromParagraphs } from './docx-parser';
import { GenerateQtiPackageOptions, StructuredQuestion } from './types';
import { generateQtiPackageFromQuestions } from './qti-generator';

type PdfInput = File | Blob | ArrayBuffer | Uint8Array;

type PdfTextBlock = {
  type: 'text';
  text: string;
  pageNumber: number;
};

type PdfSegmentation = {
  ignoredBlocks?: number[];
  items?: Array<{
    blockIndexes?: number[];
  }>;
};

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
};

export type PdfDocumentData = {
  blocks: PdfTextBlock[];
  pages: Array<{
    pageNumber: number;
    lines: string[];
  }>;
  fileName?: string;
};

export type PdfPreview = {
  pageCount: number;
  blockCount: number;
  sampleLines: string[];
  fileName?: string;
};

export type PdfToQtiResult = {
  document: PdfDocumentData;
  preview: PdfPreview;
  questions: StructuredQuestion[];
  packageBlob: Blob;
  packageName: string;
  summary: Awaited<ReturnType<typeof generateQtiPackageFromQuestions>>['summary'];
};

const PDF_SEGMENTATION_CHUNK_SIZE = 36;
const PDF_Y_TOLERANCE = 3;

try {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  }
} catch {
  // Ignore worker URL setup issues here; getDocument will raise a clearer runtime error if loading fails.
}

const logPdfDebug = (label: string, data: unknown): void => {
  console.log(`[qti-browser-spreadsheet][pdf] ${label}`, data);
};

const getInputFileName = (input: PdfInput): string | undefined => {
  if (typeof File !== 'undefined' && input instanceof File) {
    return input.name;
  }
  return undefined;
};

const toArrayBuffer = async (input: PdfInput): Promise<ArrayBuffer> => {
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

const extractResponseContent = (rawContent: string | Array<{ text?: string }> | undefined): string =>
  typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => part.text || '').join('')
      : '';

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

const parsePdfJson = (rawResponse: string): unknown => JSON.parse(extractJsonString(rawResponse)) as unknown;

const requestLlmJson = async (
  engine: WebLlmLikeEngine,
  systemPrompt: string,
  userPrompt: string
): Promise<string> => {
  const response = await engine.chat.completions.create({
    temperature: 0,
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
    throw new Error('WebLLM returned an empty PDF response.');
  }
  return content;
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

const isLikelyPdfBoilerplateLine = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return [
    /^pagina\s+\d+\s*\/\s*\d+$/i,
    /^\d{1,2}-\d{1,2}-\d{4}\b/,
    /^w\d+\s+/i,
    /^deze toets bestaat uit \d+ vragen/i,
    /^voor deze toets zijn maximaal \d+ punten/i,
    /^voor elk vraagnummer staat hoeveel punten/i,
    /^deze toets is ontworpen met/i
  ].some(pattern => pattern.test(trimmed));
};

const isQuestionStart = (value: string): boolean =>
  /^((question|vraag)\s*)?\d{1,3}[.)]\s+\S+/i.test(value) ||
  /^\(\d{1,3}\)\s+\S+/i.test(value) ||
  /^((question|vraag)\s*)?\d{1,3}\s*[:.-]\s+\S+/i.test(value) ||
  /^(question|vraag)\s+\d{1,3}\b[:.)-]?\s*/i.test(value);

const isBareQuestionNumber = (value: string): boolean => /^\d{1,3}[.)]$/.test(value);

const isCombinedQuestionSubQuestionStart = (value: string): boolean => /^\d{1,3}[.)]\s+[a-h][.)]?\s+\S+/i.test(value);

const isSubQuestionStart = (value: string): boolean =>
  /^[a-h](?:[.)])?\s+\S+/.test(value) ||
  /^\(?\d{1,3}[.)]?\s*[a-h](?:[.)])?\s+\S+/.test(value);

const buildPdfSegmentationPrompt = (
  blocks: Array<{ index: number; text: string }>
): string =>
  [
    'Split these ordered PDF text blocks into assessment items.',
    'Return strict JSON only.',
    'Use this shape: {"ignoredBlocks":[0,1],"items":[{"blockIndexes":[2,3,4]},{"blockIndexes":[5,6]}]}.',
    'Ignore front matter, page headers, footers, and generic instructions when possible.',
    'Keep option lines with the item they belong to.',
    'If one parent question contains subquestions like a, b, c, split those into separate item groups.',
    'If a parent question number like "5." is immediately followed by subquestions like "a" and "b", do not keep them as one item.',
    'When needed, include nearby shared stimulus text with each item group it belongs to.',
    'Preserve original order.',
    JSON.stringify(blocks, null, 2)
  ].join('\n\n');

const buildPdfNormalizationPrompt = (blocks: string[]): string =>
  [
    'Convert these ordered PDF item blocks into normalized question JSON.',
    'Return strict JSON only.',
    'Return {"questions":[...]}',
    'You may return more than one question if the blocks contain subquestions such as a, b, c.',
    'Question shape: {"type":"multiple_choice"|"extended_text","stimulus":"...","prompt":"...","options":[{"id":"A","text":"...","isCorrectAnswer":false}],"points":1,"layout":"auto"}',
    'Use multiple_choice only when the item truly contains answer options. Do not confuse subquestions with answer choices.',
    'For open items or fill-in items, return type "extended_text".',
    'Remove numbering like 5, 5a, a, b, c from the prompt.',
    JSON.stringify(
      blocks.map((text, index) => ({
        index,
        text
      })),
      null,
      2
    )
  ].join('\n\n');

const normalizeSegmentation = (rawValue: unknown, rangeStart: number, rangeEnd: number): number[][] => {
  const items = typeof rawValue === 'object' && rawValue && Array.isArray((rawValue as PdfSegmentation).items)
    ? (rawValue as PdfSegmentation).items || []
    : [];

  const normalized = items
    .map(item => {
      if (!Array.isArray(item.blockIndexes)) {
        return [];
      }
      const rawIndexes = item.blockIndexes
        .map(value => Number(value))
        .filter(index => Number.isInteger(index));
      const looksLocal = rawIndexes.every(index => index >= 0 && index < rangeEnd - rangeStart);
      const resolvedIndexes = looksLocal ? rawIndexes.map(index => index + rangeStart) : rawIndexes;
      return resolvedIndexes.filter(index => index >= rangeStart && index < rangeEnd);
    })
    .filter(blockIndexes => blockIndexes.length > 0);

  if (normalized.length === 0) {
    throw new Error('LLM PDF segmentation did not produce any item groups.');
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

const groupPageItemsIntoLines = (items: PdfTextItem[]): string[] => {
  const positionedItems = items
    .map(item => {
      const text = normalizeWhitespace(item.str || '');
      const transform = Array.isArray(item.transform) ? item.transform : [];
      const x = Number(transform[4] || 0);
      const y = Number(transform[5] || 0);
      return {
        text,
        x,
        y,
        hasEOL: Boolean(item.hasEOL)
      };
    })
    .filter(item => item.text);

  const rows: Array<{ y: number; items: typeof positionedItems }> = [];
  for (const item of positionedItems) {
    const existingRow = rows.find(row => Math.abs(row.y - item.y) <= PDF_Y_TOLERANCE);
    if (existingRow) {
      existingRow.items.push(item);
      existingRow.y = Math.max(existingRow.y, item.y);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .flatMap(row => {
      const rowText = row.items
        .sort((a, b) => a.x - b.x)
        .map(item => item.text)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!rowText) {
        return [];
      }
      return splitEmbeddedQuestionMarkers(rowText);
    });
};

const filterPdfBoilerplateBlocks = (blocks: PdfTextBlock[]): PdfTextBlock[] => {
  const pageCountsByText = new Map<string, Set<number>>();
  for (const block of blocks) {
    const normalizedText = block.text.trim();
    if (!normalizedText) {
      continue;
    }
    const pages = pageCountsByText.get(normalizedText) || new Set<number>();
    pages.add(block.pageNumber);
    pageCountsByText.set(normalizedText, pages);
  }

  return blocks.filter(block => {
    const normalizedText = block.text.trim();
    if (isLikelyPdfBoilerplateLine(normalizedText)) {
      return false;
    }
    const repeatedPageCount = pageCountsByText.get(normalizedText)?.size || 0;
    if (repeatedPageCount >= 2 && normalizedText.length <= 80) {
      return false;
    }
    return true;
  });
};

export const parsePdf = async (input: PdfInput): Promise<PdfDocumentData> => {
  const buffer = await toArrayBuffer(input);
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false
  } as unknown as Parameters<typeof getDocument>[0]);
  const pdf = await loadingTask.promise;

  const pages: PdfDocumentData['pages'] = [];
  const rawBlocks: PdfTextBlock[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupPageItemsIntoLines(textContent.items as PdfTextItem[]);
    pages.push({ pageNumber, lines });
    for (const line of lines) {
      rawBlocks.push({
        type: 'text',
        text: line,
        pageNumber
      });
    }
  }
  const blocks = filterPdfBoilerplateBlocks(rawBlocks);

  logPdfDebug(
    'Parsed PDF text blocks',
    blocks.map((block, index) => ({
      index,
      pageNumber: block.pageNumber,
      text: block.text
    }))
  );

  return {
    blocks,
    pages,
    fileName: getInputFileName(input)
  };
};

export const buildPdfPreview = (document: PdfDocumentData, sampleSize = 8): PdfPreview => ({
  pageCount: document.pages.length,
  blockCount: document.blocks.length,
  sampleLines: document.blocks.slice(0, Math.max(sampleSize, 0)).map(block => block.text),
  fileName: document.fileName
});

const segmentPdfBlocksWithLlm = async (
  engine: WebLlmLikeEngine,
  blocks: string[],
  onProgress?: GenerateQtiPackageOptions['onProgress']
): Promise<number[][]> => {
  const segmentedItems: number[][] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < blocks.length) {
    const endIndex = findSegmentationChunkEnd(blocks, startIndex, PDF_SEGMENTATION_CHUNK_SIZE);
    const chunk = blocks.slice(startIndex, endIndex).map((text, localIndex) => ({
      index: startIndex + localIndex,
      text
    }));

    onProgress?.({
      stage: 'chunk_started',
      message: `Segmenting PDF blocks ${startIndex + 1}-${endIndex} of ${blocks.length}.`
    });

    const rawResponse = await requestLlmJson(
      engine,
      'You segment PDF document blocks into assessment items. Return strict JSON only.',
      buildPdfSegmentationPrompt(chunk)
    );
    const parsed = parsePdfJson(rawResponse);
    const chunkItems = normalizeSegmentation(parsed, startIndex, endIndex);
    logPdfDebug('PDF segmentation chunk result', {
      chunkIndex,
      startIndex,
      endIndex,
      chunk,
      chunkItems
    });
    segmentedItems.push(...chunkItems);

    onProgress?.({
      stage: 'chunk_completed',
      message: `Segmented PDF blocks ${startIndex + 1}-${endIndex} of ${blocks.length}.`,
      data: {
        chunkIndex: chunkIndex + 1,
        chunkCount: Math.ceil(blocks.length / PDF_SEGMENTATION_CHUNK_SIZE)
      }
    });

    startIndex = endIndex;
    chunkIndex += 1;
  }

  if (segmentedItems.length === 0) {
    throw new Error('LLM PDF segmentation did not produce any item groups.');
  }

  return segmentedItems;
};

const normalizePdfItemsWithLlm = async (
  engine: WebLlmLikeEngine,
  blocks: PdfTextBlock[],
  itemBlockIndexes: number[][],
  onProgress?: GenerateQtiPackageOptions['onProgress']
): Promise<StructuredQuestion[]> => {
  const questions: StructuredQuestion[] = [];

  for (const [index, blockIndexes] of itemBlockIndexes.entries()) {
    onProgress?.({
      stage: 'chunk_started',
      message: `Normalizing PDF item ${index + 1} of ${itemBlockIndexes.length}.`
    });

    const blockTexts = blockIndexes
      .map(blockIndex => blocks[blockIndex]?.text)
      .filter((value): value is string => Boolean(value));
    let questionCount = 0;
    try {
      const rawResponse = await requestLlmJson(
        engine,
        'You convert PDF item blocks into structured assessment question JSON. Return strict JSON only.',
        buildPdfNormalizationPrompt(blockTexts)
      );
      logPdfDebug('PDF item normalization raw response', {
        itemIndex: index,
        blockIndexes,
        blockTexts,
        rawResponse
      });

      const normalized = inferQuestionsFromRawResponse(rawResponse).questions;
      const normalizedQuestions = normalized.map((question, questionIndex) => ({
        ...question,
        identifier: question.identifier || `item-${index + 1}-${questionIndex + 1}`
      }));
      questions.push(...normalizedQuestions);
      questionCount = normalizedQuestions.length;
    } catch (error) {
      console.warn('[qti-browser-spreadsheet][pdf] Falling back to heuristic normalization for PDF item.', {
        itemIndex: index,
        blockIndexes,
        blockTexts,
        error
      });
      const fallbackQuestions = extractQuestionsFromParagraphs(blockTexts).map((question, questionIndex) => ({
        ...question,
        identifier: question.identifier || `item-${index + 1}-${questionIndex + 1}`
      }));
      if (fallbackQuestions.length > 0) {
        questions.push(...fallbackQuestions);
        questionCount = fallbackQuestions.length;
      }
    }

    onProgress?.({
      stage: 'chunk_completed',
      message: `Normalized PDF item ${index + 1} of ${itemBlockIndexes.length}.`,
      data: {
        chunkIndex: index + 1,
        chunkCount: itemBlockIndexes.length,
        questionCount
      }
    });
  }

  return questions;
};

export const convertPdfToQtiPackage = async (
  input: PdfInput,
  options: GenerateQtiPackageOptions = {}
): Promise<PdfToQtiResult> => {
  options.onProgress?.({
    stage: 'parse_started',
    message: 'Parsing PDF input.'
  });

  const document = await parsePdf(input);

  options.onProgress?.({
    stage: 'parse_completed',
    message: `Parsed ${document.blocks.length} text block${document.blocks.length === 1 ? '' : 's'} from ${document.pages.length} page${document.pages.length === 1 ? '' : 's'}.`,
    data: {
      pageCount: document.pages.length,
      blockCount: document.blocks.length
    }
  });

  options.onProgress?.({
    stage: 'mapping_started',
    message: 'Extracting likely assessment items from PDF text blocks.'
  });

  let questions: StructuredQuestion[];
  try {
    const engine = await createWebLlmEngine(options.llmSettings, event => {
      options.onProgress?.(event);
    });
    const blockTexts = document.blocks.map(block => block.text);
    const segmentedItems = await segmentPdfBlocksWithLlm(engine, blockTexts, options.onProgress);
    logPdfDebug('Raw PDF segmentation indexes from LLM', segmentedItems);
    questions = await normalizePdfItemsWithLlm(engine, document.blocks, segmentedItems, options.onProgress);
  } catch (error) {
    console.warn('PDF LLM parsing failed. Falling back to heuristic extraction.', {
      error,
      blockCount: document.blocks.length,
      blocks: document.blocks.map((block, index) => ({
        index,
        pageNumber: block.pageNumber,
        text: block.text
      }))
    });
    options.onProgress?.({
      stage: 'mapping_started',
      message: 'Falling back to heuristic PDF extraction because the local LLM failed.'
    });
    questions = extractQuestionsFromParagraphs(document.blocks.map(block => block.text));
  }

  options.onProgress?.({
    stage: 'mapping_completed',
    message: `Extracted ${questions.length} likely question${questions.length === 1 ? '' : 's'}.`,
    data: questions
  });
  logPdfDebug(
    'Final PDF question mapping',
    questions.map((question, index) => ({
      questionIndex: index,
      identifier: question.identifier,
      prompt: question.prompt
    }))
  );

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(questions, options);

  return {
    document,
    preview: buildPdfPreview(document),
    questions,
    packageBlob: blob,
    packageName,
    summary
  };
};
