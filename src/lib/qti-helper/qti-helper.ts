import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import xmlFormat from 'xml-formatter';

const qtiReferenceAttributes = ['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location'];

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

const getMediaTypeByExtension = (extension: string) => {
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

async function listAllContent(zip: JSZip) {
  const nonXMLFiles: {
    type: 'audio' | 'video' | 'image' | 'unknown';
    extension: string;
    name: string;
    sizeKb: number;
  }[] = [];

  await zip.forEach(async (relativePath, zipEntry) => {
    const fileType = relativePath.split('.').pop();
    if (fileType !== 'xml') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileSizeKb = (zipEntry as any)._data.uncompressedSize / 1024;
      nonXMLFiles.push({
        type: getMediaTypeByExtension(fileType || '') || 'unknown',
        name: relativePath,
        extension: fileType || '',
        sizeKb: +fileSizeKb.toFixed(2)
      });
    } else {
      try {
        const content = await zipEntry.async('string');
        const $ = cheerio.load(cleanXMLString(content), {
          xmlMode: true,
          xml: true
        });
        if (
          $('qti-assessment-item').length > 0 ||
          $('assessmentItem').length > 0 ||
          $('qti-assessment-test').length > 0 ||
          $('assessmentTest').length > 0
        ) {
          const attributes = qtiReferenceAttributes;
          for (const attribute of attributes) {
            for (const node of $(`[${attribute}]`)) {
              const srcValue = $(node).attr(attribute);
              if (srcValue) {
                const filename = srcValue.split('/').pop() || '';
                const extension = srcValue.split('.').pop() || '';
                nonXMLFiles.push({
                  type: getMediaTypeByExtension(extension),
                  name: filename,
                  extension,
                  sizeKb: 0
                });
              }
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  });

  return nonXMLFiles;
}

function getAncestorWithTagName(
  element: cheerio.Cheerio<cheerio.AnyNode>,
  tagNames: string[]
): cheerio.Cheerio<cheerio.Element> | null {
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

export const removeMediaFromPackage = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  file: any,
  filters = ['audio', 'video']
) => {
  const zip = await JSZip.loadAsync(file);
  const allMediaFiles = await listAllContent(zip);

  const allFilesToRemove: string[] = [];
  filters.forEach(filter => {
    if (filter.toLocaleLowerCase().endsWith('kb') || filter.toLocaleLowerCase().endsWith('mb')) {
      const sizeInKb = filter.toLocaleLowerCase().endsWith('mb') ? +filter.slice(0, -2) * 1024 : +filter.slice(0, -2);
      allFilesToRemove.push(...allMediaFiles.filter(file => file.sizeKb > sizeInKb).map(file => file.name));
    } else if (filter === 'audio' || filter === 'video' || filter === 'image') {
      allFilesToRemove.push(...allMediaFiles.filter(file => file.type === filter).map(file => file.name));
    } else if (filter.startsWith('.')) {
      allFilesToRemove.push(
        ...allMediaFiles.filter(file => file.name.toLowerCase().endsWith(filter)).map(file => file.name)
      );
    }
  });

  const filesToRemove = [...new Set(allFilesToRemove)].map(f => f.split('/').pop() || '');

  const newZip = new JSZip();
  for (const relativePath of Object.keys(zip.files)) {
    const zipEntry = zip.files[relativePath];
    const fileType = relativePath.split('.').pop();
    const basename = relativePath.split('/').pop() || '';
    if (fileType === 'xml') {
      const content = await zipEntry.async('string');
      const contentText = cleanXMLString(content);
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
          const fileTypesThatCannotBeReplaced = ['css', 'xsd'];
          let contentText = formattedXML;
          const filesToBeReplaced: string[] = filesToRemove.filter(
            file => !fileTypesThatCannotBeReplaced.includes(file?.split('.').pop() || '')
          );
          const filesToBeRemoved = filesToRemove.filter(file =>
            fileTypesThatCannotBeReplaced.includes(file?.split('.').pop() || '')
          );
          if (filesToBeReplaced.length > 0) {
            contentText = replaceReferencedTags(formattedXML, filesToBeReplaced);
          }
          if (filesToBeRemoved.length > 0) {
            contentText = removeReferencedTags(formattedXML, filesToBeRemoved);
          }

          newZip.file(relativePath, contentText);
        } else if ($(`manifest`).length > 0) {
          const contentText = removeReferencedTags($.xml(), filesToRemove);
          newZip.file(relativePath, contentText);
        } else {
          newZip.file(relativePath, formattedXML);
        }
      } catch (e) {
        console.error(e);
      }
    } else if (!filesToRemove.includes(basename)) {
      newZip.file(relativePath, zipEntry.nodeStream());
      // const content = await zipEntry.async('blob');
      // newZip.file(relativePath, content);
    }
  }

  const outputBlob = await newZip.generateAsync({ type: 'blob' });
  return outputBlob;
};

function removeReferencedTags(xmlContent: string, removedFiles: string[]) {
  return findReferencedTags(xmlContent, removedFiles, node => {
    node.remove();
  });
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
        if (removedFile) {
          if (node.type === 'tag' && node.name === 'resource') {
            const identfier = $(node).attr('identifier');
            const dependencies = $(`dependency[identifierref="${identfier}"]`);
            if (dependencies.length > 0) {
              for (const dependency of dependencies) {
                handleFoundNode($(dependency), removedFile);
              }
            }
          }
          handleFoundNode($(node), removedFile);
        }

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
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="75">
      <rect width="300" height="75" style="fill:lightgray;stroke-width:1;stroke:gray" />
      <text x="10" y="25" fill="red"  textLength="280">File: ${fileName} removed</text>
    </svg>
  `;
  return `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`;
}
