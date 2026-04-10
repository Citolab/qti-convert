import type { DocumentConverter } from '../handler';
import type { DatasetPreview, GenerateQtiPackageOptions, SpreadsheetData, SpreadsheetToQtiResult, StructuredQuestion } from '../../types';
import type { SpreadsheetInput } from '../../utils/file-input';
import { buildDatasetPreview, parseSpreadsheet } from './parser';
import { convertSpreadsheetToQtiPackage } from './convert';

export const spreadsheetConverter: DocumentConverter<SpreadsheetInput, SpreadsheetData, DatasetPreview, SpreadsheetToQtiResult> = {
  name: 'Spreadsheet Converter',
  format: 'csv',
  supportedExtensions: ['csv', 'xlsx', 'xls'],

  async parse(input: SpreadsheetInput): Promise<SpreadsheetData> {
    return parseSpreadsheet(input);
  },

  buildPreview(document: SpreadsheetData): DatasetPreview {
    return buildDatasetPreview(document);
  },

  async extractQuestions(_document: SpreadsheetData, _options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]> {
    throw new Error('Spreadsheet extractQuestions requires raw input. Use convert() instead.');
  },

  async convert(input: SpreadsheetInput, options?: GenerateQtiPackageOptions): Promise<SpreadsheetToQtiResult> {
    return convertSpreadsheetToQtiPackage(input, options);
  }
};

export const xlsxConverter: DocumentConverter<SpreadsheetInput, SpreadsheetData, DatasetPreview, SpreadsheetToQtiResult> = {
  ...spreadsheetConverter,
  name: 'Excel Converter',
  format: 'xlsx',
  supportedExtensions: ['xlsx', 'xls']
};
