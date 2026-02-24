import * as path from 'path';
import * as cheerio from 'cheerio';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { convertQti2toQti3 } from './converter';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { qtiTransform } from 'src/lib/qti-transformer';
import { cleanXMLString, postProcessPackageFilesSyncAssessmentItemAndItemRefIds } from 'src/lib/qti-helper';

const hasElementLocalName = ($: cheerio.CheerioAPI, localName: string): boolean =>
  $('*')
    .toArray()
    .some(el => {
      if (el.type !== 'tag') {
        return false;
      }
      return (el.name || '').split(':').pop() === localName;
    });

// Function to find the prefix for a given namespace URI by checking all elements
function findNamespacePrefixFromAnyElement($, namespaceURI): { prefix: string; namespace: string } | null {
  // Check all elements for namespace declarations
  for (const element of $('*')) {
    const attributes = element.attribs || {};
    for (const [attrName, attrValue] of Object.entries(attributes)) {
      if (
        attrName.startsWith('xmlns:') &&
        attrValue.toString().trim().toLocaleLowerCase().includes(namespaceURI.trim().toLocaleLowerCase())
      ) {
        const prefix = attrName.replace('xmlns:', '');
        const namespace = attrValue.toString().trim();
        if (prefix) {
          return { prefix, namespace };
        }
        break;
      }
    }
  }
  return null;
}

const removeNamespacePrefix = ($: cheerio.CheerioAPI, prefix: string): cheerio.CheerioAPI => {
  // First, find the namespace URI for the given prefix
  let namespaceURI = null;
  for (const element of $('*')) {
    const nsAttr = $(element).attr(`xmlns:${prefix}`);
    if (nsAttr) {
      namespaceURI = nsAttr;
      break;
    }
  }

  if (!namespaceURI) {
    console.warn(`No namespace found for prefix: ${prefix}`);
    return $;
  }

  // Check if there's already a default namespace and handle it
  const existingDefaultNS = $('[xmlns]').first().attr('xmlns');
  if (existingDefaultNS) {
    // Check if the existing default namespace is the same as the prefix namespace
    if (existingDefaultNS.trim() === namespaceURI.trim()) {
      // Same namespace - just remove the prefix declarations, no need for olddefault
    } else {
      // Different namespaces - rename existing default namespace to olddefault:
      $('[xmlns]').each((index, element) => {
        const $elem = $(element);
        const defaultNS = $elem.attr('xmlns');
        if (defaultNS) {
          $elem.removeAttr('xmlns');
          $elem.attr('xmlns:olddefault', defaultNS);
        }
      });

      // Also update any elements that were using the default namespace
      $('*').each((index, element) => {
        const $elem = $(element);
        const tagName = (element as any).tagName;

        // Skip if element already has a prefix or is the one we're converting
        if (tagName.includes(':')) return;

        // Check if this element should be in the old default namespace
        let shouldPrefix = false;
        let currentElement = element;

        // Walk up the tree to find namespace context
        while (currentElement) {
          const $current = $(currentElement);
          if ($current.attr('xmlns:olddefault')) {
            shouldPrefix = true;
            break;
          }
          currentElement = currentElement.parent;
        }

        if (shouldPrefix) {
          // We need to recreate this element with olddefault: prefix
          const innerHTML = $elem.html();
          if ((element as any).attribs) {
            const attributes = { ...(element as any).attribs };
            delete attributes.xmlns; // Remove xmlns if present

            const attrString = Object.entries(attributes)
              .map(([name, value]) => `${name}="${value}"`)
              .join(' ');

            const newElementHtml = innerHTML
              ? `<olddefault:${tagName}${attrString ? ' ' + attrString : ''}>${innerHTML}</olddefault:${tagName}>`
              : `<olddefault:${tagName}${attrString ? ' ' + attrString : ''}/>`;

            $elem.replaceWith(newElementHtml);
          }
        }
      });
    }
  }

  // Now handle the prefix removal
  const elementsToTransform = [];
  $(`*`).each((index, element) => {
    if ((element as any).name.startsWith(prefix + ':')) {
      elementsToTransform.unshift(element);
    }
  });

  elementsToTransform.forEach(element => {
    const $elem = $(element);
    const localName = element.tagName.replace(`${prefix}:`, '');

    const newAttributes = {};
    Object.entries(element.attribs || {}).forEach(([attrName, attrValue]) => {
      if (attrName === `xmlns:${prefix}`) {
        // Convert to default namespace
        newAttributes['xmlns'] = attrValue;
      } else if (attrName.startsWith(`${prefix}:`)) {
        const localAttrName = attrName.replace(`${prefix}:`, '');
        newAttributes[localAttrName] = attrValue;
      } else if (!attrName.startsWith('xmlns:') || attrName === 'xmlns:olddefault') {
        newAttributes[attrName] = attrValue;
      }
    });

    const innerHTML = $elem.html();
    const attrString = Object.entries(newAttributes)
      .map(([name, value]) => `${name}="${value}"`)
      .join(' ');

    const newElementHtml = innerHTML
      ? `<${localName}${attrString ? ' ' + attrString : ''}>${innerHTML}</${localName}>`
      : `<${localName}${attrString ? ' ' + attrString : ''}/>`;

    $elem.replaceWith(newElementHtml);
  });

  // Clean up any remaining namespace declarations for the removed prefix
  $(`[xmlns\\:${prefix}]`).each((index, element) => {
    const $elem = $(element);
    const nsValue = $elem.attr(`xmlns:${prefix}`);
    $elem.removeAttr(`xmlns:${prefix}`);

    if (!$elem.attr('xmlns')) {
      $elem.attr('xmlns', nsValue);
    }
  });

  return $;
};

