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

## Examples

Convert a QTI 2.x XML string:

```ts
import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';

const qti3Xml = await convertQti2toQti3(qti2Xml);
```

Convert a local package file in Node.js:

```ts
import { convertPackageFile } from '@citolab/qti-convert/qti-convert-node';

await convertPackageFile('input.zip', 'output.zip');
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
