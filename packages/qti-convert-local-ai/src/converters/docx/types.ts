import type { ConversionSummary, StructuredMediaAsset, StructuredQuestion } from '../../types';
import type { BinaryInput } from '../../utils/file-input';

export type DocxInput = BinaryInput;

export type DocxBlock = { type: 'text'; text: string } | { type: 'image'; asset: StructuredMediaAsset };

export type DocxDocumentData = {
  paragraphs: string[];
  blocks: DocxBlock[];
  images: StructuredMediaAsset[];
  fileName?: string;
};

export type DocxPreview = {
  paragraphCount: number;
  sampleParagraphs: string[];
  fileName?: string;
};

export type DocxToQtiResult = {
  document: DocxDocumentData;
  preview: DocxPreview;
  questions: StructuredQuestion[];
  packageBlob: Blob;
  packageName: string;
  summary: ConversionSummary;
};
