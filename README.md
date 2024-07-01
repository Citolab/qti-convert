# @citolab/qti-convert

Welcome to **@citolab/qti-convert**, a tool for converting QTI 2.x (Question and Test Interoperability) to QTI 3. This package can be seamlessly integrated into your workflow as either a command line tool or a library for JavaScript/TypeScript applications.

## Installation

You can easily install the package using npm:

```sh
npm install @citolab/qti-convert
```

## Usage

@citolab/qti-convert can be used directly from the command line for quick conversions.
And for more advanced usage @citolab/qti-convert can be integrate within your JavaScript or TypeScript projects.

## CLI

Command Line Tool.

The following commands can be used:

#### Converting a zip file

```sh
    npx -p=@citolab/qti-convert qti-convert-pkg yourpackage.zip
```

Should have a qti2.x zip file as input parameter.
It will create a qti3 zip file in the same folder call yourpackage-qti3.zip

#### Converting a folder

```sh
   npx -p=@citolab/qti-convert qti-convert-folder yourfolder (e.g c:\users\you\qti-folder or /Users/you/qti-folder)
```

Should have the path to a folder as input parameter. This folder should contain the content of a qti.2x package
It will convert all files inside the folder and copy the converted files to a new folder called: yourfolder-qti3

#### Creating an assessment test

```sh
    npx -p=@citolab/qti-convert qti-create-assessment yourfolder (e.g c:\users\you\qti-folder or /Users/you/qti-folder)
```

I you have a directory with one or more items but no assessment test, this command will create a assessment test that contains all the items that are in the foldername.
It will override an existing assessment that's callled test.xml.

Should have the path to a folder as input parameter. This folder should contain the content of a qti3 package

#### Creating or updating an manifest

```sh
    npx -p=@citolab/qti-convert qti-create-manifest yourfolder (e.g c:\users\you\qti-folder or /Users/you/qti-folder)
```

This will create or update an existing manifest. It will look into the directory and search for all items, tests and resources.
Also it will add the resources that are used in an item as a dependency.

## API

### Convert

#### Converting a QTI 2.x XML String to QTI 3.0

```ts
import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';

const qti2Xml = '<qti-assessment-item ...>...</qti-assessment-item>';
convertQti2toQti3(qti2Xml).then(qti3Xml => {
  console.log(qti3Xml);
});
```

#### Converting a Zipped QTI Package

The convertPackageStream function processes a zipped QTI package from a stream and converts all relevant QTI 2x files to QTI 3.0.

```ts
import { convertPackageStream } from '@citolab/qti-convert/qti-convert';
import { createReadStream, writeFileSync } from 'fs';
import * as unzipper from 'unzipper';

const inputZipStream = createReadStream('path/to/qti2.zip').pipe(unzipper.Parse({ forceStream: true }));

convertPackageStream(inputZipStream).then(outputBuffer => {
  writeFileSync('path/to/qti3.zip', outputBuffer);
});
```

#### Converting a Local QTI Package File

The convertPackageFile function reads a local QTI package file, converts it, and writes the converted package to a specified output file.

```ts
import { convertPackageFile } from '@citolab/qti-convert/qti-convert';

const inputFilePath = 'path/to/qti2-package.zip';
const outputFilePath = 'path/to/qti3-package.zip';

convertPackageFile(inputFilePath, outputFilePath).then(() => {
  console.log('Package conversion complete!');
});
```

#### Converting a QTI Package Directory

The convertPackageFolder function converts all QTI 2.x files in a directory to QTI 3.0 and saves them to an output directory.

```ts
import { convertPackageFolder } from '@citolab/qti-convert/qti-convert';

const inputFolder = 'path/to/qti2-folder';
const outputFolder = 'path/to/qti3-folder';

convertPackageFolder(inputFolder, outputFolder).then(() => {
  console.log('Conversion complete!');
});
```

#### Customizing Conversion Logic

You can customize the conversion logic by providing custom conversion functions for manifest files, assessment files, and item files.

This is typically needed when a specific platform needs specific conversions.

