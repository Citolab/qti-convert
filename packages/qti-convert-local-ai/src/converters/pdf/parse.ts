import { GlobalWorkerOptions, OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inferQuestionsFromRawResponse, type WebLlmLikeEngine } from '../../mapping';
import { GenerateQtiPackageOptions, StructuredMediaAsset, StructuredQuestion } from '../../types';
import {
  buildBatchedNormalizationPrompt,
  buildSingleItemNormalizationPrompt,
  buildBoundaryDetectionPrompt,
  buildBoundaryDetectionPromptWithContext
} from '../../shared-prompts';
import { getInputFileName, toArrayBuffer } from '../../utils/file-input';
import type { PdfDocumentData, PdfImageAsset, PdfInput, PdfPreview, PdfTextBlock, PdfTextItem } from './types';

// Keep chunk sizes small to fit in Qwen2.5-7B context window (~4k tokens usable after prompts)
const PDF_BOUNDARY_DETECTION_MAX_SINGLE_PASS = 100; // Fits with examples in context window
const PDF_BOUNDARY_DETECTION_CHUNK_SIZE = 80; // Process in smaller chunks
const PDF_NORMALIZATION_BATCH_SIZE = 3; // Smaller batches to avoid overflow on items with many blocks
const PDF_CONTEXT_CARRYOVER = 10; // Blocks from previous chunk to include as context
const PDF_Y_TOLERANCE = 3;
const PDF_RENDER_SCALE = 2;

// Adaptive chunking defaults
const PDF_ADAPTIVE_CHUNKING_DEFAULT = true;
const PDF_MIN_Y_GAP_FOR_BREAK = 50; // PDF units
const PDF_MIN_CHUNK_SIZE = 20;
const PDF_MAX_CHUNK_SIZE = 80;

// Image association defaults
const PDF_IMAGE_TOP_TOLERANCE = 60;
const PDF_IMAGE_BOTTOM_TOLERANCE = 220;

// ---------------------------------------------------------------------------
// Boundary Detection Types
// ---------------------------------------------------------------------------

type BoundaryDetectionResult = {
  itemStartIndexes: number[];
  contextIndexes: number[];
  ignoredIndexes: number[];
};

// ---------------------------------------------------------------------------
// Adaptive Chunking - Find Natural Break Points
// ---------------------------------------------------------------------------

type ChunkBreakPoint = {
  index: number;
  reason: 'page_break' | 'y_gap' | 'max_size';
  score: number; // Higher = better break point
};

/**
 * Find natural break points in the document based on:
 * 1. Page boundaries (strongest signal)
 * 2. Large Y-gaps (section breaks within a page)
 * 3. Maximum chunk size limits
 * 4. Table boundaries (never break inside a table)
 */
