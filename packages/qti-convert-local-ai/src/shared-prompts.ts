/**
 * Shared Prompts for Document Converters
 *
 * Common prompt components used by PDF, DOCX, and other document parsers.
 * This ensures consistent LLM behavior across document types.
 */

// ---------------------------------------------------------------------------
// Question Format Description
// ---------------------------------------------------------------------------

/**
 * Standard question JSON shape used in all normalization prompts.
 */
export const QUESTION_JSON_SHAPE = `{
  "type": "multiple_choice" | "extended_text",
  "prompt": "The question text without numbering",
  "stimulus": "Optional shared passage or context",
  "options": [{"id": "A", "text": "Option text", "isCorrectAnswer": false}],
  "points": 1,
  "selectionMode": "single" | "multiple",
  "layout": "auto" | "two_column"
}`;

/**
 * Instructions for determining question type.
 */
export const QUESTION_TYPE_INSTRUCTIONS = [
  '- Multiple choice: has answer options labeled A, B, C, D etc.',
  '- Extended text: open questions, fill-in-the-blank, or essay questions without predefined options',
  '- Do NOT confuse subquestions (a, b, c) with answer choices (A, B, C, D)'
].join('\n');

/**
 * Instructions for extracting metadata from question text.
 */
export const METADATA_EXTRACTION_INSTRUCTIONS = [
  '- Points: Extract from patterns like "2p", "3p", "(3 points)", "2 punten" → points:2',
  '- Dutch exam format: "2p   1   Leg uit..." means question 1 worth 2 points',
  '- Selection mode: "meerdere antwoorden", "select all", "kies alle" → selectionMode:"multiple"',
  '- Remove question numbering like "1.", "5a.", "a)", "Vraag 3" from the prompt text'
].join('\n');

/**
 * Instructions for handling subquestions and compound items.
 */
export const SUBQUESTION_INSTRUCTIONS = [
  '- If blocks contain subquestions (a, b, c, 1a, 1b), extract as separate questions',
  '- Subquestions share their parent stimulus/context',
  '- Each subquestion becomes its own question in the output array'
].join('\n');

// ---------------------------------------------------------------------------
// Normalization Examples
// ---------------------------------------------------------------------------

/**
 * Few-shot examples showing how to normalize Dutch exam questions.
 */
export const NORMALIZATION_EXAMPLES = `
EXAMPLE 1: Dutch exam with points prefix

Input:
{"blocks": [{"blockIndex": 0, "text": "Opgave 1 Analyse minimumuurloon"}, {"blockIndex": 1, "text": "Nederland heeft een wettelijk minimumuurloon..."}, {"blockIndex": 2, "text": "2p   1   Leg de uitspraak van econoom 1 uit."}]}

Output:
{"questions": [{"type": "extended_text", "stimulus": "Opgave 1 Analyse minimumuurloon\\n\\nNederland heeft een wettelijk minimumuurloon...", "prompt": "Leg de uitspraak van econoom 1 uit.", "points": 2}]}

EXAMPLE 2: Calculation question

Input:
{"blocks": [{"blockIndex": 0, "text": "Gebruik bron 1."}, {"blockIndex": 1, "text": "1p   4   Bereken hoeveel procent het minimumuurloon van een 20-jarige hoger is dan dat van een 16-jarige."}]}

Output:
{"questions": [{"type": "extended_text", "stimulus": "Gebruik bron 1.", "prompt": "Bereken hoeveel procent het minimumuurloon van een 20-jarige hoger is dan dat van een 16-jarige.", "points": 1}]}

EXAMPLE 3: Multiple choice with options

Input:
{"blocks": [{"blockIndex": 0, "text": "2p   8   Maak van onderstaande tekst een economisch juiste redenering."}, {"blockIndex": 1, "text": "De markt kan worden gezien als ...(1)..."}, {"blockIndex": 2, "text": "Kies uit:"}, {"blockIndex": 3, "text": "bij (1) volkomen concurrentie / monopolistische concurrentie / oligopolie"}]}

Output:
{"questions": [{"type": "multiple_choice", "prompt": "Maak van onderstaande tekst een economisch juiste redenering.\\n\\nDe markt kan worden gezien als ...(1)...", "options": [{"id": "A", "text": "volkomen concurrentie"}, {"id": "B", "text": "monopolistische concurrentie"}, {"id": "C", "text": "oligopolie"}], "points": 2}]}

Key patterns:
- "Xp   N   " prefix: X is points, N is question number (remove from prompt)
- "Opgave" text becomes stimulus (shared context)
- "Gebruik bron X" is part of stimulus
- "Leg uit", "Bereken", "Noem" → extended_text
- "Kies uit" with options → multiple_choice
`;

// ---------------------------------------------------------------------------
// Batched Normalization Prompt Builder
// ---------------------------------------------------------------------------

export interface ItemGroup {
  itemIndex: number;
  blocks: string[];
}

/**
 * Build a batched normalization prompt for multiple items.
 * Used by both PDF and DOCX parsers for consistent behavior.
 *
 * @param documentType - "PDF" or "DOCX" for context
 * @param itemGroups - Array of item groups with their block texts
 */
