# @citolab/qti-convert-export

Export QTI 3.0 (and 2.1) packages to **paper-friendly Word (`.docx`) and PDF** documents.

This package maps QTI interactions to printable patterns (answer bubbles, boxes, numbered blanks, letters on images) via an intermediate `PaperAssessment` model. It does **not** screenshot the qti-components player. Word and PDF are drawn from the same layout, so they always match.

## Install

```sh
npm install @citolab/qti-convert-export
```

## Quick start (browser or Node)

```ts
import { convertPackageToDocx, convertPackageToPdf } from '@citolab/qti-convert-export';

// `file` can be a File/Blob (browser), ArrayBuffer/Uint8Array, or a filesystem path (Node)
const { assessment, fileName, paper, answerKey, answerKeyFileName } = await convertPackageToDocx(
  file,
  {
    locale: 'nl',
    includeAnswerKey: true,
    // default separateAnswerKey: true → Vragenblad + Antwoordmodel (Kennisnet style)
  }
);

// Browser download
const blob = new Blob([assessment], {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = fileName;
a.click();

// Or PDF
const pdf = await convertPackageToPdf(file, { locale: 'nl' });
```

## Question booklet, answer sheet and answer key (zip)

```ts
import { convertPackageToZip } from '@citolab/qti-convert-export';

const { zip, fileName, files } = await convertPackageToZip(file, {
  locale: 'nl',
  formats: ['docx', 'pdf'], // default ['docx']
});
// fileName: "Toets-papier.zip"
// files:    "Toets - opgaven.docx", "Toets - antwoordblad.docx", "Toets - antwoordmodel.docx", (+ .pdf)
```

| Document | Contents |
|----------|----------|
| `questions` (opgaven) | Questions and options only, no answer space — reusable |
| `answerSheet` (antwoordblad) | Name/class/date, then an answer area per question number |
| `answerKey` (antwoordmodel) | The answer sheet filled in, with points, accepted alternatives, scoring rubric and total |
| `workbook` | Questions with answer space in place (what `convertPackageToDocx` produces) |

Pick documents with `documents: ['questions', 'answerSheet', 'answerKey']`, or render one with `renderDocxDocument(paper, kind, options)` / `renderPdfDocument(...)`.

## Wikiwijs Toetsen — “Download Word” button

Typical integration on the preview page:

1. Fetch the QTI package ZIP (same URL the player already uses).
2. Call `convertPackageToDocx(zipBlob, { locale: 'nl', includeAnswerKey: true })`.
3. Trigger a browser download of the resulting `.docx`.

```ts
async function downloadWord(packageUrl: string) {
  const res = await fetch(packageUrl);
  const zip = await res.blob();
  const { assessment, fileName } = await convertPackageToDocx(zip, {
    locale: 'nl',
    includeAnswerKey: true,
  });
  const blob = new Blob([assessment], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
}
```

Server-side (Node) is equally supported — pass a file path or buffer to the same API.

## CLI

Published via `@citolab/qti-convert-cli`:

```sh
npx --package=@citolab/qti-convert-cli qti-export-docx package.zip -o toets.docx
npx --package=@citolab/qti-convert-cli qti-export-docx package.zip --pdf -o toets.pdf
npx --package=@citolab/qti-convert-cli qti-export-docx package.zip --separate-answer-key
npx --package=@citolab/qti-convert-cli qti-export-docx package.zip --zip --locale nl        # booklet, answer sheet, key (Word)
npx --package=@citolab/qti-convert-cli qti-export-docx package.zip --zip --both             # Word and PDF
```

## Paper designs

Each interaction has content (what the student reads), an answer area (answer sheet / workbook) and a filled answer area (answer key).

