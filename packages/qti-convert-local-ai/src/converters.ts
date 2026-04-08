/**
 * Converter Implementations
 *
 * Concrete implementations of the DocumentConverter interface for each document type.
 * These wrap the existing parsing/conversion functions while providing a consistent API.
 */

import type {
  DocumentConverter,
  DocumentData,
  DocumentPreview,
  ConversionResult,
  DocumentFormat
} from './converter-interface';
import { registerConverter } from './converter-interface';
import type { GenerateQtiPackageOptions, StructuredQuestion, ConversionSummary } from './types';

// PDF Converter
import {
  parsePdf,
  buildPdfPreview,
  convertPdfToQtiPackage,
  type PdfDocumentData,
  type PdfPreview,
  type PdfToQtiResult
} from './pdf-parser';

// DOCX Converter
import {
  parseDocx,
  buildDocxPreview,
  convertDocxToQtiPackage,
  type DocxDocumentData,
  type DocxPreview,
  type DocxToQtiResult
} from './docx-parser';

// Spreadsheet Converter
import { parseSpreadsheet, buildDatasetPreview } from './spreadsheet-parser';
import { convertSpreadsheetToQtiPackage } from './convert-spreadsheet';
import type { SpreadsheetData, DatasetPreview, SpreadsheetToQtiResult } from './types';

// Google Forms Converter
import { convertGoogleFormToQtiPackage, type ConvertGoogleFormToQtiOptions } from './google-form';

// Microsoft Forms Converter
import { convertMicrosoftFormToQtiPackage, type ConvertMicrosoftFormToQtiOptions } from './microsoft-form';

// ---------------------------------------------------------------------------
// PDF Converter Implementation
// ---------------------------------------------------------------------------

type PdfInput = File | Blob | ArrayBuffer | Uint8Array;

/**
 * PDF Document Converter
 *
 * Converts PDF files containing assessment items into QTI packages.
 * Uses local LLM for segmentation and normalization with batch processing.
 */
export const pdfConverter: DocumentConverter<PdfInput, PdfDocumentData, PdfPreview, PdfToQtiResult> = {
  name: 'PDF Converter',
  format: 'pdf',
  supportedExtensions: ['pdf'],

  async parse(input: PdfInput): Promise<PdfDocumentData> {
    return parsePdf(input);
  },

  buildPreview(document: PdfDocumentData): PdfPreview {
    return buildPdfPreview(document);
  },

  async extractQuestions(
    document: PdfDocumentData,
    options?: GenerateQtiPackageOptions
  ): Promise<StructuredQuestion[]> {
    // For PDF, the full conversion includes question extraction
    // We'd need to refactor pdf-parser to expose this separately
    // For now, this throws as it requires the full pipeline
    throw new Error('PDF extractQuestions requires the full conversion pipeline. Use convert() instead.');
  },

  async convert(input: PdfInput, options?: GenerateQtiPackageOptions): Promise<PdfToQtiResult> {
    return convertPdfToQtiPackage(input, options);
  }
};

// ---------------------------------------------------------------------------
// DOCX Converter Implementation
// ---------------------------------------------------------------------------

type DocxInput = File | Blob | ArrayBuffer | Uint8Array;

/**
 * DOCX Document Converter
 *
 * Converts Word documents containing assessment items into QTI packages.
 * Uses local LLM for segmentation and normalization with batch processing.
 */
export const docxConverter: DocumentConverter<DocxInput, DocxDocumentData, DocxPreview, DocxToQtiResult> = {
  name: 'DOCX Converter',
  format: 'docx',
  supportedExtensions: ['docx'],

  async parse(input: DocxInput): Promise<DocxDocumentData> {
    return parseDocx(input);
  },

  buildPreview(document: DocxDocumentData): DocxPreview {
    return buildDocxPreview(document);
  },

  async extractQuestions(
    document: DocxDocumentData,
    options?: GenerateQtiPackageOptions
  ): Promise<StructuredQuestion[]> {
    // For DOCX, the full conversion includes question extraction
    // We'd need to refactor docx-parser to expose this separately
    throw new Error('DOCX extractQuestions requires the full conversion pipeline. Use convert() instead.');
  },

  async convert(input: DocxInput, options?: GenerateQtiPackageOptions): Promise<DocxToQtiResult> {
    return convertDocxToQtiPackage(input, options);
  }
};

// ---------------------------------------------------------------------------
// Spreadsheet Converter Implementation
// ---------------------------------------------------------------------------

type SpreadsheetInput = File | Blob | ArrayBuffer | Uint8Array | string;

interface SpreadsheetDocumentData extends DocumentData {
  columns: string[];
  rows: Record<string, string>[];
  format: 'csv' | 'xlsx' | 'xml';
  sheetName?: string;
}