export const buildBatchedNormalizationPrompt = (documentType: 'PDF' | 'DOCX', itemGroups: ItemGroup[]): string =>
  [
    `Convert these ${documentType} assessment items into normalized question JSON.`,
    'Return strict JSON only.',
    'Return {"items":[{"itemIndex":0,"questions":[...]},{"itemIndex":1,"questions":[...]},...]}',
    '',
    'Question shape:',
    QUESTION_JSON_SHAPE,
    '',
    'Type detection:',
    QUESTION_TYPE_INSTRUCTIONS,
    '',
    'Metadata extraction:',
    METADATA_EXTRACTION_INSTRUCTIONS,
    '',
    'Subquestions:',
    SUBQUESTION_INSTRUCTIONS,
    '',
    NORMALIZATION_EXAMPLES,
    '',
    'Item groups to convert:',
    JSON.stringify(
      itemGroups.map(group => ({
        itemIndex: group.itemIndex,
        blocks: group.blocks.map((text, i) => ({ blockIndex: i, text }))
      })),
      null,
      2
    )
  ].join('\n');

// ---------------------------------------------------------------------------
// Single Item Normalization Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build a normalization prompt for a single item.
 * Used as fallback when batching is not applicable.
 *
 * @param documentType - "PDF" or "DOCX" for context
 * @param blocks - Array of text blocks for this item
 */
export const buildSingleItemNormalizationPrompt = (documentType: 'PDF' | 'DOCX', blocks: string[]): string =>
  [
    `Convert these ordered ${documentType} item blocks into normalized question JSON.`,
    'Return strict JSON only.',
    'Return {"questions":[...]}',
    '',
    'Question shape:',
    QUESTION_JSON_SHAPE,
    '',
    'Type detection:',
    QUESTION_TYPE_INSTRUCTIONS,
    '',
    'Metadata extraction:',
    METADATA_EXTRACTION_INSTRUCTIONS,
    '',
    'Subquestions:',
    SUBQUESTION_INSTRUCTIONS,
    '',
    JSON.stringify(
      blocks.map((text, index) => ({ index, text })),
      null,
      2
    )
  ].join('\n\n');

// ---------------------------------------------------------------------------
// Segmentation Examples
// ---------------------------------------------------------------------------

/**
 * Few-shot examples showing how to segment Dutch exam format.
 */
export const SEGMENTATION_EXAMPLES = `
EXAMPLE: Dutch national exam format

Input blocks:
[
  {"index": 0, "text": "Examen HAVO 2025 tijdvak 1"},
  {"index": 1, "text": "economie"},
  {"index": 2, "text": "Dit examen bestaat uit 29 vragen."},
  {"index": 3, "text": "Opgave 1 Analyse van het minimumuurloon"},
  {"index": 4, "text": "Nederland heeft een wettelijk minimumuurloon..."},
  {"index": 5, "text": "2p   1   Leg de uitspraak van econoom 1 uit."},
  {"index": 6, "text": "2p   2   Leg de uitspraak van econoom 2 uit."},
  {"index": 7, "text": "Het debat gaat verder..."},
  {"index": 8, "text": "2p   3   Leg uit welk effect..."},
  {"index": 9, "text": "Gebruik bron 1."},
  {"index": 10, "text": "1p   4   Bereken hoeveel procent..."}
]

Output:
{
  "ignoredBlocks": [0, 1, 2],
  "items": [
    {"blockIndexes": [3, 4, 5]},
    {"blockIndexes": [6]},
    {"blockIndexes": [7, 8]},
    {"blockIndexes": [9, 10]}
  ]
}

Key patterns:
- "Xp   N   " (e.g., "2p   1   ") marks the START of a new question
- "Opgave N" introduces shared context for following questions
- Context blocks (Opgave text) go with the FIRST question that follows
- Each "Xp   N   " line is a separate item
- "Gebruik bron X" before a question belongs to that question
`;

// ---------------------------------------------------------------------------
// Segmentation Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build a segmentation prompt to split text blocks into item groups.
 *
 * @param documentType - "PDF" or "DOCX" for context
 * @param blocks - Array of text blocks with their indexes
 */
export const buildSegmentationPrompt = (
  documentType: 'PDF' | 'DOCX',
  blocks: Array<{ index: number; text: string }>
): string =>
  [
    `Split these ordered ${documentType} text blocks into assessment items.`,
    'Return strict JSON only.',
    'Use this shape: {"ignoredBlocks":[0,1],"items":[{"blockIndexes":[2,3,4]},{"blockIndexes":[5,6]}]}.',
    '',
    'Guidelines:',
    '- Each question with points (e.g., "2p   1   ", "3p   12   ") is a SEPARATE item',
    '- "Opgave X" or section headers introduce shared context - attach to first question',
    '- "Gebruik bron X" (use source X) belongs with the question that follows',
    '- Ignore document chrome: exam title, page numbers, instructions about scoring',
    '- Keep answer options (A, B, C, D) with their parent question',
    '- Preserve original block order',
    '',
    SEGMENTATION_EXAMPLES,
    '',
    'Now segment these blocks:',
    JSON.stringify(blocks, null, 2)
  ].join('\n');
