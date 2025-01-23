import * as path from 'path';
import * as cheerio from 'cheerio';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { convertQti2toQti3 } from './converter';
import { copyFileSync, createReadStream, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { qtiTransform } from 'src/lib/qti-transformer';

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
  baseUrl?: string // Base URL need to resolve relative paths in PCI's can be empty
): Promise<Buffer> {
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });
  const outputBuffers: Buffer[] = [];
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
      } else if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
        $ = await convertItem($);
        modifiedContent = $.xml();
      } else if (entryName === 'imsmanifest.xml') {
        $ = await convertManifest($);
        modifiedContent = $.xml();
      }
      // Append the modified XML to the archive
      archive.append(modifiedContent, { name: entryName });
    } else {
      // Append other files as they are to the archive
      const content = await entry.buffer();
      archive.append(content, { name: entryName });
    }
    entry.autodrain();
  }

  // Finalize the archive
  await archive.finalize();

  // Combine the collected data chunks into a single buffer
  const outputBuffer = Buffer.concat(outputBuffers);
  return outputBuffer;
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
  }
): Promise<void> {
  const allFiles = readdirSync(packageFolder);
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
      } else if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
        $ = await convertItem($);
        modifiedContent = $.xml();
      } else if (fileName === 'imsmanifest.xml') {
        $ = await convertManifest($);
        modifiedContent = $.xml();
      }
      writeFileSync(`${outputFolder}/${fileName}`, modifiedContent);
    } else if (!isDir && fileName.toLocaleLowerCase() !== '.DS_Store') {
      copyFileSync(fullPath, `${outputFolder}/${fileName}`);
    } else if (isDir) {
      mkdirSync(`${outputFolder}/${fileName}`);
      convertPackageFolder(fullPath, `${outputFolder}/${fileName}`, convertManifest, convertAssessment, convertItem);
    }
  }
}

// Function to read a local file and convert it
export async function convertPackageFile(localFilePath: string, outputZipFilePath: string): Promise<void> {
  const unzipStream = createReadStream(localFilePath).pipe(unzipper.Parse({ forceStream: true }));
  const buffer = await convertPackageStream(unzipStream);
  writeFileSync(outputZipFilePath, buffer);
}

// TODO add manifest fix + code to fix references + manifest creator

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
