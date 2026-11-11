import {
  MappingInference,
  QuestionInferenceFunction,
  SpreadsheetData,
  StructuredOption,
  StructuredQuestion,
  WebLlmSettings
} from './types';
import {
  WEB_LLM_MODEL_TIERS,
  WebLlmModelSelection,
  detectDeviceProfile,
  isModelResourceError,
  isShaderF16Error,
  recordModelPerformance,
  selectWebLlmModel,
  toF32Variant
} from './device-profile';
import { createLocalServerEngine } from './local-server';

export type WebLlmLikeEngine = {
  chat: {
    completions: {
      create: (request: {
        messages: Array<{ role: 'system' | 'user'; content: string }>;
        temperature?: number;
        response_format?: { type: 'json_object' };
      }) => Promise<{
        choices?: Array<{
          message?: {
            content?: string | Array<{ text?: string }>;
          };
        }>;
      }>;
    };
  };
};

export const DEFAULT_WEB_LLM_MODEL = 'Qwen2.5-7B-Instruct-q4f16_1-MLC';
const DEFAULT_CHUNK_SIZE = 5;
const MAX_CELL_LENGTH = 120;
const MAX_COLUMNS = 24;
const MAX_PROMPT_PAYLOAD_CHARS = 3500;

const pickFirstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const extractJsonString = (rawResponse: string): string => {
  const fencedMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const arrayStart = rawResponse.indexOf('[');
  const arrayEnd = rawResponse.lastIndexOf(']');
  const start = rawResponse.indexOf('{');
  const end = rawResponse.lastIndexOf('}');
  if (arrayStart !== -1 && arrayEnd !== -1 && (start === -1 || arrayStart < start)) {
    return rawResponse.slice(arrayStart, arrayEnd + 1);
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error('LLM response did not contain JSON.');
  }
  return rawResponse.slice(start, end + 1);
};

const collectBalancedJsonCandidates = (rawResponse: string): string[] => {
  const candidates: string[] = [];
  const stack: string[] = [];
  let startIndex = -1;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let index = 0; index < rawResponse.length; index += 1) {
    const char = rawResponse[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      continue;
    }

    if (char === '{' || char === '[') {
      if (stack.length === 0) {
        startIndex = index;
      }
      stack.push(char);
      continue;
    }

    if (char !== '}' && char !== ']') {
      continue;
    }

    const expectedOpen = char === '}' ? '{' : '[';
    if (stack.at(-1) !== expectedOpen) {
      stack.length = 0;
      startIndex = -1;
      continue;
    }

    stack.pop();
    if (stack.length === 0 && startIndex !== -1) {
      candidates.push(rawResponse.slice(startIndex, index + 1));
      startIndex = -1;
    }
  }

  return candidates;
};

const stripTrailingCommas = (value: string): string => value.replace(/,\s*([}\]])/g, '$1');

const quoteUnquotedKeys = (value: string): string =>
  value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3');

const replaceSingleQuotedStrings = (value: string): string =>
  value.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => `"${inner.replace(/"/g, '\\"')}"`);

const escapeControlCharactersInStrings = (value: string): string => {
  let result = '';
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        quoteChar = char;
      }
      result += char;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === quoteChar) {
      inString = false;
      quoteChar = '';
      result += char;
      continue;
    }

    if (char === '\n') {
      result += '\\n';
      continue;
    }
    if (char === '\r') {
      result += '\\r';
      continue;
    }
    if (char === '\t') {
      result += '\\t';
      continue;
    }

    const code = char.charCodeAt(0);
    if (code >= 0 && code <= 0x1f) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    result += char;
  }

  return result;
};

const repairJsonString = (value: string): string =>
  stripTrailingCommas(quoteUnquotedKeys(replaceSingleQuotedStrings(escapeControlCharactersInStrings(value))));

const parseCandidate = (candidate: string): unknown => {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return JSON.parse(repairJsonString(candidate)) as unknown;
  }
};

const parseJsonWithRepair = (rawResponse: string): unknown => {
  const extractedCandidate = extractJsonString(rawResponse);
  const candidates = [extractedCandidate, ...collectBalancedJsonCandidates(rawResponse), rawResponse.trim()];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      continue;
    }
    seen.add(normalizedCandidate);

    try {
      return parseCandidate(normalizedCandidate);
    } catch {
      continue;
    }
  }

  const jsonString = extractJsonString(rawResponse);
  return parseCandidate(jsonString);
};