export const convertManifestFile = ($: cheerio.CheerioAPI) => {
  console.log('Converting manifest file...');
  // Replace schemas

  // Find the prefix for the IMS CP namespace
  const imscpNamespace = 'http://www.imsglobal.org/xsd/imscp';
  const result = findNamespacePrefixFromAnyElement($, imscpNamespace);

  if (result) {
    const { prefix, namespace } = result;
    // Get the XML string and remove the prefix
    $ = removeNamespacePrefix($, prefix);

    console.log(
      `Removed prefix: ${prefix} for namespace: ${namespace} content:`,
      $.xml().substring(0, Math.min(500, $.xml().length))
    ); // Log first 100 characters for debugging
  }

  $('manifest').attr({
    xmlns: 'http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1',
    'xmlns:imsqti': 'http://www.imsglobal.org/xsd/imsqti_metadata_v3p0',
    'xsi:schemaLocation': `http://ltsc.ieee.org/xsd/LOM https://purl.imsglobal.org/spec/md/v1p3/schema/xsd/imsmd_loose_v1p3p2.xsd
                    http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd
                    http://www.imsglobal.org/xsd/imsqti_metadata_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_metadatav3p0_v1p0.xsd`
  });

  // Add or replace schema version
  $('manifest > metadata').each((_, element) => {
    const schemaElement = $('schema', element);
    if (schemaElement.length > 0) {
      schemaElement.text('QTI Package');
    } else {
      $(element).append('<schema>QTI Package</schema>');
    }
    const schemaVersionElement = $('schemaversion', element);
    if (schemaVersionElement.length === 0) {
      $(element).append('<schemaversion>3.0.0</schemaversion>');
    } else {
      schemaVersionElement.text('3.0.0');
    }
  });

  // Replace resource types
  $('resource').each((_, element) => {
    const resourceType = $(element).attr('type');
    if (resourceType && resourceType.includes('item')) {
      $(element).attr('type', 'imsqti_item_xmlv3p0');
    } else if (resourceType && resourceType.includes('test')) {
      $(element).attr('type', 'imsqti_test_xmlv3p0');
    } else if (resourceType && resourceType.includes('associatedcontent')) {
      $(element).attr('type', 'webcontent');
    }
  });
  return $;
};

