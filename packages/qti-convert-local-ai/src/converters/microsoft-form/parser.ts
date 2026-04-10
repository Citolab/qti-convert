import { generateQtiPackageFromQuestions } from '../../qti-generator';
import { GenerateQtiPackageOptions, SpreadsheetToQtiResult, StructuredOption, StructuredQuestion } from '../../types';

type MicrosoftFormInput = string;

type MicrosoftFormHtmlFetcher = (url: string) => Promise<string>;
type MicrosoftFormRuntimeFetcher = (url: string, init?: RequestInit) => Promise<string>;

export type ConvertMicrosoftFormToQtiOptions = GenerateQtiPackageOptions & {
  fetchFormHtml?: MicrosoftFormHtmlFetcher;
  fetchRuntimeForm?: MicrosoftFormRuntimeFetcher;
};

type MicrosoftFormParseResult = {
  title?: string;
  description?: string;
  questions: StructuredQuestion[];
};

type MicrosoftFormPrefetchRequest = {
  url: string;
  headers: Record<string, string>;
};

type MicrosoftFormQuestionRecord = Record<string, unknown>;
type MicrosoftFormQuestionInfo = Record<string, unknown>;
type MicrosoftFormChoiceRecord = Record<string, unknown>;

const MICROSOFT_FORM_URL_RE = /^https:\/\/(?:[^./]+\.)?forms\.office\.com\//i;
const OFFICE_FORM_SERVER_INFO_RE = /window\.OfficeFormServerInfo\s*=\s*(\{.*?\});/s;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

const defaultMicrosoftFormHtmlFetcher: MicrosoftFormHtmlFetcher = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit'
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft Form (${response.status}).`);
  }
  return await response.text();
};

const defaultMicrosoftFormRuntimeFetcher: MicrosoftFormRuntimeFetcher = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    ...init
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft Form definition (${response.status}).`);
  }
  return await response.text();
};