const normalizeOption = (rawOption: Record<string, unknown>, index: number): StructuredOption => ({
  id: pickFirstString(rawOption.id, rawOption.identifier, rawOption.key, String.fromCharCode(65 + index)),
  text: pickFirstString(rawOption.text, rawOption.label, rawOption.value) || '',
  isCorrectAnswer: Boolean(rawOption.isCorrectAnswer ?? rawOption.is_correct ?? rawOption.correct)
});

const normalizeQuestion = (rawQuestion: Record<string, unknown>, index: number): StructuredQuestion => {
  const rawType = pickFirstString(rawQuestion.type, rawQuestion.item_type, rawQuestion.question_type);
  const type =
    rawType === 'extended_text' || rawType === 'open_text' || rawType === 'essay' ? 'extended_text' : 'multiple_choice';
  const options = Array.isArray(rawQuestion.options)
    ? rawQuestion.options.map((option, optionIndex) => normalizeOption(option as Record<string, unknown>, optionIndex))
    : undefined;
  const rawLayout = pickFirstString(rawQuestion.layout, rawQuestion.itemLayout, rawQuestion.item_layout);
  const layout = rawLayout === 'two_column' || rawLayout === 'single_column' ? rawLayout : 'auto';
  const expectedLength = Number(rawQuestion.expectedLength ?? rawQuestion.expected_length);
  const points = Number(rawQuestion.points ?? rawQuestion.maxScore ?? rawQuestion.max_score);

  return {
    type,
    identifier: pickFirstString(rawQuestion.identifier, rawQuestion.id, `item-${index + 1}`),
    title: pickFirstString(rawQuestion.title),
    stimulus: pickFirstString(rawQuestion.stimulus, rawQuestion.passage, rawQuestion.context),
    prompt: pickFirstString(rawQuestion.prompt, rawQuestion.question, rawQuestion.text) || '',
    options,
    correctResponse: pickFirstString(
      rawQuestion.correctResponse,
      rawQuestion.correct_response,
      rawQuestion.answer,
      rawQuestion.key
    ),
    expectedLength: Number.isFinite(expectedLength) && expectedLength > 0 ? expectedLength : undefined,
    layout,
    points: Number.isFinite(points) ? points : undefined
  };
};

const truncateText = (value: string, maxLength = MAX_CELL_LENGTH): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const compactRow = (
  row: SpreadsheetData['rows'][number],
  columns: string[],
  maxCellLength = MAX_CELL_LENGTH
): Record<string, string> => {
  const compact: Record<string, string> = {};
  for (const column of columns) {
    compact[column] = truncateText(String(row[column] || ''), maxCellLength);
  }
  return compact;
};

const buildChunkPromptPayload = (
  spreadsheet: SpreadsheetData,
  chunkRows: SpreadsheetData['rows'],
  chunkIndex: number,
  chunkCount: number
) => {
  let maxColumns = MAX_COLUMNS;
  let maxCellLength = MAX_CELL_LENGTH;
  let rows = chunkRows;

  while (true) {
    const columns = spreadsheet.columns.slice(0, maxColumns);
    const payload = {
      fileName: spreadsheet.fileName,
      sheetName: spreadsheet.sheetName,
      format: spreadsheet.format,
      totalRowCount: spreadsheet.rows.length,
      columns,
      chunkIndex,
      chunkCount,
      chunkRowCount: rows.length,
      rows: rows.map(row => compactRow(row, columns, maxCellLength)),
      promptNotes:
        spreadsheet.columns.length > maxColumns || maxCellLength < MAX_CELL_LENGTH
          ? `Chunk trimmed for local model limits: ${columns.length} columns, cell length ${maxCellLength}.`
          : 'Chunk contains all selected columns.'
    };

    if (JSON.stringify(payload).length <= MAX_PROMPT_PAYLOAD_CHARS) {
      return payload;
    }

    if (maxColumns > 12) {
      maxColumns -= 4;
      continue;
    }
    if (maxCellLength > 60) {
      maxCellLength -= 20;
      continue;
    }
    if (rows.length > 2) {
      rows = rows.slice(0, rows.length - 1);
      continue;
    }
    return payload;
  }
};

