import type { ExportLocale, PaperDocumentKind } from './types.js';

export type LocaleStrings = {
  nameLabel: string;
  classLabel: string;
  dateLabel: string;
  question: string;
  point: string;
  points: string;
  answerKeyTitle: string;
  answerKeySubtitle: string;
  scoringGuidelines: string;
  noAnswerKey: string;
  answersHeader: string;
  orderLabel: string;
  hottextInstruction: string;
  selectPointInstruction: string;
  unsupportedPrefix: string;
  endOfTest: string;
  pageOf: (page: number, total: number) => string;
  vragenbladSuffix: string;
  antwoordmodelSuffix: string;

  /** Document titles and file name suffixes per document kind. */
  documentTitle: Record<PaperDocumentKind, string>;
  fileSuffix: Record<PaperDocumentKind, string>;
  zipSuffix: string;
  bookletInstruction: string;
  sourceLabel: (n: number) => string;
  useSource: (n: number, title?: string) => string;
  answerSheetInstruction: string;
  keyColumns: { question: string; answer: string; points: string };
  total: string;
  alsoAccept: string;
  answer: string;
  text: string;
  scoring: string;

  chooseExactly: (n: number) => string;
  chooseUpTo: (n: number) => string;
  chooseAny: string;
  inlineChoiceInstruction: string;
  matchInstruction: string;
  matrixInstruction: string;
  associateInstruction: (pairs: number) => string;
  orderInstruction: string;
  gapMatchInstruction: string;
  hottextWorkbook: (max: number) => string;
  hottextBooklet: string;
  hotspotInstruction: string;
  graphicOrderInstruction: string;
  graphicAssociateInstruction: (pairs: number) => string;
  graphicGapMatchInstruction: string;
  selectPoint: (max: number) => string;
  positionObject: string;
  onAnswerSheet: string;
  slider: (min: number, max: number, step?: number) => string;
  drawing: string;
  upload: string;
  digitalOnly: string;
  unsupported: (interactionType: string) => string;
  media: Record<'audio' | 'video' | 'media', string>;
  correctArea: string;
  imageMissing: (path: string) => string;
};

