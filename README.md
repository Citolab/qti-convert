# @citolab/qti-convert

Welcome to **@citolab/qti-convert**, a tool for converting and transforming QTI. This package has scripts that can be executed from the command line and contains functions that can be integrated in JavaScript/TypeScript applications.

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

The following commands can be run from the terminal:

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

#### Removing media files

For test purposes it must sometimes be helpfull to remove large files from your qti-package.
This works on both qti2x as qti3. It will create a new zip file called: {orginal-name}-stripped.zip

```sh
   npx -p=@citolab/qti-convert qti-strip-media-pkg yourpackage.zip
```

This will remove audio and video by default. But you can specify filetype/file size yourself as well:

```sh
   npx -p=@citolab/qti-convert qti-strip-media-pkg yourpackage.zip audio,.css,300kb
```

This will remove all audio file of any known extension, .css files and files larger than 300kb.
audio,video,images are supported as type, for other files you should add the extension.

Not only the files are remove but the reference in the item/test and manifest will be removed as well. In the item and test if will be replace by an image placeholder that indicates that there is a file removed. css and xsd references will just be deleted just like references in the manifest.

#### Creating an assessment test

```sh
    npx -p=@citolab/qti-convert qti-create-assessment yourfolder (e.g c:\users\you\qti-folder or /Users/you/qti-folder)
```

I you have a directory with one or more items but no assessment test, this command will create a assessment test that contains all the items that are in the foldername.
It will override an existing assessment that's callled test.xml.

Should have the path to a folder as input parameter. This folder should contain the content of a qti3 or qti2x package

#### Creating or updating an manifest

```sh
    npx -p=@citolab/qti-convert qti-create-manifest yourfolder (e.g c:\users\you\qti-folder or /Users/you/qti-folder)
```

This will create or update an existing manifest. It will look into the directory and search for all items, tests and resources.
Also it will add the resources that are used in an item as a dependency. This folder should contain the content of a qti3 or qti2x package

#### Creating a package zip

This create a package.zip based on all resources in a manifest. So it you have an existing package and you want to remove some items, you can extract the package.zip, remove the manifest, re-generate a manifest using qti-create-manifest and then run this command. The resources used in only the items you deleted, wont be packaged in the new zip.

```sh
   npx -p=@citolab/qti-convert qti-create-package yourpackage.zip
```

#### Creating a package zip per item

This create a package.zip per item, for all items in a folder. The package will be called: package\_{item_title || item_identifer}.zip.

```sh
   npx -p=@citolab/qti-convert qti-create-package-per-item yourpackage.zip
```

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
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';

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
await(xmlValue).fnChAsync(async $ => {
  // Your custom asynchronous transformation logic
});
```

The build-in functions that can be chained are:

- `mathml(): QtiTransformAPI`: Convert MathML elements to web components.
- `objectToVideo(): QtiTransformAPI`: Convert `<object>` elements to `<video>` elements..
- `objectToAudio(): QtiTransformAPI`: Convert `<object>` elements to `<audio>` elements..
- `objectToImg(): QtiTransformAPI`: Convert `<object>` elements to `<img>` elements.
- `stripStylesheets(): QtiTransformAPI`: Remove all stylesheet references from the XML.
- `changeAssetLocation(getNewUrl: (oldUrl: string) => string, srcAttribute?: string[], skipBase64 = true): QtiTransformAPI`: Helper function to change the asset location of media files. Url can be changed in the callback function. By default the following attributes are checked for references: `['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location']` but that can be overriden. Also by default you won't get a callback for base64 urls.
- `changeAssetLocationAsync(getNewUrl: (oldUrl: string) => Promise<string>, srcAttribute?: string[], skipBase64 = true): QtiTransformAPI`: Async function of changeAssetLocation
- `configurePciAsync(baseUrl: string, getModuleResolutionConfig: (url: string) => Promise<ModuleResolutionConfig>): Promise<QtiTransformAPI>`: makes sure custom-interaction-type-identifier are unique per item, adds /modules/module_resolution.js and /modules/fallback_module_resolution.js to the qti-interaction-modules tag of the item qti and sets a baseUrl to be able to get the full path of the modules.
- `upgradePci()`: The default qti3 upgrader doesn't handle pci's exported from TAO properly. This is tested only for PCI's that use the latest PCI standard and are exported to qti2.x with TAO.
- `customTypes(): QtiTransformAPI`: Apply custom type transformations to the XML. Can be used override default web-components. E.g. `<qti-choice-interaction class="type:custom">` will result in `<qti-choice-interaction-custom>` so you can create your own web-component to render choice interactions.
- `customInteraction(baseRef: string, baseItem: string)` Transforms qti-custom-interactions that contain an object tag. Object tag will be removed and attributes will be merged in the qti-custom-interactions tag.
- `stripMaterialInfo(): QtiTransformAPI`: Remove unnecessary material information from the XML
- `qbCleanup(): QtiTransformAPI`: Clean-up for package created with the Quesify Platform
- `depConvert(): QtiTransformAPI`: Converts qti from the Dutch Extension Profile. For now only dep-dialog to a html popover. With is basic support for these dialog.
- `minChoicesToOne(): QtiTransformAPI`: Ensure the minimum number of choices is one.
- `suffix(elements: string[], suffix: string)`: Add a suffix to specified elements.
- `externalScored()`: Mark the XML as externally scored.

Other function to get the output of the transformer:

- `xml()`: returns the xml as string
- `browser.htmlDoc()`: returns a DocumentFragment. Won't work on node.
- `browser.xmlDoc()`: returns a XMLDocument. Won't work on node.

### Loader

The @citolab/qti-convert/qti-loader module provides utilities for loading and processing QTI XML content. It includes functions to fetch IMS manifest files, retrieve assessment tests, and extract item information.

#### Fetching IMS Manifest Data

The `testLoader` function fetches and processes the IMS manifest XML file from a given URI. It retrieves the assessment test and its associated items.

### Helper

@citolab/qti-convert/qti-helper provides a set of helper functions for QTI package. E.g. removeMediaFromPackage is a helper to remove media files from a QTI-package

### Helper Node

@citolab/qti-convert/qti-helper-node provides a set of helper functions for QTI packages. It includes functions to recursively retrieve QTI resources, create or update IMS manifest files and generate QTI assessment tests. These only work in NodeJS and wont work in the browser.

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