export const normalizeStructuredQuestions = (rawValue: unknown): StructuredQuestion[] => {
  const rawQuestions = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === 'object' && rawValue && Array.isArray((rawValue as { items?: unknown[] }).items)
      ? (rawValue as { items: unknown[] }).items
      : typeof rawValue === 'object' && rawValue && Array.isArray((rawValue as { questions?: unknown[] }).questions)
        ? (rawValue as { questions: unknown[] }).questions
        : [];

  if (rawQuestions.length === 0) {
    throw new Error('LLM response did not contain any questions.');
  }

  const questions = rawQuestions.map((question, index) =>
    normalizeQuestion(question as Record<string, unknown>, index)
  );
  for (const [index, question] of questions.entries()) {
    if (!question.prompt) {
      throw new Error(`Question ${index + 1} is missing a prompt.`);
    }
    if (question.type !== 'extended_text' && (!question.options || question.options.length < 2)) {
      throw new Error(`Question ${index + 1} must contain at least two options.`);
    }
  }
  return questions;
};

export const inferQuestionsFromRawResponse = (rawResponse: string): MappingInference => {
  const candidates = [
    extractJsonString(rawResponse),
    ...collectBalancedJsonCandidates(rawResponse),
    rawResponse.trim()
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      continue;
    }
    seen.add(normalizedCandidate);

    try {
      const parsed = parseJsonWithRepair(normalizedCandidate);
      return {
        questions: normalizeStructuredQuestions(parsed),
        rawResponse
      };
    } catch {
      continue;
    }
  }

  console.error('Failed to parse WebLLM question response.', {
    rawResponse,
    extractedCandidate: (() => {
      try {
        return extractJsonString(rawResponse);
      } catch {
        return undefined;
      }
    })(),
    candidateCount: collectBalancedJsonCandidates(rawResponse).length,
    candidates: collectBalancedJsonCandidates(rawResponse)
  });

  const parsed = parseJsonWithRepair(rawResponse);
  return {
    questions: normalizeStructuredQuestions(parsed),
    rawResponse
  };
};

export const createQuestionPrompt = (spreadsheet: SpreadsheetData): string => {
  const payload = JSON.stringify(buildChunkPromptPayload(spreadsheet, spreadsheet.rows, 1, 1), null, 2);

  return [
    'Convert these spreadsheet rows into question JSON.',
    'Return JSON only.',
    'Return either {"questions":[...]} or {"items":[...]}.',
    'Convert each row in this chunk into one question in the same order.',
    'Never copy placeholder example text into the output.',
    'Never return literal phrases such as "longer shared text if present", "What is the answer?", "Option 1", or "Option 2" unless they appear in the spreadsheet data itself.',
    'MC shape: {"type":"multiple_choice","prompt":"...","stimulus":"...","options":[{"id":"A","text":"...","isCorrectAnswer":true}],"layout":"auto","points":1}',
    'Open shape: {"type":"extended_text","prompt":"...","stimulus":"...","correctResponse":"...","expectedLength":200,"layout":"auto","points":1}',
    'Use "two_column" only when a long stimulus should be on the left.',
    payload
  ].join('\n\n');
};

const createChunkQuestionPrompt = (
  spreadsheet: SpreadsheetData,
  chunkRows: SpreadsheetData['rows'],
  chunkIndex: number,
  chunkCount: number
): string => {
  const payload = JSON.stringify(buildChunkPromptPayload(spreadsheet, chunkRows, chunkIndex, chunkCount), null, 2);
  return [
    'Convert these spreadsheet rows into question JSON.',
    'Return JSON only.',
    'Return either {"questions":[...]} or {"items":[...]}.',
    'Convert each row in this chunk into one question in the same order.',
    'Never copy placeholder example text into the output.',
    'MC shape: {"type":"multiple_choice","prompt":"...","options":[{"id":"A","text":"...","isCorrectAnswer":true}]}',
    'Open shape: {"type":"extended_text","prompt":"...","correctResponse":"..."}',
    payload
  ].join('\n\n');
};

const createCompactQuestionPrompt = (spreadsheet: SpreadsheetData, chunkRows: SpreadsheetData['rows']): string => {
  const columns = spreadsheet.columns.slice(0, 12);
  const sampleRows = chunkRows
    .slice(0, 3)
    .map(row => Object.fromEntries(columns.map(column => [column, truncateText(String(row[column] || ''), 60)])));
  return [
    'Return JSON only.',
    'Convert spreadsheet rows into {"questions":[...]}',
    'MC: {"type":"multiple_choice","prompt":"...","options":[{"id":"A","text":"...","isCorrectAnswer":true}]}',
    'Open: {"type":"extended_text","prompt":"...","correctResponse":"..."}',
    JSON.stringify(
      {
        columnCount: spreadsheet.columns.length,
        rowCount: chunkRows.length,
        columns,
        sampleRows
      },
      null,
      2
    )
  ].join('\n\n');
};

