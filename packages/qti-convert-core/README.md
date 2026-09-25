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
- `@citolab/qti-convert/qti-references` (repair broken file references in a QTI 2.x or 3 package)

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

Repair broken file references in a package (QTI 2.x or 3), for example `src="mediafiles/a.png"` in
`questions/q1.xml`, which is relative to the package root instead of to the item. It's a separate step: run it before
or after a conversion.

```ts
import { fixPackageReferences, fixPackageReferencesZip } from '@citolab/qti-convert/qti-references';

const { zip, fixed, unresolved } = await fixPackageReferencesZip(zipBytes); // or (file, 'blob') in the browser
const result = fixPackageReferences(files); // Map<path, string | Uint8Array>
```

Every reference in the items, tests and stimuli (`src`, `href`, `data`, `poster`, `template-location`, `primary-path`,
... see `REFERENCE_ATTRIBUTES`) is resolved in this order:

1. relative to its own file, as the specs require (a reference that only differs in case is corrected: `case`);
2. relative to the package root, the folder of `imsmanifest.xml`, which also covers paths starting with `/`
   (`package-root`);
3. by file name anywhere in the package (`file-name`). When several files have that name, the one whose folders match
   the reference best wins; a tie is reported with the candidates. `searchByFileName: false` switches this off.

A reference found in step 2 or 3 is rewritten relative to its own file (`../mediafiles/a.png`), keeping query strings,
fragments and URL encoding. Only those attribute values change; the rest of each file stays byte-for-byte the same, and
running it again changes nothing. References that aren't found are left as they are and returned in `unresolved`. The
Python package [`citolab-qti-convert`](https://pypi.org/project/citolab-qti-convert/) has the same function
(`fix_package_references`), with the same results.

To resolve references while reading a package file by file, without loading it whole, use `PackageReferenceResolver`.
It needs only the file paths:

```ts
import { PackageReferenceResolver } from '@citolab/qti-convert/qti-references';

const resolver = new PackageReferenceResolver(Object.keys(zip.files)); // rootDir: the folder of imsmanifest.xml
const resolution = resolver.resolve('questions/q1.xml', 'mediafiles/a.png', 'src');
// { target: 'mediafiles/a.png', method: 'package-root', newValue: '../mediafiles/a.png', candidates: [] }
// undefined for values that aren't a file in the package (URLs, data: URIs, fragments)
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

GPL-3.0-only
