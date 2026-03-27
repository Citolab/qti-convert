# @citolab/qti-browser-spreadsheet

Browser-side helpers for converting CSV and Excel datasets into QTI 3.0 packages.

The conversion is best-effort. The package tries to interpret spreadsheet structure conservatively and generate valid QTI output, but it does not guarantee that every CSV or Excel file will be converted correctly or completely without review.

The package supports a hybrid flow:

1. Parse CSV with `papaparse` or Excel with `xlsx`
2. Use a deterministic conversion path for recognized spreadsheet formats
3. Fall back to a local LLM such as WebLLM for unknown spreadsheet shapes
4. Generate QTI deterministically with JavaScript
5. Download the resulting zip in the browser

## Install

```sh
npm install @citolab/qti-browser-spreadsheet
```

## Example

```ts
import {
  convertSpreadsheetToQtiPackage,
  DEFAULT_WEB_LLM_MODEL,
  createWebLlmQuestionInferer
} from '@citolab/qti-browser-spreadsheet';

const inferQuestions = createWebLlmQuestionInferer(engine);

const result = await convertSpreadsheetToQtiPackage(file, inferQuestions, {
  packageIdentifier: 'demo-package',
  testTitle: 'Imported Test',
  onProgress(event) {
    console.log(event.stage, event.message);
  }
});

const blob = result.packageBlob;
console.log(result.summary);
```

If you do not pass a custom inference function, `convertSpreadsheetToQtiPackage(...)` now creates a WebLLM engine itself and uses a default model:

```ts
const result = await convertSpreadsheetToQtiPackage(file, {
  llmSettings: {
    model: DEFAULT_WEB_LLM_MODEL
  }
});
```

Current default: `Llama-3.2-1B-Instruct-q4f32_1-MLC`

You can override the model or supply your own engine factory:

```ts
const result = await convertSpreadsheetToQtiPackage(file, {
  llmSettings: {
    model: 'Llama-3.1-8B-Instruct',
    temperature: 0
  }
});
```

## Deterministic formats

These formats bypass the LLM entirely:

- `text, answer, a, b, c, d, e`
- `text, answer`
- row-oriented exports with columns such as `SE_ItemLabel`, `element_type`, `Element_type_displayLabel`, `Element_Text_Plain`, and `Element_Text_HTML`

The row-oriented Excel path groups rows by item label, extracts prompt, stimulus, options, and correct answer conservatively, and is intended for the export format used by the existing Python importer.

## LLM output contract

For non-deterministic spreadsheet shapes, the LLM should return normalized questions such as:

```json
{
  "questions": [
    {
      "type": "multiple_choice",
      "stimulus": "Here is a longer text",
      "prompt": "What do you think is the answer?",
      "options": [
        { "id": "A", "text": "This is option 1", "isCorrectAnswer": false },
        { "id": "B", "text": "This is option 2", "isCorrectAnswer": true }
      ],
      "layout": "auto",
      "points": 1
    },
    {
      "type": "extended_text",
      "stimulus": "Here is a longer text",
      "prompt": "What do you think is the answer?",
      "correctResponse": "key",
      "expectedLength": 200,
      "layout": "auto",
      "points": 1
    }
  ]
}
```

## Progress and result

`convertSpreadsheetToQtiPackage(...)` returns:

- `spreadsheet`
- `preview`
- `questions`
- `packageBlob`
- `packageName`
- `summary`

The `summary` contains:

- `totalQuestions`
- `generatedItems`
- `skippedItems`
- `warnings`
- `errors`

Progress events include:

- `parse_started`
- `parse_completed`
- `llm_loading_started`
- `llm_loading_completed`
- `mapping_started`
- `mapping_completed`
- `chunk_started`
- `chunk_completed`
- `generation_started`
- `item_generated`
- `package_completed`

## Scope

The package supports multiple-choice and extended-text items, plus optional one-column or two-column item-body layouts driven by the structured question JSON.

## License

Apache-2.0
