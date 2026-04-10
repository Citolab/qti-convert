import type { ConversionResult, DocumentConverter, DocumentData, DocumentPreview } from '../handler';
import { convertMicrosoftFormToQtiPackage, type ConvertMicrosoftFormToQtiOptions } from './parser';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';

type MicrosoftFormInput = string;

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

export const microsoftFormConverter: DocumentConverter<
  MicrosoftFormInput,
  MicrosoftFormDocumentData,
  MicrosoftFormPreview,
  MicrosoftFormResult
> = {
  name: 'Microsoft Forms Converter',
  format: 'microsoft-form',
  supportedExtensions: [],

  async parse(input: MicrosoftFormInput): Promise<MicrosoftFormDocumentData> {
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

  async extractQuestions(_document: MicrosoftFormDocumentData, _options?: GenerateQtiPackageOptions): Promise<StructuredQuestion[]> {
    throw new Error('Microsoft Forms extractQuestions requires the URL. Use convert() instead.');
  },

  async convert(input: MicrosoftFormInput, options?: ConvertMicrosoftFormToQtiOptions): Promise<MicrosoftFormResult> {
    return convertMicrosoftFormToQtiPackage(input, options);
  }
};