const findAdaptiveChunkBreaks = (
  blocks: PdfTextBlock[],
  options: {
    minYGap?: number;
    maxChunkSize?: number;
    minChunkSize?: number;
    detectTables?: boolean;
  } = {}
): number[] => {
  const minYGap = options.minYGap ?? PDF_MIN_Y_GAP_FOR_BREAK;
  const maxChunkSize = options.maxChunkSize ?? PDF_MAX_CHUNK_SIZE;
  const minChunkSize = options.minChunkSize ?? PDF_MIN_CHUNK_SIZE;
  const detectTables = options.detectTables ?? true;

  if (blocks.length <= maxChunkSize) {
    return []; // No breaks needed, process as single chunk
  }

  // Detect table regions to avoid breaking inside them
  const tables = detectTables ? detectTableRegions(blocks) : [];

  const breakPoints: ChunkBreakPoint[] = [];

  // Find all potential break points
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const curr = blocks[i];

    // Skip if this would break inside a table
    if (wouldSplitTable(i, tables)) {
      continue;
    }

    // Page break (strongest signal)
    if (curr.pageNumber !== prev.pageNumber) {
      breakPoints.push({
        index: i,
        reason: 'page_break',
        score: 100
      });
      continue;
    }

    // Large Y-gap within same page (section break)
    // Note: PDF Y increases upward, so a new section below has a SMALLER Y
    const yGap = prev.y - curr.y;
    if (yGap > minYGap) {
      breakPoints.push({
        index: i,
        reason: 'y_gap',
        score: Math.min(yGap, 80) // Cap score at 80 (less than page break)
      });
    }
  }

  // Now select breaks to create chunks within size limits
  const selectedBreaks: number[] = [];
  let lastBreak = 0;

  // Sort by index to process in order
  breakPoints.sort((a, b) => a.index - b.index);

  for (const bp of breakPoints) {
    const chunkSize = bp.index - lastBreak;

    // Skip if chunk would be too small
    if (chunkSize < minChunkSize && selectedBreaks.length > 0) {
      continue;
    }

    // Select this break if chunk is reasonable size
    if (chunkSize >= minChunkSize) {
      // But don't let chunks get too big - if we're past max, find best break
      if (chunkSize > maxChunkSize) {
        // We need to break earlier - find the best break point in range
        const rangeStart = lastBreak + minChunkSize;
        const rangeEnd = lastBreak + maxChunkSize;
        const inRangeBreaks = breakPoints.filter(
          b => b.index > rangeStart && b.index <= rangeEnd && b.index < bp.index
        );

        if (inRangeBreaks.length > 0) {
          // Pick highest scoring break in range
          inRangeBreaks.sort((a, b) => b.score - a.score);
          selectedBreaks.push(inRangeBreaks[0].index);
          lastBreak = inRangeBreaks[0].index;
        } else {
          // No good break in range, force break at max size
          selectedBreaks.push(lastBreak + maxChunkSize);
          lastBreak = lastBreak + maxChunkSize;
        }
      }

      // Now add this break if still valid
      const currentChunkSize = bp.index - lastBreak;
      if (currentChunkSize >= minChunkSize && currentChunkSize <= maxChunkSize) {
        selectedBreaks.push(bp.index);
        lastBreak = bp.index;
      }
    }
  }

  // Handle remaining blocks if they'd create a valid chunk
  const remaining = blocks.length - lastBreak;
  if (remaining > maxChunkSize) {
    // Need more breaks
    while (blocks.length - lastBreak > maxChunkSize) {
      const nextBreak = lastBreak + maxChunkSize;
      selectedBreaks.push(nextBreak);
      lastBreak = nextBreak;
    }
  }

  logPdfDebug('Adaptive chunking breaks', {
    totalBlocks: blocks.length,
    potentialBreaks: breakPoints.length,
    selectedBreaks: selectedBreaks.length,
    breaks: selectedBreaks.map(idx => ({
      index: idx,
      reason: breakPoints.find(bp => bp.index === idx)?.reason || 'max_size'
    }))
  });

  return selectedBreaks;
};

// ---------------------------------------------------------------------------
// Table Detection - Identify tabular regions
// ---------------------------------------------------------------------------

type TableRegion = {
  startIndex: number;
  endIndex: number;
  rowCount: number;
  colCount: number;
};

/**
 * Detect table-like regions in the document.
 * Tables are identified by clusters of blocks at similar Y positions (rows)
 * appearing consecutively, with multiple blocks per row (columns).
 *
 * @returns Array of table regions with start/end block indexes
 */
