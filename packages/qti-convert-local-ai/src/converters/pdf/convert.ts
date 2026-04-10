import { createWebLlmEngine } from '../../mapping';
import { generateQtiPackageFromQuestions } from '../../qti-generator';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';
import {
  buildPdfPreview,
  detectBoundariesWithLlm,
  logPdfDebug,
  normalizePdfItemsWithLlm,
  parsePdf
} from './parse';
import type { PdfInput, PdfToQtiResult } from './types';

export const convertPdfToQtiPackage = async (
  input: PdfInput,
  options: GenerateQtiPackageOptions = {}
): Promise<PdfToQtiResult> => {
  options.onProgress?.({
    stage: 'parse_started',
    message: 'Parsing PDF input.'
  });

  const document = await parsePdf(input);

  options.onProgress?.({
    stage: 'parse_completed',
    message: `Parsed ${document.blocks.length} text block${document.blocks.length === 1 ? '' : 's'} from ${document.pages.length} page${document.pages.length === 1 ? '' : 's'}.`,
    data: {
      pageCount: document.pages.length,
      blockCount: document.blocks.length
    }
  });

  options.onProgress?.({
    stage: 'mapping_started',
    message: 'Extracting likely assessment items from PDF text blocks.'
  });

  let questions: StructuredQuestion[];
  try {
    const engine = await createWebLlmEngine(options.llmSettings, event => {
      options.onProgress?.(event);
    });

    options.onProgress?.({
      stage: 'chunk_started',
      message: 'Detecting item boundaries using LLM...'
    });

    const segmentedItems = await detectBoundariesWithLlm(engine, document.blocks, options.onProgress, options);

    logPdfDebug('PDF boundary detection complete', {
      itemCount: segmentedItems.length,
      sampleItems: segmentedItems.slice(0, 3)
    });

    questions = await normalizePdfItemsWithLlm(
      engine,
      document.blocks,
      segmentedItems,
      document.images,
      options.onProgress,
      options
    );
  } catch (error) {
    console.warn('PDF LLM parsing failed. Creating simple items from all blocks.', {
      error,
      blockCount: document.blocks.length
    });
    options.onProgress?.({
      stage: 'mapping_started',
      message: 'LLM parsing failed. Creating simple items from document blocks.'
    });
    questions = document.blocks.map((block, index) => ({
      type: 'extended_text' as const,
      identifier: `item-${index + 1}`,
      prompt: block.text,
      points: 1
    }));
  }

  options.onProgress?.({
    stage: 'mapping_completed',
    message: `Extracted ${questions.length} likely question${questions.length === 1 ? '' : 's'}.`,
    data: questions
  });
  logPdfDebug(
    'Final PDF question mapping',
    questions.map((question, index) => ({
      questionIndex: index,
      identifier: question.identifier,
      prompt: question.prompt
    }))
  );

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(questions, options);

  return {
    document,
    preview: buildPdfPreview(document),
    questions,
    packageBlob: blob,
    packageName,
    summary
  };
};
