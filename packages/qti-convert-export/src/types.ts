/** Paper-friendly intermediate model for QTI → document export. */

export type ExportLocale = 'nl' | 'en';

export type PaperAsset = {
  /** Path relative to package root, e.g. resources/atom.png */
  path: string;
  bytes: Uint8Array;
  contentType: string;
};

/**
 * A chunk of item content as sanitized HTML.
 *
 * Image `src` attributes are already resolved to package paths (or remote/data
 * URLs). Inline interactions are replaced by placeholders the layout step
 * understands: `<paper-gap n="1"/>` for a numbered blank and
 * `<paper-hottext label="A">word</paper-hottext>` for a selectable word.
 */
export type PaperContentBlock = { type: 'html'; html: string };

/** A lettered or numbered option as printed on paper. */
export type PaperOption = {
  identifier: string;
  /** Paper label: A, B, C… or 1, 2, 3… */
  label: string;
  html: string;
};

export type PaperImageRef = {
  path: string;
  alt?: string;
  /** Declared size in CSS pixels; QTI coords are expressed against this size. */
  width?: number;
  height?: number;
};

export type PaperShape = 'circle' | 'rect' | 'poly' | 'ellipse' | 'default';

export type PaperHotspot = {
  identifier: string;
  label: string;
  shape: PaperShape;
  coords: number[];
};

export type PaperArea = { shape: PaperShape; coords: number[] };

export type PaperPair = [string, string];

export type PaperTextGap = {
  label: string;
  responseId: string;
  expectedLength?: number;
  /** Correct answer first, then accepted alternatives from the mapping. */
  accepted: string[];
};

export type PaperChoiceGap = {
  label: string;
  responseId: string;
  options: PaperOption[];
  correct: string[];
};

export type PaperInteraction =
  | {
      kind: 'choice';
      responseId: string;
      multi: boolean;
      minChoices: number;
      /** 0 = unlimited */
      maxChoices: number;
      options: PaperOption[];
      correct: string[];
    }
  | { kind: 'textEntry'; gaps: PaperTextGap[] }
  | { kind: 'inlineChoice'; gaps: PaperChoiceGap[] }
  | { kind: 'extendedText'; responseId: string; lines: number; correct: string[] }
  | {
      kind: 'match';
      responseId: string;
      /** Source set, numbered 1, 2, 3… */
      rows: PaperOption[];
      /** Target set, lettered A, B, C… */
      columns: PaperOption[];
      /** 0 = unlimited */
      maxAssociations: number;
      correct: PaperPair[];
    }
  | {
      kind: 'associate';
      responseId: string;
      options: PaperOption[];
      maxAssociations: number;
      correct: PaperPair[];
    }
  | { kind: 'order'; responseId: string; options: PaperOption[]; correct: string[] }
  | {
      kind: 'gapMatch';
      responseId: string;
      /** Word bank, lettered */
      options: PaperOption[];
      /** Passage with `<paper-gap n="…"/>` placeholders */
      passageHtml: string;
      gaps: { identifier: string; label: string }[];
      /** [optionId, gapId] */
      correct: PaperPair[];
    }
  | {
      kind: 'hottext';
      responseId: string;
      /** Passage with `<paper-hottext label="…">` placeholders */
      passageHtml: string;
      options: PaperOption[];
      maxChoices: number;
      correct: string[];
    }
  | {
      kind: 'hotspot';
      responseId: string;
      image: PaperImageRef;
      hotspots: PaperHotspot[];
      maxChoices: number;
      correct: string[];
    }
  | {
      kind: 'graphicOrder';
      responseId: string;
      image: PaperImageRef;
      hotspots: PaperHotspot[];
      correct: string[];
    }
  | {
      kind: 'graphicAssociate';
      responseId: string;
      image: PaperImageRef;
      hotspots: PaperHotspot[];
      maxAssociations: number;
      correct: PaperPair[];
    }
  | {
      kind: 'graphicGapMatch';
      responseId: string;
      image: PaperImageRef;
      /** Drop zones, numbered */
      hotspots: PaperHotspot[];
      /** Labels or images to place, lettered */
      options: PaperOption[];
      /** [optionId, hotspotId] */
      correct: PaperPair[];
    }
  | {
      kind: 'selectPoint';
      responseId: string;
      image: PaperImageRef;
      maxChoices: number;
      correctAreas: PaperArea[];
    }
  | {
      kind: 'positionObject';
      responseId: string;
      image: PaperImageRef;
      objectHtml: string;
      maxChoices: number;
      correctAreas: PaperArea[];
    }
  | {
      kind: 'slider';
      responseId: string;
      min: number;
      max: number;
      step?: number;
      correct?: number;
    }
  | { kind: 'drawing'; responseId: string; image?: PaperImageRef }
  | { kind: 'upload'; responseId: string }
  | {
      kind: 'unsupported';
      /** QTI element name, e.g. qti-portable-custom-interaction */
      interactionType: string;
    };

