import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import xmlFormat from 'xml-formatter';
import { Element } from 'domhandler';
import { convertQti2toQti3 } from '../qti-converter';
import { qtiTransform } from '../qti-transformer';
import { ciBootstrap, registerCES } from './ci-bootstap';

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
  const zipFileToProcess = Object.keys(zip.files).filter(
    path => !zip.files[path].dir && !path.includes('__MACOSX') && !path.includes('.DS_Store')
  );
  // Step 1: Identify the assessment test file and which items to remove
  for (const relativePath of Object.keys(zipFileToProcess)) {
    if (zipFileToProcess[relativePath].dir) continue;

    const zipEntry = zipFileToProcess[relativePath];
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
  const manifestContent = await zipFileToProcess[manifestFilePath].async('string');
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
  for (const relativePath of Object.keys(zipFileToProcess)) {
    if (relativePath.includes('__MACOSX') || relativePath.includes('.DS_Store')) {
      continue;
    }
    const zipEntry = zipFileToProcess[relativePath];

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
  const originalFileCount = Object.keys(zip.files).filter(
    path => !zip.files[path].dir && !path.includes('__MACOSX') && !path.includes('.DS_Store')
  ).length;
  const newFileCount = Object.keys(newZip.files).filter(
    path => !newZip.files[path].dir && !path.includes('__MACOSX') && !path.includes('.DS_Store')
  ).length;
  const removedFilesCount = originalFileCount - newFileCount;

  return {
    package: outputBlob,
    removedItems: itemsToRemove,
    removedFiles: removedFilesCount,
    removedResources: resourcesToRemove.length,
    totalRemoved: removedFilesCount
  };
};

/**
 * Processes a package file, extracting and converting assessment items and tests
 * @param file - The package file (zip) to process
 * @param xsltJson - The XSLT transformation in JSON format
 * @param localMedia - Whether to process media files locally
 * @param options - Additional processing options
 * @param processItemCallback - Callback function that handles each processed assessment item
 * @param processTestCallback - Callback function that handles the processed assessment test
 * @returns Promise with processing results
 */
export const processPackage = async (
  file: Blob,
  xsltJson: string,
  localMedia: boolean,
  options: {
    removeStylesheets?: boolean;
    skipValidation?: boolean;
  } = {},
  processItemCallback?:
    | ((itemData: { identifier: string; content: string; originalContent: string; relativePath: string }) => void)
    | null,
  processTestCallback?:
    | ((testData: {
        identifier: string;
        content: string;
        originalContent: string;
        relativePath: string;
        itemRefs: { itemRefIdentifier: string; identifier: string }[];
      }) => void)
    | null
) => {
  const JSZip = await import('jszip');
  const zip = await JSZip.default.loadAsync(file);

  // Results tracking
  const results = {
    itemsProcessed: 0,
    testsProcessed: 0,
    totalFilesProcessed: 0,
    errors: [] as string[],
    processedItems: [] as {
      identifier: string;
      content: string;
      originalContent: string;
      relativePath: string;
    }[],
    processedTests: [] as {
      identifier: string;
      content: string;
      originalContent: string;
      relativePath: string;
      itemRefs: { itemRefIdentifier: string; identifier: string }[];
    }[]
  };

  // Utility to clean and format XML
  const cleanXMLString = (xml: string) => {
    return xml
      .replace(/>\s+</g, '><')
      .replace(/\r?\n|\r/g, '')
      .trim();
  };
  // Utility to validate XML structure (basic validation, no XSD)
  const validateXML = async (xml: string, filename: string): Promise<{ isValid: boolean; errors: string[] }> => {
    try {
      const cheerio = await import('cheerio');
      const $ = cheerio.load(xml, { xmlMode: true, xml: true });

      // Basic XML parsing validation (will throw if XML is malformed)

      // Check for common QTI structure issues
      const errors: string[] = [];
      // Check for proper XML declaration
      if (!xml.trim().startsWith('<?xml')) {
        errors.push('Missing XML declaration. XML should start with <?xml version="1.0"?>');
      } else {
        // Check if declaration is properly closed with ?>
        const firstLine = xml.trim().split('\n')[0];
        if (!firstLine.includes('?>')) {
          errors.push('XML declaration is not properly closed with ?>');
        } else {
          const declarationMatch = xml.match(/^<\?xml\s+([^?]+)\?>/);
          if (declarationMatch) {
            if (!declarationMatch[1].includes('version=')) {
              errors.push('XML declaration missing required version attribute');
            }
            // if (!declarationMatch[1].includes('encoding=')) {
            //   errors.push('XML declaration missing encoding attribute (recommended: UTF-8)');
            // }
          }
        }
      }

      // Check for duplicate identifiers within the document
      const identifiers = new Set<string>();
      $('qti-outcome-declaration[identifier], qti-response-declaration[identifier]').each((_, el) => {
        const id = $(el).attr('identifier');
        if (id && identifiers.has(id)) {
          errors.push(`Duplicate identifier found: "${id}"`);
        }
        if (id) identifiers.add(id);
      });

      // Check for required elements in QTI items
      if ($('qti-assessment-item').length > 0) {
        if ($('qti-assessment-item').attr('identifier') === undefined) {
          errors.push('Missing required "identifier" attribute on assessment item');
        }

        // Check for response declarations in interactive items
        const interactions = [];
        $('*').each((_, el) => {
          const tagName = $(el).prop('tagName');
          if (tagName && tagName.toLowerCase().endsWith('-interaction')) {
            interactions.push(tagName);
          }
        });

        if (interactions.length > 0 && $('qti-response-declaration').length === 0) {
          errors.push(`Interactive item with ${interactions.join(', ')} missing response declaration`);
        }
      }

      // Check for QTI test structure
      if ($('qti-assessment-test').length > 0) {
        if ($('qti-assessment-test').attr('identifier') === undefined) {
          errors.push('Missing required "identifier" attribute on assessment test');
        }

        if ($('qti-test-part').length === 0) {
          errors.push('Assessment test missing required test part');
        }

        if ($('qti-assessment-section').length === 0) {
          errors.push('Assessment test missing required assessment section');
        }
        // Check that qti-assessment-item-ref identifiers are unique
        const itemRefIdentifiers = new Set<string>();
        const duplicateItemRefIdentifiers = new Set<string>();

        $('qti-assessment-item-ref, assessmentItemRef').each((_, el) => {
          const id = $(el).attr('identifier');
          if (id) {
            if (itemRefIdentifiers.has(id)) {
              duplicateItemRefIdentifiers.add(id);
            } else {
              itemRefIdentifiers.add(id);
            }
          }
        });

        if (duplicateItemRefIdentifiers.size > 0) {
          errors.push(
            `Duplicate qti-assessment-item-ref identifiers found: ${Array.from(duplicateItemRefIdentifiers).join(', ')}`
          );
        }
      }
      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (e) {
      return {
        isValid: false,
        errors: [`Failed to parse XML: ${e instanceof Error ? e.message : String(e)}`]
      };
    }
  };

  // Track manifest and test file paths
  let manifestFilePath: string | null = null;
  let testFilePath: string | null = null;
  let testIdentifier: string | null = null;
  const itemPaths = new Map<string, string>(); // Maps identifiers to paths
  const zipFileToProcess = Object.keys(zip.files).filter(
    path => !path.includes('__MACOSX') && !path.includes('.DS_Store')
  );
  // Step 1: First pass - identify manifest and test files
  for (const relativePath of zipFileToProcess) {
    if (zip.files[relativePath].dir) continue;

    const zipEntry = zip.files[relativePath];
    const fileType = relativePath.split('.').pop()?.toLowerCase();

    if (fileType === 'xml') {
      try {
        const content = await zipEntry.async('string');

        // Basic XML structure validation if validation is not skipped
        if (!options.skipValidation) {
          const basicValidationResult = await validateXML(content, relativePath);
          if (!basicValidationResult.isValid) {
            results.errors.push(`Invalid XML structure in ${relativePath}: ${basicValidationResult.errors.join(', ')}`);
          }
        }

        // Check if this is a manifest file
        if (content.includes('<manifest') || content.includes('<imsmanifest')) {
          manifestFilePath = relativePath;
          continue;
        }

        const cleanedContent = cleanXMLString(content);

        // Use cheerio (or another XML parser) to analyze content
        const cheerio = await import('cheerio');
        const $ = cheerio.load(cleanedContent, { xmlMode: true, xml: true });

        // Check if this is an assessment test
        if ($('qti-assessment-test').length > 0 || $('assessmentTest').length > 0) {
          testFilePath = relativePath;
          testIdentifier =
            $('qti-assessment-test').attr('identifier') || $('assessmentTest').attr('identifier') || null;
        }

        // Check if this is an assessment item
        if ($('qti-assessment-item').length > 0 || $('assessmentItem').length > 0) {
          const identifier =
            $('qti-assessment-item').attr('identifier') || $('assessmentItem').attr('identifier') || '';
          if (identifier) {
            itemPaths.set(identifier, relativePath);
          }
        }
      } catch (e) {
        results.errors.push(`Error analyzing ${relativePath}: ${e}`);
      }
    }
  }

  // Step 2: Process manifest to build dependencies map
  const resourceMap = new Map<
    string,
    {
      href: string;
      type: string;
      files: string[];
      dependencies: string[];
      isItem: boolean;
      isTest: boolean;
    }
  >();

  if (manifestFilePath) {
    try {
      const manifestContent = await zip.files[manifestFilePath].async('string');
      const cheerio = await import('cheerio');
      const $ = cheerio.load(manifestContent, { xmlMode: true, xml: true });

      // Build resource map
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

        resourceMap.set(identifier, {
          href,
          type,
          files,
          dependencies,
          isItem,
          isTest
        });
      });
    } catch (e) {
      results.errors.push(`Error processing manifest: ${e}`);
    }
  }

  // Step 3: Process items and test
  // First, process assessment items
  for (const [identifier, relativePath] of itemPaths.entries()) {
    try {
      const zipEntry = zip.files[relativePath];
      if (!zipEntry) continue;

      const originalContent = await zipEntry.async('string');

      // Convert QTI 2.x to QTI 3 or perform other processing
      const convertedContent = await convertAndTransform(originalContent, relativePath);

      const itemData = {
        identifier,
        content: convertedContent.xml(),
        originalContent,
        relativePath
      };

      // Use callback if provided, otherwise store in results
      if (typeof processItemCallback === 'function') {
        processItemCallback(itemData);
      }
      results.processedItems.push(itemData);

      results.itemsProcessed++;
    } catch (e) {
      results.errors.push(`Error processing item ${identifier}: ${e}`);
    }
  }

  // Then, process assessment test
  let hasProcessedTest = false;
  if (testFilePath && testIdentifier) {
    try {
      const zipEntry = zip.files[testFilePath];
      if (zipEntry) {
        const originalContent = await zipEntry.async('string');

        // Get item references from test
        const cheerio = await import('cheerio');
        const $ = cheerio.load(originalContent, { xmlMode: true, xml: true });

        const itemRefs: { itemRefIdentifier: string; identifier: string }[] = [];
        $('qti-assessment-item-ref, assessmentItemRef').each((_, element) => {
          const identifier = $(element).attr('identifier');
          const href = $(element).attr('href');
          // Resolve the href relative to the test file path
          const resolvedHref = new URL(href, `https://example.com/${testFilePath}`).pathname.replace(/^\/+/, '');
          itemPaths.forEach((itemPath, itemIdentifier) => {
            if (itemPath === resolvedHref) {
              itemRefs.push({ itemRefIdentifier: identifier, identifier: itemIdentifier });
            }
          });
        });

        // Convert test format
        const transformResult = await convertAndTransform(originalContent);

        const testData = {
          identifier: testIdentifier,
          content: transformResult.xml(),
          originalContent,
          relativePath: testFilePath,
          itemRefs
        };

        // Use callback if provided, otherwise store in results
        if (typeof processTestCallback === 'function') {
          processTestCallback(testData);
        }
        results.processedTests.push(testData);
        hasProcessedTest = true;
        results.testsProcessed++;
      }
    } catch (e) {
      results.errors.push(`Error processing test ${testIdentifier}: ${e}`);
    }
  }

  // Create a fake assessment if no assessments were found but items exist
  if (!hasProcessedTest && results.processedItems.length > 0) {
    try {
      // Create a synthetic test XML that includes all items
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <qti-assessment-test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
            identifier="All" title="ALL items"
            tool-name="CitoLab" tool-version="3.10"
            xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
            <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
                <qti-default-value>
                    <qti-value>0</qti-value>
                </qti-default-value>
            </qti-outcome-declaration>
            <qti-test-part identifier="RES-b901b8e7-b516-47cc-8adc-165d065f13c7" title="Tespart-1"
                navigation-mode="nonlinear" submission-mode="simultaneous">
                <qti-assessment-section identifier="section_1" title="section 1"
                    visible="true" keep-together="false">
                    ${results.processedItems
                      .map(item => {
                        return `<qti-assessment-item-ref identifier="${item.identifier}" href="${item.relativePath}">
                          <qti-weight identifier="WEIGHT" value="1" />
                        </qti-assessment-item-ref>`;
                      })
                      .join('')}
                </qti-assessment-section>
            </qti-test-part>
            <qti-outcome-processing>
                <qti-set-outcome-value identifier="SCORE">
                    <qti-sum>
                        <qti-test-variables variable-identifier="SCORE"
                            weight-identifier="WEIGHT" />
                    </qti-sum>
                </qti-set-outcome-value>
            </qti-outcome-processing>
        </qti-assessment-test>`;

      // Generate item references for the synthetic test
      const itemRefs = results.processedItems.map(item => {
        return {
          itemRefIdentifier: item.identifier,
          identifier: item.identifier
        };
      });

      const testData = {
        identifier: 'All',
        content: xml,
        originalContent: xml, // Original and transformed are the same since we created it in QTI 3 format
        relativePath: 'all-items.xml', // Virtual path
        itemRefs
      };

      // Use callback if provided, otherwise store in results
      if (typeof processTestCallback === 'function') {
        processTestCallback(testData);
      }
      results.processedTests.push(testData);

      results.testsProcessed++;
    } catch (e) {
      results.errors.push(`Error creating synthetic assessment: ${e}`);
    }
  }

  results.totalFilesProcessed = results.itemsProcessed + results.testsProcessed;

  return results;

  async function convertAndTransform(originalContent: string, relativePath?: string) {
    const convertedContent = await convertQti2toQti3(originalContent, xsltJson);
    const transform = qtiTransform(convertedContent);
    const folderPath = relativePath?.substring(0, relativePath.lastIndexOf('/') + 1) || '';
    let transformResult = await transform
      .objectToImg()
      .objectToVideo()
      .objectToAudio()
      .ssmlSubToSpan()
      .stripMaterialInfo()
      .minChoicesToOne()
      .externalScored()
      .customInteraction('/', folderPath)
      .qbCleanup()
      .depConvert()
      .upgradePci();

    if (options.removeStylesheets) {
      transformResult = transformResult.stripStylesheets();
    }
    if (localMedia) {
      // Check if file API is supported
      const supportFileApi = 'File' in window && 'URL' in window && 'createObjectURL' in URL;
      if (supportFileApi) {
        // File API is available, we'll use it to handle the files
        transformResult = await transformResult.changeAssetLocationAsync(async srcValue => {
          const normalizedPath = srcValue.startsWith('./') ? srcValue.substring(2) : srcValue;
          let filePath = normalizedPath;
          if (!normalizedPath.startsWith('/')) {
            const itemDir = relativePath?.substring(0, relativePath.lastIndexOf('/') + 1) || '';
            filePath = simplifyPath(itemDir + normalizedPath);
          }

          // Remove any leading slash
          filePath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

          // Check for special files that need custom handling
          const lowerFilePath = filePath.toLowerCase();

          // Special handling for manifest.json
          if (lowerFilePath.endsWith('manifest.json')) {
            return await processManifestJson(filePath, zip, relativePath);
          }
          // Special handling for bootstrap.js
          else if (lowerFilePath.endsWith('bootstrap.js')) {
            return await processBootstrapJs(filePath, zip, srcValue);
          }
          // Special handling for index.html
          else if (lowerFilePath.endsWith('index.html')) {
            return await processIndexHtml(filePath, zip, srcValue);
          }

          return await createBlobUrl(filePath, zip, srcValue);
        });

        // Function to create blob URL for a file
        async function createBlobUrl(filePath, zip, originalSrcValue) {
          const mediaFile = zip.files[filePath];

          if (mediaFile) {
            try {
              // Get file as array buffer
              let blob = await mediaFile.async('blob');
              blob = new Blob([blob], {
                type: getMimeTypeFromFileName(filePath)
              });
              const objectUrl = URL.createObjectURL(blob);
              return objectUrl;
            } catch (e) {
              console.error(`Error processing media file ${filePath}:`, e);
              return originalSrcValue; // Return original source if there's an error
            }
          }

          return originalSrcValue; // Return original source if file not found in zip
        }

        // Function to process bootstrap.js file
        async function processBootstrapJs(filePath, zip, originalSrcValue) {
          const bootstrapFile = zip.files[filePath];

          if (!bootstrapFile) {
            console.error(`Bootstrap file not found: ${filePath}`);
            return originalSrcValue;
          }

          try {
            // Read the content of the bootstrap.js file
            const contentBuffer = await bootstrapFile.async('uint8array');
            const contentString = new TextDecoder().decode(contentBuffer);

            // Check if it contains 'CES'
            if (contentString.indexOf('CES') < 0) {
              // If it doesn't contain 'CES', just return the normal blob URL
              return await createBlobUrl(filePath, zip, originalSrcValue);
            }

            // Create the .org file
            const orgFilePath = filePath.replace('bootstrap.js', 'bootstrap.org.js');

            // Create a blob URL for the original content
            const orgBlob = new Blob([contentBuffer], {
              type: 'application/javascript'
            });
            const orgBlobUrl = URL.createObjectURL(orgBlob);

            // Store the original URL in the zip object for future reference
            zip.orgBootstrapUrl = orgBlobUrl;

            // Create a blob with the new content
            const newBlob = new Blob([ciBootstrap], {
              type: 'application/javascript'
            });

            // Return the blob URL for the modified content
            return URL.createObjectURL(newBlob);
          } catch (e) {
            console.error(`Error processing bootstrap.js ${filePath}:`, e);
            return await createBlobUrl(filePath, zip, originalSrcValue);
          }
        }

        // Function to process index.html file
        async function processIndexHtml(filePath, zip, originalSrcValue) {
          const indexFile = zip.files[filePath];

          if (!indexFile) {
            console.error(`Index file not found: ${filePath}`);
            return originalSrcValue;
          }

          try {
            // Read the content of the index.html file
            const contentBuffer = await indexFile.async('uint8array');
            const contentString = new TextDecoder().decode(contentBuffer);

            // Check for <head> tag and CES
            const headIndex = contentString.indexOf('<head>');
            if (headIndex < 0 || contentString.indexOf('CES') < 0) {
              // If it doesn't meet the criteria, just return the normal blob URL
              return await createBlobUrl(filePath, zip, originalSrcValue);
            }

            // Create the .org file
            const orgFilePath = filePath.replace('index.html', 'index.org.html');

            // Create a blob URL for the original content
            const orgBlob = new Blob([contentBuffer], {
              type: 'text/html'
            });
            const orgBlobUrl = URL.createObjectURL(orgBlob);

            // Store the original URL in the zip object for future reference
            zip.orgIndexUrl = orgBlobUrl;

            // Create the modified content with the registerCES script
            const scriptTag = `<script>${registerCES}</script>`;

            // Remove duplicate script tags if any
            const scriptTagRegex = new RegExp(
              `<script>${registerCES.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}</script>`,
              'g'
            );
            const matches = [...contentString.matchAll(scriptTagRegex)];
            let cleanedContent = contentString.replace(scriptTagRegex, '');

            // If the script tag was found at least once, keep one copy
            if (matches.length > 0) {
              cleanedContent = cleanedContent.replace('</head>', `${scriptTag}</head>`);
            } else {
              const headIndex = cleanedContent.indexOf('<head>');
              if (headIndex !== -1) {
                cleanedContent = cleanedContent
                  .slice(0, headIndex + 6)
                  .concat(scriptTag)
                  .concat(cleanedContent.slice(headIndex + 6));
              }
            }

            const newContent = cleanedContent;

            // Create a blob with the new content
            const newBlob = new Blob([newContent], {
              type: 'text/html'
            });

            // Return the blob URL for the modified content
            return URL.createObjectURL(newBlob);
          } catch (e) {
            console.error(`Error processing index.html ${filePath}:`, e);
            return await createBlobUrl(filePath, zip, originalSrcValue);
          }
        }

        // Function to process manifest.json
        async function processManifestJson(manifestPath, zip, relativePath) {
          const manifestFile = zip.files[manifestPath];

          if (!manifestFile) {
            console.error(`Manifest file not found: ${manifestPath}`);
            return manifestPath; // Return original path if file not found
          }

          try {
            // Read and parse the manifest
            const manifestContent = await manifestFile.async('text');
            const manifest = JSON.parse(manifestContent);

            // Process each type of reference in the manifest
            for (const type of ['script', 'style', 'media']) {
              if (Array.isArray(manifest[type])) {
                // Process each file reference
                for (let i = 0; i < manifest[type].length; i++) {
                  const refPath = manifest[type][i];

                  // Normalize and resolve the referenced file path
                  let resolvedPath = refPath;
                  resolvedPath = resolvedPath.startsWith('/') ? resolvedPath.substring(1) : resolvedPath;

                  const lowerPath = resolvedPath.toLowerCase();
                  let blobUrl;

                  // Handle special cases for bootstrap.js and index.html
                  if (lowerPath.endsWith('bootstrap.js')) {
                    blobUrl = await processBootstrapJs(resolvedPath, zip, refPath);

                    // Also add the original bootstrap.js URL if it exists
                    if (zip.orgBootstrapUrl && type === 'script') {
                      // Create a path for the .org file
                      const orgPath = refPath.replace('bootstrap.js', 'bootstrap.org.js');

                      // Only add if not already in the array
                      if (!manifest[type].includes(orgPath) && !manifest[type].includes(zip.orgBootstrapUrl)) {
                        manifest[type].push(zip.orgBootstrapUrl);
                      }
                    }
                  } else if (lowerPath.endsWith('index.html')) {
                    blobUrl = await processIndexHtml(resolvedPath, zip, refPath);

                    // Also add the original index.html URL if it exists
                    if (zip.orgIndexUrl && type === 'media') {
                      // Create a path for the .org file
                      const orgPath = refPath.replace('index.html', 'index.org.html');

                      // Only add if not already in the array
                      if (!manifest[type].includes(orgPath) && !manifest[type].includes(zip.orgIndexUrl)) {
                        manifest[type].push(zip.orgIndexUrl);
                      }
                    }
                  } else {
                    blobUrl = await createBlobUrl(resolvedPath, zip, refPath);
                  }

                  // Update the manifest with the blob URL
                  manifest[type][i] = blobUrl;
                }
              }
            }

            // Create a new blob for the modified manifest
            const modifiedManifestContent = JSON.stringify(manifest);
            const blob = new Blob([modifiedManifestContent], {
              type: 'application/json'
            });

            // Return the blob URL for the modified manifest
            return URL.createObjectURL(blob);
          } catch (e) {
            console.error(`Error processing manifest.json ${manifestPath}:`, e);
            return manifestPath; // Return original path if there's an error
          }
        }
      } else {
        // File API not supported, fallback to base64 encoding
        transformResult = await transformResult.changeAssetLocationAsync(async srcValue => {
          const normalizedPath = srcValue.startsWith('./') ? srcValue.substring(2) : srcValue;
          let filePath = normalizedPath;
          if (!normalizedPath.startsWith('/')) {
            const testDir = testFilePath?.substring(0, testFilePath.lastIndexOf('/') + 1) || '';
            filePath = simplifyPath(testDir + normalizedPath);
          }

          // Remove any leading slash
          filePath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
          const mediaFile = zip.files[filePath];

          if (mediaFile) {
            try {
              // Get file as array buffer
              const arrayBuffer = await mediaFile.async('arraybuffer');

              // Create base64 data
              const base64 = arrayBufferToBase64(arrayBuffer);
              const mimeType = getMimeTypeFromFileName(filePath);
              const dataUrl = `data:${mimeType};base64,${base64}`;

              return dataUrl;
            } catch (e) {
              console.error(`Error processing media file ${srcValue}:`, e);
              return srcValue;
            }
          }

          return srcValue;
        });
      }
    }
    return transformResult;
  }
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
    case 'opus':
    case 'm4a':
      return 'audio';
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
    case 'webm':
    case 'flv':
    case 'mpeg':
    case 'mpg':
    case 'wmv':
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

function simplifyPath(path: string): string {
  const parts = path.split('/');
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') {
      // Skip empty or current directory
      continue;
    } else if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop(); // Go up one directory
      } else {
        // If at root or already outside, keep the '..'
        stack.push('..');
      }
    } else {
      stack.push(part); // Add valid path part
    }
  }

  const simplified = stack.join('/');

  // Preserve leading './' if it was present
  if (path.startsWith('./')) {
    return './' + simplified;
  }

  // Or return just the simplified path
  return simplified;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;

  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return window.btoa(binary);
}

// Helper function to determine MIME type from filename
function getMimeTypeFromFileName(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    amr: 'audio/amr',
    wma: 'audio/x-ms-wma',
    '3gp': 'video/3gpp',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    flv: 'video/x-flv',
    '3gpp': 'video/3gpp',
    pdf: 'application/pdf',
    json: 'application/json',
    css: 'text/css',
    js: 'application/javascript'
    // Add more mime types as needed
  };

  return mimeTypes[extension] || 'application/octet-stream';
}

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
  const zipFileToProcess = Object.keys(zip.files).filter(
    path => !path.includes('__MACOSX') && !path.includes('.DS_Store')
  );
  for (const relativePath of zipFileToProcess) {
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

// This is a more aggressive approach to free memory
// Note: This doesn't specifically target only blobs, but helps with overall memory cleanup
export function forceMemoryCleanup() {
  // Step 1: Try to run garbage collection if in a debug environment
  if (window.gc) {
    try {
      window.gc();
      console.log('Manual garbage collection triggered');
    } catch (e) {
      console.log('Manual GC not available in this browser');
    }
  }

  // Step 2: Clear browser caches that might be holding references
  if (window.caches) {
    caches.keys().then(cacheNames => {
      cacheNames.forEach(cacheName => {
        if (cacheName.includes('blob')) {
          caches
            .delete(cacheName)
            .then(() => console.log(`Cache ${cacheName} deleted`))
            .catch(err => console.error(`Failed to delete cache ${cacheName}:`, err));
        }
      });
    });
  }

  // Step 3: Clear any session storage items that might reference blobs
  try {
    const blobKeys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key);
      if (value && (value.includes('blob:') || key.includes('blob'))) {
        blobKeys.push(key);
      }
    }

    blobKeys.forEach(key => {
      sessionStorage.removeItem(key);
      console.log(`Removed session storage item: ${key}`);
    });
  } catch (e) {
    console.error('Error clearing session storage:', e);
  }

  console.log('Memory cleanup operations completed');
}

/// Updated shared post-processing logic
export async function postProcessPackageFilesSyncAssessmentItemAndItemRefIds(
  processedFiles: Map<string, { content: string | Buffer; type: 'test' | 'item' | 'manifest' | 'other' }>
): Promise<Map<string, { content: string | Buffer; type: 'test' | 'item' | 'manifest' | 'other' }>> {
  const assessmentFiles = Array.from(processedFiles.entries())
    .filter(([_, file]) => file.type === 'test')
    .map(([path, file]) => ({ path, content: file.content as string, type: file.type }));

  if (assessmentFiles.length > 0) {
    const manifestEntry = processedFiles.get('imsmanifest.xml');
    if (manifestEntry && typeof manifestEntry.content === 'string') {
      let manifestUpdated = false;
      let updatedManifestContent = manifestEntry.content;

      for (const assessment of assessmentFiles) {
        const result = await processAssessmentReferences(assessment, updatedManifestContent, processedFiles);

        if (result.assessmentUpdated) {
          processedFiles.set(assessment.path, {
            content: result.updatedAssessmentContent,
            type: 'test'
          });
        }

        if (result.manifestUpdated) {
          updatedManifestContent = result.updatedManifestContent;
          manifestUpdated = true;
        }
      }

      // Update manifest if any changes were made
      if (manifestUpdated) {
        processedFiles.set('imsmanifest.xml', {
          content: updatedManifestContent,
          type: 'manifest'
        });
      }
    }
  }
  return processedFiles;
}

// Updated helper function for processing assessment references
async function processAssessmentReferences(
  assessment: { path: string; content: string; type: string },
  manifestContent: string,
  processedFiles: Map<string, { content: string | Buffer; type: string }>
): Promise<{
  assessmentUpdated: boolean;
  manifestUpdated: boolean;
  updatedAssessmentContent: string;
  updatedManifestContent: string;
}> {
  const $manifest = cheerio.load(manifestContent, { xmlMode: true, xml: true });
  const $assessment = cheerio.load(assessment.content, { xmlMode: true, xml: true });
  const assessmentRefs = $assessment('qti-assessment-item-ref');
  const itemFiles = Array.from(processedFiles.entries())
    .filter(([_, file]) => file.type === 'item')
    .map(([path, file]) => ({ path, content: file.content as string, type: file.type }));
  const assessmentInManifest = $manifest('resource[type="imsqti_test_xmlv3p0"]');

  let assessmentChanged = false;
  let manifestChanged = false;

  for (const assessmentRef of assessmentRefs) {
    const refId = $assessment(assessmentRef).attr('identifier');
    const matchingItem = findByAttribute($manifest, 'qti-assessment-item-ref', 'identifier', refId);

    if (!matchingItem) {
      const hrefItem = $assessment(assessmentRef).attr('href');
      const hrefTest = assessmentInManifest.attr('href');
      const relativePath = resolvePath(hrefItem, hrefTest);

      const matchingItemFile = itemFiles.find(item => {
        const path1 = item.path.replace(/^(.\/|\/)/, '');
        const path2 = relativePath.replace(/^(.\/|\/)/, '');
        return path1 === path2;
      });

      const itemInManifest = findByHref($manifest, 'resource', relativePath);

      if (matchingItemFile) {
        const $item = cheerio.load(matchingItemFile.content, { xmlMode: true, xml: true });
        if ($item('qti-assessment-item').length > 0) {
          const assessmentItemId = $item('qti-assessment-item')[0]?.attribs['identifier'];
          assessmentRef.attribs['identifier'] = assessmentItemId || refId;
          assessmentChanged = true;

          if (itemInManifest) {
            itemInManifest.attribs['identifier'] = assessmentItemId || refId;
            manifestChanged = true;
          }
        }
      }
    }
  }

  return {
    assessmentUpdated: assessmentChanged,
    manifestUpdated: manifestChanged,
    updatedAssessmentContent: assessmentChanged ? $assessment.xml() : assessment.content,
    updatedManifestContent: manifestChanged ? $manifest.xml() : manifestContent
  };
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

function findByHref($element: cheerio.CheerioAPI, tagName: string, value: string) {
  for (const itemRef of $element(tagName)) {
    const itemRefElement = itemRef as Element;
    const attributeValue = itemRefElement.attribs['href'];
    if (!attributeValue) {
      continue; // Skip if href attribute is not present
    }
    // now check if the href is the same, but if it should not matter if one of the href starts with ./ or / or not
    const attributeValueNormalized = attributeValue.replace(/^(.\/|\/)/, '');
    const valueNormalized = value.replace(/^(.\/|\/)/, '');
    if (attributeValueNormalized === valueNormalized) {
      return itemRefElement;
    }
  }

  return null;
}

/**
 * Resolves a relative path against a base path
 * @param relativePath - The path to resolve (e.g., '../../items/item.xml')
 * @param basePath - The path to resolve against (e.g., 'tests/folder/test.xml')
 * @returns The resolved absolute path (e.g., 'items/item.xml')
 */
function resolvePath(relativePath: string, basePath: string): string {
  // Extract the directory part of the base path
  const baseDir = basePath.split('/').slice(0, -1);

  // Split the relative path into segments
  const relativeSegments = relativePath.split('/');

  // Start with the base directory segments
  const resultSegments = [...baseDir];

  // Process each segment of the relative path
  for (const segment of relativeSegments) {
    if (segment === '..') {
      // Go up one directory (remove last segment from result)
      if (resultSegments.length > 0) {
        resultSegments.pop();
      }
    } else if (segment !== '.' && segment !== '') {
      // Add normal segments (ignore '.' and empty segments)
      resultSegments.push(segment);
    }
  }

  return resultSegments.join('/');
}
