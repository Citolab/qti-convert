# qti-convert

Monorepo for QTI conversion, transformation, browser import, and TAO PCI support.

Published packages:

- `@citolab/qti-convert`: core conversion and transformation APIs
- `@citolab/qti-convert-cli`: command line tools
- `@citolab/qti-browser-import`: browser-side QTI package import and cache URL rewriting
- `@citolab/qti-convert-local-ai`: browser-side CSV/XLSX to QTI package conversion helpers
- `@citolab/qti-convert-export`: QTI package → Word (`.docx`) / PDF export for paper use
- `@citolab/qti-convert-tao-pci`: TAO PCI conversion helpers

## Install

Install the package you need:

```sh
npm install @citolab/qti-convert
npm install @citolab/qti-convert-cli
npm install @citolab/qti-browser-import
npm install @citolab/qti-convert-local-ai
npm install @citolab/qti-convert-tao-pci
npm install @citolab/qti-convert-export
```

## Export to Word / PDF

```sh
npx --package=@citolab/qti-convert-cli qti-export-docx yourpackage.zip -o toets.docx
npx --package=@citolab/qti-convert-cli qti-export-docx yourpackage.zip --pdf -o toets.pdf
```

See [`packages/qti-convert-export/README.md`](packages/qti-convert-export/README.md) for the library API (browser + Node), including Wikiwijs “Download Word” integration notes.

## CLI

CLI commands are published by `@citolab/qti-convert-cli`.

#### Converting a zip file

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg yourpackage.zip
```

#### Converting all zip files in a folder

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg /path/to/folder-with-zips
```

#### Converting a folder

```sh
npx --package=@citolab/qti-convert-cli qti-convert-folder yourfolder
```

#### Removing media files

```sh
npx --package=@citolab/qti-convert-cli qti-strip-media-pkg yourpackage.zip
```

With file type and size filters:

```sh
npx --package=@citolab/qti-convert-cli qti-strip-media-pkg yourpackage.zip audio,.css,300kb
```

#### Creating an assessment test

```sh
npx --package=@citolab/qti-convert-cli qti-create-assessment yourfolder
```

#### Creating or updating a manifest

```sh
npx --package=@citolab/qti-convert-cli qti-create-manifest yourfolder
```

## Core API

The `@citolab/qti-convert` package exports these entry points:

- `@citolab/qti-convert/qti-convert`
- `@citolab/qti-convert/qti-convert-node`
- `@citolab/qti-convert/qti-transformer`
- `@citolab/qti-convert/qti-loader`
- `@citolab/qti-convert/qti-helper`
- `@citolab/qti-convert/qti-helper-node`

#### Convert a QTI 2.x XML string to QTI 3

```ts
import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';

const qti2Xml = '<qti-assessment-item ...>...</qti-assessment-item>';
const qti3Xml = await convertQti2toQti3(qti2Xml);
```

#### Convert a zipped QTI package stream in Node.js

```ts
import { convertPackageStream } from '@citolab/qti-convert/qti-convert-node';
import { createReadStream, writeFileSync } from 'node:fs';
import * as unzipper from 'unzipper';

const inputZipStream = createReadStream('path/to/qti2.zip').pipe(unzipper.Parse({ forceStream: true }));
const outputBuffer = await convertPackageStream(inputZipStream);
writeFileSync('path/to/qti3.zip', outputBuffer);
```

#### Convert a local QTI package file in Node.js

```ts
import { convertPackageFile } from '@citolab/qti-convert/qti-convert-node';

await convertPackageFile('path/to/qti2-package.zip', 'path/to/qti3-package.zip');
```

#### Transform QTI XML

```ts
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';

const transformedXml = qtiTransform('<qti-assessment-item ...>...</qti-assessment-item>')
  .stripStylesheets()
  .objectToImg()
  .customTypes()
  .xml();
```

#### Inline a custom response processing template

QTI lets `qti-response-processing` point at an external template through `template` /
`template-location`. Players such as `@citolab/qti-components` only implement the IMS supplied
templates natively, and fetching a template while scoring would mean a request per item per
candidate. `inlineResponseProcessingTemplate` resolves the reference once — at import or
conversion time — and writes the rules into the item, so the delivered QTI is self-contained.

```ts
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';

// default resolver: fetch() the template url
const transformedXml = (
  await qtiTransform(itemXml).inlineResponseProcessingTemplate({
    baseUrl: 'https://example.com/package/items/'
  })
).xml();

// or resolve from wherever the templates live (zip entry, database, file system, ...)
const fromPackage = (
  await qtiTransform(itemXml).inlineResponseProcessingTemplate(async url => templatesByPath.get(url) ?? null)
).xml();
```

`template-location` is tried first because it is the resolvable url; the `template` identifier is
only a fallback, since a delivery engine is not expected to resolve that URI over the web.
Options:

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | – | Base used to resolve relative template references. |
| `includeStandardTemplates` | `false` | Also inline `match_correct`, `map_response` and `map_response_point`. |
| `standardTemplates` | the three above | Template names treated as natively supported. |
| `overwriteExistingRules` | `false` | Inline even when the element already contains response rules. |
| `keepTemplateAttributes` | `false` | Keep `template` / `template-location` after inlining. |
| `cache` | `true` | Cache resolved templates in `sessionStorage` when available. |

After inlining, the `template` and `template-location` attributes are removed — otherwise a player
that recognises the attribute would clear the rules again.

#### Generate an assessment and manifest in Node.js

```ts
import { createOrCompleteManifest, createAssessmentTest } from '@citolab/qti-convert/qti-helper-node';

const manifest = await createOrCompleteManifest('path/to/qti-folder');
const assessmentTest = await createAssessmentTest('path/to/qti-folder');
```

#### Get all resources in Node.js

```ts
import { getAllResourcesRecursively, QtiResource } from '@citolab/qti-convert/qti-helper-node';

const allResources: QtiResource[] = [];
getAllResourcesRecursively(allResources, 'path/to/qti-folder');
```

## Browser Import

`@citolab/qti-browser-import` provides browser-side package import helpers, package cache utilities, PCI path normalization, and QTI upgrader stylesheet helpers.

## Browser Spreadsheet Import

`@citolab/qti-convert-local-ai` provides browser-side CSV/XLSX parsing, LLM mapping helpers, and deterministic QTI 3.0 package generation.

## TAO PCI

`@citolab/qti-convert-tao-pci` provides TAO-specific PCI conversion helpers and bundled runtime assets.

## License

Apache-2.0. See [LICENSE](./LICENSE).
