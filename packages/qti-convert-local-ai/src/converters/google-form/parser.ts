import { generateQtiPackageFromQuestions } from '../../qti-generator';
import { GenerateQtiPackageOptions, SpreadsheetToQtiResult, StructuredOption, StructuredQuestion } from '../../types';

type GoogleFormInput = string;

type GoogleFormFetcher = (url: string) => Promise<string>;

export type ConvertGoogleFormToQtiOptions = GenerateQtiPackageOptions & {
  fetchFormHtml?: GoogleFormFetcher;
};

type GoogleFormQuestionType = 0 | 1 | 2 | 3 | 4 | 5 | 7;

type GoogleFormParseResult = {
  title?: string;
  description?: string;
  questions: StructuredQuestion[];
};

const GOOGLE_FORM_URL_RE = /^https:\/\/docs\.google\.com\/forms\//i;

/**
 * Normalizes Google Form URLs to the public viewform URL.
 * Handles various URL formats:
 * - /edit -> /viewform
 * - /d/FORM_ID/edit -> /d/e/PUBLISHED_ID/viewform (via redirect)
 * - Already viewform URLs pass through unchanged
 */
export const normalizeGoogleFormUrl = (url: string): string => {
  // If it's an edit URL, convert to viewform
  // Pattern: https://docs.google.com/forms/d/FORM_ID/edit
  // Should become: https://docs.google.com/forms/d/FORM_ID/viewform
  if (url.includes('/edit')) {
    return url.replace(/\/edit(\?.*)?$/, '/viewform$1').replace(/\/edit$/, '/viewform');
  }
  // If URL doesn't end with viewform, append it
  if (!url.includes('/viewform')) {
    // Remove trailing slash if present, then add /viewform
    return url.replace(/\/?$/, '/viewform');
  }
  return url;
};

/**
 * Extracts a short identifier from a Google Forms URL for use in package names
 * Example: https://docs.google.com/forms/d/1twzZhH5iloxZIkq3fbN-y1IvAaIiPGO7r7r49tKCDE4/viewform
 *          -> "1twzZhH5iloxZIkq3fbN-y1IvAaIiPGO7r7r49tKCDE4"
 */
export const deriveGoogleFormIdentifier = (url: string): string => {
  // Extract form ID from URL pattern: /forms/d/FORM_ID/
  const match = url.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  
  // Fallback: use a portion of the URL as identifier
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const formIndex = pathSegments.indexOf('forms');
    if (formIndex >= 0 && pathSegments[formIndex + 2]) {
      return pathSegments[formIndex + 2];
    }
  } catch {
    // URL parsing failed, continue to final fallback
  }
  
  // Final fallback: generate from timestamp
  return `google-form-${Date.now()}`;
};