interface SpreadsheetPreview extends DocumentPreview {
  columns: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  sheetName?: string;
}

/**
 * Spreadsheet Converter
 *
 * Converts CSV and Excel files containing assessment items into QTI packages.
 * Uses deterministic column mapping with optional LLM assistance.
 */
export const spreadsheetConverter: DocumentConverter<
  SpreadsheetInput,
  SpreadsheetData,
  DatasetPreview,
  SpreadsheetToQtiResult
> = {
  name: 'Spreadsheet Converter',
  format: 'csv',
  supportedExtensions: ['csv', 'xlsx', 'xls'],

  async parse(input: SpreadsheetInput): Promise<SpreadsheetData> {
    return parseSpreadsheet(input);
  },

  buildPreview(document: SpreadsheetData): DatasetPreview {
    return buildDatasetPreview(document);
  },

  async extractQuestions(
    document: SpreadsheetData,
    options?: GenerateQtiPackageOptions
  ): Promise<StructuredQuestion[]> {
    // For spreadsheets, we need to use the raw input for full conversion
    throw new Error('Spreadsheet extractQuestions requires raw input. Use convert() instead.');
  },

  async convert(input: SpreadsheetInput, options?: GenerateQtiPackageOptions): Promise<SpreadsheetToQtiResult> {
    return convertSpreadsheetToQtiPackage(input, options);
  }
};

/**
 * Excel Converter (alias for spreadsheet with xlsx format focus)
 */
export const xlsxConverter: DocumentConverter<
  SpreadsheetInput,
  SpreadsheetData,
  DatasetPreview,
  SpreadsheetToQtiResult
> = {
  ...spreadsheetConverter,
  name: 'Excel Converter',
  format: 'xlsx',
  supportedExtensions: ['xlsx', 'xls']
};

// ---------------------------------------------------------------------------
// Google Forms Converter Implementation
// ---------------------------------------------------------------------------

type GoogleFormInput = string; // URL or HTML content

interface GoogleFormDocumentData extends DocumentData {
  title?: string;
  description?: string;
  questionCount: number;
}

interface GoogleFormPreview extends DocumentPreview {
  title?: string;
  description?: string;
  questionCount: number;
}

interface GoogleFormResult extends ConversionResult {
  formTitle?: string;
  formDescription?: string;
}

/**
 * Google Forms Converter
 *
 * Converts Google Forms URLs or HTML content into QTI packages.
 * Uses deterministic parsing of the FB_PUBLIC_LOAD_DATA_ payload.
 */
export const googleFormConverter: DocumentConverter<
  GoogleFormInput,
  GoogleFormDocumentData,
  GoogleFormPreview,
  GoogleFormResult
> = {
  name: 'Google Forms Converter',
  format: 'google-form',
  supportedExtensions: [], // URL-based, no file extension

  async parse(input: GoogleFormInput): Promise<GoogleFormDocumentData> {
    // Google Forms parsing is embedded in the conversion
    // Return minimal document data
    return {
      title: undefined,
      description: undefined,
      questionCount: 0,
      fileName: input.startsWith('http') ? new URL(input).hostname : undefined
    };
  },

  buildPreview(document: GoogleFormDocumentData): GoogleFormPreview {
    return {
      title: document.title,
      description: document.description,
      questionCount: document.questionCount,
      estimatedItemCount: document.questionCount,
      sampleContent: document.title ? [document.title] : [],
      fileName: document.fileName
    };
  },

  async extractQuestions(
    document: GoogleFormDocumentData,
    options?: GenerateQtiPackageOptions
  ): Promise<StructuredQuestion[]> {
    throw new Error('Google Forms extractQuestions requires the URL. Use convert() instead.');
  },

  async convert(input: GoogleFormInput, options?: ConvertGoogleFormToQtiOptions): Promise<GoogleFormResult> {
    return convertGoogleFormToQtiPackage(input, options);
  }
};

// ---------------------------------------------------------------------------
// Microsoft Forms Converter Implementation
// ---------------------------------------------------------------------------

type MicrosoftFormInput = string; // URL or JSON content

interface MicrosoftFormDocumentData extends DocumentData {
  title?: string;
  description?: string;
  questionCount: number;
}

interface MicrosoftFormPreview extends DocumentPreview {
  title?: string;
  description?: string;
  questionCount: number;
}

interface MicrosoftFormResult extends ConversionResult {
  formTitle?: string;
  formDescription?: string;
}

/**
 * Microsoft Forms Converter
 *
 * Converts Microsoft Forms URLs or JSON content into QTI packages.
 * Uses deterministic parsing of the form JSON structure.
 */
