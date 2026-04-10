import type { DocumentConverter } from '../handler';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';
import { convertPdfToQtiPackage } from './convert';
import { buildPdfPreview, parsePdf } from './parse';
import type { PdfDocumentData, PdfPreview, PdfToQtiResult } from './types';
import type { BinaryInput } from '../../utils/file-input';

export const pdfConverter: DocumentConverter<BinaryInput, PdfDocumentData, PdfPreview, PdfToQtiResult> = {
  name: 'PDF Converter',
  format: 'pdf',
  supportedExtensions: ['pdf'],

  async parse(input: BinaryInput): Promise<PdfDocumentData> {
    return parsePdf(input);
  },

  buildPreview(document: PdfDocumentData): PdfPreview {
    return buildPdfPreview(document);
  },

  async extractQuestions(_document: PdfDocumentData, _options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]> {
    throw new Error('PDF extractQuestions requires the full conversion pipeline. Use convert() instead.');
  },

  async convert(input: BinaryInput, options?: GenerateQtiPackageOptions): Promise<PdfToQtiResult> {
    return convertPdfToQtiPackage(input, options);
  }
};
