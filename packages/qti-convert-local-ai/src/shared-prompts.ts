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
  '- Multiple choice: has answer options labeled A, B, C, D etc. EXPLICITLY in the text',
  '- Extended text: open questions, fill-in-the-blank, or essay questions without predefined options',
  '- Do NOT confuse subquestions (a, b, c) with answer choices (A, B, C, D)',
  '',
  'CRITICAL - NEVER ADD CONTENT:',
  '- ONLY use "multiple_choice" if options A/B/C/D are EXPLICITLY written in the source text',
  '- NEVER generate or invent options that do not exist in the source',
  '- If unsure, use "extended_text" - it is always safe',
  '- Questions asking to "explain", "calculate", "describe", "motivate" are ALWAYS extended_text'
].join('\n');

/**
 * Instructions for extracting metadata from question text.
 */
export const METADATA_EXTRACTION_INSTRUCTIONS = [
  '- Points: Extract from patterns like "2p", "3 points", "(5 marks)", "2 punti", "3 pts" → points:N',
  '- Score prefix format: "[Xp] [N] Question..." means question N worth X points (common in standardized exams)',
  '- REMOVE the score prefix from the prompt text! "2p 1 Leg uit..." → prompt: "Leg uit..." (NOT "2p 1 Leg uit...")',
  '- Selection mode: "select all", "multiple answers", "choose all that apply" → selectionMode:"multiple"',
  '- Remove question numbering like "1.", "Q1", "5a.", "a)", "Question 3", "Vraag 3", "Domanda 1" from the prompt text'
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
 * Few-shot examples showing how to normalize exam questions from various formats.
 * Examples include different languages to demonstrate pattern-based extraction.
 */
export const NORMALIZATION_EXAMPLES = `
IMPORTANT: Questions can be in ANY language. Focus on STRUCTURAL patterns:
- Points/scores: "2p", "3 points", "(5 marks)", "2 punti"
- Question numbers: "1.", "Q1", "Question 1", etc. (remove from prompt)
- Section headers become stimulus (shared context)
- Determine type by structure, not language keywords

CRITICAL - PRESERVE TEXT EXACTLY:
- NEVER invent, add, or generate content that is not in the source
- ONLY use multiple_choice if options A/B/C/D are EXPLICITLY written in the source
- If there are NO options in the text, use extended_text
- Copy text verbatim - do not paraphrase or summarize

EXAMPLE 1: Points-prefixed format (e.g., Dutch/European standardized exams)

Input:
{"blocks": [{"blockIndex": 0, "text": "Opgave 1 Analysis"}, {"blockIndex": 1, "text": "Country X has a minimum wage policy..."}, {"blockIndex": 2, "text": "2p   1   Explain the economist's statement."}]}

Output:
{"questions": [{"type": "extended_text", "stimulus": "Opgave 1 Analysis\\n\\nCountry X has a minimum wage policy...", "prompt": "Explain the economist's statement.", "points": 2}]}

Note: "2p 1" was REMOVED from prompt. Extract points:2, remove the prefix entirely.

EXAMPLE 2: Standard numbered with stimulus

Input:
{"blocks": [{"blockIndex": 0, "text": "Use source 1."}, {"blockIndex": 1, "text": "1p   4   Calculate the percentage difference between the two values."}]}

Output:
{"questions": [{"type": "extended_text", "stimulus": "Use source 1.", "prompt": "Calculate the percentage difference between the two values.", "points": 1}]}

EXAMPLE 3: Multiple choice with options

Input:
{"blocks": [{"blockIndex": 0, "text": "2p   8   Complete the text with the correct economic term."}, {"blockIndex": 1, "text": "The market can be seen as ...(1)..."}, {"blockIndex": 2, "text": "Choose from:"}, {"blockIndex": 3, "text": "(1) perfect competition / monopolistic competition / oligopoly"}]}

Output:
{"questions": [{"type": "multiple_choice", "prompt": "Complete the text with the correct economic term.\\n\\nThe market can be seen as ...(1)...", "options": [{"id": "A", "text": "perfect competition"}, {"id": "B", "text": "monopolistic competition"}, {"id": "C", "text": "oligopoly"}], "points": 2}]}

Key patterns to recognize:
- "[Xp] [N]" or "(X points)" prefix → extract points, remove from prompt
- Section headers ("Opgave", "Exercice", "Part") → become stimulus
- "Use source X", "See figure Y" → include in stimulus
- Questions asking to explain, calculate, analyze → extended_text
- Questions with A/B/C/D options or "choose from" → multiple_choice
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
// Boundary Detection Prompt (Phase 1)
// ---------------------------------------------------------------------------

/**
 * Concise examples for boundary detection. Keep short to fit in context window.
 * Uses SEMANTIC detection: identify blocks that contain IMPERATIVE VERBS commanding the student.
 * Also recognizes score markers (Xp N) as strong hints.
 */
export const BOUNDARY_DETECTION_EXAMPLES = `
A QUESTION block contains an IMPERATIVE VERB (command to student) - can be in ANY language:
- Dutch: "Leg uit", "Bereken", "Toon aan", "Motiveer", "Geef", "Beschrijf", "Noem", "Vergelijk"
- English: "Explain", "Calculate", "Show", "Prove", "Describe", "List", "Compare", "Analyze", "Define"
- German: "Erkläre", "Berechne", "Beschreibe", "Nenne", "Vergleiche"
- French: "Expliquez", "Calculez", "Décrivez", "Comparez"
- Spanish: "Explica", "Calcula", "Describe", "Compara"
- Other languages: Look for command verbs addressed to the student

STRONG HINT: "Xp N" pattern (e.g., "2p 16", "1p 21") almost always marks a question start.

CRITICAL - ANSWER OPTIONS ARE NOT QUESTIONS:
- Lines starting with "A ", "B ", "C ", "D ", "E ", "F " followed by text are ANSWER OPTIONS
- Answer options belong to the PREVIOUS question - they are NOT new item starts
- Bullet lists (•, -, *) followed by text are also answer options, not new items
- DO NOT put answer option lines in itemStartIndexes!

NOT a question (CONTEXT):
- Quotes: "Een econoom zegt: ..." 
- Facts: "De overheid verhoogde..."
- Scenarios without imperative: "Stel dat..."
- Answer options: "A De markt...", "B Het aanbod...", etc.

EX1: Multiple choice with answer options
[{"index":0,"text":"2p 1 Wat zijn drie voorbeelden van materiële cultuurelementen?"},{"index":1,"text":"A De Nachtwacht is het beroemdste schilderij."},{"index":2,"text":"B In de winter wordt er stamppot gegeten."},{"index":3,"text":"C In Drenthe spreekt 55% een dialect."},{"index":4,"text":"D Nederland kleurt oranje bij voetbal."},{"index":5,"text":"2p 2 Leg uit wat immateriële cultuur is."}]
Output: {"itemStartIndexes":[0,5],"contextIndexes":[],"ignoredIndexes":[]}
Why: Block 0 and 5 are questions (have "Xp N" + imperative). Blocks 1-4 are ANSWER OPTIONS (start with A/B/C/D) - they belong to question at block 0, NOT separate items.

EX2: Regular questions without options
[{"index":0,"text":"Exam 2025"},{"index":1,"text":"Een econoom zegt: 'De markt faalt.'"},{"index":2,"text":"2p 16 Leg uit waarom de markt faalt."},{"index":3,"text":"De overheid besluit in te grijpen."},{"index":4,"text":"2p 17 Leg uit welk effect dit heeft."},{"index":5,"text":"1p 18 Bereken het percentage."}]
Output: {"itemStartIndexes":[2,4,5],"contextIndexes":[1,3],"ignoredIndexes":[0]}
Why: Blocks 2,4,5 have "Xp N" AND imperatives. Blocks 1,3 are descriptive context.

EX3: Question with bullet options
[{"index":0,"text":"2p 5 Welke stelling is juist?"},{"index":1,"text":"• Stelling 1: De prijs stijgt"},{"index":2,"text":"• Stelling 2: Het aanbod daalt"},{"index":3,"text":"1p 6 Bereken de elasticiteit."}]
Output: {"itemStartIndexes":[0,3],"contextIndexes":[],"ignoredIndexes":[]}
Why: Block 0 is a question. Blocks 1-2 are bullet options (belong to question 0). Block 3 is next question.

Rule: If a block starts with A/B/C/D/E/F + space + text, OR • / - / * → it's an ANSWER OPTION, not a question.
`;

/**
 * Build a prompt for Phase 1: detecting item boundaries.
 * This is a lighter task than full segmentation - just identify WHERE items start.
 *
 * @param documentType - "PDF" or "DOCX" for context
 * @param blocks - Array of text blocks with their indexes
 */
export const buildBoundaryDetectionPrompt = (
  documentType: 'PDF' | 'DOCX',
  blocks: Array<{ index: number; text: string }>
): string =>
  [
    `Identify assessment QUESTIONS in these ${documentType} text blocks. Return strict JSON.`,
    '',
    'A QUESTION block has BOTH:',
    '1. Score marker like "2p 16", "1p 21" (X points, question N)',
    '2. Imperative verb (command to the student) - can be in ANY language:',
    '   - Dutch: Leg uit, Bereken, Toon aan, Motiveer, Geef, Beschrijf, Noem, Vergelijk',
    '   - English: Explain, Calculate, Show, Prove, Describe, List, Compare, Analyze, Define',
    '',
    'CRITICAL: ANSWER OPTIONS ARE NOT QUESTIONS!',
    '- Lines starting with A/B/C/D/E/F + space + text are ANSWER OPTIONS',
    '- Bullet points (•, -, *) followed by text are ANSWER OPTIONS',
    '- Answer options belong to the PREVIOUS question, NOT separate items',
    '',
    'CONTEXT blocks are descriptive (no imperative): quotes, facts, scenarios',
    'IGNORED blocks: titles, page numbers, dates',
    '',
    'Output: {"itemStartIndexes":[...], "contextIndexes":[...], "ignoredIndexes":[...]}',
    '',
    BOUNDARY_DETECTION_EXAMPLES,
    '',
    'Blocks to analyze:',
    JSON.stringify(blocks, null, 2)
  ].join('\n');

/**
 * Build a prompt for Phase 1 with context from previous chunk.
 */
export const buildBoundaryDetectionPromptWithContext = (
  documentType: 'PDF' | 'DOCX',
  blocks: Array<{ index: number; text: string }>,
  previousContext: Array<{ index: number; text: string }>
): string => {
  let prompt = buildBoundaryDetectionPrompt(documentType, blocks);

  if (previousContext.length > 0) {
    const contextNote = [
      '',
      '--- CONTEXT FROM PREVIOUS CHUNK ---',
      'These blocks are from the end of the previous chunk. They help you understand',
      'if the first blocks in the current chunk need context or are continuations.',
      'Do NOT include these indexes in your output - only analyze them for context.',
      '',
      JSON.stringify(previousContext, null, 2),
      '',
      '--- END CONTEXT ---',
      ''
    ].join('\n');

    prompt = prompt.replace(
      'Now analyze these blocks and identify item boundaries:',
      contextNote + 'Now analyze these blocks and identify item boundaries:'
    );
  }

  return prompt;
};

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
