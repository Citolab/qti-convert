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

## Model selection

When `llmSettings.model` is not set, the package picks a model for the device:

| Tier | Typical hardware | Model (q4f16 / q4f32 without `shader-f16`) |
|------|------------------|---------------------------------------------|
| high | Apple Silicon, NVIDIA, discrete AMD | `Qwen2.5-7B-Instruct` |
| mid | Intel Arc, integrated AMD, Safari on macOS | `Qwen2.5-3B-Instruct` |
| low | Intel integrated (Iris Xe, UHD), mobile, ≤4 GB RAM | `Qwen2.5-1.5B-Instruct` (lower accuracy) |
| none | No WebGPU or software adapter | LLM skipped, heuristic fallback |

The detected tier is then adjusted:

- models measured below `minDecodeTokensPerSecond` (default 4) on an earlier run on the same GPU are skipped (measurements are kept in `localStorage`);
- downloads that don't fit in the free browser storage are skipped;
- an already-cached smaller model is preferred over downloading a larger one (`preferCachedModels: false` to disable);
- if loading fails with an out-of-memory, device-lost or `shader-f16` error, the next smaller model (or the q4f32 variant) is tried.

`onModelSelected` receives the selection (model, tier, reasons, `lowAccuracy`) so the UI can show it. Set `model` explicitly (optionally with `fallbackModels`) or `autoSelectModel: false` to opt out; `DEFAULT_WEB_LLM_MODEL` (`Qwen2.5-7B-Instruct-q4f16_1-MLC`) is used then. `detectDeviceProfile()`, `recommendWebLlmModel()` and `selectWebLlmModel()` are exported for building a model picker.

### Running WebLLM in a Web Worker

Model loading and shader compilation freeze the page when WebLLM runs on the main thread (slow on Windows integrated GPUs). Create a worker file in your app:

```ts
// llm.worker.ts
import '@citolab/qti-convert-local-ai/webllm-worker';
```

and pass it in:

```ts
llmSettings: {
  worker: () => new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
}
```

### Engine reuse

The loaded WebLLM engine is cached per model, so several conversions on the same page load the model only once. Call `releaseWebLlmEngines()` to free GPU memory, or pass `reuseEngine: false`.

### Native local server (Ollama, LM Studio, llama.cpp)

On typical Windows hardware a native runtime is much faster than WebGPU in the browser, and documents still never leave the machine. Point `localServer` at its OpenAI-compatible endpoint:

```ts
llmSettings: {
  localServer: {
    baseUrl: 'http://localhost:11434/v1', // Ollama; LM Studio: http://localhost:1234/v1
    model: 'qwen2.5:7b'
  }
}
```

- `detectLocalLlmServers()` probes Ollama, LM Studio and llama.cpp on their default ports and returns the servers that respond with their models, for a picker in the UI.
- If the server is unreachable, conversion falls back to in-browser WebLLM (`fallbackToWebLlm: false` to fail instead).
- Only loopback hosts (`localhost`, `127.0.0.1`, `::1`) are accepted unless `allowRemoteHost: true`, so documents are not sent over the network by accident.
- The server must allow the page origin via CORS: for Ollama set `OLLAMA_ORIGINS` (e.g. `OLLAMA_ORIGINS=https://your-app.example`), for LM Studio enable CORS in the server settings. Chrome may also ask the user for permission to access the local network.
- Prompts are sized for a ~4K context window, so the server's default context length is enough.

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

GPL-3.0-only
