import { buildDatasetPreview, parseSpreadsheet, ParseSpreadsheetOptions } from './spreadsheet-parser';
import { createWebLlmQuestionInfererFromSettings } from './mapping';
import { generateQtiPackageFromQuestions } from './qti-generator';
import {
  GenerateQtiPackageOptions,
  QuestionInferenceFunction,
  SpreadsheetData,
  SpreadsheetRow,
  SpreadsheetToQtiResult,
  StructuredQuestion
} from './types';

export type ConvertSpreadsheetToQtiOptions = ParseSpreadsheetOptions & GenerateQtiPackageOptions;

const isQuestionInferenceFunction = (value: unknown): value is QuestionInferenceFunction => typeof value === 'function';
const normalizeColumnName = (value: string) => value.trim().toLowerCase();
const emptySummary = () => ({
  totalQuestions: 0,
  generatedItems: 0,
  skippedItems: 0,
  warnings: [],
  errors: []
});

const ROW_EXPORT_REQUIRED_COLUMNS = [
  'SE_ItemLabel',
  'element_type',
  'Element_type_displayLabel',
  'Element_Text_Plain',
  'Element_Text_HTML'
] as const;
const ANSWER_COLUMN_CANDIDATES = [
  'CorrectAnswer',
  'Correct_Answer',
  'Answer',
  'Key',
  'CorrectOption',
  'Correct Option',
  'is_correct',
  'IsCorrect'
];
const QUESTESTINTEROP_REQUIRED_COLUMNS = [
  'identifier',
  'title',
  'prompt',
  'generalFeedback',
  'questionType',
  'selectionMode',
  'correctResponse',
  'optionsJson',
  'expectedLength'
] as const;

const decodeHtmlEntities = (value: string): string =>
  value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");

