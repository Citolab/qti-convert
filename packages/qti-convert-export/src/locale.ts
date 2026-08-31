import type { ExportLocale } from './types.js';

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
  hottextInstruction: 'Selecteer / omcirkel de juiste woord(en) in de tekst.',
  selectPointInstruction: 'Markeer het juiste punt met een kruisje (X) op de afbeelding hierboven.',
  unsupportedPrefix: 'Deze vraag kan niet volledig op papier worden weergegeven',
  endOfTest: '- Einde van de toets -',
  pageOf: (page, total) => `Pagina ${page} van ${total}`,
  vragenbladSuffix: 'Vragenblad',
  antwoordmodelSuffix: 'Antwoordmodel',
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
  hottextInstruction: 'Select / circle the correct word(s) in the text.',
  selectPointInstruction: 'Mark the correct point with a cross (X) on the image above.',
  unsupportedPrefix: 'This question cannot be fully represented on paper',
  endOfTest: '- End of assessment -',
  pageOf: (page, total) => `Page ${page} of ${total}`,
  vragenbladSuffix: 'Question sheet',
  antwoordmodelSuffix: 'Answer key',
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
