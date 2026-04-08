/**
 * Document Converter Interface
 *
 * This module defines the factory pattern for document converters.
 * Each document type (PDF, DOCX, Spreadsheet, Google Forms, Microsoft Forms)
 * has a corresponding converter that implements the DocumentConverter interface.
 */

import type { GenerateQtiPackageOptions, StructuredQuestion, ConversionSummary, ProgressCallback } from './types';

// ---------------------------------------------------------------------------
// Core Converter Types
// ---------------------------------------------------------------------------

/**
 * Supported document formats for conversion
 */
export type DocumentFormat = 'pdf' | 'docx' | 'csv' | 'xlsx' | 'google-form' | 'microsoft-form';

/**
 * Base interface for parsed document data
 */
export interface DocumentData {
  /** Original file name if available */
  fileName?: string;
}

/**
 * Preview data shown before conversion starts
 */
export interface DocumentPreview {
  /** Estimated question/item count */
  estimatedItemCount?: number;
  /** Sample content for user review */
  sampleContent?: string[];
  /** Original file name if available */
  fileName?: string;
}

/**
 * Result of a document-to-QTI conversion
 *
 * This is a minimal interface - individual converters return their own
 * result types which may include additional properties.
 */
export interface ConversionResult {
  /** Extracted questions ready for QTI generation */
  questions: StructuredQuestion[];
  /** Generated QTI package blob */
  packageBlob?: Blob;
  /** Suggested package filename */
  packageName?: string;
  /** Conversion summary with statistics and issues */
  summary: ConversionSummary;
}

// ---------------------------------------------------------------------------
// Document Converter Interface
// ---------------------------------------------------------------------------

/**
 * Interface for document converters.
 *
 * Each document type (PDF, DOCX, etc.) implements this interface to provide
 * consistent conversion capabilities with type-safe document data.
 *
 * TResult is flexible - each converter can return its own native result type
 * which should at minimum include questions, packageBlob, packageName, and summary.
 */
export interface DocumentConverter<
  TInput,
  TDocument extends DocumentData = DocumentData,
  TPreview extends DocumentPreview = DocumentPreview,
  TResult = ConversionResult
> {
  /** Human-readable name of the converter */
  readonly name: string;

  /** Document format handled by this converter */
  readonly format: DocumentFormat;

  /** File extensions supported by this converter */
  readonly supportedExtensions: readonly string[];

  /**
   * Parse raw input into structured document data.
   * This step extracts text, images, and other content without LLM processing.
   */
  parse(input: TInput): Promise<TDocument>;

  /**
   * Build a preview for user inspection before conversion.
   */
  buildPreview(document: TDocument): TPreview;

  /**
   * Extract questions from the parsed document.
   * This may use LLM processing for segmentation and normalization.
   */
  extractQuestions(document: TDocument, options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]>;

  /**
   * Full conversion pipeline: parse → extract → generate QTI package.
   */
  convert(input: TInput, options?: GenerateQtiPackageOptions): Promise<TResult>;
}

// ---------------------------------------------------------------------------
// Factory Pattern
// ---------------------------------------------------------------------------

/**
 * Registry of document converters by format
 */
const converterRegistry = new Map<DocumentFormat, DocumentConverter<unknown, DocumentData>>();

/**
 * Register a document converter for a specific format.
 */
export function registerConverter<TInput, TDocument extends DocumentData, TPreview extends DocumentPreview, TResult>(
  format: DocumentFormat,
  converter: DocumentConverter<TInput, TDocument, TPreview, TResult>
): void {
  converterRegistry.set(format, converter as unknown as DocumentConverter<unknown, DocumentData>);
}

/**
 * Get a registered converter by format.
 */
export function getConverter<
  TInput = unknown,
  TDocument extends DocumentData = DocumentData,
  TPreview extends DocumentPreview = DocumentPreview,
  TResult = ConversionResult
>(format: DocumentFormat): DocumentConverter<TInput, TDocument, TPreview, TResult> | undefined {
  return converterRegistry.get(format) as DocumentConverter<TInput, TDocument, TPreview, TResult> | undefined;
}

/**
 * Get all registered converters.
 */
export function getRegisteredConverters(): Map<DocumentFormat, DocumentConverter<unknown, DocumentData>> {
  return new Map(converterRegistry);
}

/**
 * Detect document format from file extension.
 */
export function detectFormatFromExtension(fileName: string): DocumentFormat | undefined {
  const extension = fileName.toLowerCase().split('.').pop();
  if (!extension) return undefined;

  for (const [format, converter] of converterRegistry) {
    if (converter.supportedExtensions.includes(extension)) {
      return format;
    }
  }
  return undefined;
}

/**
 * Detect document format from MIME type.
 */
export function detectFormatFromMimeType(mimeType: string): DocumentFormat | undefined {
  const mimeMap: Record<string, DocumentFormat> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xlsx'
  };
  return mimeMap[mimeType.toLowerCase()];
}

/**
 * Get a converter for a file, auto-detecting the format.
 */
export function getConverterForFile(
  file: File | { name: string; type?: string }
): DocumentConverter<unknown, DocumentData> | undefined {
  // Try MIME type first
  if ('type' in file && file.type) {
    const format = detectFormatFromMimeType(file.type);
    if (format) {
      return getConverter(format);
    }
  }

  // Fall back to extension
  const format = detectFormatFromExtension(file.name);
  if (format) {
    return getConverter(format);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Batch Processing Constants
// ---------------------------------------------------------------------------

/**
 * Default batch size for LLM normalization calls.
 * Processing multiple items per LLM call significantly reduces conversion time.
 */
export const NORMALIZATION_BATCH_SIZE = 8;

/**
 * Default chunk size for document segmentation.
 */
export const SEGMENTATION_CHUNK_SIZE = 36;
