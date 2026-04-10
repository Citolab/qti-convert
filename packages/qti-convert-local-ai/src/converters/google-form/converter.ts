import type { ConversionResult, DocumentConverter, DocumentData, DocumentPreview } from '../handler';
import { convertGoogleFormToQtiPackage, type ConvertGoogleFormToQtiOptions } from './parser';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';

type GoogleFormInput = string;

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

export const googleFormConverter: DocumentConverter<
  GoogleFormInput,
  GoogleFormDocumentData,
  GoogleFormPreview,
  GoogleFormResult
> = {
  name: 'Google Forms Converter',
  format: 'google-form',
  supportedExtensions: [],

  async parse(input: GoogleFormInput): Promise<GoogleFormDocumentData> {
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

  async extractQuestions(_document: GoogleFormDocumentData, _options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]> {
    throw new Error('Google Forms extractQuestions requires the URL. Use convert() instead.');
  },

  async convert(input: GoogleFormInput, options?: ConvertGoogleFormToQtiOptions): Promise<GoogleFormResult> {
    return convertGoogleFormToQtiPackage(input, options);
  }
};