export type PaperInteractionKind = PaperInteraction['kind'];

/** One answerable part of an item; items with several parts label them a, b, c. */
export type PaperItemPart = {
  /** '' when the item has a single part */
  label: string;
  promptHtml?: string;
  interaction: PaperInteraction;
};

export type PaperBodyNode =
  PaperContentBlock | { type: 'part'; index: number } | { type: 'media'; mediaType: 'audio' | 'video' | 'media' };

export type PaperAnswerKey = {
  /** Plain-text summary of the correct answers, one line per part. */
  summary: string;
  /** Raw QTI correct values across all parts. */
  values?: string[];
  /** From qti-rubric-block view=scorer — preferred teacher guidance. */
  rubricHtml?: string;
};

export type PaperItem = {
  identifier: string;
  title: string;
  /** Max score from MAXSCORE / SCORE normal-maximum. */
  points?: number;
  /** Item content in reading order, with markers where each part goes. */
  body: PaperBodyNode[];
  /** Answerable parts. Empty for information-only items (printed without a number). */
  parts: PaperItemPart[];
  /** Shared stimuli (package paths) this item refers to. */
  stimulusRefs: string[];
  rubricHtml?: string;
  answerKey?: PaperAnswerKey;
};

export type PaperStimulus = { identifier: string; title?: string; html: string };

export type PaperAssessment = {
  title: string;
  identifier?: string;
  /** Welcome / instructions from assessment-test rubric (candidate). */
  instructions?: string[];
  /** Optional publisher/author from package metadata. */
  author?: string;
  items: PaperItem[];
  /** Shared stimuli by package path. */
  stimuli: Map<string, PaperStimulus>;
  /** Asset lookup by relative path. */
  assets: Map<string, PaperAsset>;
};

export type ParseOptions = {
  /**
   * Keep options in source order even when the interaction says shuffle="true".
   * By default shuffled interactions get a fixed, seeded order on paper so the
   * source order (often the correct order) is not given away.
   */
  keepSourceOrder?: boolean;
};

export type ExportOptions = ParseOptions & {
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

/**
 * Documents the export can produce.
 * - `workbook`: questions with answer space in place (the classic single document)
 * - `questions`: question booklet without answer space, reusable
 * - `answerSheet`: answer sheet with an answer area per question
 * - `answerKey`: the answer sheet filled in, with points and scoring rubrics
 */
export type PaperDocumentKind = 'workbook' | 'questions' | 'answerSheet' | 'answerKey';

export type PaperFormat = 'docx' | 'pdf';

export type ZipExportOptions = ExportOptions & {
  /** Default: ['docx'] */
  formats?: PaperFormat[];
  /** Default: ['questions', 'answerSheet', 'answerKey'] */
  documents?: PaperDocumentKind[];
};

export type ZipExportFile = {
  name: string;
  kind: PaperDocumentKind;
  format: PaperFormat;
  bytes: Uint8Array;
};

export type ZipExportResult = {
  zip: Uint8Array;
  fileName: string;
  files: ZipExportFile[];
  paper: PaperAssessment;
};

/** Resolve where the correction sheet should appear. */
export function resolveCorrectionPlacement(options: ExportOptions = {}): {
  inDocument: boolean;
  separate: boolean;
} {
  const hasNewFlags = options.correctionInDocument !== undefined || options.correctionSeparate !== undefined;

  if (hasNewFlags) {
    return {
      inDocument: options.correctionInDocument === true,
      separate: options.correctionSeparate === true
    };
  }

  // Legacy defaults: separate correction file (Kennisnet style)
  if (options.includeAnswerKey === false) {
    return { inDocument: false, separate: false };
  }
  const separate = options.separateAnswerKey !== false;
  return {
    inDocument: !separate,
    separate
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
