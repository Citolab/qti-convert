# Changelog

## 0.9.0

### Added

- **Paper export as a zip with three documents** (`@citolab/qti-convert-export`: `convertPackageToZip`, `renderPaperZip`; `qti-export-docx --zip`). A question booklet without answer space (reusable), an answer sheet with an answer area per question, and an answer key that is the answer sheet filled in, with points, accepted alternatives, scoring rubrics and a total. Word by default; `formats: ['pdf']` or `['docx', 'pdf']` (`--pdf`, `--both`) for PDF. Single documents via `renderDocxDocument` / `renderPdfDocument` with `'workbook' | 'questions' | 'answerSheet' | 'answerKey'`.
- **Paper designs for every interaction type.** New: associate, hotspot, graphic order, graphic associate and graphic gap match (letters or numbers drawn on the hotspots), slider, position object, drawing and upload. Media interactions print a note; PCI and custom interactions print "digital only" and keep their question number.
- **Items with several interactions** keep all of them, labelled a, b, c, in reading order. Before, only the first was exported.
- **Shared stimuli** (`qti-assessment-stimulus-ref`) print once, before the first question that uses them. Items without interactions (introductions, section texts) print without a question number instead of being dropped.
- **Tables, lists, headings, sub/superscript and MathML** in item content (x², H₂O, fractions, roots) instead of flattened text.
- **QTI 2.1 items** are read as well as QTI 3.

### Changed

- **The Word and PDF output share one design.** `compose.ts` builds a format-neutral layout once; `render-docx.ts` and `render-pdf.ts` only draw it, so both formats always match. `convertPackageToDocx` / `convertPackageToPdf` keep their signature and still produce one document with answer space in place (plus the answer key), on the new designs.
- **Shuffled interactions get a fixed, seeded order on paper** (fixed choices stay put) and an order item never prints in its correct order. `keepSourceOrder: true` (`--keep-order`) prints the source order.
- **The answer key uses paper letters** ("C") with the option text, instead of only the option text.
- **Numbered gaps.** Text entries, dropdowns and gap-match gaps are numbered (1), (2) across an item when there is more than one; the word bank is lettered.
- **Choice questions say how many answers to give** (from `min-choices` / `max-choices`), and single and multiple choice look different (○ vs ☐).
- **A question is kept on one page** when it fits.
- **Images keep their aspect ratio** (read from the PNG/JPEG/GIF/SVG header when the item gives no height).
- **English exports contain no Dutch.** All labels and notes come from the locale.
- **The `PaperItem` model changed** (`parts`, `body`, `stimulusRefs` instead of `interaction` and `stimulus`). Only code that inspects the model directly is affected.
- Dependencies updated across the workspace, including vitest 5, tsup 9 and Storybook 10.6.

### Fixed

- Associate interactions exported as an empty question.
- Hottext and gap-match text kept the line breaks of the XML source, scattering sentences over several lines.
- Select-point instructions were printed twice, with on-screen wording ("Klik op …").

## 0.8.3

### Fixed

- **`qbCleanup` leaves adaptive items' outcomes alone.** It put a reset of every outcome the response processing writes (`set … = 0`) at the top of the response processing. An adaptive item (`adaptive="true"`) is answered in attempts and its outcomes carry over from one attempt to the next, so the reset undid what the previous attempt did (a follow-up step, a hint, a score already given) and even overwrote `completionStatus`. Adaptive items now get no reset; other items keep it.

## 0.8.2

### Changed

- **`depConvert`: an image that opens a dialog no longer looks like a button.** The `<button popovertarget>` around a trigger with only an image gets no background, border or padding, and a `zoom-in` cursor. A trigger with text keeps the button look, with a `pointer` cursor. The button is `type="button"`, so it never submits a form.

## 0.8.1

### Fixed