const detectTableRegions = (
  blocks: PdfTextBlock[],
  options: {
    minRows?: number;
    minCols?: number;
    yTolerance?: number;
  } = {}
): TableRegion[] => {
  const minRows = options.minRows ?? 3; // At least 3 rows to be considered a table
  const minCols = options.minCols ?? 2; // At least 2 columns
  const yTolerance = options.yTolerance ?? PDF_Y_TOLERANCE;

  const tables: TableRegion[] = [];

  // Group consecutive blocks by Y position (same row)
  type RowGroup = { y: number; startIdx: number; endIdx: number; count: number };
  const rows: RowGroup[] = [];

  let currentRow: RowGroup | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Check if this block continues the current row
    if (
      currentRow &&
      Math.abs(block.y - currentRow.y) <= yTolerance &&
      block.pageNumber === blocks[currentRow.startIdx].pageNumber
    ) {
      currentRow.endIdx = i;
      currentRow.count += 1;
    } else {
      // Start a new row
      if (currentRow) {
        rows.push(currentRow);
      }
      currentRow = {
        y: block.y,
        startIdx: i,
        endIdx: i,
        count: 1
      };
    }
  }

  if (currentRow) {
    rows.push(currentRow);
  }

  // Find consecutive multi-column rows (table candidates)
  let tableStart: number | null = null;
  let tableRowCount = 0;
  let minColsInTable = Infinity;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Check if this row has multiple columns and continues a table
    if (row.count >= minCols) {
      if (tableStart === null) {
        tableStart = row.startIdx;
        tableRowCount = 1;
        minColsInTable = row.count;
      } else {
        // Check if rows are consecutive (no big gap)
        const prevRow = rows[i - 1];
        const yGap = prevRow.y - row.y;
        const samePageAsPrev = blocks[row.startIdx].pageNumber === blocks[prevRow.startIdx].pageNumber;

        if (samePageAsPrev && yGap < 50) {
          tableRowCount += 1;
          minColsInTable = Math.min(minColsInTable, row.count);
        } else {
          // End current table, start new one
          if (tableRowCount >= minRows) {
            tables.push({
              startIndex: tableStart,
              endIndex: prevRow.endIdx,
              rowCount: tableRowCount,
              colCount: minColsInTable
            });
          }
          tableStart = row.startIdx;
          tableRowCount = 1;
          minColsInTable = row.count;
        }
      }
    } else {
      // Single-column row - end any current table
      if (tableStart !== null && tableRowCount >= minRows) {
        const prevRow = rows[i - 1];
        tables.push({
          startIndex: tableStart,
          endIndex: prevRow.endIdx,
          rowCount: tableRowCount,
          colCount: minColsInTable
        });
      }
      tableStart = null;
      tableRowCount = 0;
      minColsInTable = Infinity;
    }
  }

  // Handle table at end of document
  if (tableStart !== null && tableRowCount >= minRows) {
    const lastRow = rows[rows.length - 1];
    tables.push({
      startIndex: tableStart,
      endIndex: lastRow.endIdx,
      rowCount: tableRowCount,
      colCount: minColsInTable
    });
  }

  if (tables.length > 0) {
    logPdfDebug('Table regions detected', {
      count: tables.length,
      tables: tables.map(t => ({
        blocks: `${t.startIndex}-${t.endIndex}`,
        rows: t.rowCount,
        cols: t.colCount
      }))
    });
  }

  return tables;
};

/**
 * Check if a block index falls within any table region.
 */
const isInTable = (blockIndex: number, tables: TableRegion[]): boolean => {
  return tables.some(t => blockIndex >= t.startIndex && blockIndex <= t.endIndex);
};

/**
 * Check if a potential break point would split a table.
 */
const wouldSplitTable = (breakIndex: number, tables: TableRegion[]): boolean => {
  return tables.some(t => breakIndex > t.startIndex && breakIndex <= t.endIndex);
};

try {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL(
      '../../../pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url
    ).toString();
  }
} catch {
  // Ignore worker URL setup issues here; getDocument will raise a clearer runtime error if loading fails.
}

export const logPdfDebug = (label: string, data: unknown): void => {
  console.log(`[qti-convert-local-ai][pdf] ${label}`, data);
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
        points:
          typeof raw.points === 'number' ? raw.points : typeof raw.points === 'string' ? Number(raw.points) : undefined,
        layout: pickFirstString(raw.layout) === 'two_column' ? 'two_column' : 'auto',
        correctResponse: pickFirstString(raw.correctResponse, raw.answer),
        selectionMode: pickFirstString(raw.selectionMode) === 'multiple' ? 'multiple' : 'single'
      } satisfies StructuredQuestion;
    })
    .filter(question => question.prompt);
};

const buildPdfNormalizationPrompt = (blocks: string[]): string => buildSingleItemNormalizationPrompt('PDF', blocks);

// Batched version that processes multiple items at once
const buildBatchedPdfNormalizationPrompt = (itemGroups: Array<{ itemIndex: number; blocks: string[] }>): string =>
  buildBatchedNormalizationPrompt('PDF', itemGroups);

