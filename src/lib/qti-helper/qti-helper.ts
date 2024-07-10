import * as cheerio from 'cheerio';
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import xmlFormat from 'xml-formatter';
import unzipper from 'unzipper';
import path, { basename, extname } from 'path';
import archiver from 'archiver';
import { cleanXMLString } from '../qti-converter';

export const qtiReferenceAttributes = ['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location'];

export type QtiResource = {
  type: 'imsqti_test_xmlv3p0' | 'imsqti_item_xmlv3p0' | 'associatedcontent/learning-application-resource';
  href: string;
  identifier: string;
  dependencies: string[];
};

export const getAllResourcesRecursively = (allResouces: QtiResource[], foldername: string) => {
  // continue if the foldername is not a folder but a file
  if (!lstatSync(foldername).isDirectory()) {
    return;
  }
  try {
    const files = readdirSync(foldername);
    for (const file of files) {
      if (file === '.DS_Store') {
        continue;
      }
      const subfolder = `${foldername}/${file}`;
      let processed = false;
      if (lstatSync(subfolder).isDirectory()) {
        getAllResourcesRecursively(allResouces, subfolder);
      } else {
        if (subfolder.endsWith('.xml')) {
          processed = true;
          const content = readFileSync(subfolder, 'utf-8');
          if (content.indexOf('<qti-assessment-test') !== -1) {
            const $ = cheerio.load(content, { xmlMode: true, xml: true });
            const identifier = $(`qti-assessment-test`).attr('identifier');
            allResouces.push({
              type: 'imsqti_test_xmlv3p0',
              href: subfolder,
              identifier,
              dependencies: getDependencies($)
            });
          } else if (content.indexOf('<manifest') !== -1) {
            // do nothing
          } else if (content.indexOf('<qti-assessment-item') !== -1) {
            const $ = cheerio.load(content, {
              xmlMode: true,
              xml: true
            });
            const identifier = $(`qti-assessment-item`).attr('identifier');
            allResouces.push({
              type: 'imsqti_item_xmlv3p0',
              href: subfolder,
              identifier,
              dependencies: getDependencies($)
            });
          } else {
            processed = false;
          }
        }
        if (!processed) {
          console.log(`Unprocessed file: ${subfolder}`);
          const filenameWithoutExtension = `RES-${subfolder.split('/').pop().replaceAll('.', '_')}`;
          allResouces.push({
            type: 'associatedcontent/learning-application-resource',
            href: subfolder,
            identifier: filenameWithoutExtension,
            dependencies: []
          });
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
};

const getMediaTypeByExtension = (extension: string): 'audio' | 'video' | 'image' | 'unknown' => {
  switch (extension.replace('.', '')) {
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'aac':
    case 'flac':
    case 'amr':
    case 'wma':
    case '3gp':
      return 'audio';
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
    case 'webm':
    case 'flv':
    case '3gpp':
      return 'video';
    case 'jpg':
    case 'png':
    case 'tiff':
    case 'gif':
    case 'jpeg':
    case 'bmp':
    case 'svg':
      return 'image';
    default:
      return 'unknown';
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listAllContent(zipStream: unzipper.ParseStream) {
  const nonXMLFiles: {
    type: 'audio' | 'video' | 'image' | 'unknown';
    extension: string;
    name: string;
    sizeKb: number;
  }[] = [];

  for await (const entry of zipStream) {
    const entryName = entry.path;
    const fileType = extname(entryName);

    if (fileType !== '.xml') {
      const fileSizeKb = entry.vars.uncompressedSize / 1024; // File size in kilobytes
      nonXMLFiles.push({
        type: getMediaTypeByExtension(entryName),
        name: entryName,
        extension: fileType,
        sizeKb: +fileSizeKb.toFixed(2) // Convert to 2 decimal places
      });
    } else {
      try {
        const content = await entry.buffer();
        const $ = cheerio.load(cleanXMLString(content.toString('utf8')), { xmlMode: true, xml: true });
        if (
          $('qti-assessment-item').length > 0 ||
          $('assessmentItem').length > 0 ||
          $('qti-assessment-test').length > 0 ||
          $('assessmentTest').length > 0
        ) {
          const attributes = qtiReferenceAttributes;
          for (const attribute of attributes) {
            for (const node of $(`[${attribute}]`)) {
              const srcValue = $(node).attr(attribute)!;
              if (srcValue) {
                const filename = basename(srcValue);
                const extension = extname(srcValue);
                nonXMLFiles.push({
                  type: getMediaTypeByExtension(extension),
                  name: filename,
                  extension,
                  sizeKb: 0 // Convert to 2 decimal places
                });
              }
            }
          }
        }
      } catch {
        // Do nothing
      }
    }
    entry.autodrain();
  }

  return nonXMLFiles;
}

function removeReferencedTags(xmlContent: string, removedFiles: string[]) {
  return findReferencedTags(xmlContent, removedFiles, node => {
    node.remove();
  });
}

function getAncestorWithTagName(
  element: cheerio.Cheerio<cheerio.AnyNode>,
  tagNames: string[]
): cheerio.Cheerio<cheerio.Element> {
  tagNames = tagNames.map(tagName => tagName.toLowerCase());
  let parent = element.parent();
  while (parent.length > 0) {
    const tagName = parent[0].tagName.toLowerCase();
    if (tagNames.includes(tagName)) {
      return parent;
    }
    parent = parent.parent();
  }
  return null;
}

export function replaceReferencedTags(xmlContent: string, removedFiles: string[]) {
  return findReferencedTags(xmlContent, removedFiles, (node, removedFile) => {
    const base64SVG = createBase64SVGPlaceholder(removedFile);
    const mediaInteraction = getAncestorWithTagName(node, ['qti-media-interaction', 'mediaInteraction']);
    const elementToReplace = mediaInteraction || node;
    elementToReplace.replaceWith(`<img src="${base64SVG}" alt="File: ${removedFile} removed"/>`);
  });
}

function findReferencedTags(
  xmlContent: string,
  removedFiles: string[],
  handleFoundNode: (node: cheerio.Cheerio<cheerio.AnyNode>, removedFile: string) => void
) {
  // Load the XML content
  const $ = cheerio.load(xmlContent, { xmlMode: true });

  // Iterate through each node
  $('*').each(function (i, node) {
    const attributes = (node as cheerio.Element)?.attribs || [];
    // Check each attribute of the node
    for (const attr in attributes) {
      // Check if the attribute value ends with any of the removed file names
      const value = attributes[attr];
      if (removedFiles.some(file => value.endsWith(file))) {
        const removedFile = removedFiles.find(file => value.endsWith(file));
        handleFoundNode($(node), removedFile);

        break; // No need to check other attributes of this node
      }
    }
  });
  // Return the modified XML content
  return $.xml();
}

// Function to create a Base64-encoded SVG placeholder
function createBase64SVGPlaceholder(fileName: string): string {
  const svgPlaceholder = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="75">
      <rect width="200" height="50" style="fill:lightgray;stroke-width:1;stroke:gray" />
      <text x="10" y="25" fill="red"  textLength="380">File: ${fileName} removed</text>
    </svg>
  `;
  return `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`;
}

export const removeMediaFromPackage = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unzipStream: any,
  outputFileName: string,
  filters: string[]
) => {
  let zipStream = createReadStream(unzipStream).pipe(unzipper.Parse({ forceStream: true }));
  const allMediaFiles = await listAllContent(zipStream);
  const allFilesToRemove: string[] = [];
  filters.forEach(filter => {
    if (filter.toLocaleLowerCase().endsWith('kb') || filter.toLocaleLowerCase().endsWith('mb')) {
      const sizeInKb = filter.toLocaleLowerCase().endsWith('mb') ? +filter.slice(0, -2) * 1024 : +filter.slice(0, -2);
      allFilesToRemove.push(...allMediaFiles.filter(file => file.sizeKb > sizeInKb).map(file => file.name));
    } else if (filter === 'audio' || filter === 'video' || filter === 'image') {
      allFilesToRemove.push(...allMediaFiles.filter(file => file.type === filter).map(file => file.name));
    } else if (filter.startsWith('.')) {
      allFilesToRemove.push(
        ...allMediaFiles.filter(file => path.extname(file.name).toLowerCase() === filter).map(file => file.name)
      );
    }
  });
  const filesToRemove = [...new Set(allFilesToRemove)].map(f => path.basename(f));
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });
  const outputBuffers: Buffer[] = [];
  // Collect data chunks in an array of buffers
  archive.on('data', chunk => {
    outputBuffers.push(chunk);
  });
  // create a new one to loop, otherwise it will not work
  zipStream = createReadStream(unzipStream).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zipStream) {
    const entryName = entry.path;
    const fileType = path.extname(entryName);
    const basename = path.basename(entryName);
    if (fileType === '.xml') {
      const content = await entry.buffer();
      const contentText = cleanXMLString(content.toString('utf8'));
      const formattedXML = xmlFormat(contentText, {
        indentation: '  ',
        collapseContent: true,
        lineSeparator: '\n'
      });
      try {
        const $ = cheerio.load(formattedXML, { xmlMode: true, xml: true });
        if (
          $(`assessmentItem`).length > 0 ||
          $(`qti-assessment-item`).length > 0 ||
          $(`assessmentTest`).length > 0 ||
          $(`qti-assessment-test`).length > 0
        ) {
          const fileTypesThatCannotBeReplaced = ['.css', '.xsd'];
          let contentText = formattedXML;
          const filesToBeReplaced = filesToRemove.filter(
            file => !fileTypesThatCannotBeReplaced.includes(path.extname(file))
          );
          const filesToBeRemoved = filesToRemove.filter(file =>
            fileTypesThatCannotBeReplaced.includes(path.extname(file))
          );
          if (filesToBeReplaced.length > 0) {
            contentText = replaceReferencedTags(formattedXML, filesToBeReplaced);
          }
          if (filesToBeRemoved.length > 0) {
            contentText = removeReferencedTags(formattedXML, filesToBeRemoved);
          }

          archive.append(contentText, { name: entryName });
        } else if ($(`manifest`).length > 0) {
          const contentText = removeReferencedTags($.xml(), filesToRemove);
          archive.append(contentText, { name: entryName });
        } else {
          archive.append(formattedXML, { name: entryName });
        }
      } catch {
        // ignore
      }
    } else if (filesToRemove.includes(basename)) {
      console.log(`File: ${entryName} removed`);
      // do nothing
    } else {
      const content = await entry.buffer();
      archive.append(content, { name: entryName });
    }
    entry.autodrain();
  }
  // Finalize the archive
  await archive.finalize();

  // Combine the collected data chunks into a single buffer
  const outputBuffer = Buffer.concat(outputBuffers);
  writeFileSync(outputFileName, outputBuffer);
};

export const createOrCompleteManifest = async (foldername: string) => {
  const manifest = `${foldername}/imsmanifest.xml`;
  // check if manifest exists
  const identfier = foldername.split('/').pop();
  let manifestString = '';
  if (!existsSync(manifest)) {
    manifestString = `<?xml version="1.0" encoding="utf-8"?>
                    <manifest xmlns:imsmd="http://ltsc.ieee.org/xsd/LOM"
                        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                        xsi:schemaLocation="http://ltsc.ieee.org/xsd/LOM https://purl.imsglobal.org/spec/md/v1p3/schema/xsd/imsmd_loose_v1p3p2.xsd
                                            http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd"
                        identifier="${identfier}"
                        xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
                            <metadata>
                                <schema>QTI Package</schema>
                                <schemaversion>3.0.0</schemaversion>
                            </metadata>
                            <organizations />
                            <resources>
                            </resources>
                    </manifest>`;
  } else {
    manifestString = readFileSync(manifest, 'utf-8');
  }
  const $manifestXml = cheerio.load(manifestString, {
    xmlMode: true,
    xml: true
  });

  const allResouces: QtiResource[] = [];
  getAllResourcesRecursively(allResouces, foldername);
  for (const resource of allResouces) {
    if ($manifestXml(`resource[identifier="${resource.identifier}"]`).length === 0) {
      const href = resource.href.replace(foldername, '');
      // remove first slash if it exists
      const hrefWithoutLeadingSlash = href[0] === '/' ? href.slice(1) : href;
      $manifestXml('resources').append(
        `<resource identifier="${resource.identifier}" type="${resource.type}" href="${hrefWithoutLeadingSlash}">
      <file href="${hrefWithoutLeadingSlash}" />
    </resource>`
      );
    }
    if (resource.dependencies.length > 0) {
      const manifestResource = $manifestXml(`resource[identifier="${resource.identifier}"]`);
      if (manifestResource.length > 0) {
        for (const dependency of resource.dependencies) {
          const dependencyNode = manifestResource.find(`dependency[identifierref="${dependency}"]`);

          if (dependencyNode.length === 0) {
            // Append the dependency node if it doesn't exist
            manifestResource.append(`<dependency identifierref="${dependency}"/>`);
          }
        }
      }
    }
  }
  let xmlString = $manifestXml.xml();
  // Remove the BOM character if it exists: https://github.com/cheeriojs/cheerio/issues/1117
  if (xmlString.startsWith('&#xfeff;')) {
    xmlString = xmlString.replace('&#xfeff;', '');
  }
  const formattedXML = xmlFormat(xmlString, {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  });
  return formattedXML;
};

export const createAssessmentTest = async (foldername: string) => {
  const allResouces: QtiResource[] = [];
  getAllResourcesRecursively(allResouces, foldername);
  const items = allResouces.filter(item => item.type === 'imsqti_item_xmlv3p0');

  const xmlString = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<qti-assessment-test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
                     xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd http://www.w3.org/1998/Math/MathML https://purl.imsglobal.org/spec/mathml/v3p0/schema/xsd/mathml3.xsd http://www.w3.org/2001/XInclude https://purl.imsglobal.org/spec/w3/2001/schema/xsd/XInclude.xsd" 
                     xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:xi="http://www.w3.org/2001/XInclude" xmlns:m="http://www.w3.org/1998/Math/MathML" 
                     tool-version="0.1" 
                     title="My Test" tool-name="Spectatus" identifier="TST-GENERATED-TEST">
    <qti-outcome-declaration base-type="float" cardinality="single" identifier="SCORE">
        <qti-default-value>
            <qti-value>0.0</qti-value>
        </qti-default-value>
    </qti-outcome-declaration>
    <qti-test-part submission-mode="simultaneous" navigation-mode="nonlinear" identifier="TP">
        <qti-assessment-section title="Section 1" visible="true" identifier="S1">
            ${items
              .map(item => {
                const relativePath = item.href.replace(foldername + '/', '').replace(foldername, '');
                return `<qti-assessment-item-ref href="${relativePath}" identifier="${item.identifier}"/>`;
              })
              .join('\n')}
        </qti-assessment-section>
    </qti-test-part>
    <qti-outcome-processing>
        <qti-set-outcome-value identifier="SCORE">
            <qti-sum>
                <qti-test-variables base-type="float" variable-identifier="SCORE"/>
            </qti-sum>
        </qti-set-outcome-value>
    </qti-outcome-processing>
</qti-assessment-test>`;
  const formattedXML = xmlFormat(xmlString, {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  });
  return formattedXML;
};

const getDependencies = ($: cheerio.CheerioAPI) => {
  const identifiers = [];

  // Get qti-assessment-item identifiers
  $('qti-assessment-item-ref').each((i, elem) => {
    const identifier = $(elem).attr('identifier');
    if (identifier) {
      identifiers.push(identifier);
    }
  });

  qtiReferenceAttributes.forEach(selector => {
    $(`[${selector}]`).each((i, elem) => {
      if (elem.type !== 'tag' || elem.name !== 'qti-assessment-item-ref') {
        const attr = $(elem).attr(selector);
        if (attr) {
          const filename = attr.split('/').pop();
          const identifier = `RES-${filename.replace(/\./g, '_')}`;
          identifiers.push(identifier);
        }
      }
    });
  });

  return identifiers;
};
