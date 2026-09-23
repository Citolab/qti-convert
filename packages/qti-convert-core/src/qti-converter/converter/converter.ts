import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { postProcessPackageFilesSyncAssessmentItemAndItemRefIds } from '../../qti-helper';
import { qtiTransform } from '../../qti-transformer';
import {
  extractSharedStimuliIfEnabled,
  type SharedStimuliPackageOptions,
  type SharedStimulusPackageFiles,
  upgradeQti2toQti3
} from '../../qti-upgrader';

const hasElementLocalName = ($: cheerio.CheerioAPI, localName: string): boolean =>
  $('*')
    .toArray()
    .some(el => {
      if (el.type !== 'tag') {
        return false;
      }
      return (el.name || '').split(':').pop() === localName;
    });

// Some QTI 2.x packages namespace-prefix their content-packaging elements
// (e.g. <imscp:manifest>, <imscp:resource>). The selectors below match by
// plain tag name, so first strip the prefix bound to the IMS Content Packaging
// namespace, leaving a clean default-namespace QTI 3 manifest. Metadata
// namespaces (imsmd/imsqti) are left untouched.
const stripContentPackagingPrefix = ($: cheerio.CheerioAPI) => {
  const cpPrefixes = new Set<string>();
  $('*').each((_, el) => {
    if (el.type !== 'tag' || !el.attribs) {
      return;
    }
    for (const [attrName, attrValue] of Object.entries(el.attribs)) {
      if (attrName.startsWith('xmlns:') && attrValue.toLowerCase().includes('imscp')) {
        cpPrefixes.add(attrName.slice('xmlns:'.length));
      }
    }
  });

  for (const prefix of cpPrefixes) {
    $('*').each((_, el) => {
      if (el.type !== 'tag') {
        return;
      }
      if (el.name.startsWith(`${prefix}:`)) {
        el.name = el.name.slice(prefix.length + 1);
      }
      if (el.attribs && Object.prototype.hasOwnProperty.call(el.attribs, `xmlns:${prefix}`)) {
        delete el.attribs[`xmlns:${prefix}`];
      }
    });
  }
};

export const convertManifestFile = ($: cheerio.CheerioAPI) => {
  stripContentPackagingPrefix($);

  // Replace schemas
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
      console.log('Converting resource type to imsqti_test_xmlv3p0');
      $(element).attr('type', 'imsqti_test_xmlv3p0');
    } else if (resourceType && resourceType.includes('associatedcontent')) {
      $(element).attr('type', 'webcontent');
    }
  });
};

/** Converts QTI 2.x to QTI 3. */
export const convertQti2toQti3 = async (qti2: string) => upgradeQti2toQti3(cleanXMLString(qti2));