// ---------------------------------------------------------------------------
// LLM-based Boundary Detection (Phase 1)
// ---------------------------------------------------------------------------

/**
 * Parse the LLM's boundary detection response.
 */
const parseBoundaryDetectionResponse = (
  rawResponse: string,
  rangeStart: number,
  rangeEnd: number
): BoundaryDetectionResult => {
  const jsonStr = extractJsonString(rawResponse);
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const parseIndexArray = (key: string): number[] => {
    const arr = parsed[key];
    if (!Array.isArray(arr)) return [];
    return arr
      .map(v => Number(v))
      .filter(n => Number.isInteger(n))
      .map(n => {
        // Handle local vs global indexes
        if (n >= 0 && n < rangeEnd - rangeStart) {
          return n + rangeStart; // Convert local to global
        }
        return n; // Already global
      })
      .filter(n => n >= rangeStart && n < rangeEnd);
  };

  return {
    itemStartIndexes: parseIndexArray('itemStartIndexes'),
    contextIndexes: parseIndexArray('contextIndexes'),
    ignoredIndexes: parseIndexArray('ignoredIndexes')
  };
};

/**
 * Convert boundary detection results into item block groups.
 * Each item includes blocks from its start until the next item starts,
 * with context blocks prepended to the first item that follows them.
 */
const boundariesToItemGroups = (boundaries: BoundaryDetectionResult, totalBlocks: number): number[][] => {
  const { itemStartIndexes, contextIndexes, ignoredIndexes } = boundaries;

  if (itemStartIndexes.length === 0) {
    throw new Error('LLM boundary detection did not find any item starts.');
  }

  // Sort item starts
  const sortedStarts = [...itemStartIndexes].sort((a, b) => a - b);
  const itemGroups: number[][] = [];

  // Track which context blocks haven't been assigned yet
  const unassignedContext = new Set(contextIndexes);

  for (let i = 0; i < sortedStarts.length; i++) {
    const startIdx = sortedStarts[i];
    const endIdx = sortedStarts[i + 1] ?? totalBlocks;
    const itemBlocks: number[] = [];

    // Find context blocks that should attach to this item
    // (context that appears before this item's start but after previous item's start)
    const prevStart = i > 0 ? sortedStarts[i - 1] : -1;
    for (const ctxIdx of unassignedContext) {
      if (ctxIdx > prevStart && ctxIdx < startIdx) {
        itemBlocks.push(ctxIdx);
        unassignedContext.delete(ctxIdx);
      }
    }

    // Add all blocks from start to next item (excluding ignored)
    for (let j = startIdx; j < endIdx; j++) {
      if (!ignoredIndexes.includes(j) && !itemBlocks.includes(j)) {
        itemBlocks.push(j);
      }
    }

    // Sort blocks within item
    itemBlocks.sort((a, b) => a - b);
    if (itemBlocks.length > 0) {
      itemGroups.push(itemBlocks);
    }
  }

  return itemGroups;
};

/**
 * Detect item boundaries using LLM (Phase 1).
 * Uses adaptive chunking based on page breaks and Y-gaps when enabled.
 */
