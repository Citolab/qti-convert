import * as path from 'path';
import * as cheerio from 'cheerio';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { cleanXMLString, convertManifestFile, convertQti2toQti3 } from './../../qti-converter/converter/converter';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { qtiTransform } from 'src/lib/qti-transformer';
import { Element } from 'domhandler';

// Function to handle Firestore storage files
// callbacks for converting assessment, manifest and item are optional and provided with defaul conversions
// can be overridden if other conversions are needed
export async function convertPackageStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unzipStream: any,
  convertManifest: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = $manifest => {
    convertManifestFile($manifest);
    return Promise.resolve($manifest);
  },
  convertAssessment: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $assessment => {
    if ($assessment('assessmentTest').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $item => {
    if ($item('assessmentItem').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
      const transform = qtiTransform(modifiedContent);
      const transformResult = await transform
        // .stripStylesheets()
        .objectToImg()
        .objectToVideo()
        .objectToAudio()
        .stripMaterialInfo()
        .minChoicesToOne()
        .externalScored()
        .qbCleanup()
        .depConvert()
        .upgradePci();
      $item = cheerio.load(transformResult.xml(), { xmlMode: true, xml: true });
    }
    return $item;
  },
  postProcessing: (
    files: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]
  ) => Promise<{ path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]> = async files => {
    return Promise.resolve(files);
  }
): Promise<Buffer> {
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });
  const outputBuffers: Buffer[] = [];
  const processedFiles: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[] = [];

  // Collect data chunks in an array of buffers
  archive.on('data', chunk => {
    outputBuffers.push(chunk);
  });

  for await (const entry of unzipStream) {
    const entryName = entry.path;
    const fileType = path.extname(entryName);

    if (fileType === '.xml') {
      // If the file is an XML, process it
      const content = await entry.buffer();
      let $ = cheerio.load(cleanXMLString(content.toString('utf8')), { xmlMode: true, xml: true });
      let modifiedContent = $.xml();
      if ($('qti-assessment-test').length > 0 || $('assessmentTest').length > 0) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        processedFiles.push({ path: entryName, content: modifiedContent, type: 'test' });
      } else if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
        $ = await convertItem($);
        modifiedContent = $.xml();
        processedFiles.push({ path: entryName, content: modifiedContent, type: 'item' });
      } else if (entryName === 'imsmanifest.xml') {
        $ = await convertManifest($);
        modifiedContent = $.xml();
        processedFiles.push({ path: entryName, content: modifiedContent, type: 'manifest' });
      }
      // Append the modified XML to the archive
      archive.append(modifiedContent, { name: entryName });
    } else {
      // Append other files as they are to the archive
      const content = await entry.buffer();
      archive.append(content, { name: entryName });
      processedFiles.push({ path: entryName, content: content, type: 'other' });
    }
    entry.autodrain();
  }
  archive.removeAllListeners(); // Remove event listeners
  await archive.finalize();
  // Perform post-processing before finalizing the archive
  const updatedFiles = await postProcessing(processedFiles);

  // Create a new archive instead of aborting the old one
  const newArchive = archiver('zip', {
    zlib: { level: 9 }
  });
  const newOutputBuffers: Buffer[] = [];

  // Collect data chunks in an array of buffers
  newArchive.on('data', chunk => {
    newOutputBuffers.push(chunk);
  });

  // Append updated files to the new archive
  for (const file of updatedFiles) {
    newArchive.append(file.content, { name: file.path });
  }

  // Finalize the new archive
  await newArchive.finalize();

  // Combine the collected data chunks into a single buffer
  const outputBuffer = Buffer.concat(newOutputBuffers);

  // Return the final buffer
  return outputBuffer;
}

/**
 * Resolves a relative path from a base file to an absolute path relative to the root.
 * @param baseFilePath - The path of the file containing the reference.
 * @param relativeReference - The relative reference path from the base file.
 * @returns The relative path from the root.
 */
function resolvePathFromRoot(baseFilePath: string, relativeReference: string): string {
  // Get the directory of the base file
  const baseDir = path.dirname(baseFilePath);

  // Resolve the absolute path
  const absolutePath = path.resolve(baseDir, relativeReference);

  // Define the root directory name
  const rootDir = 'items';

  // Find the index of the root directory in the resolved path
  const rootIndex = absolutePath.indexOf(rootDir);
  if (rootIndex === -1) {
    throw new Error(`Root directory '${rootDir}' not found in resolved path`);
  }

  // Extract the path from the root directory onward
  const relativePath = absolutePath.substring(rootIndex);

  return relativePath.replace(/\\/g, '/'); // Normalize for all OS
}

function findByAttribute($assessmentTest: cheerio.CheerioAPI, tagName: string, attribute: string, value: string) {
  for (const itemRef of $assessmentTest(tagName)) {
    const itemRefElement = itemRef as Element;
    const attributeValue = itemRefElement.attribs[attribute];
    if (attributeValue === value) {
      return itemRefElement;
    }
  }

  return null;
}

function findByHref($assessmentTest: cheerio.CheerioAPI, tagName: string, value: string) {
  for (const itemRef of $assessmentTest(tagName)) {
    const itemRefElement = itemRef as Element;
    const attributeValue = itemRefElement.attribs['href'];
    // now check if the href is the same, but if it should not matter if one of the href starts with ./ or / or not
    const attributeValueNormalized = attributeValue.replace(/^(.\/|\/)/, '');
    const valueNormalized = value.replace(/^(.\/|\/)/, '');
    if (attributeValueNormalized === valueNormalized) {
      return itemRefElement;
    }
  }

  return null;
}

