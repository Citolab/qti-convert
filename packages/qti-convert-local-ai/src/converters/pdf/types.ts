import type { ConversionSummary, StructuredMediaAsset, StructuredQuestion } from '../../types';
import type { BinaryInput } from '../../utils/file-input';

export type PdfInput = BinaryInput;

export type PdfTextBlock = {
  type: 'text';
  text: string;
  pageNumber: number;
  y: number;
};

export type PdfImageAsset = StructuredMediaAsset & {
  pageNumber: number;
  top: number;
  bottom: number;
};

export type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
};

export type PdfDocumentData = {
  blocks: PdfTextBlock[];
  images: PdfImageAsset[];
  pages: Array<{
    pageNumber: number;
    lines: string[];
  }>;
  fileName?: string;
};

export type PdfPreview = {
  pageCount: number;
  blockCount: number;
  sampleLines: string[];
  fileName?: string;
};

export type PdfToQtiResult = {
  document: PdfDocumentData;
  preview: PdfPreview;
  questions: StructuredQuestion[];
  packageBlob: Blob;
  packageName: string;
  summary: ConversionSummary;
};
