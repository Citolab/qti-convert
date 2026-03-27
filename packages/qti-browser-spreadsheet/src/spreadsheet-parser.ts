import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { DatasetPreview, SpreadsheetData, SpreadsheetFormat, SpreadsheetRow } from './types';

const EMPTY_CELL = '';

type SpreadsheetInput = File | Blob | ArrayBuffer | Uint8Array | string;

export type ParseSpreadsheetOptions = {
  format?: SpreadsheetFormat;
  fileName?: string;
  sheetName?: string;
};

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
  }
  if (typeof input === 'string') {
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

const parseWorkbook = (buffer: ArrayBuffer, sheetName?: string): SpreadsheetData => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const targetSheetName = sheetName || workbook.SheetNames[0];
  if (!targetSheetName) {
    throw new Error('Workbook does not contain any sheets.');
  }
  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" was not found.`);
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: EMPTY_CELL,
    raw: false
  });
  const headerRow = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
    header: 1,
    raw: false,
    blankrows: false
  })[0];
  const columns = (headerRow || []).map(value => normalizeCellValue(value)).filter(Boolean);
  const rows = normalizeRows(rawRows, columns);
  return {
    columns: columns.length > 0 ? columns : normalizeColumns(rows),
    rows,
    format: 'xlsx',
    sheetName: targetSheetName
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

  const buffer = await toArrayBuffer(input);
  return {
    ...parseWorkbook(buffer, options.sheetName),
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