export const detectBoundariesWithLlm = async (
  engine: WebLlmLikeEngine,
  blocks: PdfTextBlock[],
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
): Promise<number[][]> => {
  const allBoundaries: BoundaryDetectionResult = {
    itemStartIndexes: [],
    contextIndexes: [],
    ignoredIndexes: []
  };

  // Extract chunking options with defaults
  const chunkingOptions = options.pdfChunking ?? {};
  const useAdaptive = chunkingOptions.adaptiveChunking ?? PDF_ADAPTIVE_CHUNKING_DEFAULT;
  const maxChunkSize = chunkingOptions.maxChunkSize ?? PDF_MAX_CHUNK_SIZE;
  const minChunkSize = chunkingOptions.minChunkSize ?? PDF_MIN_CHUNK_SIZE;
  const minYGap = chunkingOptions.minYGapForBreak ?? PDF_MIN_Y_GAP_FOR_BREAK;

  // Determine chunk boundaries
  let chunkBreaks: number[];
  if (blocks.length <= PDF_BOUNDARY_DETECTION_MAX_SINGLE_PASS) {
    // Small document - process in single pass
    chunkBreaks = [];
  } else if (useAdaptive) {
    // Use adaptive chunking based on natural breaks
    chunkBreaks = findAdaptiveChunkBreaks(blocks, {
      minYGap,
      maxChunkSize,
      minChunkSize
    });
  } else {
    // Fixed-size chunking (legacy behavior)
    chunkBreaks = [];
    for (let i = maxChunkSize; i < blocks.length; i += maxChunkSize) {
      chunkBreaks.push(i);
    }
  }

  // Build chunk ranges from breaks
  const chunkRanges: Array<{ start: number; end: number }> = [];
  let prevEnd = 0;
  for (const breakIdx of chunkBreaks) {
    chunkRanges.push({ start: prevEnd, end: breakIdx });
    prevEnd = breakIdx;
  }
  chunkRanges.push({ start: prevEnd, end: blocks.length });

  logPdfDebug('Chunking strategy', {
    totalBlocks: blocks.length,
    useAdaptive,
    chunkCount: chunkRanges.length,
    chunkSizes: chunkRanges.map(r => r.end - r.start)
  });

  if (chunkRanges.length === 1) {
    onProgress?.({
      stage: 'chunk_started',
      message: `Analyzing all ${blocks.length} blocks for item boundaries (single pass).`
    });
  }

  let previousContext: Array<{ index: number; text: string }> = [];

  for (let chunkIndex = 0; chunkIndex < chunkRanges.length; chunkIndex++) {
    const { start: startIndex, end: endIndex } = chunkRanges[chunkIndex];
    const chunk = blocks.slice(startIndex, endIndex).map((block, localIndex) => ({
      index: startIndex + localIndex,
      text: block.text
    }));

    if (chunkRanges.length > 1) {
      onProgress?.({
        stage: 'chunk_started',
        message: `Detecting item boundaries in blocks ${startIndex + 1}-${endIndex} of ${blocks.length}${previousContext.length > 0 ? ` (with ${previousContext.length} context blocks)` : ''}.`
      });
    }

    const prompt =
      previousContext.length > 0
        ? buildBoundaryDetectionPromptWithContext('PDF', chunk, previousContext)
        : buildBoundaryDetectionPrompt('PDF', chunk);

    try {
      const rawResponse = await requestLlmJson(
        engine,
        buildPdfSystemPrompt(
          'You analyze document structure to identify where assessment items begin. Return strict JSON only.',
          options
        ),
        prompt,
        options
      );

      const chunkBoundaries = parseBoundaryDetectionResponse(rawResponse, startIndex, endIndex);

      logPdfDebug('PDF boundary detection chunk result', {
        chunkIndex,
        startIndex,
        endIndex,
        itemStartsFound: chunkBoundaries.itemStartIndexes.length,
        contextFound: chunkBoundaries.contextIndexes.length,
        ignoredFound: chunkBoundaries.ignoredIndexes.length
      });

      // Merge into overall results
      allBoundaries.itemStartIndexes.push(...chunkBoundaries.itemStartIndexes);
      allBoundaries.contextIndexes.push(...chunkBoundaries.contextIndexes);
      allBoundaries.ignoredIndexes.push(...chunkBoundaries.ignoredIndexes);
    } catch (error) {
      console.warn('[qti-convert-local-ai][pdf] Failed to parse boundary detection response for chunk', {
        chunkIndex,
        startIndex,
        endIndex,
        error
      });
      // Continue with next chunk - partial results are better than none
    }

    onProgress?.({
      stage: 'chunk_completed',
      message:
        chunkRanges.length > 1
          ? `Detected boundaries in blocks ${startIndex + 1}-${endIndex}.`
          : `Boundary detection complete (${allBoundaries.itemStartIndexes.length} items found).`,
      data: {
        chunkIndex: chunkIndex + 1,
        chunkCount: chunkRanges.length,
        itemStartsFound: allBoundaries.itemStartIndexes.length
      }
    });

    // Save trailing blocks as context for next chunk
    if (chunkIndex < chunkRanges.length - 1) {
      const trailingStart = Math.max(startIndex, endIndex - PDF_CONTEXT_CARRYOVER);
      previousContext = blocks.slice(trailingStart, endIndex).map((block, i) => ({
        index: trailingStart + i,
        text: block.text
      }));
    }
  }

  // Convert boundaries to item groups
  const itemGroups = boundariesToItemGroups(allBoundaries, blocks.length);

  logPdfDebug('PDF boundary detection complete', {
    totalItemStarts: allBoundaries.itemStartIndexes.length,
    totalContextBlocks: allBoundaries.contextIndexes.length,
    totalIgnoredBlocks: allBoundaries.ignoredIndexes.length,
    finalItemCount: itemGroups.length
  });

  return itemGroups;
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
    (canvas as HTMLCanvasElement).toBlob(value => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error('Failed to convert PDF canvas to blob.'));
      }
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
};

