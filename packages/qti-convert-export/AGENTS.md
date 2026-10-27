# qti-convert-export — Agent Instructions

## Purpose

Convert QTI 3 packages into paper-friendly **Word (`.docx`)** and **PDF** documents via a structural intermediate model (`PaperAssessment`). Do not drive export from `@citolab/qti-components` rendering.

## Pipeline

```
QTI ZIP → loadPackage → PaperAssessment → composeDocument → LayoutDocument → layoutToDocx / layoutToPdf
```

Key files:

| File | Role |
|------|------|
| `src/load-package.ts` | ZIP / file map → assessment model, shared stimuli, image hydration |
| `src/parse-item.ts` | Item XML → `PaperItem` (parts in reading order, correct answers in paper labels) |
| `src/compose.ts` | **The paper designs**: content, answer area and filled answer area per interaction; the four documents |
| `src/html-to-layout.ts` | Item HTML (tables, lists, MathML, gaps, hottext) → layout blocks |
| `src/layout.ts` | Format-neutral layout primitives |
| `src/render-docx.ts` | Layout → Word (`docx`) |
| `src/render-pdf.ts` | Layout → PDF (`pdf-lib`), including line breaking and pagination |
| `src/convert.ts` | One-shot helpers and the zip export |

## Decision rules

- Change or add a paper design in `compose.ts` only; never special-case an interaction in a renderer.
- A new interaction: parse it in `parse-item.ts` (store correct answers as paper labels), then add it to `answerArea` and `interactionBlocks` in `compose.ts`.
- A new layout primitive must be drawn by both `render-docx.ts` and `render-pdf.ts`.
- Keep unsupported types as `kind: 'unsupported'` — never fail the whole export. User-facing text comes from `locale.ts`, never from the parser.
- PDF text must stay Windows-1252 safe (see `sanitizePdfText`); draw shapes (bubbles, boxes) instead of using symbol characters.
- Browser and Node share the same API; Node path loading uses dynamic `node:fs/promises`.

## Testing

```sh
npm run test --workspace=@citolab/qti-convert-export
```

Fixtures live in `tests/fixtures/sample-package/` (common types) and `tests/fixtures/all-types-package/` (every other type, multi-part items, shared stimulus, rich content).
