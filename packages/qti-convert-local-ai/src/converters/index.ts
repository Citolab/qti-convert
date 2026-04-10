import type { ConversionResult, DocumentFormat } from './handler';
import { getConverter, registerConverter, type DocumentConverter } from './handler';
import { docxConverter } from './docx';
import { googleFormConverter } from './google-form';
import { microsoftFormConverter } from './microsoft-form';
import { pdfConverter } from './pdf';
import { spreadsheetConverter, xlsxConverter } from './spreadsheet';
import type { GenerateQtiPackageOptions } from '../types';

export * from './handler';
export * from './docx';
export * from './pdf';
export * from './spreadsheet';
export * from './google-form';
export * from './microsoft-form';
export * from './remote-source';

export function registerBuiltInConverters(): void {
  registerBuiltInConverter('pdf', pdfConverter);
  registerBuiltInConverter('docx', docxConverter);
  registerBuiltInConverter('csv', spreadsheetConverter);
  registerBuiltInConverter('xlsx', xlsxConverter);
  registerBuiltInConverter('google-form', googleFormConverter);
  registerBuiltInConverter('microsoft-form', microsoftFormConverter);
}

const registerBuiltInConverter = (format: DocumentFormat, converter: DocumentConverter<unknown>): void => {
  if (getConverter(format) !== converter) {
    registerConverter(format, converter);
  }
};

const detectDocumentFormat = (input: File | Blob | ArrayBuffer | Uint8Array | string): DocumentFormat | undefined => {
  if (typeof input === 'string') {
    if (input.includes('docs.google.com/forms') || input.includes('forms.gle')) {
      return 'google-form';
    }
    if (input.includes('forms.office.com') || input.includes('forms.microsoft.com')) {
      return 'microsoft-form';
    }
    return undefined;
  }

  if ('name' in input && typeof (input as File).name === 'string') {
    const fileName = (input as File).name.toLowerCase();
    if (fileName.endsWith('.pdf')) return 'pdf';
    if (fileName.endsWith('.docx')) return 'docx';
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) return 'xlsx';
    if (fileName.endsWith('.csv')) return 'csv';
  }

  return undefined;
};

export async function convertDocument(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  options?: GenerateQtiPackageOptions
): Promise<ConversionResult> {
  registerBuiltInConverters();

  const format = detectDocumentFormat(input);
  if (!format) {
    throw new Error('Could not detect document format. Please use a specific converter.');
  }

  const converter = getConverter(format);
  if (!converter) {
    throw new Error(`No converter available for format: ${format}`);
  }

  return converter.convert(input, options);
}