- **DEP dialogs: the trigger no longer disappears** (`depConvertExtended`, `depConvert`). The `dep-dialogTrigger` kept its `data-stimulus-idref`, which is also the shared-stimulus hook of qti-components: it empties every element with that attribute, so the thumbnail that opens the popup was wiped before it was shown. The attribute is now removed from the trigger once it is converted.
- **`depConvertExtended` only sets the `dep-popup` attributes the dialog has.** A missing `data-dep-dialog-modal` became `modal=""`, which `dep-popup` reads as modal, and a missing width or height became `0`.

## 0.8.0

### Added

- **Repair broken file references in a package** (`@citolab/qti-convert/qti-references`: `fixPackageReferences(files)`, `fixPackageReferencesZip(zip)`; `qti-fix-references-pkg` CLI). A separate step for QTI 2.x and 3 packages, not part of the conversion. Every reference in the items, tests and stimuli (`src`, `href`, `data`, `poster`, `template-location`, `primary-path`, ...) is resolved relative to its file; if that fails, relative to the package root (the folder of `imsmanifest.xml`, also for paths starting with `/`); and if that fails, by file name anywhere in the package. The ones found the second or third way are rewritten relative to their file, and only those attribute values change. References that can't be found are reported. The Python package `citolab-qti-convert` (0.2.0) has the same function, with the same results.
- **`PackageReferenceResolver`** (`@citolab/qti-convert/qti-references`): the same resolving for code that reads a package file by file. It needs only the file paths of the package (e.g. the entries of a zip), not their contents, and a resolved target is always a path in the package.

## 0.7.1

### Changed

- **License: GPL-3.0-only** for all packages (the package metadata said Apache-2.0; the repository LICENSE was already GPL-3.0). Each package now includes the LICENSE file. Versions up to 0.7.0 remain available under Apache-2.0.

### Added

- **QTI 3 → QTI 2.1: shared vocabulary stylesheet.** Items that use QTI 3 shared vocabulary classes (`qti-layout-row`, `qti-underline`, ...) get a `<stylesheet>` to `qti3-shared-vocabulary.css`, which is added next to the manifest and registered in it, so QTI 2.1 players can style those classes. It contains the 1EdTech `qti3p0.css` utility classes unmodified, with its page-level layout section replaced by a grid sized by the row (not the screen), plus defaults for its CSS variables and a fix for its missing-comma `qti-float-clear-*` rules. On by default; `injectSharedVocabularyStylesheet: false` switches it off. For single items use the `sharedVocabularyStylesheetHref` option and `QTI3_SHARED_VOCABULARY_CSS`.

## 0.7.0

### Added

- **QTI 3 → QTI 2.1 conversion** (`@citolab/qti-convert/qti-downgrader`, `qti-convert-pkg-qti21` CLI). Best-effort: shared stimuli are inlined, HTML5 media become `<object>`, image-only gap texts become `gapImg`, `aria-*`/`role`/`dir` are removed, and constructs without a 2.1 equivalent are reported as warnings. Output is validated against the QTI 2.1 XSD.

- **Shared stimulus extraction** in the QTI 2 → 3 package conversion (opt-in: `extractSharedStimuli` option, `qti-convert-pkg --extract-stimuli`). Content that is identical in two or more items (e.g. a reading passage, also a column of a `qti-layout-row`) is moved into a `qti-assessment-stimulus`, referenced from the items and registered in the manifest. Similar but not identical content is only reported.
- QTI 2.1 and QTI 3 output is validated against the official IMS XSDs in the tests (when `xmllint` is available).
- `qti-rubric-block` gets the `use` attribute QTI 3 requires.

### Changed

- **QTI 2 → QTI 3 conversion no longer uses XSLT/Saxon-JS.** `convertQti2toQti3` now runs a TypeScript port of `qti2xTo30.xsl` (also exported as the synchronous `upgradeQti2toQti3`), checked against the XSLT's output for a set of QTI 2 fixtures. It works the same in Node and the browser; no stylesheet or Saxon runtime has to be loaded. Beyond the XSLT it also converts `stimulusBody`, `durationLT`/`durationGTE`, `outcomeElseIf`, `exitTest`, `testFeedback`, `templateDefault`, `variableMapping` and prefixed QTI 2 elements, keeps inline SVG in its namespace, and no longer duplicates the children of video objects.