// Function to handle Firestore storage files
// callbacks for converting assessment, manifest and item are optional and provided with defaul conversions
// can be overridden if other conversions are needed
// Shared core processing logic
// Shared core processing logic
async function processPackageFiles(
  unzipStream: any,
  convertManifest: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = $manifest => {
    convertManifestFile($manifest);
    return Promise.resolve($manifest);
  },
  convertAssessment: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $assessment => {
    if (hasElementLocalName($assessment, 'assessmentTest')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $item => {
    if (hasElementLocalName($item, 'assessmentItem')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
      const transform = qtiTransform(modifiedContent);
      if (!transform) {
        console.warn('QTI Transform could not be initialized. Please check your QTI package.');
      }
      const transformResult = await transform
        .objectToImg()
        .objectToVideo()
        .objectToAudio()
        .ssmlSubToSpan()
        .stripMaterialInfo()
        .minChoicesToOne()
        .externalScored()
        .qbCleanup()
        .depConvert()
        .upgradePci();
      $item = cheerio.load(transformResult.xml(), { xmlMode: true, xml: true });
    }
    return $item;
  }
): Promise<Map<string, { content: string | Buffer; type: 'test' | 'item' | 'manifest' | 'other' }>> {
  const processedFiles = new Map<
    string,
    {
      content: string | Buffer;
      type: 'test' | 'item' | 'manifest' | 'other';
    }
  >();

  // Process files from the unzip stream
  for await (const entry of unzipStream) {
    const entryName = entry.path;
    const fileType = path.extname(entryName);

    if (fileType === '.xml') {
      const content = await entry.buffer();
      let $ = cheerio.load(cleanXMLString(content.toString('utf8')), {
        xmlMode: true,
        xml: true
      });

      let modifiedContent = $.xml();
      let fileTypeCategory: 'test' | 'item' | 'manifest' | 'other' = 'other';

      if (hasElementLocalName($, 'qti-assessment-test') || hasElementLocalName($, 'assessmentTest')) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        fileTypeCategory = 'test';
      } else if (hasElementLocalName($, 'qti-assessment-item') || hasElementLocalName($, 'assessmentItem')) {
        $ = await convertItem($);
        modifiedContent = $.xml();
        fileTypeCategory = 'item';
      } else if (entryName === 'imsmanifest.xml') {
        $ = await convertManifest($);
        modifiedContent = $.xml();
        fileTypeCategory = 'manifest';
      }

      processedFiles.set(entryName, {
        content: modifiedContent,
        type: fileTypeCategory
      });

      // Clean up buffer immediately
      content.fill(0);
    } else {
      // Handle non-XML files
      const content = await entry.buffer();

      processedFiles.set(entryName, {
        content: content,
        type: 'other'
      });
    }

    entry.autodrain();
  }

  return processedFiles;
}

// Original function that returns a Buffer (for backward compatibility)
export async function convertPackageStream(
  unzipStream: any,
  convertManifest?: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertAssessment?: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertItem?: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  postProcessing?: (
    files: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]
  ) => Promise<{ path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]>
): Promise<Buffer> {
  // Process files using shared logic
  const processedFiles = await processPackageFiles(unzipStream, convertManifest, convertAssessment, convertItem);
  // Apply post-processing using shared logic
  const updatedFiles = await postProcessPackageFilesSyncAssessmentItemAndItemRefIds(processedFiles);

  // If custom post-processing is provided, apply it
  if (postProcessing) {
    const filesArray = Array.from(updatedFiles.entries()).map(([path, file]) => ({
      path,
      content: typeof file.content === 'string' ? file.content : file.content.toString(),
      type: file.type
    }));

    const customProcessedFiles = await postProcessing(filesArray);

    // Update the map with custom processed results
    updatedFiles.clear();
    for (const file of customProcessedFiles) {
      updatedFiles.set(file.path, {
        content: file.content,
        type: file.type
      });
    }
  }

  // Create archive and return as Buffer
  return createArchiveBuffer(updatedFiles);
}

// New function that streams directly to storage
export async function convertPackageStreamAndWriteToStream(
  unzipStream: any,
  outputStream: NodeJS.WritableStream,
  convertManifest?: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertAssessment?: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>,
  convertItem?: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI>
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      // Process files using shared logic
      const processedFiles = await processPackageFiles(unzipStream, convertManifest, convertAssessment, convertItem);

      // Apply post-processing using shared logic
      const updatedFiles = await postProcessPackageFilesSyncAssessmentItemAndItemRefIds(processedFiles);

      // Stream to output
      await streamArchiveToOutput(updatedFiles, outputStream);

      // Clean up
      updatedFiles.clear();

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to create archive buffer
async function createArchiveBuffer(files: Map<string, { content: string | Buffer; type: string }>): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const outputBuffers: Buffer[] = [];

  archive.on('data', chunk => {
    outputBuffers.push(chunk);
  });

  // Add all files to archive
  for (const [filePath, fileData] of files.entries()) {
    if (Buffer.isBuffer(fileData.content)) {
      archive.append(fileData.content, { name: filePath });
    } else {
      archive.append(fileData.content, { name: filePath });
    }
  }

  await archive.finalize();
  return Buffer.concat(outputBuffers);
}