```ts
import { convertPackageFolder } from '@citolab/qti-convert/qti-convert';
import * as cheerio from 'cheerio';

const customConvertManifest = async ($manifest: cheerio.CheerioAPI): Promise<cheerio.CheerioAPI> => {
  // Base conversion:
  convertManifestFile($manifest);
  // Custom manifest conversion logic here

  return $manifest;
};

const customConvertAssessment = async ($assessment: cheerio.CheerioAPI): Promise<cheerio.CheerioAPI> => {
  // Base conversion:
  if ($assessment('assessmentTest').length > 0) {
    const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
    $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
  }
  // Custom assessment conversion logic here

  return $assessment;
};

const customConvertItem = async ($item: cheerio.CheerioAPI): Promise<cheerio.CheerioAPI> => {
  // Base conversion:
  if ($item('assessmentItem').length > 0) {
    const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
    $item = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
  }
  // Custom item conversion logic here
  return $item;
};

convertPackageFolder(
  'path/to/qti2-folder',
  'path/to/qti3-folder',
  customConvertManifest,
  customConvertAssessment,
  customConvertItem
).then(() => {
  console.log('Custom conversion complete!');
});
```

### Transform

To use the qtiTransform function, import it and pass a QTI XML string. The returned API allows you to chain various transformation methods. There are some built-in functions but you can also create your own functions and chain these

```ts
import { qtiTransform } from '@citolab/qti-convert/qti-transform';

const qtiXml = '<qti-assessment-item ...>...</qti-assessment-item>';
const transformedXml = qtiTransform(qtiXml).stripStylesheets().objectToImg().customTypes().xml();

console.log(transformedXml);
```

#### API Methods

##### fnCh(fn: (xmlString: cheerio.CheerioAPI) => void): QtiTransformAPI

Apply a synchronous function to the XML.

```ts
qtiTransform(xmlValue).fnCh($ => {
  // Your custom synchronous transformation logic
});
```

##### fnChAsync(fn: (xmlString: cheerio.CheerioAPI) => Promise<void>): Promise<QtiTransformAPI>

Apply an asynchronous function to the XML.

```ts
await qtiTransform(xmlValue).fnChAsync(async $ => {
  // Your custom asynchronous transformation logic
});
```

The build-in functions that can be chained are:

- `mathml(): QtiTransformAPI`: Convert MathML elements to web components.
- `objectToVideo(): QtiTransformAPI`: Convert `<object>` elements to `<video>` elements..
- `objectToImg(): QtiTransformAPI`: Convert `<object>` elements to `<img>` elements.
- `stripStylesheets(): QtiTransformAPI`: Remove all stylesheet references from the XML.
- `customTypes(): QtiTransformAPI`: Apply custom type transformations to the XML. Can be used override default web-components. E.g. `<qti-choice-interaction class="type:custom">` will result in `<qti-choice-interaction-custom>` so you can create your own web-component to render choice interactions.
- `stripMaterialInfo(): QtiTransformAPI`: Remove unnecessary material information from the XML
- `qbCleanup(): QtiTransformAPI`: Clean-up for package created with the Quesify Platform
- `minChoicesToOne(): QtiTransformAPI`: Ensure the minimum number of choices is one.
- `suffix(elements: string[], suffix: string)`: Add a suffix to specified elements.
- `externalScored()`: Mark the XML as externally scored.

### Loader

The @citolab/qti-convert/qti-loader module provides utilities for loading and processing QTI XML content. It includes functions to fetch IMS manifest files, retrieve assessment tests, and extract item information.

#### Fetching IMS Manifest Data

The `testLoader` function fetches and processes the IMS manifest XML file from a given URI. It retrieves the assessment test and its associated items.

### Helper

@citolab/qti-convert/qti-helper provides a set of helper functions for QTI padckages. It includes functions to recursively retrieve QTI resources, create or update IMS manifest files and generate QTI assessment tests.

#### Generate an assessement and manifest

createAssessmentTest create an assessment with all items in a folder.
createOrCompleteManifest will create or update a manifest based on all resources in a folder.

```ts
import { createOrCompleteManifest, createAssessmentTest } from '@citolab/qti-convert/qti-helper';

const foldername = 'path/to/qti-folder';

async function processQtiFolder(foldername: string) {
  try {
    const manifest = await createOrCompleteManifest(foldername);
    console.log('Manifest:', manifest);

    const assessmentTest = await createAssessmentTest(foldername);
    console.log('Assessment Test:', assessmentTest);
  } catch (error) {
    console.error('Error processing QTI folder:', error);
  }
}

processQtiFolder(foldername);
```

#### Get all resources

Returns a list of all resources with its type.

```ts
import { getAllResourcesRecursively, QtiResource } from '@citolab/qti-convert/qti-helper';

const allResources: QtiResource[] = [];
const foldername = 'path/to/qti-folder';

getAllResourcesRecursively(allResources, foldername);
console.log(allResources);
```

## License

This package is licensed under the GNU General Public License. See the [LICENSE file](/LICENSE) for more information.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.
