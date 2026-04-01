# @citolab/qti-convert-local-ai

Browser-side helpers for converting spreadsheets, XML exports, DOCX, PDF, Google Forms, Microsoft Forms, and selected remote URLs into QTI 3.0 packages.

The conversion is best-effort. The package uses deterministic parsing for recognized formats and falls back to a local LLM such as WebLLM for unfamiliar structures. Processing is intended to run in the browser.

## Supported inputs

- CSV and Excel spreadsheets
- Brightspace QuestestInterop XML
- Moodle quiz XML
- DOCX
- PDF
- Google Forms
- Microsoft Forms
- Remote URLs that resolve to spreadsheets, DOCX, PDF, HTML/text, Google Forms, or Microsoft Forms

## Install

```sh
npm install @citolab/qti-convert-local-ai
```

## Main APIs

The package exports:

- `convertSpreadsheetToQtiPackage(...)`
- `convertDocxToQtiPackage(...)`
- `convertPdfToQtiPackage(...)`
- `convertGoogleFormToQtiPackage(...)`
- `convertMicrosoftFormToQtiPackage(...)`
- `convertRemoteSourceToQtiPackage(...)`
- `createWebLlmQuestionInferer(...)`
- `DEFAULT_WEB_LLM_MODEL`

## Example

```ts
import {
  DEFAULT_WEB_LLM_MODEL,
  convertDocxToQtiPackage,
  convertGoogleFormToQtiPackage,
  convertPdfToQtiPackage,
  convertRemoteSourceToQtiPackage,
  convertSpreadsheetToQtiPackage
} from '@citolab/qti-convert-local-ai';

const spreadsheetResult = await convertSpreadsheetToQtiPackage(file, {
  packageIdentifier: 'demo-package',
  testTitle: 'Imported Test',
  llmSettings: {
    model: DEFAULT_WEB_LLM_MODEL
  },
  onProgress(event) {
    console.log(event.stage, event.message);
  }
});

const docxResult = await convertDocxToQtiPackage(docxFile, {
  packageIdentifier: 'docx-package',
  testTitle: 'Imported DOCX Test'
});

const pdfResult = await convertPdfToQtiPackage(pdfFile, {
  packageIdentifier: 'pdf-package',
  testTitle: 'Imported PDF Test'
});

const googleFormResult = await convertGoogleFormToQtiPackage(
  'https://docs.google.com/forms/d/e/.../viewform'
);

const remoteResult = await convertRemoteSourceToQtiPackage(
  'https://docs.google.com/spreadsheets/d/.../edit'
);

console.log(spreadsheetResult.summary);
console.log(docxResult.summary);
console.log(pdfResult.summary);
console.log(googleFormResult.summary);
console.log(remoteResult.summary);
```

If you want to provide your own inference function instead of letting the package create one from `llmSettings`, that is still supported:

```ts
import {
  convertSpreadsheetToQtiPackage,
  createWebLlmQuestionInferer
} from '@citolab/qti-convert-local-ai';

const inferQuestions = createWebLlmQuestionInferer(engine);

const result = await convertSpreadsheetToQtiPackage(file, inferQuestions, {
  packageIdentifier: 'demo-package',
  testTitle: 'Imported Test'
});
```

Current default WebLLM model: `Qwen2.5-7B-Instruct-q4f16_1-MLC`

## Deterministic formats

These inputs bypass the spreadsheet-structure LLM path entirely:

- common spreadsheet shapes such as `text, answer, a, b, c, d, e`
- common spreadsheet shapes such as `text, answer`
- row-oriented exports with columns such as `SE_ItemLabel`, `element_type`, `Element_type_displayLabel`, `Element_Text_Plain`, and `Element_Text_HTML`
- Brightspace QuestestInterop XML
- Moodle quiz XML `multichoice`
- Google Forms public payloads
- Microsoft Forms runtime form definitions

The row-oriented Excel path groups rows by item label, extracts prompt, stimulus, options, and correct answer conservatively, and is intended for the export format used by the existing Python importer.

DOCX extraction is intentionally conservative. It tries to:

- identify numbered items such as `1.`, `1)` or `Question 1`
- collect answer options such as `A.`, `B.`, `C.`
- treat preceding non-boilerplate paragraphs as candidate stimulus text
- ignore likely booklet metadata and instructions where possible

PDF extraction uses local parsing plus local LLM segmentation/normalization, with a heuristic fallback if the LLM path fails.

## Forms and remote URLs

Google Forms conversion supports these public-form structures:

- multiple choice
- checkboxes
- dropdown
- short answer
- paragraph
- linear scale
- grid questions, expanded into one QTI item per grid row

Microsoft Forms conversion currently supports these common structures:

- choice
- multi-select choice
- text field
- rating
- net promoter score
- matrix / likert-style rows, expanded into one QTI item per row

`convertRemoteSourceToQtiPackage(...)` accepts URLs and routes them to the appropriate parser for:

- Google Sheets
- Google Docs
- Google Forms
- Microsoft Forms
- direct `.xlsx`, `.xls`, `.csv`, `.docx`, and `.pdf` URLs
- generic HTML/text fallback

## Remote source proxy

`convertRemoteSourceToQtiPackage(...)` uses this default proxy when `proxyUrl` is omitted:

`https://corsproxy.io/?url={url}`

You can override it by passing `proxyUrl`, or disable the default proxy by passing an empty string:

```ts
await convertRemoteSourceToQtiPackage(remoteUrl, {
  proxyUrl: ''
});
```

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

## Progress and results

`convertSpreadsheetToQtiPackage(...)` returns:

- `spreadsheet`
- `preview`
- `processable`
- `reason` when `processable` is `false`
- `questions`
- `packageBlob`
- `packageName`
- `summary`

If a spreadsheet does not look like question content, the converter returns `processable: false`, leaves `questions` empty, and skips package generation instead of sending the file to the local LLM.

`convertDocxToQtiPackage(...)` returns:

- `document`
- `preview`
- `questions`
- `packageBlob`
- `packageName`
- `summary`

`convertPdfToQtiPackage(...)` returns:

- `document`
- `preview`
- `questions`
- `packageBlob`
- `packageName`
- `summary`

Google Forms, Microsoft Forms, and remote source conversion return:

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

The package supports multiple-choice, short-text, and extended-text items, plus optional one-column or two-column item-body layouts driven by the structured question JSON.

## License

Apache-2.0
