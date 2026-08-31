# qti-convert-export — Agent Instructions

## Purpose

Convert QTI 3 packages into paper-friendly **Word (`.docx`)** and **PDF** documents via a structural intermediate model (`PaperAssessment`). Do not drive export from `@citolab/qti-components` rendering.

## Pipeline

```
QTI ZIP → loadPackage → PaperAssessment → renderDocx / renderPdf
```

Key files:

| File | Role |
|------|------|
| `src/load-package.ts` | ZIP / file map → assessment model |
| `src/parse-item.ts` | Item XML → `PaperItem` + answer key |
| `src/render-docx.ts` | Model → Word (`docx`) |
| `src/render-pdf.ts` | Model → PDF (`pdf-lib`) |
| `src/convert.ts` | One-shot helpers |

## Decision rules

- Add new interaction paper patterns in `parse-item.ts` + both renderers.
- Keep unsupported types as `kind: 'unsupported'` with a Dutch/EN note — never fail the whole export.
- PDF text must stay WinAnsi-safe (see `sanitizePdfText`); prefer ASCII substitutes for arrows/checkboxes in PDF.
- Browser and Node share the same API; Node path loading uses dynamic `node:fs/promises`.

## Testing

```sh
npm run test --workspace=@citolab/qti-convert-export
```

Fixtures live in `tests/fixtures/sample-package/`.