export const microsoftFormConverter: DocumentConverter<
  MicrosoftFormInput,
  MicrosoftFormDocumentData,
  MicrosoftFormPreview,
  MicrosoftFormResult
> = {
  name: 'Microsoft Forms Converter',
  format: 'microsoft-form',
  supportedExtensions: [], // URL-based, no file extension

  async parse(input: MicrosoftFormInput): Promise<MicrosoftFormDocumentData> {
    // Microsoft Forms parsing is embedded in the conversion
    return {
      title: undefined,
      description: undefined,
      questionCount: 0,
      fileName: input.startsWith('http') ? new URL(input).hostname : undefined
    };
  },

  buildPreview(document: MicrosoftFormDocumentData): MicrosoftFormPreview {
    return {
      title: document.title,
      description: document.description,
      questionCount: document.questionCount,
      estimatedItemCount: document.questionCount,
      sampleContent: document.title ? [document.title] : [],
      fileName: document.fileName
    };
  },

  async extractQuestions(
    document: MicrosoftFormDocumentData,
    options?: GenerateQtiPackageOptions
  ): Promise<StructuredQuestion[]> {
    throw new Error('Microsoft Forms extractQuestions requires the URL. Use convert() instead.');
  },

  async convert(input: MicrosoftFormInput, options?: ConvertMicrosoftFormToQtiOptions): Promise<MicrosoftFormResult> {
    return convertMicrosoftFormToQtiPackage(input, options);
  }
};

// ---------------------------------------------------------------------------
// Factory Registration
// ---------------------------------------------------------------------------

/**
 * Register all built-in converters with the factory.
 * Call this function once at application startup to enable auto-detection.
 */
export function registerBuiltInConverters(): void {
  registerConverter('pdf', pdfConverter);
  registerConverter('docx', docxConverter);
  registerConverter('csv', spreadsheetConverter);
  registerConverter('xlsx', xlsxConverter);
  registerConverter('google-form', googleFormConverter);
  registerConverter('microsoft-form', microsoftFormConverter);
}

// ---------------------------------------------------------------------------
// Convenience Factory Function
// ---------------------------------------------------------------------------

/**
 * Convert any supported document to a QTI package.
 *
 * Auto-detects the document format and uses the appropriate converter.
 *
 * @param input - File, Blob, URL string, or raw data
 * @param options - Conversion options
 * @returns Conversion result with QTI package
 *
 * @example
 * ```typescript
 * import { convertDocument, registerBuiltInConverters } from '@citolab/qti-convert-local-ai';
 *
 * // Register converters once at startup
 * registerBuiltInConverters();
 *
 * // Convert a PDF file
 * const pdfResult = await convertDocument(pdfFile, { testTitle: 'My Test' });
 *
 * // Convert a DOCX file
 * const docxResult = await convertDocument(docxFile);
 *
 * // Convert a Google Form
 * const formResult = await convertDocument('https://docs.google.com/forms/...', options);
 * ```
 */
export async function convertDocument(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  options?: GenerateQtiPackageOptions
): Promise<ConversionResult> {
  // Ensure converters are registered
  registerBuiltInConverters();

  // Detect format from input
  let format: DocumentFormat | undefined;

  if (typeof input === 'string') {
    // URL detection
    if (input.includes('docs.google.com/forms')) {
      format = 'google-form';
    } else if (input.includes('forms.office.com') || input.includes('forms.microsoft.com')) {
      format = 'microsoft-form';
    }
  } else if ('name' in input && typeof (input as File).name === 'string') {
    const fileName = (input as File).name.toLowerCase();
    if (fileName.endsWith('.pdf')) format = 'pdf';
    else if (fileName.endsWith('.docx')) format = 'docx';
    else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) format = 'xlsx';
    else if (fileName.endsWith('.csv')) format = 'csv';
  }

  if (!format) {
    throw new Error('Could not detect document format. Please use a specific converter.');
  }

  // Get and use the appropriate converter
  const converters: Record<DocumentFormat, DocumentConverter<unknown, DocumentData>> = {
    pdf: pdfConverter as unknown as DocumentConverter<unknown, DocumentData>,
    docx: docxConverter as unknown as DocumentConverter<unknown, DocumentData>,
    csv: spreadsheetConverter as unknown as DocumentConverter<unknown, DocumentData>,
    xlsx: xlsxConverter as unknown as DocumentConverter<unknown, DocumentData>,
    'google-form': googleFormConverter as unknown as DocumentConverter<unknown, DocumentData>,
    'microsoft-form': microsoftFormConverter as unknown as DocumentConverter<unknown, DocumentData>
  };

  const converter = converters[format];
  if (!converter) {
    throw new Error(`No converter available for format: ${format}`);
  }

  return converter.convert(input, options);
}
