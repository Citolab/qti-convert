# @citolab/qti-convert

Core QTI conversion and transformation APIs.

## Install

```sh
npm install @citolab/qti-convert
```

## Exports

- `@citolab/qti-convert/qti-convert`
- `@citolab/qti-convert/qti-convert-node`
- `@citolab/qti-convert/qti-transformer`
- `@citolab/qti-convert/qti-loader`
- `@citolab/qti-convert/qti-helper`
- `@citolab/qti-convert/qti-helper-node`
- `@citolab/qti-convert/qti-downgrader` (QTI 3 → QTI 2.1)

## Examples

Convert a QTI 2.x XML string (pure TypeScript, works in Node and the browser; Saxon-JS is no longer needed):

```ts
import { convertQti2toQti3, upgradeQti2toQti3 } from '@citolab/qti-convert/qti-convert';

const qti3Xml = await convertQti2toQti3(qti2Xml);
const sameButSync = upgradeQti2toQti3(qti2Xml);
```

Convert a local package file in Node.js:

```ts
import { convertPackageFile } from '@citolab/qti-convert/qti-convert-node';

await convertPackageFile('input.zip', 'output.zip');

// Optionally move content that several items share (e.g. a reading passage) into shared stimuli.
// Only identical content is extracted; similar content is reported in nearDuplicates.
await convertPackageFile('input.zip', 'output.zip', {
  extractSharedStimuli: true, // or { minTextLength, similarityThreshold, stimulusFolder }
  onSharedStimuliReport: report => console.log(report.stimuli, report.nearDuplicates)
});
```

In the browser `convertPackage(file, convertManifest, convertAssessment, convertItem, postProcessing, options)` takes the same options, and `extractSharedStimuli(files)` can be used on any map of converted QTI 3 package files.

Convert QTI 3 back to QTI 2.1 (best-effort; anything without a 2.1 equivalent is reported in `warnings`):

```ts
import { convertQti3toQti21, convertPackageToQti21 } from '@citolab/qti-convert/qti-downgrader';

const { xml, warnings } = convertQti3toQti21(qti3Xml);
// Packages: shared stimuli are inlined into the items that reference them, and items using QTI 3 shared
// vocabulary classes (qti-layout-row, ...) get a stylesheet for those classes (added to the package)
const { zip } = await convertPackageToQti21(qti3ZipBytes); // or (file, 'blob') in the browser
```

Transform QTI XML:

```ts
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';

const result = qtiTransform(xml).stripStylesheets().objectToImg().xml();
```

Generate manifest and assessment in Node.js:

```ts
import { createOrCompleteManifest, createAssessmentTest } from '@citolab/qti-convert/qti-helper-node';

const manifest = await createOrCompleteManifest('path/to/folder');
const assessment = await createAssessmentTest('path/to/folder');
```

## License

Apache-2.0
