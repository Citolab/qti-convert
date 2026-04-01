import * as Papa from 'papaparse';
import { Buffer as BrowserBuffer } from 'buffer';
import ExcelJS from 'exceljs';
import { DatasetPreview, SpreadsheetData, SpreadsheetFormat, SpreadsheetRow } from './types';

const EMPTY_CELL = '';

type SpreadsheetInput = File | Blob | ArrayBuffer | Uint8Array | string;

export type ParseSpreadsheetOptions = {
  format?: SpreadsheetFormat;
  fileName?: string;
  sheetName?: string;
};

const QUESTESTINTEROP_COLUMNS = [
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

const toArrayBuffer = async (input: SpreadsheetInput): Promise<ArrayBuffer> => {
  if (typeof input === 'string') {
    return new Uint8Array(new TextEncoder().encode(input)).buffer.slice(0) as ArrayBuffer;
  }
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (input instanceof Uint8Array) {
    return new Uint8Array(input).buffer.slice(0) as ArrayBuffer;
  }
  return (await input.arrayBuffer()) as ArrayBuffer;
};

const getInputFileName = (input: SpreadsheetInput, fallback?: string): string | undefined => {
  if (fallback) {
    return fallback;
  }
  if (typeof File !== 'undefined' && input instanceof File) {
    return input.name;
  }
  return undefined;
};

const detectFormat = (input: SpreadsheetInput, explicitFormat?: SpreadsheetFormat): SpreadsheetFormat => {
  if (explicitFormat) {
    return explicitFormat;
  }
  const fileName = getInputFileName(input);
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.csv')) {
      return 'csv';
    }
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      return 'xlsx';
    }
    if (lowerName.endsWith('.xml')) {
      return 'xml';
    }
  }
  if (typeof input === 'string') {
    if (input.trim().startsWith('<')) {
      return 'xml';
    }
    return 'csv';
  }
  return 'xlsx';
};

const normalizeCellValue = (value: unknown): string => {
  if (value == null) {
    return EMPTY_CELL;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
};

const normalizeColumns = (rows: SpreadsheetRow[]): string[] => {
  const orderedColumns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        orderedColumns.push(key);
      }
    }
  }
  return orderedColumns;
};

const normalizeRows = (rawRows: Record<string, unknown>[], columns?: string[]): SpreadsheetRow[] => {
  const headerOrder = columns && columns.length > 0 ? columns : normalizeColumns(rawRows as SpreadsheetRow[]);
  return rawRows
    .map(rawRow => {
      const row: SpreadsheetRow = {};
      for (const column of headerOrder) {
        row[column] = normalizeCellValue(rawRow[column]);
      }
      for (const [key, value] of Object.entries(rawRow)) {
        if (!(key in row)) {
          row[key] = normalizeCellValue(value);
        }
      }
      return row;
    })
    .filter(row => Object.values(row).some(value => value !== EMPTY_CELL));
};

const parseCsv = (csvText: string): SpreadsheetData => {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: value => value.trim()
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => error.message).join('; '));
  }

  const rows = normalizeRows(parsed.data);
  const columns = normalizeColumns(rows);
  return {
    columns,
    rows: normalizeRows(rows, columns),
    format: 'csv'
  };
};

const ensureBufferCompatibility = (): void => {
  if (typeof globalThis.Buffer === 'undefined') {
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      writable: true,
      value: BrowserBuffer
    });
    return;
  }

  if (typeof globalThis.Buffer.isBuffer !== 'function') {
    Object.defineProperty(globalThis.Buffer, 'isBuffer', {
      configurable: true,
      writable: true,
      value: () => false
    });
  }
};

const parseWorkbook = async (buffer: ArrayBuffer, sheetName?: string): Promise<SpreadsheetData> => {
  const workbook = new ExcelJS.Workbook();
  ensureBufferCompatibility();
  await workbook.xlsx.load(BrowserBuffer.from(buffer) as never);

  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(sheetName ? `Sheet "${sheetName}" was not found.` : 'Workbook does not contain any sheets.');
  }

  const targetSheetName = worksheet.name;
  let columns: string[] = [];
  const rawRows: Record<string, unknown>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      const headerValues = row.values as ExcelJS.CellValue[];
      columns = headerValues.slice(1).map(value => normalizeCellValue(value));
    } else {
      const rowData: Record<string, unknown> = {};
      columns.forEach((col, index) => {
        rowData[col] = row.getCell(index + 1).text ?? EMPTY_CELL;
      });
      rawRows.push(rowData);
    }
  });

  const rows = normalizeRows(rawRows, columns);
  return {
    columns: columns.length > 0 ? columns : normalizeColumns(rows),
    rows,
    format: 'xlsx',
    sheetName: targetSheetName
  };
};

const parseXml = (xmlText: string): Document => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment.');
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, 'text/xml');
  const parseError = document.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(parseError.textContent || 'Invalid XML input.');
  }
  return document;
};

type XmlElementContainer = Document | Element;

const directChildElements = (parent: Element, localName: string): Element[] =>
  Array.from(parent.children).filter(child => child.localName?.toLowerCase() === localName.toLowerCase());