const isContextWindowError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes('ContextWindowSizeExceededError') ||
    error.message.includes('Prompt tokens exceed context window size'));

const isJsonParseError = (error: unknown): boolean =>
  error instanceof SyntaxError ||
  (error instanceof Error && (error.message.includes('JSON') || error.message.includes('property name')));

const extractResponseContent = (rawContent: string | Array<{ text?: string }> | undefined): string =>
  typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(part => part.text || '').join('')
      : '';

const requestQuestions = async (
  engine: WebLlmLikeEngine,
  systemPrompt: string,
  userPrompt: string,
  settings: WebLlmSettings = {}
): Promise<string> => {
  const response = await engine.chat.completions.create({
    temperature: settings.temperature ?? 0,
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
    throw new Error('WebLLM returned an empty question response.');
  }
  return content;
};

const buildSystemPrompt = (basePrompt: string, settings: WebLlmSettings = {}): string => {
  const prompt = settings.systemPrompt?.trim() || basePrompt;
  const instructions = settings.instructions?.trim();

  return instructions ? `${prompt}\n\nAdditional import instructions:\n${instructions}` : prompt;
};

const chunkRows = (rows: SpreadsheetData['rows'], chunkSize: number): SpreadsheetData['rows'][] => {
  const chunks: SpreadsheetData['rows'][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
};

const splitRowsInHalf = (rows: SpreadsheetData['rows']): [SpreadsheetData['rows'], SpreadsheetData['rows']] => {
  const midpoint = Math.ceil(rows.length / 2);
  return [rows.slice(0, midpoint), rows.slice(midpoint)];
};

const reindexQuestions = (questions: StructuredQuestion[], offset: number): StructuredQuestion[] =>
  questions.map((question, index) => {
    const globalNumber = offset + index + 1;
    if (!question.identifier || /^item-\d+$/i.test(question.identifier)) {
      return {
        ...question,
        identifier: `item-${globalNumber}`
      };
    }
    return question;
  });

const asWebLlmEngine = (value: unknown): WebLlmLikeEngine => value as WebLlmLikeEngine;

export const createWebLlmEngine = async (
  settings: WebLlmSettings = {},
  reportProgress?: (event: {
    stage: 'llm_loading_started' | 'llm_loading_completed';
    message: string;
    data?: unknown;
  }) => void
): Promise<WebLlmLikeEngine> => {
  if (settings.engine) {
    return asWebLlmEngine(settings.engine);
  }

  if (settings.createEngine) {
    reportProgress?.({
      stage: 'llm_loading_started',
      message: `Loading WebLLM model ${settings.model || DEFAULT_WEB_LLM_MODEL}.`
    });
    const engine = await settings.createEngine(settings);
    reportProgress?.({
      stage: 'llm_loading_completed',
      message: `Loaded WebLLM model ${settings.model || DEFAULT_WEB_LLM_MODEL}.`,
      data: {
        model: settings.model || DEFAULT_WEB_LLM_MODEL
      }
    });
    return asWebLlmEngine(engine);
  }

  if (settings.localServer) {
    try {
      return await createLocalServerEngine(settings.localServer, reportProgress);
    } catch (error) {
      if (settings.localServer.fallbackToWebLlm === false) {
        throw error;
      }
      console.warn('Local LLM server unavailable; falling back to in-browser WebLLM.', error);
    }
  }

  if (settings.reuseEngine === false) {
    return loadWebLlmEngine(settings, reportProgress);
  }
  const cacheKey = settings.model || (settings.autoSelectModel === false ? DEFAULT_WEB_LLM_MODEL : 'auto');
  const cached = webLlmEngineCache.get(cacheKey);
  if (cached) {
    reportProgress?.({ stage: 'llm_loading_started', message: 'Reusing loaded WebLLM engine.' });
    const engine = await cached;
    reportProgress?.({
      stage: 'llm_loading_completed',
      message: 'Reusing loaded WebLLM engine.',
      data: { reused: true }
    });
    return engine;
  }
  const pending = loadWebLlmEngine(settings, reportProgress);
  webLlmEngineCache.set(cacheKey, pending);
  pending.catch(() => {
    if (webLlmEngineCache.get(cacheKey) === pending) webLlmEngineCache.delete(cacheKey);
  });
  return pending;
};

/** Engines loaded by `createWebLlmEngine`, reused across conversions so the model is loaded once per page. */
const webLlmEngineCache = new Map<string, Promise<WebLlmLikeEngine>>();

/** Unloads cached WebLLM engines (frees GPU memory) and clears the cache. */
export const releaseWebLlmEngines = async (): Promise<void> => {
  const engines = [...webLlmEngineCache.values()];
  webLlmEngineCache.clear();
  await Promise.all(
    engines.map(async pending => {
      const engine = (await pending.catch(() => undefined)) as { unload?: () => Promise<void> } | undefined;
      await engine?.unload?.().catch(() => undefined);
    })
  );
};

const loadWebLlmEngine = async (
  settings: WebLlmSettings,
  reportProgress?: (event: {
    stage: 'llm_loading_started' | 'llm_loading_completed';
    message: string;
    data?: unknown;
  }) => void
): Promise<WebLlmLikeEngine> => {
  let selection: WebLlmModelSelection | undefined;
  let candidates: string[];
  let gpuKey: string | undefined;
  if (settings.model) {
    candidates = [settings.model, ...(settings.fallbackModels || [])];
  } else if (settings.autoSelectModel === false) {
    candidates = [DEFAULT_WEB_LLM_MODEL, ...(settings.fallbackModels || [])];
  } else {
    selection = await selectWebLlmModel({
      preferCachedModels: settings.preferCachedModels,
      minDecodeTokensPerSecond: settings.minDecodeTokensPerSecond,
      persistStorage: settings.persistStorage
    });
    settings.onModelSelected?.(selection);
    if (!selection.model) {
      throw new Error(`Local AI is not available on this device: ${selection.reasons.join(' ')}`);
    }
    candidates = [selection.model, ...(settings.fallbackModels || selection.fallbackModels)];
    gpuKey = selection.profile.gpuKey;
  }

  const webllm = await import('@mlc-ai/web-llm');
  const engineConfig = {
    initProgressCallback: (progress: unknown) => {
      settings.initProgressCallback?.(progress);
    }
  };

  let lastError: unknown;
  for (let index = 0; index < candidates.length; index++) {
    const model = candidates[index];
    reportProgress?.({
      stage: 'llm_loading_started',
      message:
        index === 0
          ? `Loading WebLLM model ${model}${selection ? ` (${selection.tier} tier${selection.cached ? ', cached' : ''})` : ''}.`
          : `Retrying with smaller WebLLM model ${model}.`
    });
    const ownsWorker = typeof settings.worker === 'function';
    const worker = typeof settings.worker === 'function' ? settings.worker() : settings.worker;
    try {
      const engine = worker
        ? await webllm.CreateWebWorkerMLCEngine(worker, model, engineConfig)
        : await webllm.CreateMLCEngine(model, engineConfig);
      if (settings.recordPerformance !== false) {
        instrumentDecodeSpeed(asWebLlmEngine(engine), model, gpuKey ?? (await detectDeviceProfile()).gpuKey);
      }
      reportProgress?.({
        stage: 'llm_loading_completed',
        message: `Loaded WebLLM model ${model}.`,
        data: {
          model,
          tier: selection?.tier,
          detectedTier: selection?.detectedTier,
          lowAccuracy: Object.values(WEB_LLM_MODEL_TIERS.low).some(entry => entry.model === model),
          failedModels: candidates.slice(0, index),
          reasons: selection?.reasons
        }
      });
      return asWebLlmEngine(engine);
    } catch (error) {
      lastError = error;
      if (ownsWorker) worker?.terminate();
      if (!isModelResourceError(error)) {
        throw error;
      }
      // Without shader-f16 the same size may still fit as q4f32; try that before going smaller.
      if (isShaderF16Error(error) && toF32Variant(model) !== model) {
        const remaining = [toF32Variant(model), ...candidates.slice(index + 1).map(toF32Variant)];
        candidates = [
          ...candidates.slice(0, index + 1),
          ...remaining.filter((candidate, position) => remaining.indexOf(candidate) === position)
        ];
      }
      console.warn(`WebLLM failed to load ${model}; trying a smaller model if available.`, error);
    }
  }
  throw lastError;
};

type CompletionUsage = {
  completion_tokens?: number;
  extra?: { decode_tokens_per_s?: number };
};

/** Wraps chat.completions.create to record decode speed for future model selection. */
const instrumentDecodeSpeed = (engine: WebLlmLikeEngine, model: string, gpuKey: string): void => {
  const completions = engine.chat?.completions;
  if (!completions?.create) return;
  const original = completions.create.bind(completions);
  completions.create = async request => {
    const startedAt = Date.now();
    const response = await original(request);
    try {
      const usage = (response as { usage?: CompletionUsage }).usage;
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const tokensPerSecond =
        usage?.extra?.decode_tokens_per_s ??
        (usage?.completion_tokens && elapsedSeconds > 0 ? usage.completion_tokens / elapsedSeconds : undefined);
      if (tokensPerSecond && (usage?.completion_tokens ?? 0) >= 16) {
        recordModelPerformance(gpuKey, model, tokensPerSecond);
      }
    } catch {
      // Measuring is best effort.
    }
    return response;
  };
};

export const createWebLlmQuestionInferer =
  (engine: WebLlmLikeEngine, settings: WebLlmSettings = {}): QuestionInferenceFunction =>
  async (spreadsheet, context) => {
    context?.reportProgress?.({
      stage: 'mapping_started',
      message: 'Sending parsed spreadsheet JSON to the local LLM.'
    });

    const chunks = chunkRows(spreadsheet.rows, Math.max(1, settings.chunkSize || DEFAULT_CHUNK_SIZE));
    const mergedQuestions: StructuredQuestion[] = [];

    const resolveChunkQuestions = async (
      rowsInChunk: SpreadsheetData['rows'],
      chunkIndex: number,
      chunkCount: number,
      fallbackDepth = 0
    ): Promise<StructuredQuestion[]> => {
      const humanChunkIndex = chunkIndex + 1;
      let content = '';

      try {
        content = await requestQuestions(
          engine,
          buildSystemPrompt(
            'You convert spreadsheet rows into normalized question JSON. Respond with strict JSON only. Preserve row order.',
            settings
          ),
          createChunkQuestionPrompt(spreadsheet, rowsInChunk, humanChunkIndex, chunkCount),
          settings
        );
      } catch (error) {
        if (!isContextWindowError(error)) {
          throw error;
        }
        context?.reportProgress?.({
          stage: 'mapping_started',
          message: `Chunk ${humanChunkIndex} exceeded model context window. Retrying with a smaller prompt.`
        });
        content = await requestQuestions(
          engine,
          buildSystemPrompt('Return strict JSON only.', settings),
          createCompactQuestionPrompt(spreadsheet, rowsInChunk),
          settings
        );
      }

      try {
        return inferQuestionsFromRawResponse(content).questions;
      } catch (error) {
        if (!isJsonParseError(error)) {
          throw error;
        }

        context?.reportProgress?.({
          stage: 'mapping_started',
          message: `Chunk ${humanChunkIndex} returned invalid JSON. Retrying with stricter JSON instructions.`
        });

        try {
          const retryContent = await requestQuestions(
            engine,
            buildSystemPrompt(
              'Return valid minified JSON only. Use double-quoted property names, double-quoted string values, no trailing commas, no comments, no markdown fences.',
              settings
            ),
            `${createCompactQuestionPrompt(spreadsheet, rowsInChunk)}\n\nYour previous response was invalid JSON. Return valid JSON only.`,
            settings
          );
          return inferQuestionsFromRawResponse(retryContent).questions;
        } catch (retryError) {
          if (!isJsonParseError(retryError) || rowsInChunk.length <= 1) {
            throw retryError;
          }

          const [leftRows, rightRows] = splitRowsInHalf(rowsInChunk);
          if (leftRows.length === 0 || rightRows.length === 0) {
            throw retryError;
          }

          context?.reportProgress?.({
            stage: 'mapping_started',
            message: `Chunk ${humanChunkIndex} still returned invalid JSON. Splitting ${rowsInChunk.length} rows into smaller chunks (depth ${fallbackDepth + 1}).`
          });

          const leftQuestions = await resolveChunkQuestions(leftRows, chunkIndex, chunkCount, fallbackDepth + 1);
          const rightQuestions = await resolveChunkQuestions(rightRows, chunkIndex, chunkCount, fallbackDepth + 1);
          return [...leftQuestions, ...rightQuestions];
        }
      }
    };

    for (const [chunkIndex, rowsInChunk] of chunks.entries()) {
      const humanChunkIndex = chunkIndex + 1;
      context?.reportProgress?.({
        stage: 'chunk_started',
        message: `Processing chunk ${humanChunkIndex} of ${chunks.length}.`
      });

      const parsedQuestions = await resolveChunkQuestions(rowsInChunk, chunkIndex, chunks.length);

      mergedQuestions.push(...reindexQuestions(parsedQuestions, mergedQuestions.length));
      context?.reportProgress?.({
        stage: 'chunk_completed',
        message: `Processed chunk ${humanChunkIndex} of ${chunks.length}.`,
        data: {
          chunkIndex: humanChunkIndex,
          chunkCount: chunks.length,
          questionCount: parsedQuestions.length
        }
      });
    }

    return mergedQuestions;
  };

export const createWebLlmQuestionInfererFromSettings = (settings: WebLlmSettings = {}): QuestionInferenceFunction => {
  let enginePromise: Promise<WebLlmLikeEngine> | undefined;

  return async (spreadsheet, context) => {
    if (!enginePromise) {
      enginePromise = createWebLlmEngine(settings, event => {
        context?.reportProgress?.(event);
      });
    }
    const engine = await enginePromise;
    const inferer = createWebLlmQuestionInferer(engine, settings);
    return inferer(spreadsheet, context);
  };
};

// ============================================================================
// LLM-Based Column Mapping for Spreadsheets
// ============================================================================

export type ColumnMapping = {
  questionColumn?: string;
  answerColumn?: string;
  optionColumns?: string[];
  pointsColumn?: string;
  stimulusColumn?: string;
  identifierColumn?: string;
  confidence: 'high' | 'medium' | 'low';
};

const COLUMN_MAPPING_PROMPT = `
Analyze these spreadsheet columns and sample data to identify which columns contain assessment question data.

## Column Roles to Identify:
- questionColumn: The main question text/prompt/stem (look for longest text, question marks, or columns named question/vraag/prompt/stem/text)
- answerColumn: The correct answer(s) (look for columns named answer/antwoord/correct/key/solution or short letter values like "A", "B", "C")
- optionColumns: Answer options/choices in separate columns (often columns A, B, C, D or named option/choice/answer a/answer b)
- pointsColumn: Point values for questions (look for columns named points/punten/score/marks with numeric values)
- stimulusColumn: Shared passage/context/source for questions (look for columns named stimulus/passage/context/bron/tekst)
- identifierColumn: Question ID/number (look for columns named id/identifier/nummer/item with unique short values)

## Rules:
1. Only map columns that clearly match a role - leave undefined if uncertain
2. optionColumns should be an array of column names (e.g., ["A", "B", "C", "D"])
3. If columns are named with single letters A-F and contain answer text, those are optionColumns
4. The questionColumn typically has the longest text content

Return strict JSON only:
{"questionColumn":"...", "answerColumn":"...", "optionColumns":["A","B","C","D"], "pointsColumn":"...", "stimulusColumn":"...", "identifierColumn":"...", "confidence":"high"|"medium"|"low"}
`;

const buildColumnMappingPrompt = (columns: string[], sampleRows: Record<string, string>[]): string => {
  return [
    COLUMN_MAPPING_PROMPT,
    '',
    '## Columns:',
    JSON.stringify(columns),
    '',
    '## Sample Rows (first 5):',
    JSON.stringify(sampleRows.slice(0, 5), null, 2)
  ].join('\n');
};

const parseColumnMappingResponse = (rawResponse: string, availableColumns: Set<string>): ColumnMapping => {
  const extractedJson = (() => {
    const fencedMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }
    const start = rawResponse.indexOf('{');
    const end = rawResponse.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return rawResponse.slice(start, end + 1);
    }
    return rawResponse;
  })();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractedJson) as Record<string, unknown>;
  } catch {
    return { confidence: 'low' };
  }

  // Validate and clean the mapping - only keep columns that actually exist
  const validateColumn = (value: unknown): string | undefined => {
    if (typeof value === 'string' && availableColumns.has(value)) {
      return value;
    }
    return undefined;
  };

  const validateColumns = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const validated = value.filter((v): v is string => typeof v === 'string' && availableColumns.has(v));
    return validated.length > 0 ? validated : undefined;
  };

  const confidence = parsed.confidence === 'high' ? 'high' : parsed.confidence === 'medium' ? 'medium' : 'low';

  return {
    questionColumn: validateColumn(parsed.questionColumn),
    answerColumn: validateColumn(parsed.answerColumn),
    optionColumns: validateColumns(parsed.optionColumns),
    pointsColumn: validateColumn(parsed.pointsColumn),
    stimulusColumn: validateColumn(parsed.stimulusColumn),
    identifierColumn: validateColumn(parsed.identifierColumn),
    confidence
  };
};

