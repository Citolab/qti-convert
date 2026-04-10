import type { DocumentConverter } from '../handler';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';
import { convertDocxToQtiPackage } from './convert';
import { buildDocxPreview, parseDocx } from './parse';
import type { DocxDocumentData, DocxPreview, DocxToQtiResult } from './types';
import type { BinaryInput } from '../../utils/file-input';

export const docxConverter: DocumentConverter<BinaryInput, DocxDocumentData, DocxPreview, DocxToQtiResult> = {
  name: 'DOCX Converter',
  format: 'docx',
  supportedExtensions: ['docx'],

  async parse(input: BinaryInput): Promise<DocxDocumentData> {
    return parseDocx(input);
  },

  buildPreview(document: DocxDocumentData): DocxPreview {
    return buildDocxPreview(document);
  },

  async extractQuestions(_document: DocxDocumentData, _options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]> {
    throw new Error('DOCX extractQuestions requires the full conversion pipeline. Use convert() instead.');
  },

  async convert(input: BinaryInput, options?: GenerateQtiPackageOptions): Promise<DocxToQtiResult> {
    return convertDocxToQtiPackage(input, options);
  }
};
