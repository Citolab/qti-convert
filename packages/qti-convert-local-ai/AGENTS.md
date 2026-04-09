# qti-convert-local-ai — Agent Instructions

## Purpose

This package provides browser-side document-to-QTI conversion. It parses various document formats (PDF, DOCX, spreadsheets, Google Forms, Microsoft Forms) and converts them into QTI 3.0 packages using a local LLM (WebLLM) for intelligent boundary detection and normalization.

## Supported Input Formats

| Format | Parser | File Types |
|--------|--------|------------|
| PDF | `pdf-parser.ts` | `.pdf` |
| DOCX | `docx-parser.ts` | `.docx` |
| Spreadsheet | `spreadsheet-parser.ts` | `.csv`, `.xlsx`, `.xls` |
| Google Forms | `google-form.ts` | Google Forms URLs |
| Microsoft Forms | `microsoft-form.ts` | Microsoft Forms URLs |
| Remote sources | `remote-source.ts` | URLs to any supported format |

## Core Processing Pipeline (Two-Phase LLM Approach)

All document converters now follow a two-phase LLM approach:

```
Input Document
     │
     ▼
┌─────────────────────────────────────┐
│  PHASE 1: LLM BOUNDARY DETECTION    │  ← Identifies WHERE items start
│  - Analyzes document structure      │     (larger chunks: 60 blocks)
│  - Detects item start patterns      │
│  - Identifies context/section blocks│
│  - Marks ignored blocks (headers)   │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  PHASE 2: LLM NORMALIZATION         │  ← Converts items to JSON
│  - Processes item groups in batches │     (batched: 8 items/call)
│  - Extracts question type, points   │
│  - Handles subquestions (a, b, c)   │
│  - Builds structured questions      │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  GENERATE QTI PACKAGE               │
└─────────────────────────────────────┘
```

## Why Two-Phase LLM?

**Previous approach had issues:**
- Hardcoded regex patterns (e.g., Dutch exam format "2p   1   ") only worked for specific formats
- Fixed chunk boundaries could split items mid-question
- Context blocks (like "Opgave" headers) might be separated from their questions

**New approach benefits:**
- LLM learns the pattern from the document itself
- Context carryover between chunks prevents orphaned items
- Works with any exam format, not just Dutch national exams
- Example-based learning via prompts (see `shared-prompts.ts`)

## Context Carryover Between Chunks

For large documents, Phase 1 processes in chunks with overlap:

```
Document has 150 text blocks (chunk size: 60, carryover: 8)
     │
     ├─► Chunk 1: blocks 0-59   → LLM analyzes, finds items
     │   └─► Trailing 8 blocks (52-59) saved as context
     │
     ├─► Chunk 2: blocks 60-119 + context 52-59
     │   └─► LLM sees context, can attach to first items if needed
     │
     └─► Chunk 3: blocks 120-149 + context 112-119
```

## Key Files

| File | Responsibility |
|------|----------------|
| `shared-prompts.ts` | **LLM prompt templates** — boundary detection & normalization examples |
| `pdf-parser.ts` | PDF parsing and LLM-based conversion |
| `docx-parser.ts` | DOCX parsing and LLM-based conversion |
| `spreadsheet-parser.ts` | CSV/Excel parsing |
| `mapping.ts` | WebLLM engine creation and question inference |
| `qti-generator.ts` | QTI 3.0 XML package generation |
| `converters.ts` | Unified converter interface implementations |
| `types.ts` | Shared TypeScript types |

## Shared Prompts Architecture (`shared-prompts.ts`)

The prompts teach the LLM by example, not by hardcoded patterns:

### Boundary Detection Prompts
- `buildBoundaryDetectionPrompt` — Main prompt for Phase 1
- `buildBoundaryDetectionPromptWithContext` — Includes context from previous chunk
- `BOUNDARY_DETECTION_EXAMPLES` — English examples showing structural patterns that work in any language:
  - Points-prefixed format ("2p   1   ") — Common in standardized exams
  - Standard numbered ("1.", "2.") — Universal
  - Lettered with passage ("Question A:", "Question B:")
  - Exercise sections with sub-numbering ("Exercise 1", "1)")
  - Parenthetical letter format ("Problem 1", "(a)")

