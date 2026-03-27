export type SpreadsheetRow = Record<string, string>;

export type SpreadsheetFormat = 'csv' | 'xlsx';

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
};

export type StructuredQuestion = {
  type?: 'multiple_choice' | 'extended_text';
  identifier?: string;
  title?: string;
  stimulus?: string;
  prompt: string;
  options?: StructuredOption[];
  correctResponse?: string;
  expectedLength?: number;
  layout?: QuestionLayout;
  points?: number;
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
      stage:
        | 'parse_started'
        | 'llm_loading_started'
        | 'mapping_started'
        | 'generation_started'
        | 'chunk_started';
      message: string;
    }
  | {
      stage:
        | 'parse_completed'
        | 'llm_loading_completed'
        | 'mapping_completed'
        | 'package_completed'
        | 'chunk_completed';
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
  engine?: unknown;
  createEngine?: (settings: WebLlmSettings) => Promise<unknown>;
  initProgressCallback?: (progress: unknown) => void;
};

export type QuestionInferenceFunction = (
  spreadsheet: SpreadsheetData,
  context?: {
    reportProgress?: ProgressCallback;
  }
) => Promise<StructuredQuestion[]>;

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
};

export type SpreadsheetToQtiResult = {
  spreadsheet: SpreadsheetData;
  preview: DatasetPreview;
  questions: StructuredQuestion[];
  packageBlob: Blob;
  packageName: string;
  summary: ConversionSummary;
};