| QTI interaction | Question | Answer area | Answer key |
|-----------------|----------|-------------|------------|
| choice | `A.  text` (+ "choose 2" from min/max-choices) | `○A ○B ○C` (☐ for multiple) | filled bubble |
| text-entry | numbered gap `(1) ____` in the text | `(1) ________` | answer + accepted alternatives |
| inline-choice | numbered gap + options per number | `(1) ○A ○B` | filled bubble |
| extended-text | prompt | ruled lines (`expected-lines`) | correct value or scoring rubric |
| match (≤ 6 columns) | numbered and lettered lists | grid of bubbles (column text when short) | filled grid |
| match (> 6 columns) | numbered and lettered lists | `1 [  ]` per row | letters |
| associate | lettered list | `[ ]–[ ]` pairs | pairs |
| order | lettered list (never in the correct order) | `1 [ ] 2 [ ] 3 [ ]` | letters in order |
| gap-match | lettered word bank + numbered gaps | `(1) [ ] (2) [ ]` | letter + word |
| hottext | words underlined with a letter | `○A ○B ○C` | filled + the words |
| hotspot | image with letters on the hotspots | `○A ○B ○C` | filled bubble |
| graphic-order | image with letters | `1 [ ] 2 [ ] 3 [ ]` | letters in order |
| graphic-associate | image with letters | `[ ]–[ ]` pairs | pairs |
| graphic-gap-match | image with numbers + lettered bank | `(1) [ ] (2) [ ]` | letter + label |
| select-point / position-object | image + "mark with a cross" | image | correct area outlined |
| slider | "choose a value from … to …" | `Answer: ____` | value |
| drawing | prompt (+ image) | image or empty box | rubric |
| upload | "hand in separately" | note | rubric |
| media | note that a fragment belongs to the question | — | — |
| PCI / custom | "digital only" (question keeps its number) | "digital only" | — |

Items with several interactions get parts a, b, c. Shared stimuli print once, before the first question that uses them. Items without interactions print without a number. Tables, lists, headings, sub/superscript and MathML are kept.

Shuffled interactions (`shuffle="true"`) get a fixed, seeded order on paper; pass `keepSourceOrder: true` to print the source order.

## API surface

| Function | Role |
|----------|------|
| `loadPackage(source, options)` | ZIP → `PaperAssessment` |
| `parseItemXml(xml, assets, href, options)` | single item XML → `PaperItem` |
| `composeDocument(paper, kind, options)` | model → format-neutral layout (the designs) |
| `renderDocxDocument` / `renderPdfDocument` | one document → bytes |
| `renderDocx(assessment, options)` / `renderPdf` | workbook + answer key → bytes |
| `convertPackageToDocx` / `convertPackageToPdf` | one-shot workbook + answer key |
| `convertPackageToZip` | one-shot booklet + answer sheet + answer key zip |

## Images

- **Package-relative** paths (e.g. `../resources/fig.png` from `items/item01.xml`) are resolved against the item location and read from the ZIP.
- **External** `http(s)://` image URLs are fetched during export (works in Node; in the browser the image host must allow CORS).
- **`data:`** URLs are decoded in-place.
- Word gets PNG, JPEG, GIF and SVG; PDF gets PNG and JPEG (other formats print a placeholder).
- Letters and answer areas on images are an SVG layer in Word (Word 2016+ / Microsoft 365; older versions show the plain image) and drawn directly in PDF.


```ts
type ExportOptions = {
  locale?: 'en' | 'nl';              // default: en
  correctionInDocument?: boolean;  // append correction to question doc (default false)
  correctionSeparate?: boolean;    // separate …-correction file (default true if unset)
  fileNameBase?: string;           // default: QTI ZIP name (File/path) or assessment title
  keepSourceOrder?: boolean;       // ignore shuffle="true" (default false)
};

type ZipExportOptions = ExportOptions & {
  formats?: ('docx' | 'pdf')[];                                        // default ['docx']
  documents?: ('workbook' | 'questions' | 'answerSheet' | 'answerKey')[]; // default questions, answerSheet, answerKey
};
```

Download names follow the QTI package: `{zipBase}.docx` and `{zipBase}-correction.docx` (same for PDF).
`correctionInDocument` and `correctionSeparate` are independent — check both to get correction in the question file **and** as a separate document.
When you pass a `File` or filesystem path, the zip name is used automatically (`.zip` / `.package` stripped).