### Normalization Prompts
- `buildBatchedNormalizationPrompt` — Converts item blocks to structured JSON
- `buildSingleItemNormalizationPrompt` — Single item fallback
- `NORMALIZATION_EXAMPLES` — Examples showing:
  - Point extraction ("2p", "3 points", "(5 marks)" → points: N)
  - Question type detection (by structure, not keywords)
  - Stimulus/context handling

## Internationalization

The prompts are **language-agnostic** — they focus on **structural patterns** rather than specific words:

```
Focus on STRUCTURE, not language:
- Numbering: "1.", "1)", "(1)", "Q1", "Question 1", etc.
- Scores: "2p", "3 points", "(5 marks)", etc.
- Sections: "Part A", "Section 1", "Exercise 2", "Problem 1", etc.
```

The LLM learns patterns from English examples and generalizes to any language. To add support for a new exam format:

1. Add a boundary detection example to `BOUNDARY_DETECTION_EXAMPLES` (in English)
2. Optionally add a normalization example to `NORMALIZATION_EXAMPLES`
3. Focus on **format/structure**, not language-specific keywords

The LLM generalizes from structural patterns to handle documents in any language, including RTL languages.

## Remaining Regex Patterns (Heuristic Fallback Only)

Some regex patterns remain for the **heuristic fallback** when LLM completely fails:

| Pattern | Purpose | Used In |
|---------|---------|---------|
| `isQuestionStart` | Detect question begins | Fallback extraction |
| `isSubQuestionStart` | Detect "a)", "b)" | Fallback extraction |
| `optionMatch` | Detect "A)", "B)" options | Fallback extraction |
| `scorePattern` | Extract points | Text cleanup |
| `blankPlaceholderPattern` | Detect "___" blanks | Fill-in-blank detection |
| `isLikelyBoilerplate` | Filter headers/footers | Fallback extraction |

These are **only used when LLM fails** — the primary path is all LLM-based.

## Decision Rules

### When to change this package

- Adding support for new document formats
- Improving LLM prompts for better extraction accuracy
- Adding new prompt examples for different exam formats
- Adjusting chunking/batching strategies
- Improving heuristic fallbacks

### When NOT to change this package

- QTI XML structure issues → change `qti-convert-core`
- Browser import/hosting issues → change `qti-browser-import`
- Rendering issues → change `qti-components`

## Adding New Exam Format Support

To support a new exam format, **add examples to the prompts** in `shared-prompts.ts`:

1. Add boundary detection example to `BOUNDARY_DETECTION_EXAMPLES`:
```typescript
EXAMPLE N: Format name (e.g., "Bracketed sub-questions format")

Blocks:
[
  {"index": 0, "text": "Final Exam 2024"},
  {"index": 1, "text": "Part 1 (10 points)"},
  {"index": 2, "text": "[a] Explain the concept of..."},
  {"index": 3, "text": "[b] Calculate the result..."},
  ...
]

Pattern detected: "Questions start with '[letter]' pattern within Part sections"
Reasoning: "Part N" marks sections, questions use "[a]", "[b]" format.
Output: {"itemStartIndexes": [...], "contextIndexes": [...], "ignoredIndexes": [...]}
```

2. Add normalization example to `NORMALIZATION_EXAMPLES` if the format has unique metadata patterns

**Key principles:**
- Write examples in English, describe the STRUCTURAL pattern
- Include "Reasoning:" to help the LLM generalize
- Focus on numbering, punctuation, and formatting patterns
- The LLM will generalize from examples to documents in any language

**Do NOT add hardcoded regex patterns** — teach the LLM through examples instead.

## Testing

Run tests with:
```sh
npm test
```

Key test files:
- `docx-parser.test.ts`
- `pdf-parser.test.ts` (if exists)
- `mapping.test.ts`
- `qti-generator.test.ts`

## LLM Settings

```typescript
{
  model: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',  // Default model
  temperature: 0,                             // Deterministic output
  systemPrompt: string,                       // Optional custom prompt
  instructions: string                        // Additional import instructions
}
```

## Error Handling

If LLM processing fails:
1. Parser logs a warning with diagnostic info
2. Falls back to heuristic extraction (regex-based)
3. Continues with reduced accuracy rather than failing completely