### Removed (breaking)

- All XSLT/Saxon-JS support: the `saxon-js` and `qti30upgrader` dependencies and the unused `src/assets/qb-TAO-qti3.xsl`.
- The `xsltJson` parameter of `convertQti2toQti3`, `convertPackage` and `processPackage` (the following parameters move one position forward).
- `@citolab/qti-browser-import`: `ensureSaxonJsLoaded`, the `saxonJsUrl` option, `getUpgraderStylesheetBlobUrl` and `revokeUpgraderStylesheetBlobUrl`.

### Fixed

- `qti-convert-pkg` imported the non-exported `qti-converter-node` subpath and failed to start.

## 0.4.16

### Fixed

- **Namespace-prefixed manifests**: `convertManifestFile` (browser/`qti-convert` path) now strips the prefix bound to the IMS Content Packaging namespace (e.g. `<imscp:manifest>`, `<imscp:resource>`) before converting. Previously the prefix-blind selectors matched nothing, so resource types were never upgraded to `imsqti_*_xmlv3p0` and the manifest namespaces stayed at QTI 2.x. This brings the browser path in line with the node path, which already stripped the prefix.
- **Package conversion crash**: `processAssessmentReferences` no longer throws `Cannot read properties of undefined (reading 'split')` when an assessment item ref or the manifest test resource has no resolvable `href`; such refs are now skipped instead of crashing `convertPackage`.

## 0.4.11 (qti-convert-local-ai)

### Fixed

- **Google Forms parser**: Updated extraction logic to support multiple data patterns. Google Forms HTML no longer consistently uses `FB_PUBLIC_LOAD_DATA_` variable. The parser now tries multiple extraction patterns including:
  - `FB_PUBLIC_LOAD_DATA_ = [...]` (original pattern)
  - `var FB_PUBLIC_LOAD_DATA_ = [...]` (with var keyword)
  - Fallback pattern that searches for the form data structure directly
- Improved error message when form data cannot be extracted

## 0.4.0

This release introduces a multi-package publish setup for the `qti-convert` repository and updates the recommended installation and CLI usage.

### Highlights

- The repository is now published as 4 packages:
  - `@citolab/qti-convert`
  - `@citolab/qti-convert-cli`
  - `@citolab/qti-browser-import`
  - `@citolab/qti-convert-tao-pci`
- Package versions are now aligned and intended to be released together.
- A workspace publish flow was added for synchronized versioning and publishing.

### Package changes

- `@citolab/qti-convert`
  - remains the core API package for QTI conversion, transformation, loader utilities, and helper modules
- `@citolab/qti-convert-cli`
  - is now the package that publishes the CLI commands
- `@citolab/qti-browser-import`
  - provides browser-side QTI package import, cache URL rewriting, and PCI-related browser helpers
- `@citolab/qti-convert-tao-pci`
  - provides TAO PCI conversion helpers and bundled runtime assets

### CLI usage change

CLI commands should now be run from `@citolab/qti-convert-cli` instead of `@citolab/qti-convert`.

Old:

```sh
npx -p=@citolab/qti-convert qti-convert-pkg yourpackage.zip
```

New:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg yourpackage.zip
```

The same applies to:

- `qti-convert-folder`
- `qti-create-manifest`
- `qti-create-assessment`
- `qti-strip-media-pkg`

### Tooling

- Added `publish:all` to publish all packages with the same version
- Added `publish:all:dry-run` for release validation
- Removed `np` from the release workflow

### Documentation

- Updated the root README to reflect the multi-package setup
- Added missing README files for all published packages
