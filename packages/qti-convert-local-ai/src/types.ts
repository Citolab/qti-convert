import type { WebLlmModelSelection } from './device-profile';

export type SpreadsheetRow = Record<string, string>;

export type SpreadsheetFormat = 'csv' | 'xlsx' | 'xml';

export type SpreadsheetData = {
  columns: string[];
  rows: SpreadsheetRow[];
  format: SpreadsheetFormat;
  sheetName?: string;
  fileName?: string;
};

export type DatasetPreview = {
  columns: string[];
  sampleRows: SpreadsheetRow[];
  rowCount: number;
  fileName?: string;
  sheetName?: string;
};

export type QuestionLayout = 'single_column' | 'two_column' | 'auto';

export type StructuredOption = {
  id?: string;
  text: string;
  isCorrectAnswer?: boolean;
  feedback?: string;
};

export type StructuredMediaAsset = {
  id?: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
  altText?: string;
};

export type StructuredQuestion = {
  type?: 'multiple_choice' | 'extended_text' | 'short_text';
  identifier?: string;
  title?: string;
  stimulus?: string;
  generalFeedback?: string;
  stimulusImages?: StructuredMediaAsset[];
  prompt: string;
  options?: StructuredOption[];
  correctResponse?: string;
  expectedLength?: number;
  layout?: QuestionLayout;
  points?: number;
  selectionMode?: 'single' | 'multiple';
};

export type ConversionIssue = {
  severity: 'warning' | 'error';
  questionIndex: number;
  identifier?: string;
  message: string;
};

export type ConversionSummary = {
  totalQuestions: number;
  generatedItems: number;
  skippedItems: number;
  warnings: ConversionIssue[];
  errors: ConversionIssue[];
};

export type StructuredQuestionMapping = {
  type: 'multiple_choice' | 'extended_text';
  questionColumn: string;
  stimulusColumn?: string;
  answerColumns?: string[];
  correctAnswerColumn?: string;
  pointsColumn?: string;
  itemIdentifierColumn?: string;
  titleColumn?: string;
  expectedLength?: number;
  layout?: QuestionLayout;
  selectionMode?: 'single' | 'multiple';
};

export type MappingInference = {
  questions: StructuredQuestion[];
  rawResponse: string;
};

export type ProgressEvent =
  | {
      stage: 'parse_started' | 'llm_loading_started' | 'mapping_started' | 'generation_started' | 'chunk_started';
      message: string;
    }
  | {
      stage:
        'parse_completed' | 'llm_loading_completed' | 'mapping_completed' | 'package_completed' | 'chunk_completed';
      message: string;
      data?: unknown;
    }
  | {
      stage: 'item_generated';
      message: string;
      current: number;
      total: number;
      itemIdentifier: string;
    };

export type ProgressCallback = (event: ProgressEvent) => void;

export type WebLlmSettings = {
  model?: string;
  chunkSize?: number;
  temperature?: number;
  systemPrompt?: string;
  instructions?: string;
  engine?: unknown;
  createEngine?: (settings: WebLlmSettings) => Promise<unknown>;
  initProgressCallback?: (progress: unknown) => void;
  /**
   * When `model` is not set, pick a model based on the detected hardware, cached models,
   * free storage and decode speed measured on earlier runs. Set to `false` to always use
   * `DEFAULT_WEB_LLM_MODEL`.
   * @default true
   */
  autoSelectModel?: boolean;
  /**
   * Models to try, in order, when loading fails with an out-of-memory / device-lost /
   * shader-f16 error. Filled automatically when the model is auto-selected.
   */
  fallbackModels?: string[];
  /**
   * Run WebLLM in a Web Worker so model loading and shader compilation don't freeze the page.
   * Pass a Worker (or a factory) whose script imports `@citolab/qti-convert-local-ai/webllm-worker`.
   */
  worker?: Worker | (() => Worker);
  /** Use an already-downloaded smaller model instead of downloading a larger one. @default true */
  preferCachedModels?: boolean;
  /** Models measured slower than this (decode tokens/s) on earlier runs are skipped. @default 4 */
  minDecodeTokensPerSecond?: number;
  /** Ask the browser to persist storage so the model cache isn't evicted. @default true */
  persistStorage?: boolean;
  /** Measure decode speed and remember it (localStorage) to tune future model selection. @default true */
  recordPerformance?: boolean;
  /** Called after auto-selection, e.g. to show the chosen model or a low-accuracy warning. */
  onModelSelected?: (selection: WebLlmModelSelection) => void;
  /**
   * Reuse a loaded WebLLM engine across calls (per model) so the model is loaded once per page.
   * Call `releaseWebLlmEngines()` to free GPU memory.
   * @default true
   */
  reuseEngine?: boolean;
  /**
   * Use a native OpenAI-compatible LLM server on this machine (Ollama, LM Studio, llama.cpp)
   * instead of in-browser WebLLM. Much faster on typical Windows hardware, still fully local.
   */
  localServer?: LocalServerSettings;
};

export type LocalServerSettings = {
  /** OpenAI-compatible base URL including `/v1`, e.g. `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio). */
  baseUrl: string;
  /** Model name as known to the server, e.g. `qwen2.5:7b`. */
  model: string;
  apiKey?: string;
  /** Per-request timeout. @default 300000 */
  timeoutMs?: number;
  /** Fall back to in-browser WebLLM when the server is unreachable. @default true */
  fallbackToWebLlm?: boolean;
  /** Allow a non-loopback host. Documents are then sent over the network. @default false */
  allowRemoteHost?: boolean;
  /** Custom fetch implementation (testing). */
  fetch?: typeof fetch;
};

export type QuestionInferenceFunction = (
  spreadsheet: SpreadsheetData,
  context?: {
    reportProgress?: ProgressCallback;
  }
) => Promise<StructuredQuestion[]>;

export type PdfChunkingOptions = {
  /**
   * Use adaptive chunking based on page breaks and Y-gaps instead of fixed chunk size.
   * @default true
   */
  adaptiveChunking?: boolean;
  /**
   * Minimum Y-gap (in PDF units) to consider as a natural section break.
   * Larger values = fewer breaks. Typical range: 30-100.
   * @default 50
   */
  minYGapForBreak?: number;
  /**
   * Maximum blocks per chunk (hard limit even with adaptive chunking).
   * @default 80
   */
  maxChunkSize?: number;
  /**
   * Minimum blocks per chunk (prevents tiny chunks).
   * @default 20
   */
  minChunkSize?: number;
};

export type ImageAssociationOptions = {
  /**
   * Y-tolerance above item top for image association (PDF units).
   * @default 60
   */
  topTolerance?: number;
  /**
   * Y-tolerance below item bottom for image association (PDF units).
   * @default 220
   */
  bottomTolerance?: number;
};

export type GenerateQtiPackageOptions = {
  packageIdentifier?: string;
  testIdentifier?: string;
  testTitle?: string;
  sectionIdentifier?: string;
  sectionTitle?: string;
  manifestIdentifier?: string;
  pointsDefault?: number;
  onProgress?: ProgressCallback;
  llmSettings?: WebLlmSettings;
  /**
   * PDF-specific chunking options for boundary detection.
   */
  pdfChunking?: PdfChunkingOptions;
  /**
   * Image-to-item association options (PDF only).
   */
  imageAssociation?: ImageAssociationOptions;
};

export type SpreadsheetToQtiResult = {
  spreadsheet: SpreadsheetData;
  preview: DatasetPreview;
  processable: boolean;
  reason?: string;
  questions: StructuredQuestion[];
  packageBlob?: Blob;
  packageName?: string;
  summary: ConversionSummary;
};