export function cleanXMLString(xmlString: string): string {
  if (!xmlString) {
    return xmlString;
  }
  // Regular expression to match the XML declaration
  const xmlDeclaration = /<\?xml.*?\?>/;

  // Find the position of the XML declaration
  const match = xmlString.match(xmlDeclaration);

  if (match && match.index !== undefined) {
    // Remove any characters before the XML declaration
    return xmlString.slice(match.index)?.replace('&#xfeff;', '');
  } else {
    // add the XML declaration to the beginning of the string
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlString?.replace('&#xfeff;', '')}`;
  }
}
/**
 * Browser-compatible function to convert assessment packages
 * Processes a package file and applies conversions to manifest, assessment, and item files
 * @param {Blob|File} file - The uploaded file object
 * @param {Function} convertManifest - Optional function to convert manifest files
 * @param {Function} convertAssessment - Optional function to convert assessment files
 * @param {Function} convertItem - Optional function to convert item files
 * @param {Function} postProcessing - Optional function for post-processing
 * @param {SharedStimuliPackageOptions} options - Optional: extract content shared by items into shared stimuli
 * @returns {Promise<Blob>} A blob containing the converted zip file
 */
export async function convertPackage(
  file,
  convertManifest = async $manifest => {
    // Default manifest conversion
    convertManifestFile($manifest);
    return $manifest;
  },
  convertAssessment = async $assessment => {
    // Default assessment conversion
    if (hasElementLocalName($assessment, 'assessmentTest')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()));
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem = async $item => {
    // Default item conversion
    if (hasElementLocalName($item, 'assessmentItem')) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()));
      const transform = qtiTransform(modifiedContent);
      const transformResult = await transform
        .objectToImg()
        .objectToVideo()
        .objectToAudio()
        .ssmlSubToSpan()
        .stripMaterialInfo()
        .minChoicesToOne()
        .externalScored()
        .qbCleanup()
        .depConvert();
      $item = cheerio.load(transformResult.xml(), { xmlMode: true, xml: true });
    }
    return $item;
  },
  postProcessing = async files => {
    // Default post-processing: sync assessment item identifiers
    // Convert array to Map for shared post-processing
    const filesMap = new Map();
    for (const file of files) {
      filesMap.set(file.path, {
        content: file.content,
        type: file.type
      });
    }

    // Apply shared post-processing logic for identifier synchronization
    const updatedFilesMap = await postProcessPackageFilesSyncAssessmentItemAndItemRefIds(filesMap);

    // Convert back to array format
    return files.map(originalFile => {
      const updatedFile = updatedFilesMap.get(originalFile.path);

      if (updatedFile) {
        return {
          ...originalFile,
          content: updatedFile.content,
          type: updatedFile.type
        };
      }
      return originalFile;
    });
  },
  options: SharedStimuliPackageOptions = {}
) {
  // Load the file into JSZip
  const zip = await JSZip.loadAsync(file);
  const newZip = new JSZip();

  // Array to store processed files for potential post-processing
  const processedFiles = [];

  const zipFileToProcess = Object.keys(zip.files).filter(
    path => !path.includes('__MACOSX') && !path.includes('.DS_Store')
  );

  // Process each file in the zip
  for (const relativePath of zipFileToProcess) {
    const zipEntry = zip.files[relativePath];

    // Skip directories
    if (zipEntry.dir) {
      newZip.folder(relativePath);
      continue;
    }

    const fileType = relativePath.split('.').pop()?.toLowerCase();

    if (fileType === 'xml') {
      // Get the content as string
      const content = await zipEntry.async('string');
      const cleanedContent = cleanXMLString(content);

      // Load the XML with cheerio
      let $ = cheerio.load(cleanedContent, { xmlMode: true, xml: true });
      let modifiedContent = $.xml();
      let fileTypeCategory = 'other';

      // Apply appropriate conversion based on file type
      if (hasElementLocalName($, 'qti-assessment-test') || hasElementLocalName($, 'assessmentTest')) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        fileTypeCategory = 'test';
      } else if (hasElementLocalName($, 'qti-assessment-item') || hasElementLocalName($, 'assessmentItem')) {
        $ = await convertItem($);
        modifiedContent = $.xml();
        fileTypeCategory = 'item';
      } else if (relativePath.toLowerCase().includes('imsmanifest.xml')) {
        $ = await convertManifest($);
        modifiedContent = $.xml();
        fileTypeCategory = 'manifest';
      }

      // Add the processed file to our array
      processedFiles.push({
        path: relativePath,
        content: modifiedContent,
        type: fileTypeCategory
      });
    } else {
      // For non-XML files, keep them as binary data
      const binaryContent = await zipEntry.async('blob');
      processedFiles.push({
        path: relativePath,
        content: binaryContent,
        type: 'other' // Changed from 'binary' to 'other' to match the type system
      });
    }
  }

  // Apply post-processing (includes identifier sync by default)
  const postProcessedFiles = await postProcessing(processedFiles);
  const finalFiles = options.extractSharedStimuli
    ? [
        ...extractSharedStimuliIfEnabled(
          new Map(postProcessedFiles.map(({ path, content, type }) => [path, { content, type }])) as SharedStimulusPackageFiles,
          options
        )
      ].map(([path, file]) => ({ path, ...file }))
    : postProcessedFiles;

  // Add all processed files to the new zip
  for (const file of finalFiles) {
    if (file.type === 'other' && file.content instanceof Blob) {
      // For binary files (blobs), add directly
      newZip.file(file.path, file.content);
    } else {
      // For XML and text files
      newZip.file(file.path, file.content);
    }
  }

  // Generate the final zip file as a blob
  const outputBlob = await newZip.generateAsync({ type: 'blob' });

  return outputBlob;
}
