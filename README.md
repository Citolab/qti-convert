# qti-convert

Monorepo for QTI conversion, transformation, browser import, and TAO PCI support.

Published packages:

- `@citolab/qti-convert`: core conversion and transformation APIs
- `@citolab/qti-convert-cli`: command line tools
- `@citolab/qti-browser-import`: browser-side QTI package import and cache URL rewriting
- `@citolab/qti-browser-spreadsheet`: browser-side CSV/XLSX to QTI package conversion helpers
- `@citolab/qti-convert-tao-pci`: TAO PCI conversion helpers

## Install

Install the package you need:

```sh
npm install @citolab/qti-convert
npm install @citolab/qti-convert-cli
npm install @citolab/qti-browser-import
npm install @citolab/qti-browser-spreadsheet
npm install @citolab/qti-convert-tao-pci
```

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

`@citolab/qti-browser-spreadsheet` provides browser-side CSV/XLSX parsing, LLM mapping helpers, and deterministic QTI 3.0 package generation.

## TAO PCI

`@citolab/qti-convert-tao-pci` provides TAO-specific PCI conversion helpers and bundled runtime assets.

## License

Apache-2.0. See [LICENSE](./LICENSE).