// Multiple extraction patterns for Google Forms data (Google changes these periodically)
const EXTRACTION_PATTERNS = [
  // Original pattern (pre-2024)
  /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s,
  // Alternative patterns Google may use
  /var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s,
  // AF_initDataCallback pattern used by some Google services
  /AF_initDataCallback\s*\(\s*\{[^}]*data:\s*(\[.*?\])\s*\}\s*\)/s,
  // Direct array assignment in script tags - look for form data structure
  /<script[^>]*>\s*(\[\s*null\s*,\s*\[.*?\]\s*,\s*"[^"]*"\s*(?:,.*?)?\])\s*;?\s*<\/script>/s,
  // Look for any variable assignment with form-like data structure
  /=\s*(\[\s*null\s*,\s*\[\s*"[^"]*".*?\]\s*,\s*"https:\/\/docs\.google\.com\/forms[^"]*".*?\]);/s
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const defaultGoogleFormFetcher: GoogleFormFetcher = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit'
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google Form (${response.status}).`);
  }
  return await response.text();
};

const extractPayloadSource = (input: string): string => {
  const trimmed = input.trim();
  // If already a JSON array, return as-is
  if (trimmed.startsWith('[')) {
    return trimmed;
  }

  // Try each extraction pattern
  for (const pattern of EXTRACTION_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  // Fallback: search for large JSON array that looks like form data
  // Look for pattern: [null,[ followed by form structure
  const fallbackMatch = input.match(/(\[\s*null\s*,\s*\[[^\]]*"[^"]*"[^\]]*\])/s);
  if (fallbackMatch?.[1]) {
    // Try to find the complete balanced array
    const startIndex = input.indexOf(fallbackMatch[1]);
    if (startIndex !== -1) {
      let depth = 0;
      let endIndex = startIndex;
      for (let i = startIndex; i < input.length && i < startIndex + 500000; i++) {
        if (input[i] === '[') depth++;
        else if (input[i] === ']') {
          depth--;
          if (depth === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }
      if (endIndex > startIndex) {
        const candidate = input.slice(startIndex, endIndex);
        // Validate it looks like form data (has the expected structure)
        if (candidate.includes('"docs.google.com/forms') || candidate.match(/\[\s*null\s*,\s*\[\s*"[^"]*"/)) {
          return candidate;
        }
      }
    }
  }

  throw new Error(
    'Could not extract form data from Google Forms HTML. ' +
      'Google may have changed their page structure. ' +
      'Please report this issue with a sample form URL.'
  );
};

const parsePayload = (input: string): unknown[] => {
  const source = extractPayloadSource(input)
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');

  try {
    return JSON.parse(source) as unknown[];
  } catch {
    return Function(`"use strict"; return (${source});`)() as unknown[];
  }
};

const extractQuestionTitle = (field: unknown[], index: number): string =>
  asString(field[1]) || `Google Form question ${index + 1}`;
const extractQuestionDescription = (field: unknown[]): string => asString(field[2]);
const extractQuestionType = (field: unknown[]): GoogleFormQuestionType | null => {
  const value = asNumber(field[3]);
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 7) {
    return value;
  }
  return null;
};

const extractEntryList = (field: unknown[]): unknown[][] => asArray(field[4]).filter(Array.isArray) as unknown[][];

const extractChoiceOptions = (entry: unknown[] | undefined): Array<Required<Pick<StructuredOption, 'id' | 'text'>>> => {
  const rawOptions = asArray(entry?.[1]);
  return rawOptions
    .map<Required<Pick<StructuredOption, 'id' | 'text'>> | null>((option, index) => {
      const values = asArray(option);
      const text = asString(values[0]);
      if (!text) {
        return null;
      }
      return {
        id: String.fromCharCode(65 + index),
        text
      };
    })
    .filter((option): option is Required<Pick<StructuredOption, 'id' | 'text'>> => option !== null);
};

const collectNumericValues = (value: unknown, bucket: number[] = []): number[] => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    bucket.push(value);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumericValues(item, bucket);
    }
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectNumericValues(item, bucket);
    }
  }
  return bucket;
};

const inferLinearScaleOptions = (field: unknown[], entry: unknown[] | undefined): StructuredOption[] => {
  const directOptions = extractChoiceOptions(entry);
  if (directOptions.length > 0) {
    return directOptions;
  }

  const numericCandidates = collectNumericValues([field, entry])
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 10)
    .sort((left, right) => left - right);

  let min = 1;
  let max = 5;
  for (let index = 0; index < numericCandidates.length - 1; index += 1) {
    const start = numericCandidates[index];
    const end = numericCandidates[index + 1];
    if (end > start && end - start <= 10) {
      min = start;
      max = end;
      break;
    }
  }

  const options: StructuredOption[] = [];
  for (let value = min; value <= max; value += 1) {
    options.push({
      id: String(value),
      text: String(value)
    });
  }
  return options;
};

const extractGridRowLabel = (entry: unknown[], index: number): string => {
  const directCandidates = [entry[3], entry[6], entry[8], entry[9]];
  for (const candidate of directCandidates) {
    const text = asString(candidate);
    if (text) {
      return text;
    }
    if (Array.isArray(candidate)) {
      const nestedText = candidate.map(asString).find(Boolean);
      if (nestedText) {
        return nestedText;
      }
    }
  }
  return `Row ${index + 1}`;
};

const extractQuestionsFromField = (field: unknown[], index: number): StructuredQuestion[] => {
  const type = extractQuestionType(field);
  if (type == null) {
    return [];
  }

  const title = extractQuestionTitle(field, index);
  const description = extractQuestionDescription(field);
  const prompt = title;
  const entries = extractEntryList(field);
  const firstEntry = entries[0];

  if (type === 0) {
    return [
      {
        type: 'short_text',
        identifier: `google-form-item-${index + 1}`,
        title,
        prompt,
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 1) {
    return [
      {
        type: 'extended_text',
        identifier: `google-form-item-${index + 1}`,
        title,
        prompt,
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 2 || type === 3 || type === 4) {
    const options = extractChoiceOptions(firstEntry);
    if (options.length < 2) {
      return [];
    }
    return [
      {
        type: 'multiple_choice',
        identifier: `google-form-item-${index + 1}`,
        title,
        prompt,
        options,
        selectionMode: type === 4 ? 'multiple' : 'single',
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 5) {
    const options = inferLinearScaleOptions(field, firstEntry);
    if (options.length < 2) {
      return [];
    }
    return [
      {
        type: 'multiple_choice',
        identifier: `google-form-item-${index + 1}`,
        title,
        prompt,
        options,
        selectionMode: 'single',
        generalFeedback: description || undefined
      }
    ];
  }

  if (type === 7) {
    const gridEntries = entries;
    const columnOptions = extractChoiceOptions(gridEntries[0]);
    if (columnOptions.length < 2 || gridEntries.length === 0) {
      return [];
    }

    return gridEntries.map((entry, rowIndex) => ({
      type: 'multiple_choice',
      identifier: `google-form-item-${index + 1}-${rowIndex + 1}`,
      title: `${title} - ${extractGridRowLabel(entry, rowIndex)}`,
      stimulus: title,
      prompt: extractGridRowLabel(entry, rowIndex),
      options: columnOptions,
      selectionMode: 'single',
      generalFeedback: description || undefined
    }));
  }

  return [];
};

export const parseGoogleForm = (input: string): GoogleFormParseResult => {
  const payload = parsePayload(input);
  const formData = asArray(payload[1]);
  const description = asString(formData[0]);
  const fields = asArray(formData[1]).filter(Array.isArray) as unknown[][];
  const title = asString(formData[8]) || asString(payload[3]);
  const questions = fields.flatMap((field, index) => extractQuestionsFromField(field, index));

  return {
    title: title || undefined,
    description: description || undefined,
    questions
  };
};

export async function convertGoogleFormToQtiPackage(
  input: GoogleFormInput,
  options: ConvertGoogleFormToQtiOptions = {}
): Promise<
  Pick<SpreadsheetToQtiResult, 'questions' | 'packageBlob' | 'packageName' | 'summary'> & {
    formTitle?: string;
    formDescription?: string;
  }
> {
  // Normalize URL (convert /edit to /viewform)
  const normalizedInput = GOOGLE_FORM_URL_RE.test(input) ? normalizeGoogleFormUrl(input) : input;
  const source = GOOGLE_FORM_URL_RE.test(normalizedInput)
    ? await (options.fetchFormHtml || defaultGoogleFormFetcher)(normalizedInput)
    : normalizedInput;
  const parsed = parseGoogleForm(source);
  if (parsed.questions.length === 0) {
    throw new Error('No supported Google Forms questions were found.');
  }

  const { blob, packageName, summary } = await generateQtiPackageFromQuestions(parsed.questions, {
    ...options,
    testTitle: options.testTitle || parsed.title || 'Imported Google Form'
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