const nl: LocaleStrings = {
  nameLabel: 'Naam:',
  classLabel: 'Klas:',
  dateLabel: 'Datum:',
  question: 'Vraag',
  point: 'punt',
  points: 'punten',
  answerKeyTitle: 'Antwoordmodel',
  answerKeySubtitle: 'Antwoordmodel voor de docent  —  niet voor leerlingen',
  scoringGuidelines: 'Beoordelingsrichtlijnen',
  noAnswerKey: 'Geen automatisch antwoordmodel beschikbaar (open vraag of externe scoring).',
  answersHeader: 'ANTWOORDEN',
  orderLabel: 'Volgorde:',
  hottextInstruction: 'Omcirkel de juiste woord(en) in de tekst.',
  selectPointInstruction: 'Zet een kruisje (X) op de juiste plek in de afbeelding.',
  unsupportedPrefix: 'Deze vraag kan niet volledig op papier worden weergegeven',
  endOfTest: '- Einde van de toets -',
  pageOf: (page, total) => `Pagina ${page} van ${total}`,
  vragenbladSuffix: 'Vragenblad',
  antwoordmodelSuffix: 'Antwoordmodel',

  documentTitle: {
    workbook: 'Toets',
    questions: 'Opgaven',
    sources: 'Bronnen',
    answerSheet: 'Antwoordblad',
    answerKey: 'Antwoordmodel'
  },
  fileSuffix: {
    workbook: 'toets',
    questions: 'opgaven',
    sources: 'bronnen',
    answerSheet: 'antwoordblad',
    answerKey: 'antwoordmodel'
  },
  zipSuffix: 'papier',
  bookletInstruction: 'Schrijf je antwoorden op het antwoordblad.',
  sourceLabel: n => `Bron ${n}`,
  useSource: (n, title) => `Gebruik bron ${n}${title ? ` (${title})` : ''} uit het bronnenboekje.`,
  answerSheetInstruction: 'Vul je antwoord in bij het juiste vraagnummer.',
  keyColumns: { question: 'Vraag', answer: 'Antwoord', points: 'Punten' },
  total: 'Totaal',
  alsoAccept: 'ook goed:',
  answer: 'Antwoord:',
  text: 'Tekst',
  scoring: 'Beoordeling',

  chooseExactly: n => `Kies ${n} antwoorden.`,
  chooseUpTo: n => `Kies maximaal ${n} antwoorden.`,
  chooseAny: 'Er kunnen meerdere antwoorden juist zijn.',
  inlineChoiceInstruction: 'Kies bij elk nummer het juiste antwoord.',
  matchInstruction: 'Schrijf bij elk nummer de letter van het juiste antwoord.',
  matrixInstruction: 'Kruis bij elk nummer het juiste vakje aan.',
  associateInstruction: n =>
    n === 1 ? 'Vorm een paar: schrijf twee letters op.' : `Vorm ${n} paren: schrijf steeds twee letters op.`,
  orderInstruction: 'Zet de letters in de juiste volgorde.',
  gapMatchInstruction: 'Schrijf bij elk nummer de letter van het woord dat in het gat past.',
  hottextWorkbook: n =>
    n === 1
      ? 'Omcirkel het juiste woord in de tekst.'
      : n > 1
        ? `Omcirkel ${n} woorden in de tekst.`
        : 'Omcirkel de juiste woorden in de tekst.',
  hottextBooklet: 'De woorden die je kunt kiezen zijn onderstreept en hebben een letter.',
  hotspotInstruction: 'Kies de letter van het juiste deel van de afbeelding.',
  graphicOrderInstruction: 'Zet de letters op de afbeelding in de juiste volgorde.',
  graphicAssociateInstruction: n =>
    n === 1 ? 'Vorm een paar met de letters op de afbeelding.' : `Vorm ${n} paren met de letters op de afbeelding.`,
  graphicGapMatchInstruction: 'Schrijf bij elk nummer op de afbeelding de letter die daar hoort.',
  selectPoint: n =>
    n === 1
      ? 'Zet een kruisje (X) op de juiste plek in de afbeelding.'
      : n > 1
        ? `Zet ${n} kruisjes (X) op de juiste plekken in de afbeelding.`
        : 'Zet kruisjes (X) op de juiste plekken in de afbeelding.',
  positionObject: 'Zet een kruisje (X) in de afbeelding waar dit hoort:',
  onAnswerSheet: 'Doe dit op het antwoordblad.',
  slider: (min, max, step) => `Kies een waarde van ${min} tot en met ${max}${step ? ` (stappen van ${step})` : ''}.`,
  drawing: 'Maak je tekening in het kader.',
  upload: 'Lever je werk apart in bij je docent.',
  digitalOnly: 'Alleen digitaal te maken.',
  unsupported: type =>
    type.includes('portable-custom') || type.includes('custom')
      ? 'Deze vraag gebruikt een speciale interactie en kan alleen digitaal worden gemaakt.'
      : `Deze vraag kan niet op papier worden gemaakt (${type}).`,
  media: {
    audio: 'Bij deze vraag hoort een geluidsfragment.',
    video: 'Bij deze vraag hoort een video.',
    media: 'Bij deze vraag hoort een mediafragment.'
  },
  correctArea: 'Goed als het kruisje in het gemarkeerde gebied staat.',
  imageMissing: path => `[afbeelding: ${path}]`
};

