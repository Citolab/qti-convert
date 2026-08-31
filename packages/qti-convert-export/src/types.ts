/** Paper-friendly intermediate model for QTI → document export. */

export type ExportLocale = 'nl' | 'en';

export type PaperAsset = {
  /** Path relative to package root, e.g. resources/atom.png */
  path: string;
  bytes: Uint8Array;
  contentType: string;
};

export type PaperContentBlock =
  | { type: 'paragraph'; html: string }
  | { type: 'image'; assetPath: string; alt?: string; width?: number; height?: number };

export type PaperChoiceOption = {
  identifier: string;
  label: string;
  contentHtml: string;
};

export type PaperMatchOption = {
  identifier: string;
  contentHtml: string;
};

export type PaperGapPart =
  | { type: 'text'; html: string }
  | { type: 'gap'; identifier: string };

export type PaperHottextPart =
  | { type: 'text'; text: string }
  | { type: 'hottext'; identifier: string; text: string };

export type PaperInteraction =
  | {
      kind: 'choice';
      multi: boolean;
      choices: PaperChoiceOption[];
    }
  | {
      kind: 'textEntry';
      /** Number of blank fields (may be inline in stimulus). */
      blanks: number;
      /** When true, blanks are already represented as ____ in stimulusHtml blocks. */
      inline: boolean;
    }
  | {
      kind: 'extendedText';
      lines: number;
    }
  | {
      kind: 'match';
      mode: 'matrix' | 'pairs';
      /** Kennisnet: top = bank above blanks; answers = bank under ANTWOORDEN (qti-choices-right). */
      bankPlacement?: 'top' | 'answers';
      rows: PaperMatchOption[];
      columns: PaperMatchOption[];
    }
  | {
      kind: 'inlineChoice';
      /** Numbered dropdowns in the passage, with option banks listed below. */
      slots: {
        number: number;
        responseId: string;
        options: PaperChoiceOption[];
      }[];
    }
  | {
      kind: 'order';
      items: PaperChoiceOption[];
      orientation: 'vertical' | 'horizontal';
    }
  | {
      kind: 'gapMatch';
      options: PaperMatchOption[];
      parts: PaperGapPart[];
    }
  | {
      kind: 'hottext';
      parts: PaperHottextPart[];
    }
  | {
      kind: 'selectPoint';
      imageAsset: string;
      instruction: string;
      alt?: string;
      width?: number;
      height?: number;
    }
  | {
      kind: 'unsupported';
      interactionType: string;
      fallbackNote: string;
    };

export type PaperAnswerKey = {
  /** Human-readable correct answer summary. */
  summary: string;
  /** Raw QTI correct values when available. */
  values?: string[];
  /** From qti-rubric-block view=scorer — preferred teacher guidance. */
  rubricHtml?: string;
};

export type PaperItem = {
  identifier: string;
  title: string;
  /** Max score from MAXSCORE / SCORE normal-maximum. */
  points?: number;
  /** Blocks that appear above / around the interaction (stimulus, prompt). */
  stimulus: PaperContentBlock[];
  interaction: PaperInteraction;
  answerKey?: PaperAnswerKey;
};

export type PaperAssessment = {
  title: string;
  identifier?: string;
  /** Welcome / instructions from assessment-test rubric (candidate). */
  instructions?: string[];
  /** Optional publisher/author from package metadata. */
  author?: string;
  items: PaperItem[];
  /** Asset lookup by relative path. */
  assets: Map<string, PaperAsset>;
};

export type ExportOptions = {
  locale?: ExportLocale;
  /**
   * Append the correction sheet at the end of the question document.
   * Independent of `correctionSeparate` — both can be true.
   * Default: false
   */
  correctionInDocument?: boolean;
  /**
   * Produce a separate correction document (`{base}-correction.docx`).
   * Independent of `correctionInDocument` — both can be true.
   * Default: true when neither this nor `correctionInDocument` is set.
   */
  correctionSeparate?: boolean;
  /** @deprecated Use `correctionInDocument` / `correctionSeparate`. */
  includeAnswerKey?: boolean;
  /** @deprecated Use `correctionSeparate`. */
  separateAnswerKey?: boolean;
  /** Document variant label on cover. */
  variant?: 'learner' | 'scorer';
  /**
   * Base name for downloads (without extension).
   * Defaults to the QTI ZIP filename when converting a File/path, else the assessment title.
   * Paper: `{base}.docx` — answer key: `{base}-correction.docx`
   */
  fileNameBase?: string;
};

/** Resolve where the correction sheet should appear. */
export function resolveCorrectionPlacement(options: ExportOptions = {}): {
  inDocument: boolean;
  separate: boolean;
} {
  const hasNewFlags =
    options.correctionInDocument !== undefined || options.correctionSeparate !== undefined;

  if (hasNewFlags) {
    return {
      inDocument: options.correctionInDocument === true,
      separate: options.correctionSeparate === true,
    };
  }

  // Legacy defaults: separate correction file (Kennisnet style)
  if (options.includeAnswerKey === false) {
    return { inDocument: false, separate: false };
  }
  const separate = options.separateAnswerKey !== false;
  return {
    inDocument: !separate,
    separate,
  };
}

export type DocxExportResult = {
  assessment: Uint8Array;
  answerKey?: Uint8Array;
  fileName: string;
  answerKeyFileName?: string;
};

export type PdfExportResult = {
  assessment: Uint8Array;
  answerKey?: Uint8Array;
  fileName: string;
  answerKeyFileName?: string;
};