// Helper function to stream archive to output
async function streamArchiveToOutput(
  files: Map<string, { content: string | Buffer; type: string }>,
  outputStream: NodeJS.WritableStream
): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Pipe directly to output stream
    archive.pipe(outputStream);

    // Handle archive events
    archive.on('error', err => {
      reject(err);
    });

    archive.on('end', () => {
      resolve();
    });

    // Add all files to archive
    for (const [filePath, fileData] of files.entries()) {
      if (Buffer.isBuffer(fileData.content)) {
        archive.append(fileData.content, { name: filePath });
      } else {
        archive.append(fileData.content, { name: filePath });
      }
    }

    archive.finalize();
  });
}

// Convenience function for Firebase Storage usage
export async function convertPackageToStorage(
  inputFile: any, // Firebase Storage file
  outputFile: any // Firebase Storage file
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const readStream = inputFile.createReadStream();
      const unzipStream = readStream.pipe(unzipper.Parse({ forceStream: true }));

      const writeStream = outputFile.createWriteStream({
        metadata: {
          contentType: 'application/zip'
        }
      });

      // Handle stream errors
      writeStream.on('error', error => {
        console.error('Write stream error:', error);
        reject(error);
      });

      readStream.on('error', error => {
        console.error('Read stream error:', error);
        reject(error);
      });

      // Handle successful completion
      writeStream.on('finish', () => {
        resolve();
      });

      await convertPackageStreamAndWriteToStream(unzipStream, writeStream);
    } catch (error) {
      reject(error);
    }
  });
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
      if (hasElementLocalName($, 'qti-assessment-test') || hasElementLocalName($, 'assessmentTest')) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        processedFiles.push({ path: `${outputFolder}/${fileName}`, content: modifiedContent, type: 'test' });
      } else if (hasElementLocalName($, 'qti-assessment-item') || hasElementLocalName($, 'assessmentItem')) {
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
  packageFolder: string,
  outputFolder: string,
  convertManifest: ($manifest: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = $manifest => {
    convertManifestFile($manifest);
    return Promise.resolve($manifest);
  },
  convertAssessment: ($assessment: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $assessment => {
    if (hasElementLocalName($assessment, 'assessmentTest')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem: ($item: cheerio.CheerioAPI) => Promise<cheerio.CheerioAPI> = async $item => {
    if (hasElementLocalName($item, 'assessmentItem')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
      $item = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $item;
  },
  postProcessing?: (
    files: { path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]
  ) => Promise<{ path: string; content: string; type: 'test' | 'item' | 'manifest' | 'other' }[]>
): Promise<void> {
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

  // Convert array to Map for shared post-processing
  const filesMap = new Map<string, { content: string | Buffer; type: 'test' | 'item' | 'manifest' | 'other' }>();
  for (const file of processedFiles) {
    // Extract just the filename for the map key to match the stream processing behavior
    const fileName = path.basename(file.path);
    filesMap.set(fileName, {
      content: file.content,
      type: file.type
    });
  }

  // Apply shared post-processing logic
  const updatedFilesMap = await postProcessPackageFilesSyncAssessmentItemAndItemRefIds(filesMap);

  // Convert back to array format, preserving original paths
  const updatedFiles = processedFiles.map(originalFile => {
    const fileName = path.basename(originalFile.path);
    const updatedFile = updatedFilesMap.get(fileName);

    if (updatedFile) {
      return {
        ...originalFile,
        content: typeof updatedFile.content === 'string' ? updatedFile.content : updatedFile.content.toString()
      };
    }
    return originalFile;
  });

  // Apply custom post-processing if provided
  const finalFiles = postProcessing ? await postProcessing(updatedFiles) : updatedFiles;

  // Write all files
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
