import { GlobalWorkerOptions, OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWebLlmEngine, inferQuestionsFromRawResponse, type WebLlmLikeEngine } from './mapping';
import { extractQuestionsFromParagraphs } from './docx-parser';
import { GenerateQtiPackageOptions, StructuredMediaAsset, StructuredQuestion } from './types';
import { generateQtiPackageFromQuestions } from './qti-generator';

type PdfInput = File | Blob | ArrayBuffer | Uint8Array;

type PdfTextBlock = {
  type: 'text';
  text: string;
  pageNumber: number;
  y: number;
};

type PdfImageAsset = StructuredMediaAsset & {
  pageNumber: number;
  top: number;
  bottom: number;
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
  images: PdfImageAsset[];
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
const PDF_RENDER_SCALE = 2;

try {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  }
} catch {
  // Ignore worker URL setup issues here; getDocument will raise a clearer runtime error if loading fails.
}

const logPdfDebug = (label: string, data: unknown): void => {
  console.log(`[qti-convert-local-ai][pdf] ${label}`, data);
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

const pickFirstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

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
    throw new Error('WebLLM returned an empty PDF response.');
  }
  return content;
};

const buildPdfSystemPrompt = (basePrompt: string, options: GenerateQtiPackageOptions = {}): string => {
  const prompt = options.llmSettings?.systemPrompt?.trim() || basePrompt;
  const instructions = options.llmSettings?.instructions?.trim();

  return instructions ? `${prompt}\n\nAdditional import instructions:\n${instructions}` : prompt;
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

const salvagePdfQuestionsFromRawResponse = (rawResponse: string, blockTexts: string[]): StructuredQuestion[] => {
  const parsed = parsePdfJson(rawResponse);
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed && Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : typeof parsed === 'object' && parsed && Array.isArray((parsed as { items?: unknown[] }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

  if (rawQuestions.length === 0) {
    return [];
  }

  return rawQuestions
    .map(question => {
      const raw = (question || {}) as Record<string, unknown>;
      const rawOptions = Array.isArray(raw.options) ? raw.options : [];
      const options = rawOptions
        .map((option, index) => {
          const rawOption = (option || {}) as Record<string, unknown>;
          const text = pickFirstString(rawOption.text, rawOption.label, rawOption.value);
          if (!text) {
            return null;
          }
          const id = pickFirstString(rawOption.id, rawOption.identifier) || String.fromCharCode(65 + index);
          return {
            id,
            text,
            isCorrectAnswer: Boolean(rawOption.isCorrectAnswer)
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

      const prompt =
        pickFirstString(raw.prompt, raw.question, raw.stem) ||
        normalizeWhitespace(blockTexts.find(text => normalizeWhitespace(text)) || '');
      const stimulus = pickFirstString(raw.stimulus, raw.passage, raw.context);
      const type = pickFirstString(raw.type) === 'extended_text' ? 'extended_text' : 'multiple_choice';

      return {
        type,
        prompt,
        stimulus: stimulus && stimulus !== prompt ? stimulus : undefined,
        options: type === 'multiple_choice' && options.length >= 2 ? options : undefined,
        points: typeof raw.points === 'number' ? raw.points : typeof raw.points === 'string' ? Number(raw.points) : undefined,
        layout: pickFirstString(raw.layout) === 'two_column' ? 'two_column' : 'auto',
        correctResponse: pickFirstString(raw.correctResponse, raw.answer),
        selectionMode: pickFirstString(raw.selectionMode) === 'multiple' ? 'multiple' : 'single'
      } satisfies StructuredQuestion;
    })
    .filter(question => question.prompt);
};

const buildPdfSegmentationPrompt = (
  blocks: Array<{ index: number; text: string }>
): string =>
  [
    'Split these ordered PDF text blocks into assessment items.',
    'Return strict JSON only.',
    'Use this shape: {"ignoredBlocks":[0,1],"items":[{"blockIndexes":[2,3,4]},{"blockIndexes":[5,6]}]}.',
    'Decide which blocks are relevant assessment content and which are irrelevant document chrome.',
    'Figure out item boundaries from the content itself instead of relying on numbering only.',
    'Keep answer options with the item they belong to when a block clearly contains choice alternatives.',
    'If a parent item contains subparts, you may return multiple item groups or one group that will later normalize into multiple questions.',
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
    'Decide from the content whether this is multiple choice or extended text.',
    'Ignore irrelevant document chrome or repeated page text.',
    'For open items or fill-in items, return type "extended_text".',
    'Only return multiple questions if the content clearly contains multiple real assessment items.',
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

const groupPageItemsIntoLineBlocks = (items: PdfTextItem[], pageNumber: number): PdfTextBlock[] => {
  const positionedItems = items
    .map(item => {
      const text = normalizeWhitespace(item.str || '');
      const transform = Array.isArray(item.transform) ? item.transform : [];
      const x = Number(transform[4] || 0);
      const y = Number(transform[5] || 0);
      return {
        text,
        x,
        y
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
      return splitEmbeddedQuestionMarkers(rowText).map(text => ({
        type: 'text' as const,
        text,
        pageNumber,
        y: row.y
      }));
    });
};

const multiplyMatrix = (left: number[], right: number[]): number[] => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5]
];

const createCanvas = (width: number, height: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Canvas is not available for PDF image extraction.');
};

const getCanvas2dContext = (
  canvas: OffscreenCanvas | HTMLCanvasElement
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null =>
  canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;

const canvasToPngBytes = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> => {
  if ('convertToBlob' in canvas) {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      value => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error('Failed to convert PDF canvas to blob.'));
        }
      },
      'image/png'
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
};

const extractPdfPageImages = async (page: any, pageNumber: number): Promise<PdfImageAsset[]> => {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const operatorList = await page.getOperatorList();
  const imageBoxes: Array<{ left: number; top: number; width: number; height: number; topPdf: number; bottomPdf: number }> = [];
  const transformStack: number[][] = [];
  let currentTransform = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];

    if (fn === OPS.save) {
      transformStack.push([...currentTransform]);
      continue;
    }
    if (fn === OPS.restore) {
      currentTransform = transformStack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.transform) {
      currentTransform = multiplyMatrix(currentTransform, args as number[]);
      continue;
    }
    if (
      fn !== OPS.paintImageXObject &&
      fn !== OPS.paintInlineImageXObject &&
      fn !== OPS.paintImageMaskXObject
    ) {
      continue;
    }

    const corners = [
      viewport.convertToViewportPoint(currentTransform[4], currentTransform[5]),
      viewport.convertToViewportPoint(currentTransform[4] + currentTransform[0], currentTransform[5] + currentTransform[1]),
      viewport.convertToViewportPoint(currentTransform[4] + currentTransform[2], currentTransform[5] + currentTransform[3]),
      viewport.convertToViewportPoint(
        currentTransform[4] + currentTransform[0] + currentTransform[2],
        currentTransform[5] + currentTransform[1] + currentTransform[3]
      )
    ];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.max(0, Math.min(...xs));
    const right = Math.min(viewport.width, Math.max(...xs));
    const top = Math.max(0, Math.min(...ys));
    const bottom = Math.min(viewport.height, Math.max(...ys));
    const width = right - left;
    const height = bottom - top;
    if (width < 24 || height < 24) {
      continue;
    }
    const yValues = [currentTransform[5], currentTransform[5] + currentTransform[1], currentTransform[5] + currentTransform[3], currentTransform[5] + currentTransform[1] + currentTransform[3]];
    imageBoxes.push({
      left,
      top,
      width,
      height,
      topPdf: Math.max(...yValues),
      bottomPdf: Math.min(...yValues)
    });
  }

  if (imageBoxes.length === 0) {
    return [];
  }

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = getCanvas2dContext(canvas);
  if (!context) {
    return [];
  }
  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  const images: PdfImageAsset[] = [];
  for (const [index, box] of imageBoxes.entries()) {
    const cropCanvas = createCanvas(Math.ceil(box.width), Math.ceil(box.height));
    const cropContext = getCanvas2dContext(cropCanvas);
    if (!cropContext) {
      continue;
    }
    cropContext.drawImage(
      canvas as CanvasImageSource,
      box.left,
      box.top,
      box.width,
      box.height,
      0,
      0,
      box.width,
      box.height
    );

    images.push({
      fileName: `pdf-page-${pageNumber}-image-${index + 1}.png`,
      mimeType: 'image/png',
      data: await canvasToPngBytes(cropCanvas),
      pageNumber,
      top: box.topPdf,
      bottom: box.bottomPdf
    });
  }

  return images;
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
  const images: PdfImageAsset[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupPageItemsIntoLines(textContent.items as PdfTextItem[]);
    const lineBlocks = groupPageItemsIntoLineBlocks(textContent.items as PdfTextItem[], pageNumber);
    const pageImages = await extractPdfPageImages(page, pageNumber);
    pages.push({ pageNumber, lines });
    rawBlocks.push(...lineBlocks);
    images.push(...pageImages);
  }
  const blocks = rawBlocks;

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
    images,
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
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
): Promise<number[][]> => {
  const segmentedItems: number[][] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < blocks.length) {
    const endIndex = Math.min(blocks.length, startIndex + PDF_SEGMENTATION_CHUNK_SIZE);
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
      buildPdfSystemPrompt('You segment PDF document blocks into assessment items. Return strict JSON only.', options),
      buildPdfSegmentationPrompt(chunk),
      options
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
  images: PdfImageAsset[],
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
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
        buildPdfSystemPrompt(
          'You convert PDF item blocks into structured assessment question JSON. Return strict JSON only.',
          options
        ),
        buildPdfNormalizationPrompt(blockTexts),
        options
      );
      logPdfDebug('PDF item normalization raw response', {
        itemIndex: index,
        blockIndexes,
        blockTexts,
        rawResponse
      });

      let normalized: StructuredQuestion[];
      try {
        normalized = inferQuestionsFromRawResponse(rawResponse).questions;
      } catch (error) {
        const salvaged = salvagePdfQuestionsFromRawResponse(rawResponse, blockTexts);
        if (salvaged.length === 0) {
          throw error;
        }
        logPdfDebug('Salvaged PDF item normalization result', {
          itemIndex: index,
          blockIndexes,
          blockTexts,
          questionCount: salvaged.length,
          questions: salvaged.map(question => ({
            prompt: question.prompt,
            type: question.type,
            optionCount: question.options?.length || 0
          }))
        });
        normalized = salvaged;
      }
      const itemPages = Array.from(new Set(blockIndexes.map(blockIndex => blocks[blockIndex]?.pageNumber).filter((value): value is number => Number.isFinite(value))));
      const itemYValues = blockIndexes.map(blockIndex => blocks[blockIndex]?.y).filter((value): value is number => Number.isFinite(value));
      const itemTop = itemYValues.length > 0 ? Math.max(...itemYValues) : Number.NEGATIVE_INFINITY;
      const itemBottom = itemYValues.length > 0 ? Math.min(...itemYValues) : Number.POSITIVE_INFINITY;
      const itemImages = images.filter(image => {
        if (!itemPages.includes(image.pageNumber)) {
          return false;
        }
        if (!Number.isFinite(itemTop) || !Number.isFinite(itemBottom)) {
          return true;
        }
        return image.bottom <= itemTop + 60 && image.top >= itemBottom - 220;
      });
      const normalizedQuestions = normalized.map((question, questionIndex) => ({
        ...question,
        stimulusImages:
          questionIndex === 0 && itemImages.length > 0
            ? [...(question.stimulusImages || []), ...itemImages]
            : question.stimulusImages,
        identifier: question.identifier || `item-${index + 1}-${questionIndex + 1}`
      }));
      questions.push(...normalizedQuestions);
      questionCount = normalizedQuestions.length;
    } catch (error) {
      console.warn('[qti-convert-local-ai][pdf] Falling back to heuristic normalization for PDF item.', {
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
        questions.push(
          ...fallbackQuestions.map((question, questionIndex) => ({
            ...question,
            identifier: question.identifier || `item-${index + 1}-${questionIndex + 1}`
          }))
        );
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
    const segmentedItems = await segmentPdfBlocksWithLlm(engine, blockTexts, options.onProgress, options);
    logPdfDebug('Raw PDF segmentation indexes from LLM', segmentedItems);
    questions = await normalizePdfItemsWithLlm(engine, document.blocks, segmentedItems, document.images, options.onProgress, options);
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