const firstDescendant = (parent: XmlElementContainer, localName: string): Element | null =>
  Array.from(parent.getElementsByTagName(localName))[0] || null;

const textContent = (element: Element | null | undefined): string => (element?.textContent || '').trim();

const normalizeQuestestText = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const isQuestestInteropRow = (
  row: SpreadsheetRow | null
): row is SpreadsheetRow & {
  identifier: string;
  title: string;
  prompt: string;
  generalFeedback: string;
  questionType: string;
  selectionMode: string;
  correctResponse: string;
  optionsJson: string;
  expectedLength: string;
} => Boolean(row);

const isNonNullRow = (
  row: SpreadsheetRow | null
): row is SpreadsheetRow & Record<string, string> => Boolean(row);

const uniqueNonEmpty = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter(value => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const extractItemPrompt = (item: Element): string => {
  const presentation = firstDescendant(item, 'presentation');
  const questionMaterial =
    presentation &&
    directChildElements(presentation, 'flow')
      .flatMap(flow => directChildElements(flow, 'material'))
      .map(material => firstDescendant(material, 'mattext'))
      .find(Boolean);
  return normalizeQuestestText(textContent(questionMaterial));
};

const extractItemCorrectResponses = (item: Element): string[] =>
  uniqueNonEmpty(
    Array.from(item.getElementsByTagName('respcondition')).map(condition => {
      const score = Number.parseFloat(textContent(firstDescendant(condition, 'setvar')));
      if (score !== 100) {
        return '';
      }
      return textContent(firstDescendant(condition, 'varequal'));
    })
  );

const extractChoiceOptions = (item: Element): Array<{ id: string; text: string }> => {
  const responseLid = firstDescendant(item, 'response_lid');
  const renderChoice = responseLid ? firstDescendant(responseLid, 'render_choice') : null;
  return (renderChoice ? directChildElements(renderChoice, 'flow_label') : [])
    .map(flowLabel => {
      const responseLabel = firstDescendant(flowLabel, 'response_label');
      const choiceMaterial = responseLabel
        ? directChildElements(responseLabel, 'flow_mat')
            .flatMap(flowMat => directChildElements(flowMat, 'material'))
            .map(material => firstDescendant(material, 'mattext'))
            .find(Boolean)
        : null;
      const choiceText = normalizeQuestestText(textContent(choiceMaterial));

      return {
        id: (responseLabel?.getAttribute('ident') || '').trim(),
        text: choiceText
      };
    })
    .filter(choice => choice.id && choice.text);
};

const extractMoodleQuestionTitle = (question: Element, fallback: string): string =>
  textContent(firstDescendant(firstDescendant(question, 'name') || question, 'text')) || fallback;

const extractMoodleQuestionPrompt = (question: Element): string =>
  normalizeQuestestText(textContent(firstDescendant(firstDescendant(question, 'questiontext') || question, 'text')));

const extractMoodleAnswers = (question: Element): Array<{ text: string; fraction: number; tolerance: string }> =>
  directChildElements(question, 'answer')
    .map(answer => ({
      text: normalizeQuestestText(textContent(firstDescendant(answer, 'text'))),
      fraction: Number.parseFloat((answer.getAttribute('fraction') || '').trim() || '0'),
      tolerance: normalizeQuestestText(textContent(firstDescendant(answer, 'tolerance')))
    }))
    .filter(answer => answer.text);

const parseMoodleQuiz = (xmlText: string): SpreadsheetData => {
  const document = parseXml(xmlText);
  const rootName = document.documentElement.localName?.toLowerCase();
  if (rootName !== 'quiz') {
    throw new Error('Unsupported XML format. Expected a Moodle quiz export.');
  }

  let multichoiceIndex = 0;
  const rows: SpreadsheetRow[] = Array.from(document.getElementsByTagName('question'))
    .map(question => {
      const type = (question.getAttribute('type') || '').trim().toLowerCase();
      if (!['multichoice', 'truefalse', 'shortanswer', 'numerical'].includes(type)) {
        return null;
      }

      multichoiceIndex += 1;
      const title = extractMoodleQuestionTitle(question, `Moodle question ${multichoiceIndex}`);
      const prompt = extractMoodleQuestionPrompt(question);
      const generalFeedback = normalizeQuestestText(
        textContent(firstDescendant(firstDescendant(question, 'generalfeedback') || question, 'text'))
      );
      if (!prompt) {
        return null;
      }

      const answers = extractMoodleAnswers(question);
      if (answers.length === 0) {
        return null;
      }

      if (type === 'shortanswer' || type === 'numerical') {
        const bestAnswer = [...answers].sort((left, right) => right.fraction - left.fraction)[0];
        if (!bestAnswer || bestAnswer.fraction <= 0) {
          return null;
        }

        return {
          identifier: `moodle-item-${multichoiceIndex}`,
          title,
          prompt,
          generalFeedback,
          questionType: 'short_text',
          selectionMode: 'single',
          correctResponse: bestAnswer.text,
          optionsJson: '[]',
          expectedLength: String(bestAnswer.text.length || '')
        };
      }

      const choiceOptions = answers.map((answer, index) => ({
        id: String.fromCharCode(65 + index),
        text: answer.text,
        fraction: answer.fraction
      }));

      const correctResponse = choiceOptions.filter(answer => answer.fraction > 0).map(answer => answer.id).join(',');

      return {
        identifier: `moodle-item-${multichoiceIndex}`,
        title,
        prompt,
        generalFeedback,
        questionType: 'multiple_choice',
        selectionMode: correctResponse.includes(',') ? 'multiple' : 'single',
        correctResponse,
        optionsJson: JSON.stringify(
          directChildElements(question, 'answer')
            .map((answer, index) => ({
              id: String.fromCharCode(65 + index),
              text: normalizeQuestestText(textContent(firstDescendant(answer, 'text'))),
              feedback: normalizeQuestestText(textContent(firstDescendant(firstDescendant(answer, 'feedback') || answer, 'text'))),
              fraction: Number.parseFloat((answer.getAttribute('fraction') || '').trim() || '0')
            }))
            .filter(answer => answer.text)
            .map(({ id, text, feedback }) => ({ id, text, feedback }))
        ),
        expectedLength: ''
      };
    })
    .filter(isNonNullRow);

  return {
    columns: [...QUESTESTINTEROP_COLUMNS],
    rows,
    format: 'xml'
  };
};

const parseQuestestInterop = (xmlText: string): SpreadsheetData => {
  const document = parseXml(xmlText);
  const rootName = document.documentElement.localName?.toLowerCase();
  if (rootName === 'quiz') {
    return parseMoodleQuiz(xmlText);
  }
  if (rootName !== 'questestinterop') {
    throw new Error('Unsupported XML format. Expected a QuestestInterop/Brightspace or Moodle quiz export.');
  }

  const rows: SpreadsheetRow[] = Array.from(document.getElementsByTagName('item'))
    .map(item => {
      const identifier = (item.getAttribute('ident') || '').trim();
      if (!identifier) {
        return null;
      }

      const title = (item.getAttribute('label') || '').trim();
      const prompt = extractItemPrompt(item);
      const correctResponses = extractItemCorrectResponses(item);
      const responseLid = firstDescendant(item, 'response_lid');
      const responseStr = firstDescendant(item, 'response_str');
      const choices = extractChoiceOptions(item);
      const selectionMode =
        (responseLid?.getAttribute('rcardinality') || '').trim().toLowerCase() === 'multiple' ? 'multiple' : 'single';
      const renderFib = responseStr ? firstDescendant(responseStr, 'render_fib') : null;
      const fibRows = Number.parseInt((renderFib?.getAttribute('rows') || '').trim(), 10);
      const fibMaxChars = Number.parseInt((renderFib?.getAttribute('maxchars') || '').trim(), 10);
      const fibColumns = Number.parseInt((renderFib?.getAttribute('columns') || '').trim(), 10);
      const isEssayLike = Number.isFinite(fibRows) && fibRows > 1;
      const expectedLength = Number.isFinite(fibMaxChars) && fibMaxChars > 0 ? fibMaxChars : Number.isFinite(fibColumns) && fibColumns > 0 ? fibColumns : '';
      const questionType = responseLid ? 'multiple_choice' : responseStr ? (isEssayLike || correctResponses.length === 0 ? 'extended_text' : 'short_text') : 'extended_text';

      return {
        identifier,
        title,
        prompt,
        generalFeedback: '',
        questionType,
        selectionMode,
        correctResponse: correctResponses.join(','),
        optionsJson: JSON.stringify(choices)
        ,
        expectedLength: String(expectedLength || '')
      };
    })
    .filter(isQuestestInteropRow);

  return {
    columns: [...QUESTESTINTEROP_COLUMNS],
    rows,
    format: 'xml'
  };
};

export const parseSpreadsheet = async (
  input: SpreadsheetInput,
  options: ParseSpreadsheetOptions = {}
): Promise<SpreadsheetData> => {
  const format = detectFormat(input, options.format);
  const fileName = getInputFileName(input, options.fileName);

  if (format === 'csv') {
    const buffer = await toArrayBuffer(input);
    const text = new TextDecoder().decode(buffer);
    return {
      ...parseCsv(text),
      fileName
    };
  }

  if (format === 'xml') {
    const buffer = await toArrayBuffer(input);
    const text = new TextDecoder().decode(buffer);
    return {
      ...parseQuestestInterop(text),
      fileName
    };
  }

  const buffer = await toArrayBuffer(input);
  return {
    ...await parseWorkbook(buffer, options.sheetName),
    fileName
  };
};

export const buildDatasetPreview = (spreadsheet: SpreadsheetData, sampleSize = 5): DatasetPreview => ({
  columns: [...spreadsheet.columns],
  sampleRows: spreadsheet.rows.slice(0, Math.max(sampleSize, 0)).map(row => ({ ...row })),
  rowCount: spreadsheet.rows.length,
  fileName: spreadsheet.fileName,
  sheetName: spreadsheet.sheetName
});