const extractPdfPageImages = async (page: any, pageNumber: number): Promise<PdfImageAsset[]> => {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const operatorList = await page.getOperatorList();
  const imageBoxes: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    topPdf: number;
    bottomPdf: number;
  }> = [];
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
    if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject && fn !== OPS.paintImageMaskXObject) {
      continue;
    }

    const corners = [
      viewport.convertToViewportPoint(currentTransform[4], currentTransform[5]),
      viewport.convertToViewportPoint(
        currentTransform[4] + currentTransform[0],
        currentTransform[5] + currentTransform[1]
      ),
      viewport.convertToViewportPoint(
        currentTransform[4] + currentTransform[2],
        currentTransform[5] + currentTransform[3]
      ),
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
    const yValues = [
      currentTransform[5],
      currentTransform[5] + currentTransform[1],
      currentTransform[5] + currentTransform[3],
      currentTransform[5] + currentTransform[1] + currentTransform[3]
    ];
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

type BatchedNormalizationResult = {
  items: Array<{
    itemIndex: number;
    questions: StructuredQuestion[];
  }>;
};

const parseBatchedNormalizationResponse = (rawResponse: string): BatchedNormalizationResult => {
  const parsed = parsePdfJson(rawResponse);
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

export const normalizePdfItemsWithLlm = async (
  engine: WebLlmLikeEngine,
  blocks: PdfTextBlock[],
  itemBlockIndexes: number[][],
  images: PdfImageAsset[],
  onProgress?: GenerateQtiPackageOptions['onProgress'],
  options: GenerateQtiPackageOptions = {}
): Promise<StructuredQuestion[]> => {
  const questions: StructuredQuestion[] = [];
  const totalItems = itemBlockIndexes.length;
  let batchIndex = 0;

  // Process items in batches
  for (let startIdx = 0; startIdx < totalItems; startIdx += PDF_NORMALIZATION_BATCH_SIZE) {
    const endIdx = Math.min(startIdx + PDF_NORMALIZATION_BATCH_SIZE, totalItems);
    const batchItems = itemBlockIndexes.slice(startIdx, endIdx);
    batchIndex += 1;
    const totalBatches = Math.ceil(totalItems / PDF_NORMALIZATION_BATCH_SIZE);

    onProgress?.({
      stage: 'chunk_started',
      message: `Normalizing PDF items ${startIdx + 1}-${endIdx} of ${totalItems} (batch ${batchIndex}/${totalBatches}).`
    });

    // Prepare batch data: each item has its blocks
    const itemGroups = batchItems.map((blockIndexes, localIdx) => {
      const globalIdx = startIdx + localIdx;
      const blockTexts = blockIndexes
        .map(blockIndex => blocks[blockIndex]?.text)
        .filter((value): value is string => Boolean(value));
      return { itemIndex: globalIdx, blocks: blockTexts };
    });

    let batchQuestionCount = 0;
    try {
      const rawResponse = await requestLlmJson(
        engine,
        buildPdfSystemPrompt(
          'You convert PDF item blocks into structured assessment question JSON. Return strict JSON only.',
          options
        ),
        buildBatchedPdfNormalizationPrompt(itemGroups),
        options
      );
      logPdfDebug('PDF batch normalization raw response', {
        batchIndex,
        itemRange: [startIdx, endIdx],
        itemGroups: itemGroups.map(g => ({ itemIndex: g.itemIndex, blockCount: g.blocks.length })),
        rawResponse
      });

      let batchResult: BatchedNormalizationResult;
      try {
        batchResult = parseBatchedNormalizationResponse(rawResponse);
      } catch (error) {
        // Salvage: try to parse as single-item response
        const salvaged = salvagePdfQuestionsFromRawResponse(
          rawResponse,
          itemGroups.flatMap(g => g.blocks)
        );
        if (salvaged.length > 0) {
          logPdfDebug('Salvaged PDF batch normalization result', {
            batchIndex,
            questionCount: salvaged.length
          });
          // Distribute salvaged questions evenly across items in batch
          batchResult = {
            items: itemGroups.map((g, i) => ({ itemIndex: g.itemIndex, questions: i === 0 ? salvaged : [] }))
          };
        } else {
          throw error;
        }
      }

      // Process each item in the batch result
      for (const itemResult of batchResult.items) {
        const globalItemIndex = itemResult.itemIndex;
        const blockIndexes = itemBlockIndexes[globalItemIndex];
        if (!blockIndexes) continue;

        const normalized = itemResult.questions;
        const itemPages = Array.from(
          new Set(
            blockIndexes
              .map(blockIndex => blocks[blockIndex]?.pageNumber)
              .filter((value): value is number => Number.isFinite(value))
          )
        );
        const itemYValues = blockIndexes
          .map(blockIndex => blocks[blockIndex]?.y)
          .filter((value): value is number => Number.isFinite(value));
        const itemTop = itemYValues.length > 0 ? Math.max(...itemYValues) : Number.NEGATIVE_INFINITY;
        const itemBottom = itemYValues.length > 0 ? Math.min(...itemYValues) : Number.POSITIVE_INFINITY;

        // Image association with configurable tolerances
        const topTolerance = options.imageAssociation?.topTolerance ?? PDF_IMAGE_TOP_TOLERANCE;
        const bottomTolerance = options.imageAssociation?.bottomTolerance ?? PDF_IMAGE_BOTTOM_TOLERANCE;

        const itemImages = images.filter(image => {
          if (!itemPages.includes(image.pageNumber)) {
            return false;
          }
          if (!Number.isFinite(itemTop) || !Number.isFinite(itemBottom)) {
            return true;
          }
          return image.bottom <= itemTop + topTolerance && image.top >= itemBottom - bottomTolerance;
        });
        const normalizedQuestions = normalized.map((question, questionIndex) => ({
          ...question,
          stimulusImages:
            questionIndex === 0 && itemImages.length > 0
              ? [...(question.stimulusImages || []), ...itemImages]
              : question.stimulusImages,
          identifier: question.identifier || `item-${globalItemIndex + 1}-${questionIndex + 1}`
        }));
        questions.push(...normalizedQuestions);
        batchQuestionCount += normalizedQuestions.length;
      }
    } catch (error) {
      console.warn('[qti-convert-local-ai][pdf] LLM normalization failed for PDF batch, creating simple items.', {
        batchIndex,
        itemRange: [startIdx, endIdx],
        error
      });
      // Fallback: create simple items from blocks (no pattern matching)
      for (let localIdx = 0; localIdx < batchItems.length; localIdx++) {
        const globalIdx = startIdx + localIdx;
        const blockIndexes = batchItems[localIdx];
        const blockTexts = blockIndexes
          .map(blockIndex => blocks[blockIndex]?.text)
          .filter((value): value is string => Boolean(value));
        // Create one extended_text item per block group without regex pattern matching
        if (blockTexts.length > 0) {
          questions.push({
            type: 'extended_text',
            identifier: `item-${globalIdx + 1}`,
            prompt: blockTexts.join('\n\n'),
            points: 1
          });
          batchQuestionCount += 1;
        }
      }
    }

    onProgress?.({
      stage: 'chunk_completed',
      message: `Normalized PDF items ${startIdx + 1}-${endIdx} of ${totalItems}.`,
      data: {
        chunkIndex: batchIndex,
        chunkCount: totalBatches,
        questionCount: batchQuestionCount
      }
    });
  }

  return questions;
};