const en: LocaleStrings = {
  nameLabel: 'Name:',
  classLabel: 'Class:',
  dateLabel: 'Date:',
  question: 'Question',
  point: 'point',
  points: 'points',
  answerKeyTitle: 'Answer key',
  answerKeySubtitle: 'Answer key for the teacher  —  not for students',
  scoringGuidelines: 'Scoring guidelines',
  noAnswerKey: 'No automatic answer key available (open response or external scoring).',
  answersHeader: 'ANSWERS',
  orderLabel: 'Order:',
  hottextInstruction: 'Circle the correct word(s) in the text.',
  selectPointInstruction: 'Mark the correct spot in the image with a cross (X).',
  unsupportedPrefix: 'This question cannot be fully represented on paper',
  endOfTest: '- End of assessment -',
  pageOf: (page, total) => `Page ${page} of ${total}`,
  vragenbladSuffix: 'Question sheet',
  antwoordmodelSuffix: 'Answer key',

  documentTitle: {
    workbook: 'Assessment',
    questions: 'Questions',
    sources: 'Sources',
    answerSheet: 'Answer sheet',
    answerKey: 'Answer key'
  },
  fileSuffix: {
    workbook: 'assessment',
    questions: 'questions',
    sources: 'sources',
    answerSheet: 'answer-sheet',
    answerKey: 'answer-key'
  },
  zipSuffix: 'paper',
  bookletInstruction: 'Write your answers on the answer sheet.',
  sourceLabel: n => `Source ${n}`,
  useSource: (n, title) => `Use source ${n}${title ? ` (${title})` : ''} in the sources booklet.`,
  answerSheetInstruction: 'Write each answer next to its question number.',
  keyColumns: { question: 'Question', answer: 'Answer', points: 'Points' },
  total: 'Total',
  alsoAccept: 'also accept:',
  answer: 'Answer:',
  text: 'Text',
  scoring: 'Scoring',

  chooseExactly: n => `Choose ${n} answers.`,
  chooseUpTo: n => `Choose up to ${n} answers.`,
  chooseAny: 'More than one answer may be correct.',
  inlineChoiceInstruction: 'Choose the correct answer for each number.',
  matchInstruction: 'Write the letter of the matching answer next to each number.',
  matrixInstruction: 'Tick the correct box for each number.',
  associateInstruction: n =>
    n === 1 ? 'Make a pair: write two letters.' : `Make ${n} pairs: write two letters each time.`,
  orderInstruction: 'Put the letters in the correct order.',
  gapMatchInstruction: 'Write the letter of the word that fits each numbered gap.',
  hottextWorkbook: n =>
    n === 1
      ? 'Circle the correct word in the text.'
      : n > 1
        ? `Circle ${n} words in the text.`
        : 'Circle the correct words in the text.',
  hottextBooklet: 'The words you can choose are underlined and lettered.',
  hotspotInstruction: 'Choose the letter of the correct part of the image.',
  graphicOrderInstruction: 'Put the letters in the image in the correct order.',
  graphicAssociateInstruction: n =>
    n === 1 ? 'Make a pair using the letters in the image.' : `Make ${n} pairs using the letters in the image.`,
  graphicGapMatchInstruction: 'Write the letter that belongs at each number in the image.',
  selectPoint: n =>
    n === 1
      ? 'Mark the correct spot in the image with a cross (X).'
      : n > 1
        ? `Mark ${n} correct spots in the image with a cross (X).`
        : 'Mark the correct spots in the image with a cross (X).',
  positionObject: 'Mark with a cross (X) where this belongs in the image:',
  onAnswerSheet: 'Do this on the answer sheet.',
  slider: (min, max, step) => `Choose a value from ${min} to ${max}${step ? ` (steps of ${step})` : ''}.`,
  drawing: 'Make your drawing in the box.',
  upload: 'Hand in your work separately to your teacher.',
  digitalOnly: 'Digital only.',
  unsupported: type =>
    type.includes('portable-custom') || type.includes('custom')
      ? 'This question uses a custom interaction and can only be answered digitally.'
      : `This question cannot be answered on paper (${type}).`,
  media: {
    audio: 'This question comes with an audio fragment.',
    video: 'This question comes with a video.',
    media: 'This question comes with a media fragment.'
  },
  correctArea: 'Correct when the cross is inside the marked area.',
  imageMissing: path => `[image: ${path}]`
};

export function getLocaleStrings(locale: ExportLocale = 'en'): LocaleStrings {
  return locale === 'nl' ? nl : en;
}

export function formatPoints(points: number | undefined, locale: LocaleStrings): string {
  if (points == null || Number.isNaN(points)) return '';
  const n = Math.round(points * 100) / 100;
  const label = n === 1 ? locale.point : locale.points;
  return `(${n} ${label})`;
}
