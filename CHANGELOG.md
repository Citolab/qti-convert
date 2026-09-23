# Changelog

## Unreleased

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
