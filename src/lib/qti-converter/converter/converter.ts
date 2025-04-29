import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { qtiTransform } from 'src/lib/qti-transformer';
// import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json';

/**
 * Converts QTI2.x to QTI3 using Saxon-JS in browser environment
 *
 * @param {string} qti2 - QTI2.x XML string
 * @returns {Promise<string>} QTI3 XML string
 */
// Import cleaned up since browser import assertions may differ
// You'll need to make sure this file is accessible from your web app
// import styleSheetString from './path/to/qti2xTo30.sef.json';
// import SaxonJS from 'saxon-js';
/**
 * Converts QTI2.x to QTI3 using Saxon-JS in browser environment
 *
 * @param {string} qti2 - QTI2.x XML string
 * @param {Object} styleSheetString - The stylesheet as a JSON object
 * @returns {Promise<string>} QTI3 XML string
 */
const convert = async (qti2, styleSheetString) => {
  // Ensure SaxonJS is available globally
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SaxonJS = (window as any).SaxonJS || globalThis.SaxonJS;

  if (!SaxonJS) {
    throw new Error('SaxonJS is not loaded. Please include it via a CDN.');
  }
  if (typeof SaxonJS === 'undefined') {
    throw new Error('SaxonJS is not loaded. Make sure to include the Saxon-JS library.');
  }

  qti2 = cleanXMLString(qti2);

  return new Promise<string>((resolve, reject) => {
    // There are two ways to use Saxon-JS in the browser:

    // Option 1: If you have the stylesheet as a JSON object already loaded
    if (styleSheetString) {
      try {
        // Use SaxonJS.transform for SaxonJS 2.x
        SaxonJS.transform(
          {
            stylesheetInternal: styleSheetString,
            sourceText: qti2,
            destination: 'serialized'
          },
          'async'
        )
          .then(output => {
            resolve(output.principalResult);
          })
          .catch(error => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    }
    // Option 2: Load the stylesheet from a URL
    else {
      try {
        SaxonJS.transform({
          stylesheetLocation: './qti2xTo30.sef.json',
          sourceText: qti2,
          destination: 'serialized'
        })
          .then(output => {
            resolve(output.principalResult);
          })
          .catch(error => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    }
  });
};

export const convertManifestFile = ($: cheerio.CheerioAPI) => {
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
      $(element).attr('type', 'imsqti_test_xmlv3p0');
    } else if (resourceType && resourceType.includes('associatedcontent')) {
      $(element).attr('type', 'webcontent');
    }
  });
};

export const convertQti2toQti3 = async (qti2: string, xsltJson = './qti2xTo30.sef.json') => {
  qti2 = cleanXMLString(qti2);

  // If styleSheetString is already imported as a module:
  // const qti3 = await convert(qti2, styleSheetString);

  // If we need to fetch the stylesheet:
  let styleSheet;
  try {
    const response = await fetch(xsltJson);
    styleSheet = await response.json();
  } catch (error) {
    console.error('Failed to load stylesheet:', error);
    throw new Error('Failed to load XSLT stylesheet');
  }

  const qti3 = await convert(qti2, styleSheet);
  return qti3;
};
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
 * @returns {Promise<Blob>} A blob containing the converted zip file
 */
export async function convertPackage(
  file,
  xsltJson = './qti2xTo30.sef.json',
  convertManifest = async $manifest => {
    // Default manifest conversion
    convertManifestFile($manifest);
    return $manifest;
  },
  convertAssessment = async $assessment => {
    // Default assessment conversion
    if ($assessment('assessmentTest').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($assessment.xml()), xsltJson);
      $assessment = cheerio.load(modifiedContent, { xmlMode: true, xml: true });
    }
    return $assessment;
  },
  convertItem = async $item => {
    // Default item conversion
    if ($item('assessmentItem').length > 0) {
      const modifiedContent = await convertQti2toQti3(cleanXMLString($item.xml()), xsltJson);
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
        .depConvert()
        .upgradePci();
      $item = cheerio.load(transformResult.xml(), { xmlMode: true, xml: true });
    }
    return $item;
  },
  postProcessing = async files => {
    // Default post-processing (no changes)
    return files;
  }
) {
  // Load the file into JSZip
  const zip = await JSZip.loadAsync(file);
  const newZip = new JSZip();

  // Array to store processed files for potential post-processing
  const processedFiles = [];

  // Process each file in the zip
  for (const relativePath of Object.keys(zip.files)) {
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
      let fileType = 'other';

      // Apply appropriate conversion based on file type
      if ($('qti-assessment-test').length > 0 || $('assessmentTest').length > 0) {
        $ = await convertAssessment($);
        modifiedContent = $.xml();
        fileType = 'test';
      } else if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
        $ = await convertItem($);
        modifiedContent = $.xml();
        fileType = 'item';
      } else if (relativePath.toLowerCase().includes('imsmanifest.xml')) {
        $ = await convertManifest($);
        modifiedContent = $.xml();
        fileType = 'manifest';
      }

      // Add the processed file to our array
      processedFiles.push({
        path: relativePath,
        content: modifiedContent,
        type: fileType
      });
    } else {
      // For non-XML files, keep them as binary data
      const binaryContent = await zipEntry.async('blob');
      processedFiles.push({
        path: relativePath,
        content: binaryContent,
        type: 'binary' // Mark as binary to handle differently later
      });
    }
  }

  // Apply post-processing to the files
  const updatedFiles = await postProcessing(processedFiles);

  // Add all processed files to the new zip
  for (const file of updatedFiles) {
    if (file.type === 'binary') {
      // For binary files, add directly as blobs
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

// Note: The blobToString function can be kept for other uses but is no longer used
// in the convertPackage function for binary files
async function blobToString(blob) {
  if (typeof blob === 'string') return blob;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