async function processFilesInFolder(
  packageFolder: string,
  outputFolder: string,
  convertManifest: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertAssessment: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertItem: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>
): Promise<{ path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]> {
  const allFiles = readdirSync(packageFolder);
  const processedFiles: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[] = [];
  for await (const file of allFiles) {
    const fullPath = path.join(packageFolder, file);
    const isDir = lstatSync(fullPath).isDirectory();
    const fileType = path.extname(file);
    const fileName = path.basename(file);
    if (fileType === '.xml') {
      const content = readFileSync(fullPath, {
        encoding: 'utf8'
      });
      let $ = cheerio.load(cleanXMLString(content), { xmlMode: true, xml: true });
      let modifiedContent = $.xml();
      if ($('qti-assessment-test').length > 0 || $('assessmentTest').length > 0) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        processedFiles.push({ path: `${outputFolder}/${fileName}`, content: modifiedContent, type: 'test' });
      } else if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
        $ = await convertItem($);
        modifiedContent = $.xml();
        processedFiles.push({ path: `${outputFolder}/${fileName}`, content: modifiedContent, type: 'item' });
      } else if (fileName === 'imsmanifest.xml') {
        $ = await convertManifest($);
        modifiedContent = $.xml();
        processedFiles.push({ path: `${outputFolder}/${fileName}`, content: modifiedContent, type: 'manifest' });
      }
    } else if (!isDir && fileName.toLocaleLowerCase() !== '.DS_Store') {
      const content = readFileSync(fullPath);
      processedFiles.push({ path: `${outputFolder}/${fileName}`, content: content.toString(), type: 'other' });
    } else if (isDir) {
      if (!existsSync(`${outputFolder}/${fileName}`)) {
        mkdirSync(`${outputFolder}/${fileName}`);
      }
      const subFolderFiles = await processFilesInFolder(
        fullPath,
        `${outputFolder}/${fileName}`,
        convertManifest,
        convertAssessment,
        convertItem
      );
      processedFiles.push(...subFolderFiles);
    }
  }
  return processedFiles;
}

export async function convertPackageFolder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  packageFolder: string,
  outputFolder: string,
  convertManifest: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = $manifest => {
    convertManifestFile($manifest);
    return Promise.resolve($manifest);
  },
  convertAssessment: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $assessment => {
    if ($assessment('assessmentTest').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $item => {
    if ($item('assessmentItem').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
      $item = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $item;
  },
  postProcessing: (
    files: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]
  ) => Promise<{ path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]> = async files => {
    const assessments = files.filter(file => file.type === 'test');
    for (const assessment of assessments) {
      const $manifest = await cheerio.load(files.find(file => file.type === 'manifest')?.content, {
        xmlMode: true,
        xml: true
      });
      if (!$manifest) {
        return Promise.resolve(files);
      }
      const $assessment = await cheerio.load(assessment.content, { xmlMode: true, xml: true });
      const assessmentRefs = $assessment('qti-assessment-item-ref');
      const assessmentInManifest = $manifest('resource[type="imsqti_test_xmlv3p0"]');
      let changed = false;
      for (const assessmentRef of assessmentRefs) {
        const refId = $assessment(assessmentRef).attr('identifier');
        const matchingItem = findByAttribute($manifest, 'qti-assessment-item-ref', 'identifier', refId);
        const items = files.filter(file => file.type === 'item');
        if (!matchingItem) {
          // some packages, especially those from TAO have identifiers in the assessment that don't match the identifier in the item
          const hrefItem = $assessment(assessmentRef).attr('href');
          const hrefTest = assessmentInManifest.attr('href');
          const relativePath = resolvePathFromRoot(hrefTest, hrefItem);
          const matchingItem = items.find(item => {
            const path1 = item.path.replace(/^(.\/|\/)/, '');
            const path2 = relativePath.replace(/^(.\/|\/)/, '');
            return path1 === path2;
          });
          const itemInManifest = findByHref($manifest, 'resource', relativePath);
          if (matchingItem) {
            const $item = await cheerio.load(matchingItem.content, { xmlMode: true, xml: true });
            if ($item('qti-assessment-item').length > 0) {
              const assessmentItemId = $item('qti-assessment-item')[0]?.attribs['identifier'];
              assessmentRef.attribs['identifier'] = assessmentItemId || refId;
              if (itemInManifest) {
                itemInManifest.attribs['identifier'] = assessmentItemId || refId;
              }
            }
          }
          changed = true;
        }
      }
      if (changed) {
        // replace the assessment in the files array
        const modifiedAssessment = $assessment.xml();
        const assessmentIndex = files.findIndex(file => file.path === assessment.path);
        files[assessmentIndex].content = modifiedAssessment;
      }
    }
    return Promise.resolve(files);
  }
): Promise<void> {
  // check if outputFolder exists, if not create it
  // Check if outputFolder exists, if not create it
  if (!existsSync(outputFolder)) {
    mkdirSync(outputFolder, { recursive: true });
  }

  const processedFiles = await processFilesInFolder(
    packageFolder,
    outputFolder,
    convertManifest,
    convertAssessment,
    convertItem
  );

  const finalFiles = await postProcessing(processedFiles);
  for (const file of finalFiles) {
    writeFileSync(file.path, file.content);
  }
}

// Function to read a local file and convert it
export async function convertPackageFile(localFilePath: string, outputZipFilePath: string): Promise<void> {
  const unzipStream = createReadStream(localFilePath).pipe(unzipper.Parse({ forceStream: true }));
  const buffer = await convertPackageStream(unzipStream);
  writeFileSync(outputZipFilePath, buffer);
}
