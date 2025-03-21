import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import xmlFormat from 'xml-formatter';
import { Element } from 'domhandler';

export const qtiReferenceAttributes = [
  'src',
  'href',
  'data',
  'primary-path',
  'fallback-path',
  'template-location',
  'value',
  'backgroundimg',
  'background-img',
  'file',
  'templateSrc',
  'template-src',
  'templateurl',
  'template-url',
  'sound',
  'video',
  'image'
];

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const removeItemsFromPackage = async (file: any, startIndex: number, endIndex: number) => {
  const zip = await JSZip.loadAsync(file);
  const newZip = new JSZip();

  // Track which assessment items to remove
  const itemsToRemove: string[] = [];
  const itemIdentifiersToRemove: string[] = [];
  let testFilePath: string | null = null;
  let manifestFilePath: string | null = null;

  // Step 1: Identify the assessment test file and which items to remove
  for (const relativePath of Object.keys(zip.files)) {
    if (zip.files[relativePath].dir) continue;

    const zipEntry = zip.files[relativePath];
    const fileType = relativePath.split('.').pop()?.toLowerCase();

    if (fileType === 'xml') {
      const content = await zipEntry.async('string');

      // Check if this is a manifest file
      if (content.includes('<manifest') || content.includes('<imsmanifest')) {
        manifestFilePath = relativePath;
        continue;
      }

      const contentText = cleanXMLString(content);
      const formattedXML = xmlFormat(contentText, {
        indentation: '  ',
        collapseContent: true,
        lineSeparator: '\n'
      });

      try {
        const $ = cheerio.load(formattedXML, { xmlMode: true, xml: true });

        // Check if this is an assessment test
        if ($(`qti-assessment-test`).length > 0 || $(`assessmentTest`).length > 0) {
          testFilePath = relativePath;

          // Get all assessment item refs
          const itemRefs = $('qti-assessment-item-ref, assessmentItemRef');
          const allItems: { index: number; href: string; identifier: string }[] = [];

          itemRefs.each((index, element) => {
            const href = $(element).attr('href');
            const identifier = $(element).attr('identifier');
            if (href) {
              allItems.push({ index, href, identifier: identifier || '' });
            }
          });

          // Determine which items to remove based on indices
          for (let i = 0; i < allItems.length; i++) {
            if (i < startIndex || i > endIndex) {
              const itemPath = allItems[i].href;
              // Get just the filename without path
              const itemFileName = itemPath.split('/').pop();
              if (itemFileName) {
                itemsToRemove.push(itemFileName);
                if (allItems[i].identifier) {
                  itemIdentifiersToRemove.push(allItems[i].identifier);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error processing XML file ${relativePath}:`, e);
      }
    }
  }

  if (!manifestFilePath) {
    console.error('No manifest file found in the package');
    return {
      package: await zip.generateAsync({ type: 'blob' }),
      removedItems: [],
      removedFiles: 0,
      removedResources: 0,
      totalRemoved: 0
    };
  }

  // Step 2: Process the manifest to identify dependencies
  const manifestContent = await zip.files[manifestFilePath].async('string');
  const resourceMap = new Map<
    string,
    {
      href: string;
      type: string;
      files: string[];
      dependencies: string[];
      isItem: boolean;
      isTest: boolean;
      toKeep: boolean;
    }
  >();

  try {
    const $ = cheerio.load(manifestContent, { xmlMode: true, xml: true });

    // First pass: collect all resources
    $('resource').each((_, element) => {
      const identifier = $(element).attr('identifier') || '';
      const href = $(element).attr('href') || '';
      const type = $(element).attr('type') || '';
      const files: string[] = [];
      const dependencies: string[] = [];

      // Get the main file
      if (href) {
        files.push(href);
      }

      // Get all additional files
      $(element)
        .find('file')
        .each((_, fileEl) => {
          const fileHref = $(fileEl).attr('href');
          if (fileHref) {
            files.push(fileHref);
          }
        });

      // Get dependencies
      $(element)
        .find('dependency')
        .each((_, dep) => {
          const identifierref = $(dep).attr('identifierref');
          if (identifierref) {
            dependencies.push(identifierref);
          }
        });

      // Determine if it's an item or test
      const isTest = type.includes('test');
      const isItem = type.includes('item');

      // Initially mark as not to keep
      resourceMap.set(identifier, {
        href,
        type,
        files,
        dependencies,
        isItem,
        isTest,
        toKeep: false
      });
    });

    // Second pass: mark resources to keep
    // Start by marking the test resource
    const testResource = Array.from(resourceMap.values()).find(r => r.isTest);
    if (testResource) {
      markResourceToKeep(
        resourceMap,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        Array.from(resourceMap.entries()).find(([_, res]) => res.isTest)?.[0] || '',
        false
      );
    }

    // Mark items we want to keep
    resourceMap.forEach((resource, identifier) => {
      if (resource.isItem) {
        const fileName = resource.href.split('/').pop() || '';
        // If it's not in the removal list, mark it to keep
        if (!itemsToRemove.includes(fileName) && !itemIdentifiersToRemove.includes(identifier)) {
          markResourceToKeep(resourceMap, identifier);
        }
      }
    });
  } catch (e) {
    console.error(`Error processing manifest file:`, e);
  }

  // Collect files to keep and remove
  const filesToKeep = new Set<string>();
  const resourcesToRemove: string[] = [];

  resourceMap.forEach((resource, identifier) => {
    if (resource.toKeep) {
      // Add all files from this resource to the keep list
      resource.files.forEach(file => filesToKeep.add(file));
    } else {
      resourcesToRemove.push(identifier);
    }
  });

  // Step 3: Process all files, keeping only what's needed
  for (const relativePath of Object.keys(zip.files)) {
    const zipEntry = zip.files[relativePath];

    // Always keep directories
    if (zipEntry.dir) {
      newZip.folder(relativePath);
      continue;
    }

    const fileName = relativePath.split('/').pop() || '';

    if (relativePath === testFilePath) {
      // Handle the test file - remove references to items being removed
      const content = await zipEntry.async('string');
      const contentText = cleanXMLString(content);
      const formattedXML = xmlFormat(contentText, {
        indentation: '  ',
        collapseContent: true,
        lineSeparator: '\n'
      });

      try {
        const $ = cheerio.load(formattedXML, { xmlMode: true, xml: true });
        const itemRefs = $('qti-assessment-item-ref, assessmentItemRef');

        itemRefs.each((index, element) => {
          const href = $(element).attr('href');
          const identifier = $(element).attr('identifier');

          if (href) {
            const itemFileName = href.split('/').pop();
            if (
              (itemFileName && itemsToRemove.includes(itemFileName)) ||
              (identifier && itemIdentifiersToRemove.includes(identifier))
            ) {
              $(element).remove();
            }
          }
        });

        // Save the modified test XML
        newZip.file(relativePath, $.xml());
      } catch (e) {
        console.error(`Error processing test file:`, e);
        // If there's an error, still include the original file
        newZip.file(relativePath, content);
      }
    } else if (relativePath === manifestFilePath) {
      // Handle the manifest file - remove resources for items being removed
      const content = await zipEntry.async('string');

      try {
        const $ = cheerio.load(content, { xmlMode: true, xml: true });

        // Remove resources that are marked for removal
        $('resource').each((_, element) => {
          const identifier = $(element).attr('identifier') || '';
          if (resourcesToRemove.includes(identifier)) {
            $(element).remove();
          }
        });

        // Save the modified manifest
        newZip.file(relativePath, $.xml());
      } catch (e) {
        console.error(`Error processing manifest file:`, e);
        // If there's an error, still include the original file
        newZip.file(relativePath, content);
      }
    } else {
      // Handle regular files - only include if they're in the "to keep" list
      // or if they're XML files (for safety)
      const fileExt = fileName.split('.').pop()?.toLowerCase();

      if (fileExt === 'xml' || filesToKeep.has(relativePath)) {
        // Copy the file
        try {
          const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

          if (isNode && zipEntry?.nodeStream) {
            // Node.js environment
            newZip.file(relativePath, zipEntry.nodeStream());
          } else {
            // Browser environment
            const content = await zipEntry.async('blob');
            newZip.file(relativePath, content);
          }
        } catch (error) {
          console.error(`Error processing zip entry ${relativePath}:`, error);
        }
      }
    }
  }

  const outputBlob = await newZip.generateAsync({ type: 'blob' });

  // Count how many files were removed
  const originalFileCount = Object.keys(zip.files).filter(path => !zip.files[path].dir).length;
  const newFileCount = Object.keys(newZip.files).filter(path => !newZip.files[path].dir).length;
  const removedFilesCount = originalFileCount - newFileCount;

  return {
    package: outputBlob,
    removedItems: itemsToRemove,
    removedFiles: removedFilesCount,
    removedResources: resourcesToRemove.length,
    totalRemoved: removedFilesCount
  };
};

// Helper function to mark a resource and all its dependencies to keep
function markResourceToKeep(
  resourceMap: Map<
    string,
    {
      href: string;
      type: string;
      files: string[];
      dependencies: string[];
      isItem: boolean;
      isTest: boolean;
      toKeep: boolean;
    }
  >,
  resourceId: string,
  keepXml = true
) {
  const resource = resourceMap.get(resourceId);
  if (!resource || resource.toKeep) return;
  if (resource.href.endsWith('.xml') && !keepXml) return;
  // Mark this resource to keep
  resource.toKeep = true;

  // Recursively mark all dependencies
  resource.dependencies.forEach(depId => {
    markResourceToKeep(resourceMap, depId);
  });
}

const getMediaTypeByExtension = (extension: string) => {
  switch (extension.replace('.', '').toLowerCase()) {
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
    const fileType = relativePath.split('.').pop().toLocaleLowerCase();
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
  element: cheerio.Cheerio<Element>,
  tagNames: string[]
): cheerio.Cheerio<Element> | null {
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
  filters = ['audio', 'video'],
  onResourceRemoved?: (name: string, fileContent: Blob | NodeJS.ReadableStream) => void
) => {
  const zip = await JSZip.loadAsync(file);
  const allMediaFiles = await listAllContent(zip);
  const allFilesToRemove: string[] = [];
  filters.forEach(filter => {
    filter = filter.trim().toLowerCase();
    if (filter.toLocaleLowerCase().endsWith('kb') || filter.toLocaleLowerCase().endsWith('mb')) {
      const sizeInKb = filter.toLocaleLowerCase().endsWith('mb') ? +filter.slice(0, -2) * 1024 : +filter.slice(0, -2);
      allFilesToRemove.push(...allMediaFiles.filter(file => file.sizeKb > sizeInKb).map(file => file.name));
    } else if (filter === 'audio' || filter === 'video' || filter === 'image') {
      // Add debug logging to see what's being filtered
      const matchingFiles = allMediaFiles.filter(file => file.type.trim().toLowerCase() === filter);
      allFilesToRemove.push(...matchingFiles.map(file => file.name));
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
      try {
        // Check if we're in Node.js (where process.versions exists) AND nodeStream is available
        // Using optional chaining (?.) to avoid the "not supported" error
        const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

        if (isNode && zipEntry?.nodeStream) {
          // Node.js environment
          newZip.file(relativePath, zipEntry.nodeStream());
        } else {
          // Browser environment or Node.js without nodeStream
          const content = await zipEntry.async('blob');
          newZip.file(relativePath, content);
        }
      } catch (error) {
        console.error(`Error processing zip entry ${relativePath}:`, error);
        // Handle the error or skip this file
      }
    } else if (onResourceRemoved && filesToRemove.includes(basename)) {
      try {
        // Same environment check for the resource removal branch
        const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

        if (isNode && zipEntry?.nodeStream) {
          // Node.js environment
          onResourceRemoved(relativePath, zipEntry.nodeStream());
        } else {
          // Browser environment or Node.js without nodeStream
          const content = await zipEntry.async('blob');
          onResourceRemoved(relativePath, content);
        }
      } catch (error) {
        console.error(`Error handling removed resource ${relativePath}:`, error);
        // Handle the error or skip this file
      }
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
  handleFoundNode: (node: cheerio.Cheerio<Element>, removedFile: string) => void
) {
  // Load the XML content
  const $ = cheerio.load(xmlContent, { xmlMode: true });

  // Iterate through each node
  $('*').each(function (i, node) {
    const element = $(node);
    const attributes = (node as Element)?.attribs || [];
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
          handleFoundNode(element as cheerio.Cheerio<Element>, removedFile);
        }

        break; // No need to check other attributes of this node
      }
    }
  });
  // Return the modified XML content
  return $.xml();
}

/**
 * Creates a Base64-encoded SVG placeholder that works in both Node.js and browser environments
 * @param fileName The name of the file to display in the placeholder
 * @returns A data URL containing the base64-encoded SVG
 */
function createBase64SVGPlaceholder(fileName: string): string {
  const svgPlaceholder = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="75">
      <rect width="300" height="75" style="fill:lightgray;stroke-width:1;stroke:gray" />
      <text x="10" y="25" fill="red" textLength="280">File: ${fileName} removed</text>
    </svg>
  `;

  // Check if running in Node.js environment
  if (typeof Buffer !== 'undefined') {
    // Node.js environment - use Buffer
    return `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`;
  } else {
    // Browser environment - use TextEncoder and btoa
    try {
      // Modern browsers with TextEncoder support for handling Unicode
      const utf8Encoder = new TextEncoder();
      const utf8Bytes = utf8Encoder.encode(svgPlaceholder);

      const base64 = btoa(
        Array.from(utf8Bytes)
          .map(byte => String.fromCharCode(byte))
          .join('')
      );

      return `data:image/svg+xml;base64,${base64}`;
    } catch (error) {
      // Fallback for older browsers without TextEncoder
      // Note: This will fail with non-ASCII characters
      try {
        return `data:image/svg+xml;base64,${btoa(svgPlaceholder)}`;
      } catch (e) {
        console.error('Error encoding SVG:', e);
        return ''; // Return empty string or some default on error
      }
    }
  }
}