const parseQuestionInfo = (question: MicrosoftFormQuestionRecord): MicrosoftFormQuestionInfo => {
  const raw = question.questionInfo;
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const extractText = (question: MicrosoftFormQuestionRecord, titleKey: string, fallback: string): string =>
  asString(question[titleKey]) || asString(question[fallback]);

const normalizeChoiceOption = (choice: unknown, index: number): StructuredOption | null => {
  const record = isRecord(choice) ? choice : null;
  const text =
    asString(record?.FormsProDisplayRTText) || asString(record?.description) || asString(record?.Description) || asString(choice);
  if (!text) {
    return null;
  }

  return {
    id: String.fromCharCode(65 + index),
    text,
    isCorrectAnswer: asBoolean(record?.IsAnswerKey) || false
  };
};

const extractChoiceOptions = (
  question: MicrosoftFormQuestionRecord,
  questionInfo: MicrosoftFormQuestionInfo
): StructuredOption[] => {
  const embeddedChoices = asArray(questionInfo.Choices).map(normalizeChoiceOption).filter((choice): choice is StructuredOption => choice !== null);
  if (embeddedChoices.length > 0) {
    return embeddedChoices;
  }

  return asArray(question.choices).map(normalizeChoiceOption).filter((choice): choice is StructuredOption => choice !== null);
};

const buildScaleOptions = (
  question: MicrosoftFormQuestionRecord,
  questionInfo: MicrosoftFormQuestionInfo
): StructuredOption[] => {
  const explicitOptions = extractChoiceOptions(question, questionInfo);
  if (explicitOptions.length > 0) {
    return explicitOptions;
  }

  const min =
    asNumber(questionInfo.MinRating) ??
    asNumber(questionInfo.MinValue) ??
    (question.type === 'Question.NetPromoterScore' ? 0 : 1);
  const max =
    asNumber(questionInfo.MaxRating) ??
    asNumber(questionInfo.MaxValue) ??
    asNumber(questionInfo.RatingLevel) ??
    (question.type === 'Question.NetPromoterScore' ? 10 : 5);

  const options: StructuredOption[] = [];
  for (let value = min; value <= max; value += 1) {
    options.push({
      id: String(value),
      text: String(value)
    });
  }
  return options;
};

const buildQuestionIdentifier = (question: MicrosoftFormQuestionRecord, index: number, suffix?: string): string => {
  const base = asString(question.id) || `microsoft-form-item-${index + 1}`;
  return suffix ? `${base}-${suffix}` : base;
};

const toOpenQuestion = (
  question: MicrosoftFormQuestionRecord,
  index: number,
  type: 'short_text' | 'extended_text',
  prompt: string,
  description: string
): StructuredQuestion => {
  const questionInfo = parseQuestionInfo(question);
  const expectedLength =
    asNumber(questionInfo.ExpectedLength) ??
    asNumber(questionInfo.MaxLength) ??
    (type === 'short_text' ? 64 : 200);

  return {
    type,
    identifier: buildQuestionIdentifier(question, index),
    title: prompt,
    prompt,
    generalFeedback: description || undefined,
    correctResponse: asString(questionInfo.CorrectAnswer) || undefined,
    expectedLength
  };
};

const extractRows = (questionInfo: MicrosoftFormQuestionInfo): string[] => {
  const candidates = [questionInfo.Rows, questionInfo.Statements, questionInfo.RowTitles];
  for (const candidate of candidates) {
    const rows = asArray(candidate)
      .map(value => {
        if (isRecord(value)) {
          return asString(value.title) || asString(value.Title) || asString(value.description) || asString(value.Description);
        }
        return asString(value);
      })
      .filter(Boolean);
    if (rows.length > 0) {
      return rows;
    }
  }
  return [];
};

const normalizeQuestion = (question: MicrosoftFormQuestionRecord, index: number): StructuredQuestion[] => {
  const type = asString(question.type);
  const prompt = extractText(question, 'formsProRTQuestionTitle', 'title') || `Microsoft Form question ${index + 1}`;
  const description = extractText(question, 'formsProRTSubtitle', 'subtitle');
  const questionInfo = parseQuestionInfo(question);

  if (type === 'Question.TextField' || type === 'Question.Date' || type === 'Question.Time' || type === 'Question.Number') {
    const multiline = asBoolean(questionInfo.Multiline) || false;
    return [toOpenQuestion(question, index, multiline ? 'extended_text' : 'short_text', prompt, description)];
  }

  if (type === 'Question.Choice') {
    const options = extractChoiceOptions(question, questionInfo);
    if (options.length < 2) {
      return [];
    }
    return [
      {
        type: 'multiple_choice',
        identifier: buildQuestionIdentifier(question, index),
        title: prompt,
        prompt,
        options,
        selectionMode: question.allowMultipleValues === true || asNumber(questionInfo.ChoiceType) === 2 ? 'multiple' : 'single',
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 'Question.Rating' || type === 'Question.NetPromoterScore') {
    const options = buildScaleOptions(question, questionInfo);
    if (options.length < 2) {
      return [];
    }
    return [
      {
        type: 'multiple_choice',
        identifier: buildQuestionIdentifier(question, index),
        title: prompt,
        prompt,
        options,
        selectionMode: 'single',
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 'Question.Likert' || type === 'Question.MatrixChoice') {
    const options = extractChoiceOptions(question, questionInfo);
    const rows = extractRows(questionInfo);
    if (options.length < 2 || rows.length === 0) {
      return [];
    }
    return rows.map((row, rowIndex) => ({
      type: 'multiple_choice',
      identifier: buildQuestionIdentifier(question, index, String(rowIndex + 1)),
      title: `${prompt} - ${row}`,
      stimulus: prompt,
      prompt: row,
      options,
      selectionMode: 'single',
      generalFeedback: description || undefined
    }));
  }

  return [];
};

const parseRuntimeQuestions = (value: unknown): MicrosoftFormParseResult => {
  const root = isRecord(value) ? value : {};
  const form = isRecord(root.form) ? root.form : root;
  const title = asString(form.title);
  const description = asString(form.description);
  const questions = asArray(form.questions)
    .filter(isRecord)
    .sort((left, right) => (asNumber(left.order) ?? 0) - (asNumber(right.order) ?? 0))
    .flatMap((question, index) => normalizeQuestion(question, index));

  return {
    title: title || undefined,
    description: description || undefined,
    questions
  };
};

const extractServerInfo = (html: string): Record<string, unknown> => {
  const match = html.match(OFFICE_FORM_SERVER_INFO_RE);
  if (!match) {
    throw new Error('Could not find OfficeFormServerInfo in the Microsoft Forms HTML.');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
};

export const extractMicrosoftFormPrefetchRequest = (html: string): MicrosoftFormPrefetchRequest => {
  const serverInfo = extractServerInfo(html);
  const url = asString(serverInfo.prefetchFormUrl) || asString(serverInfo.prefetchFormWithResponsesUrl);
  if (!url) {
    throw new Error('Could not find a Microsoft Forms prefetch URL.');
  }

  const headers: Record<string, string> = {};
  const antiForgeryToken = asString(serverInfo.antiForgeryToken);
  const serverSessionId =
    asString(serverInfo.serverSessionId) ||
    (isRecord(serverInfo.serverInfoFromPageHeaders) ? asString(serverInfo.serverInfoFromPageHeaders.serverSesionId) : '');

  if (antiForgeryToken) {
    headers.__RequestVerificationToken = antiForgeryToken;
  }
  if (serverSessionId) {
    headers['X-UserSessionId'] = serverSessionId;
  }
  headers.Accept = 'application/json';
  headers['Content-Type'] = 'application/json';

  return { url, headers };
};

export const parseMicrosoftForm = (input: string): MicrosoftFormParseResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Microsoft Forms input is empty.');
  }

  if (trimmed.startsWith('{')) {
    return parseRuntimeQuestions(JSON.parse(trimmed) as unknown);
  }

  extractMicrosoftFormPrefetchRequest(input);
  throw new Error('Microsoft Forms HTML requires the runtime form definition. Use convertMicrosoftFormToQtiPackage() to fetch and convert it.');
};

export async function convertMicrosoftFormToQtiPackage(
  input: MicrosoftFormInput,
  options: ConvertMicrosoftFormToQtiOptions = {}
): Promise<Pick<SpreadsheetToQtiResult, 'questions' | 'packageBlob' | 'packageName' | 'summary'> & { formTitle?: string; formDescription?: string }> {
  const htmlOrJson = MICROSOFT_FORM_URL_RE.test(input) ? await (options.fetchFormHtml || defaultMicrosoftFormHtmlFetcher)(input) : input;

  let parsed = htmlOrJson.trim().startsWith('{') ? parseRuntimeQuestions(JSON.parse(htmlOrJson) as unknown) : null;
  if (!parsed) {
    const prefetchRequest = extractMicrosoftFormPrefetchRequest(htmlOrJson);
    const runtimeJson = await (options.fetchRuntimeForm || defaultMicrosoftFormRuntimeFetcher)(prefetchRequest.url, {
      headers: prefetchRequest.headers
    });
    parsed = parseRuntimeQuestions(JSON.parse(runtimeJson) as unknown);
  }

  if (parsed.questions.length === 0) {
    throw new Error('No supported Microsoft Forms questions were found.');
  }

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(parsed.questions, {
    ...options,
    testTitle: options.testTitle || parsed.title || 'Imported Microsoft Form'
  });

  return {
    formTitle: parsed.title,
    formDescription: parsed.description,
    questions: parsed.questions,
    packageBlob: blob,
    packageName,
    summary
  };
}
