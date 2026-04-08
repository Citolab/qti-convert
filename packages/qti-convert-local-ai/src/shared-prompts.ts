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
  '- Points: Extract from patterns like "2p", "(3 points)", "2 punten" → points:2',
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
    '- Decide which blocks are relevant assessment content vs document chrome (headers, footers)',
    '- Determine item boundaries from content, not just numbering',
    '- Keep answer options with their parent question block',
    '- If an item has subparts (a, b, c), include all as one item group',
    '- Preserve original block order',
    '',
    JSON.stringify(blocks, null, 2)
  ].join('\n');
