import { createWebLlmEngine } from '../../mapping';
import { generateQtiPackageFromQuestions } from '../../qti-generator';
import type { GenerateQtiPackageOptions, StructuredQuestion } from '../../types';
import {
  buildDocxPreview,
  detectDocxBoundariesWithLlm,
  extractQuestionsFromParagraphs,
  logDocxDebug,
  normalizeDocxItemsWithLlm,
  parseDocx
} from './parse';
import type { DocxInput, DocxToQtiResult } from './types';

export const convertDocxToQtiPackage = async (
  input: DocxInput,
  options: GenerateQtiPackageOptions = {}
): Promise<DocxToQtiResult> => {
  options.onProgress?.({
    stage: 'parse_started',
    message: 'Parsing DOCX input.'
  });

  const document = await parseDocx(input);

  options.onProgress?.({
    stage: 'parse_completed',
    message: `Parsed ${document.paragraphs.length} paragraph${document.paragraphs.length === 1 ? '' : 's'}.`,
    data: {
      paragraphCount: document.paragraphs.length
    }
  });

  options.onProgress?.({
    stage: 'mapping_started',
    message: 'Extracting likely assessment items from DOCX paragraphs.'
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

    const blockTexts = document.blocks.map(block =>
      block.type === 'text' ? block.text : `[Image: ${block.asset.fileName}]`
    );
    const segmentedItems = await detectDocxBoundariesWithLlm(engine, blockTexts, options.onProgress, options);

    logDocxDebug('DOCX boundary detection complete', {
      itemCount: segmentedItems.length,
      sampleItems: segmentedItems.slice(0, 3)
    });

    questions = await normalizeDocxItemsWithLlm(engine, document.blocks, segmentedItems, options.onProgress, options);
  } catch (error) {
    console.warn('DOCX LLM parsing failed. Falling back to heuristic paragraph extraction.', {
      error,
      blockCount: document.blocks.length
    });
    options.onProgress?.({
      stage: 'mapping_started',
      message: 'LLM parsing failed. Falling back to heuristic paragraph extraction.'
    });
    questions = extractQuestionsFromParagraphs(document.paragraphs);
  }

  options.onProgress?.({
    stage: 'mapping_completed',
    message: `Extracted ${questions.length} likely question${questions.length === 1 ? '' : 's'}.`,
    data: questions
  });
  logDocxDebug(
    'Final DOCX question image mapping',
    questions.map((question, index) => ({
      questionIndex: index,
      identifier: question.identifier,
      prompt: question.prompt,
      stimulusImageFileNames: (question.stimulusImages || []).map(image => image.fileName)
    }))
  );

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(questions, options);

  return {
    document,
    preview: buildDocxPreview(document),
    questions,
    packageBlob: blob,
    packageName,
    summary
  };
};