const htmlToText = (value: string): string => {
  if (!value.trim()) {
    return '';
  }

  return decodeHtmlEntities(
    value
      .replace(/<(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, '\n')
      .replace(/<(p|div|li|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const contentFromRow = (row: SpreadsheetRow): string => {
  const htmlValue = (row.Element_Text_HTML || '').trim();
  if (htmlValue) {
    return htmlToText(htmlValue);
  }
  return (row.Element_Text_Plain || '').trim();
};

const rowKind = (row: SpreadsheetRow): 'question' | 'option' | 'stimulus' | 'other' => {
  const displayLabel = (row.Element_type_displayLabel || '').trim().toLowerCase();
  const elementType = (row.element_type || '').trim().toLowerCase();

  if (displayLabel.includes('response option') || elementType.includes('_box_')) {
    return 'option';
  }
  if (displayLabel.includes('item question') || displayLabel.includes('question')) {
    return 'question';
  }
  if (displayLabel.includes('stimulus') || elementType.includes('stimulus')) {
    return 'stimulus';
  }
  return 'other';
};

const normalizeTextChunks = (values: string[]): string =>
  values
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n\n');

const orderedUnique = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter(value => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
};

const truthy = (value: string): boolean => ['1', 'true', 'yes', 'y', 'ja', 'correct', 'x'].includes(value.trim().toLowerCase());

const parseLetterKeys = (raw: string, optionCount: number): string[] =>
  orderedUnique((raw.toUpperCase().match(/[A-Z]/g) || []).filter(letter => letter.charCodeAt(0) - 65 < optionCount));

const findPresentColumn = (rows: SpreadsheetRow[], candidates: string[]): string | undefined => {
  const available = new Set(rows.flatMap(row => Object.keys(row)));
  return candidates.find(candidate => available.has(candidate));
};

const inferRowExportAnswer = (
  groupRows: SpreadsheetRow[],
  optionRows: SpreadsheetRow[],
  options: string[],
  answerColumn?: string
): string => {
  if (!answerColumn) {
    return '';
  }

  const optionLevelKeys: string[] = [];
  for (const [index, row] of optionRows.entries()) {
    const raw = (row[answerColumn] || '').trim();
    if (!raw) {
      continue;
    }
    const optionId = String.fromCharCode(65 + index);
    if (truthy(raw) || raw.toUpperCase() === optionId) {
      optionLevelKeys.push(optionId);
    }
  }
  if (optionLevelKeys.length > 0) {
    return orderedUnique(optionLevelKeys).join(',');
  }

  for (const row of groupRows) {
    const raw = (row[answerColumn] || '').trim();
    if (!raw) {
      continue;
    }
    const letters = parseLetterKeys(raw, options.length);
    if (letters.length > 0) {
      return letters.join(',');
    }
    const optionIndex = options.findIndex(option => option === raw);
    if (optionIndex >= 0) {
      return String.fromCharCode(65 + optionIndex);
    }
    return raw;
  }

  return '';
};

const inferRowExportQuestions = (spreadsheet: SpreadsheetData): StructuredQuestion[] | null => {
  const hasRequiredColumns = ROW_EXPORT_REQUIRED_COLUMNS.every(column => spreadsheet.columns.includes(column));
  if (!hasRequiredColumns) {
    return null;
  }

  const answerColumn = findPresentColumn(spreadsheet.rows, ANSWER_COLUMN_CANDIDATES);
  const groupedRows = new Map<string, SpreadsheetRow[]>();
  for (const row of spreadsheet.rows) {
    const itemLabel = (row.SE_ItemLabel || '').trim();
    if (!itemLabel) {
      continue;
    }
    const group = groupedRows.get(itemLabel);
    if (group) {
      group.push(row);
    } else {
      groupedRows.set(itemLabel, [row]);
    }
  }

  const questions: StructuredQuestion[] = [];
  for (const [itemLabel, groupRows] of groupedRows.entries()) {
    const questionRows = groupRows.filter(row => rowKind(row) === 'question');
    const optionRows = groupRows.filter(row => rowKind(row) === 'option');
    const stimulusRows = groupRows.filter(row => rowKind(row) === 'stimulus');

    const prompt = normalizeTextChunks(questionRows.map(contentFromRow));
    const options = optionRows.map(contentFromRow).filter(Boolean);
    const stimulusParts = stimulusRows
      .map(contentFromRow)
      .filter(text => text && text !== prompt);
    const stimulus = normalizeTextChunks(stimulusParts);

    if (!prompt && options.length === 0 && !stimulus) {
      continue;
    }

    const effectivePrompt = prompt || stimulus;
    const effectiveStimulus = prompt ? stimulus : '';
    if (!effectivePrompt) {
      continue;
    }

    questions.push({
      type: options.length > 0 ? 'multiple_choice' : 'extended_text',
      identifier: itemLabel,
      prompt: effectivePrompt,
      stimulus: effectiveStimulus || undefined,
      options:
        options.length > 0
          ? options.map((text, index) => ({
              id: String.fromCharCode(65 + index),
              text
            }))
          : undefined,
      correctResponse: options.length > 0 ? inferRowExportAnswer(groupRows, optionRows, options, answerColumn) : undefined,
      layout: effectiveStimulus ? 'auto' : 'single_column'
    });
  }

  return questions.length > 0 ? questions : null;
};

const inferQuestestInteropQuestions = (spreadsheet: SpreadsheetData): StructuredQuestion[] | null => {
  if (spreadsheet.format !== 'xml') {
    return null;
  }

  const hasRequiredColumns = QUESTESTINTEROP_REQUIRED_COLUMNS.every(column => spreadsheet.columns.includes(column));
  if (!hasRequiredColumns) {
    return null;
  }

  const questions = spreadsheet.rows
    .map<StructuredQuestion | null>(row => {
      const prompt = (row.prompt || '').trim();
      if (!prompt) {
        return null;
      }

      let options: Array<{ id: string; text: string; feedback?: string }> = [];
      const rawOptions = (row.optionsJson || '').trim();
      if (rawOptions) {
        try {
          const parsed = JSON.parse(rawOptions);
          if (Array.isArray(parsed)) {
            options = parsed
              .map(option => ({
                id: String(option?.id || '').trim(),
                text: String(option?.text || '').trim(),
                feedback: String(option?.feedback || '').trim() || undefined
              }))
              .filter(option => option.id && option.text);
          }
        } catch {
          options = [];
        }
      }

      return {
        type:
          row.questionType === 'short_text'
            ? 'short_text'
            : row.questionType === 'extended_text'
              ? 'extended_text'
              : 'multiple_choice',
        identifier: (row.identifier || '').trim() || undefined,
        title: (row.title || '').trim() || undefined,
        prompt,
        generalFeedback: (row.generalFeedback || '').trim() || undefined,
        options: options.length > 0 ? options : undefined,
        correctResponse: (row.correctResponse || '').trim() || undefined,
        expectedLength: Number.parseInt((row.expectedLength || '').trim(), 10) || undefined,
        selectionMode: (row.selectionMode || '').trim() === 'multiple' ? 'multiple' : 'single',
        layout: 'single_column' as const
      };
    })
    .filter((question): question is StructuredQuestion => question !== null);

  return questions.length > 0 ? questions : null;
};

const inferQuestionsDeterministically = (spreadsheet: SpreadsheetData): StructuredQuestion[] | null => {
  const questestInteropQuestions = inferQuestestInteropQuestions(spreadsheet);
  if (questestInteropQuestions) {
    return questestInteropQuestions;
  }

  const rowExportQuestions = inferRowExportQuestions(spreadsheet);
  if (rowExportQuestions) {
    return rowExportQuestions;
  }

  const normalizedColumns = new Map(spreadsheet.columns.map(column => [normalizeColumnName(column), column]));
  const textColumn = normalizedColumns.get('text');
  const answerColumn = normalizedColumns.get('answer');
  const optionColumns = ['a', 'b', 'c', 'd', 'e']
    .map(key => normalizedColumns.get(key))
    .filter((value): value is string => Boolean(value));

  if (!textColumn) {
    return null;
  }

  if (optionColumns.length >= 2 && answerColumn) {
    return spreadsheet.rows.map((row, index) => {
      const prompt = (row[textColumn] || '').trim();
      const answerValue = (row[answerColumn] || '').trim();
      const answerTokens = answerValue
        .split(/[;,|/]+/)
        .map(token => token.trim().toLowerCase())
        .filter(Boolean);

      return {
        type: 'multiple_choice',
        identifier: `item-${index + 1}`,
        prompt,
        correctResponse: answerValue,
        options: optionColumns
          .map((columnName, optionIndex) => {
            const optionId = String.fromCharCode(65 + optionIndex);
            const text = (row[columnName] || '').trim();
            const isCorrectAnswer =
              answerTokens.includes(optionId.toLowerCase()) || answerTokens.includes(text.toLowerCase());
            return {
              id: optionId,
              text,
              isCorrectAnswer
            };
          })
          .filter(option => option.text)
      };
    });
  }

  if (answerColumn && optionColumns.length === 0) {
    return spreadsheet.rows.map((row, index) => ({
      type: 'extended_text',
      identifier: `item-${index + 1}`,
      prompt: (row[textColumn] || '').trim(),
      correctResponse: (row[answerColumn] || '').trim()
    }));
  }

  return null;
};

const QUESTION_COLUMN_HINTS = [
  'question',
  'prompt',
  'stem',
  'text',
  'item',
  'vraag',
  'vraagtekst',
  'title'
];
const ANSWER_COLUMN_HINTS = ['answer', 'correct', 'key', 'response', 'solution', 'antwoord'];
const OPTION_COLUMN_HINTS = ['option', 'choice', 'answer a', 'answer b', 'answer c', 'answer d', 'answer e'];
const SINGLE_LETTER_OPTION_COLUMNS = new Set(['a', 'b', 'c', 'd', 'e', 'f']);

const countFilledTextCells = (row: SpreadsheetRow): number =>
  Object.values(row).filter(value => {
    const trimmed = String(value || '').trim();
    return trimmed.length >= 2 && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmed);
  }).length;

const hasQuestionLikeValue = (row: SpreadsheetRow): boolean =>
  Object.values(row).some(value => {
    const trimmed = String(value || '').trim();
    if (trimmed.length < 8) {
      return false;
    }
    return (
      /\?$/.test(trimmed) ||
      /^((question|vraag)\s*)?\d{1,3}[.):-]\s+\S+/i.test(trimmed) ||
      trimmed.split(/\s+/).length >= 4
    );
  });

const hasOptionLikeSpread = (row: SpreadsheetRow): boolean => countFilledTextCells(row) >= 3;

const assessSpreadsheetProcessability = (
  spreadsheet: SpreadsheetData
): { processable: true } | { processable: false; reason: string } => {
  if (spreadsheet.rows.length === 0) {
    return {
      processable: false,
      reason: 'The spreadsheet is empty.'
    };
  }

  const normalizedColumns = spreadsheet.columns.map(normalizeColumnName);
  const hasQuestionColumn = normalizedColumns.some(
    column => QUESTION_COLUMN_HINTS.some(hint => column.includes(hint)) || SINGLE_LETTER_OPTION_COLUMNS.has(column)
  );
  const hasAnswerColumn = normalizedColumns.some(column => ANSWER_COLUMN_HINTS.some(hint => column.includes(hint)));
  const optionLikeColumnCount = normalizedColumns.filter(
    column => OPTION_COLUMN_HINTS.some(hint => column.includes(hint)) || SINGLE_LETTER_OPTION_COLUMNS.has(column)
  ).length;

  if ((hasQuestionColumn && hasAnswerColumn) || (hasQuestionColumn && optionLikeColumnCount >= 2)) {
    return { processable: true };
  }

  const sampleRows = spreadsheet.rows.slice(0, 50);
  const rowsWithQuestionLikeValue = sampleRows.filter(hasQuestionLikeValue).length;
  const rowsWithOptionLikeSpread = sampleRows.filter(hasOptionLikeSpread).length;
  const rowsWithEnoughText = sampleRows.filter(row => countFilledTextCells(row) >= 2).length;

  if (
    (rowsWithQuestionLikeValue >= 2 && rowsWithEnoughText >= 2) ||
    (rowsWithQuestionLikeValue >= 1 && rowsWithOptionLikeSpread >= 2)
  ) {
    return { processable: true };
  }

  return {
    processable: false,
    reason: 'The spreadsheet does not appear to contain question-like rows or answer columns that can be converted to QTI.'
  };
};

export async function convertSpreadsheetToQtiPackage(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  options?: ConvertSpreadsheetToQtiOptions
): Promise<SpreadsheetToQtiResult>;

export async function convertSpreadsheetToQtiPackage(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  inferQuestions: QuestionInferenceFunction,
  options?: ConvertSpreadsheetToQtiOptions
): Promise<SpreadsheetToQtiResult>;

export async function convertSpreadsheetToQtiPackage(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  inferQuestionsOrOptions?: QuestionInferenceFunction | ConvertSpreadsheetToQtiOptions,
  maybeOptions: ConvertSpreadsheetToQtiOptions = {}
): Promise<SpreadsheetToQtiResult> {
  const inferQuestions = isQuestionInferenceFunction(inferQuestionsOrOptions)
    ? inferQuestionsOrOptions
    : createWebLlmQuestionInfererFromSettings((inferQuestionsOrOptions || maybeOptions || {}).llmSettings);
  const options = (isQuestionInferenceFunction(inferQuestionsOrOptions) ? maybeOptions : inferQuestionsOrOptions) || {};

  options.onProgress?.({
    stage: 'parse_started',
    message: 'Parsing spreadsheet input.'
  });
  const spreadsheet = await parseSpreadsheet(input, options);
  options.onProgress?.({
    stage: 'parse_completed',
    message: `Parsed ${spreadsheet.rows.length} row${spreadsheet.rows.length === 1 ? '' : 's'}.`,
    data: {
      rowCount: spreadsheet.rows.length,
      columns: spreadsheet.columns
    }
  });
  const preview = buildDatasetPreview(spreadsheet);
  options.onProgress?.({
    stage: 'mapping_started',
    message: 'Inferring structured questions from parsed spreadsheet JSON.'
  });
  const deterministicQuestions = inferQuestionsDeterministically(spreadsheet);
  if (!deterministicQuestions) {
    const processability = assessSpreadsheetProcessability(spreadsheet);
    if (processability.processable === false) {
      const { reason } = processability;
      options.onProgress?.({
        stage: 'mapping_completed',
        message: reason,
        data: {
          processable: false
        }
      });

      return {
        spreadsheet,
        preview,
        processable: false,
        reason,
        questions: [],
        summary: emptySummary()
      };
    }
  }
  const questions = deterministicQuestions
    ? deterministicQuestions
    : await inferQuestions(spreadsheet, {
        reportProgress: options.onProgress
      });
  options.onProgress?.({
    stage: 'mapping_completed',
    message: `${deterministicQuestions ? 'Resolved deterministic mapping for' : 'Resolved'} ${questions.length} structured question${questions.length === 1 ? '' : 's'}.`,
    data: questions
  });
  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(questions, options);

  return {
    spreadsheet,
    preview,
    processable: true,
    questions,
    packageBlob: blob,
    packageName,
    summary
  };
}
