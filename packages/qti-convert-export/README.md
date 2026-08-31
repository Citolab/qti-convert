# @citolab/qti-convert-export

Export QTI 3.0 packages to **paper-friendly Word (`.docx`) and PDF** documents.

This package maps QTI interactions to printable patterns (checkboxes, blanks, tables) via an intermediate `PaperAssessment` model. It does **not** screenshot the qti-components player.

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
```

## Supported paper patterns

| QTI interaction | Paper pattern |
|-----------------|---------------|
| choice (single/multi) | `A.  text` (Kennisnet style) |
| text-entry / inline-choice | blanks in text or lines |
| extended-text | lined answer area |
| match / associate | option bank + labeled blanks, or matrix with ○ |
| order | labeled items + `Volgorde:` numbered blanks |
| gap-match | passage with gaps + word bank |
| hottext | words to circle |
| select-point | image + “mark with X” |
| PCI / media / upload / graphic-* | unsupported note (export continues) |

## API surface

| Function | Role |
|----------|------|
| `loadPackage(source)` | ZIP → `PaperAssessment` |
| `parseItemXml(xml, assets)` | single item XML → `PaperItem` |
| `renderDocx(assessment, options)` | model → `.docx` bytes |
| `renderPdf(assessment, options)` | model → `.pdf` bytes |
| `convertPackageToDocx` / `convertPackageToPdf` | one-shot helpers |

## Images

- **Package-relative** paths (e.g. `../resources/fig.png` from `items/item01.xml`) are resolved against the item location and read from the ZIP.
- **External** `http(s)://` image URLs are fetched during export (works in Node; in the browser the image host must allow CORS).
- **`data:`** URLs are decoded in-place.


```ts
type ExportOptions = {
  locale?: 'en' | 'nl';              // default: en
  correctionInDocument?: boolean;  // append correction to question doc (default false)
  correctionSeparate?: boolean;    // separate …-correction file (default true if unset)
  fileNameBase?: string;           // default: QTI ZIP name (File/path) or assessment title
};
```

Download names follow the QTI package: `{zipBase}.docx` and `{zipBase}-correction.docx` (same for PDF).
`correctionInDocument` and `correctionSeparate` are independent — check both to get correction in the question file **and** as a separate document.
When you pass a `File` or filesystem path, the zip name is used automatically (`.zip` / `.package` stripped).