export const inferColumnMappingWithLlm = async (
  engine: WebLlmLikeEngine,
  spreadsheet: SpreadsheetData,
  settings: WebLlmSettings = {}
): Promise<ColumnMapping> => {
  const sampleRows = spreadsheet.rows.slice(0, 5).map(row => {
    const compact: Record<string, string> = {};
    for (const column of spreadsheet.columns.slice(0, 20)) {
      const value = String(row[column] || '').trim();
      compact[column] = value.length > 100 ? value.slice(0, 100) + '...' : value;
    }
    return compact;
  });

  const response = await engine.chat.completions.create({
    temperature: settings.temperature ?? 0,
    messages: [
      {
        role: 'system',
        content:
          'You analyze spreadsheet structure to identify columns containing assessment question data. Return strict JSON only.'
      },
      {
        role: 'user',
        content: buildColumnMappingPrompt(spreadsheet.columns.slice(0, 20), sampleRows)
      }
    ]
  });

  const content = extractResponseContent(response.choices?.[0]?.message?.content);
  if (!content) {
    return { confidence: 'low' };
  }

  const availableColumns = new Set(spreadsheet.columns);
  return parseColumnMappingResponse(content, availableColumns);
};

export const applyColumnMappingToSpreadsheet = (
  spreadsheet: SpreadsheetData,
  mapping: ColumnMapping
): StructuredQuestion[] | null => {
  if (!mapping.questionColumn || mapping.confidence === 'low') {
    return null;
  }

  const questions: StructuredQuestion[] = [];

  for (const [index, row] of spreadsheet.rows.entries()) {
    const prompt = (row[mapping.questionColumn] || '').trim();
    if (!prompt) {
      continue;
    }

    const stimulus = mapping.stimulusColumn ? (row[mapping.stimulusColumn] || '').trim() || undefined : undefined;

    const identifier = mapping.identifierColumn
      ? (row[mapping.identifierColumn] || '').trim() || `item-${index + 1}`
      : `item-${index + 1}`;

    const pointsRaw = mapping.pointsColumn ? (row[mapping.pointsColumn] || '').trim() : undefined;
    const points = pointsRaw ? Number(pointsRaw) : undefined;

    const answerValue = mapping.answerColumn ? (row[mapping.answerColumn] || '').trim() : undefined;

    // Build options if optionColumns are mapped
    if (mapping.optionColumns && mapping.optionColumns.length >= 2) {
      const options = mapping.optionColumns
        .map((col, optIndex) => ({
          id: String.fromCharCode(65 + optIndex),
          text: (row[col] || '').trim()
        }))
        .filter(opt => opt.text);

      if (options.length >= 2) {
        // Determine which options are correct
        const answerTokens = answerValue
          ? answerValue
              .toUpperCase()
              .split(/[;,|/]+/)
              .map(t => t.trim())
              .filter(Boolean)
          : [];

        const optionsWithCorrect = options.map(opt => ({
          ...opt,
          isCorrectAnswer: answerTokens.includes(opt.id)
        }));

        questions.push({
          type: 'multiple_choice',
          identifier,
          prompt,
          stimulus,
          options: optionsWithCorrect,
          correctResponse: answerValue,
          points: points && Number.isFinite(points) ? points : undefined,
          selectionMode: answerTokens.length > 1 ? 'multiple' : 'single',
          layout: stimulus ? 'auto' : 'single_column'
        });
        continue;
      }
    }

    // No valid options - treat as extended text or try to infer from answer
    questions.push({
      type: 'extended_text',
      identifier,
      prompt,
      stimulus,
      correctResponse: answerValue,
      points: points && Number.isFinite(points) ? points : undefined,
      layout: stimulus ? 'auto' : 'single_column'
    });
  }

  return questions.length > 0 ? questions : null;
};
