import archiver from 'archiver';
import * as cheerio from 'cheerio';
import { createWriteStream, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import xmlFormat from 'xml-formatter';
import { Element } from 'domhandler';

export const qtiReferenceAttributes = ['src', 'href', 'data', 'primary-path', 'fallback-path', 'template-location'];

export type QtiResource = {
  type:
    | 'imsqti_test_xmlv3p0'
    | 'imsqti_item_xmlv3p0'
    | 'associatedcontent/learning-application-resource'
    | 'imsqti_item_xmlv2p2'
    | 'imsqti_test_xmlv2p2'
    | 'webcontent';

  href: string;
  identifier: string;
  dependencies: string[];
};

export const determineQtiVersion = (foldername: string): '2.x' | '3.0' => {
  // continue if the foldername is not a folder but a file
  if (!lstatSync(foldername).isDirectory()) {
    return undefined;
  }
  try {
    const files = readdirSync(foldername);
    for (const file of files) {
      if (file === '.DS_Store') {
        continue;
      }
      const subfolder = `${foldername}/${file}`;
      if (lstatSync(subfolder).isDirectory()) {
        const subResult = determineQtiVersion(subfolder);
        if (subResult !== undefined) {
          return subResult;
        }
      } else {
        if (subfolder.endsWith('.xml')) {
          const content = readFileSync(subfolder, 'utf-8');
          if (content.includes('<qti-assessment-test') || content.includes('<qti-assessment-item')) {
            return '3.0';
          }
          if (content.includes('<assessmentTest') || content.includes('<assessmentItem')) {
            return '2.x';
          }
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
  return undefined;
};

export const getAllXmlResourcesRecursivelyWithDependencies = (
  allResouces: QtiResource[],
  foldername: string,
  version: '2.x' | '3.0'
) => {
  const assessmentTestTag = version === '2.x' ? 'assessmentTest' : 'qti-assessment-test';
  const assessmentItemTag = version === '2.x' ? 'assessmentItem' : 'qti-assessment-item';
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
      if (lstatSync(subfolder).isDirectory()) {
        getAllXmlResourcesRecursivelyWithDependencies(allResouces, subfolder, version);
      } else {
        if (subfolder.endsWith('.xml')) {
          const content = readFileSync(subfolder, 'utf-8');
          if (content.indexOf(`<${assessmentTestTag}`) !== -1) {
            const $ = cheerio.load(content, { xmlMode: true, xml: true });
            const identifier = $(assessmentTestTag).attr('identifier');
            allResouces.push({
              type: version === '2.x' ? 'imsqti_test_xmlv2p2' : 'imsqti_test_xmlv3p0',
              href: subfolder,
              identifier,
              dependencies: getDependencyReferences(subfolder, $, version)
            });
          } else if (content.indexOf('<manifest') !== -1) {
            // do nothing
          } else if (content.indexOf(`<${assessmentItemTag}`) !== -1) {
            const $ = cheerio.load(content, {
              xmlMode: true,
              xml: true
            });
            const identifier = $(assessmentItemTag).attr('identifier');
            allResouces.push({
              type: version === '2.x' ? 'imsqti_item_xmlv2p2' : 'imsqti_item_xmlv3p0',
              href: subfolder,
              identifier,
              dependencies: getDependencyReferences(subfolder, $, version)
            });
          }
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
};

function getAttributeFromRawElement(element: Element, attributeName: string): string | undefined {
  // Check if the element has attributes and return the requested one if it exists
  return element.attribs ? element.attribs[attributeName] : undefined;
}

export const createPackageZipsPerItem = async (foldername: string) => {
  const manifest = `${foldername}/imsmanifest.xml`;
  let manifestString = '';
  const version = await determineQtiVersion(foldername);
  // Check if manifest exists
  if (!existsSync(manifest)) {
    manifestString = await createOrCompleteManifest(foldername);
  } else {
    manifestString = readFileSync(manifest, 'utf-8');
  }

  const $manifestXml = cheerio.load(manifestString, {
    xmlMode: true,
    xml: true
  });
  const items: Element[] = [];

  $manifestXml('resource').each((_, element) => {
    const resourceType = $manifestXml(element).attr('type');
    if (resourceType && resourceType.includes('item')) {
      items.push(element);
    }
  });
  const promises = [];
  for (const item of items) {
    const file = $manifestXml(item).attr('href');
    const itemContent = readFileSync(`${foldername}/${file}`, 'utf-8');
    const $item = cheerio.load(itemContent, {
      xmlMode: true,
      xml: true
    });
    const title = $item(formatTagByVersion('assessment-item', version)).attr('title');
    const identfier = $item(formatTagByVersion('assessment-item', version)).attr('identifier');
    if (!title) {
      throw new Error('Title is missing in ' + file);
    }
    const replaceAllCharsThatAreNotAllowedInaFileNameWithAUnderscore = (str: string) =>
      str.replace(/[^a-zA-Z0-9_]/g, '_');
    const packageFile = `${foldername}/package_${replaceAllCharsThatAreNotAllowedInaFileNameWithAUnderscore(
      title || identfier
    )}.zip`;
    const $itemInManifest = $manifestXml(`resource[href="${file}"]`);

    const dependencies = $itemInManifest
      .find('dependency')
      .toArray()
      .map(d => {
        const ref = getAttributeFromRawElement(d, 'identifierref');
        const resource = $manifestXml(`resource[identifier="${ref}"]`);
        const href = resource.attr('href');
        return href;
      })
      .concat(file);
    // Create a file stream for the zip output
    const output = createWriteStream(packageFile);

    // Create the zip archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Compression level
    });

    // Pipe the archive data to the file stream
    archive.pipe(output);

    // Handle archive finalization
    promises.push(
      new Promise((resolve, reject) => {
        // Listen for errors
        archive.on('error', err => {
          console.log('Archiving error: ', err);
          reject(err);
        });

        // When the output stream finishes, resolve the promise
        output.on('close', () => {
          console.log(`Archive has been finalized and the output file is ${archive.pointer()} total bytes`);
          resolve(packageFile);
        });
        // create a manifest file for this item.
        const manifestString = getEmptyManifest(`manifest-${title}.xml`, version);

        // Append all files mentioned in the manifest to the archive
        for (const href of dependencies) {
          // const filename = href.split('/').pop();
          const fullPath = `${foldername}/${href}`;
          archive.append(readFileSync(fullPath), { name: href });
          if (!existsSync(fullPath)) {
            console.log(`Could not find the file: ${fullPath}`);
            continue;
          }
        }

        const $itemManifest = cheerio.load(manifestString, {
          xmlMode: true,
          xml: true
        });
        for (const href of dependencies) {
          const elementInManifest = $manifestXml(`resource[href="${href}"]`);
          if (elementInManifest.length > 0) {
            $itemManifest('resources').append(elementInManifest);
          }
        }
        const itemManifestString = $itemManifest.xml();
        archive.append(itemManifestString, { name: 'imsmanifest.xml' });

        // Finalize the archive (no more files can be added after this point)
        archive.finalize();
      })
    );
  }
  return Promise.all(promises);
};

export const createPackageZip = async (foldername: string, createManifest = false, createAssessment = false) => {
  const manifest = `${foldername}/imsmanifest.xml`;

  if (createAssessment) {
    const assessmentFilename = `${foldername}/test.xml`;
    const assessment = await createAssessmentTest(assessmentFilename);
    writeFileSync(`${foldername}/test.xml`, assessment);
  }

  if (createManifest) {
    const manifestFilename = `${foldername}/imsmanifest.xml`;
    const manifest = await createOrCompleteManifest(manifestFilename);
    writeFileSync(`${foldername}/imsmanifest.xml`, manifest);
  }

  // Check if manifest exists
  if (!createManifest && !existsSync(manifest)) {
    console.log(`Could not find the manifest file in the folder: ${foldername}`);
    return;
  }

  const manifestString = readFileSync(manifest, 'utf-8');
  const $manifestXml = cheerio.load(manifestString, {
    xmlMode: true,
    xml: true
  });

  const allFiles = $manifestXml('file').toArray();
  const packageFile = `${foldername}/package.zip`;

  // Create a file stream for the zip output
  const output = createWriteStream(packageFile);

  // Create the zip archive
  const archive = archiver('zip', {
    zlib: { level: 9 } // Compression level
  });

  // Pipe the archive data to the file stream
  archive.pipe(output);

  // Handle archive finalization
  return new Promise((resolve, reject) => {
    // Listen for errors
    archive.on('error', err => {
      console.log('Archiving error: ', err);
      reject(err);
    });

    // When the output stream finishes, resolve the promise
    output.on('close', () => {
      console.log(`Archive has been finalized and the output file is ${archive.pointer()} total bytes`);
      resolve(packageFile);
    });

    // Append all files mentioned in the manifest to the archive
    for (const file of allFiles) {
      const href = file.attribs.href;
      // const filename = href.split('/').pop();
      const fullPath = `${foldername}/${href}`;

      if (!existsSync(fullPath)) {
        console.log(`Could not find the file: ${fullPath}`);
        continue;
      }

      const fileContent = readFileSync(fullPath);
      archive.append(fileContent, { name: href });
    }
    // append the manifest self
    archive.append(manifestString, { name: 'imsmanifest.xml' });
    // Finalize the archive (no more files can be added after this point)
    archive.finalize();
  });
};

const getEmptyManifest = (identifier: string, version: '2.x' | '3.0') => {
  return version === '3.0'
    ? `<?xml version="1.0" encoding="utf-8"?>
                    <manifest xmlns:imsmd="http://ltsc.ieee.org/xsd/LOM"
                        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                        xsi:schemaLocation="http://ltsc.ieee.org/xsd/LOM https://purl.imsglobal.org/spec/md/v1p3/schema/xsd/imsmd_loose_v1p3p2.xsd
                                            http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd"
                        identifier="${identifier}"
                        xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
                            <metadata>
                                <schema>QTI Package</schema>
                                <schemaversion>3.0.0</schemaversion>
                            </metadata>
                            <organizations />
                            <resources>
                            </resources>
                    </manifest>`
    : `<?xml version="1.0"?>
              <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/qti/qtiv2p2/qtiv2p2_imscpv1p2_v1p0.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd http://ltsc.ieee.org/xsd/LOM http://www.imsglobal.org/xsd/imsmd_loose_v1p3p2.xsd" identifier="${identifier}" xmlns:imsmd="http://ltsc.ieee.org/xsd/LOM">
                  <metadata>
                      <schema>QTIv2.2 Package</schema>
                      <schemaversion>1.0.0</schemaversion>
                  </metadata>
                  <organizations/>
                  <resources>
              </resources>
          </manifest>`;
};

export const createOrCompleteManifest = async (foldername: string) => {
  const manifest = `${foldername}/imsmanifest.xml`;
  // check if manifest exists
  const identfier = foldername.split('/').pop();
  const version = determineQtiVersion(foldername);
  let manifestString = '';
  if (!existsSync(manifest)) {
    manifestString = getEmptyManifest(identfier, version);
  } else {
    manifestString = readFileSync(manifest, 'utf-8');
  }
  const $manifestXml = cheerio.load(manifestString, {
    xmlMode: true,
    xml: true
  });

  const allResouces: QtiResource[] = [];
  getAllXmlResourcesRecursivelyWithDependencies(allResouces, foldername, version);

  const allDependencies = allResouces.flatMap(r =>
    r.dependencies.map(d => ({ fileRef: d, referencedBy: r.identifier }))
  );
  // Define the type for unique dependencies
  type UniqueDependency = {
    href: string;
    id: string;
    referencedBy: string[];
  };

  // Create a new list of unique dependencies
  const uniqueDependencies: UniqueDependency[] = [];

  allDependencies.forEach(dependency => {
    const { fileRef, referencedBy } = dependency;

    // Extract the filename from href
    const filename = fileRef.split('/').pop()?.replaceAll('.', '_') ?? '';

    // Check if this dependency is already in the unique list
    const existingDependency = uniqueDependencies.find(dep => dep.href === fileRef);

    if (existingDependency) {
      // If it exists, add the new resource reference to the referencedBy array
      if (!existingDependency.referencedBy.includes(referencedBy)) {
        existingDependency.referencedBy.push(referencedBy);
      }
    } else {
      // Create a new ID based on the uniqueness rules
      let id = `RES-${filename}`;

      // If multiple resources reference the same filename but different hrefs
      if (uniqueDependencies.some(dep => dep.id === id)) {
        id = `RES-${referencedBy}-${filename}`;
      }

      // Add the unique dependency
      uniqueDependencies.push({
        href: fileRef,
        id,
        referencedBy: [referencedBy]
      });
    }
  });

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
      const dependencyFiles = uniqueDependencies.filter(d => d.referencedBy.includes(resource.identifier));
      const manifestResource = $manifestXml(`resource[identifier="${resource.identifier}"]`);
      if (manifestResource.length > 0) {
        for (const dependency of dependencyFiles) {
          const dependencyNode = manifestResource.find(`dependency[identifierref="${dependency.id}"]`);

          if (dependencyNode.length === 0) {
            // Append the dependency node if it doesn't exist
            manifestResource.append(`<dependency identifierref="${dependency.id}"/>`);
          }
        }
      }
    }
  }
  for (const resource of uniqueDependencies) {
    if ($manifestXml(`resource[identifier="${resource.id}"]`).length === 0) {
      const href = resource.href.replace(foldername, '');
      // remove first slash if it exists
      const hrefWithoutLeadingSlash = href[0] === '/' ? href.slice(1) : href;
      $manifestXml('resources').append(
        `<resource identifier="${resource.id}" type="${
          version === '3.0' ? 'associatedcontent/learning-application-resource' : 'webcontent'
        }" href="${hrefWithoutLeadingSlash}">
      <file href="${hrefWithoutLeadingSlash}" />
    </resource>`
      );
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

const formatTagByVersion = (tagName: string, version: '3.0' | '2.x') => {
  if (version === '3.0') {
    return `qti-${tagName}`;
  } else {
    // Convert to camelCase, remove the "qti-" prefix, and return the formatted tag
    return tagName
      .replace(/-./g, x => x[1].toUpperCase()) // Converts dash-case to camelCase
      .replace(/^qti/, ''); // Remove qti- prefix if present
  }
};

const formatAttributesByVersion = (attributes: string, version: '3.0' | '2.x') => {
  if (version === '3.0') {
    return attributes;
  } else {
    return attributes.replace(/([a-z])-([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
  }
};

export const createAssessmentTest = async (foldername: string) => {
  const allResouces: QtiResource[] = [];
  const version = determineQtiVersion(foldername);
  getAllXmlResourcesRecursivelyWithDependencies(allResouces, foldername, version);
  const items = allResouces.filter(item => item.type.includes('imsqti_item'));

  const formatTag = (tagName: string) => {
    return formatTagByVersion(tagName, version);
  };

  const formatAttributes = (attributes: string) => {
    return formatAttributesByVersion(attributes, version);
  };

  const xmlString = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
${
  version === '3.0'
    ? `<qti-assessment-test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
                     xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd http://www.w3.org/1998/Math/MathML https://purl.imsglobal.org/spec/mathml/v3p0/schema/xsd/mathml3.xsd http://www.w3.org/2001/XInclude https://purl.imsglobal.org/spec/w3/2001/schema/xsd/XInclude.xsd" 
                     xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:xi="http://www.w3.org/2001/XInclude" xmlns:m="http://www.w3.org/1998/Math/MathML" 
                     tool-version="0.1" 
                     title="My Test" tool-name="Spectatus" identifier="TST-GENERATED-TEST">`
    : `<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" 
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
           identifier="TST-GENERATED-TEST"
          title="My Test 12" 
          toolVersion="01" 
          xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p2 http://www.imsglobal.org/xsd/qti/qtiv2p2/imsqti_v2p2p1.xsd">`
} 
        <${formatTag('outcome-declaration')} ${formatAttributes(
          'base-type="float" cardinality="single" identifier="SCORE"'
        )}>
        <${formatTag('default-value')}>
            <${formatTag('value')}>0.0</${formatTag('value')}>
        </${formatTag('default-value')}>
    </${formatTag('outcome-declaration')}>
    <${formatTag('test-part')} ${formatAttributes(
      'submission-mode="simultaneous" navigation-mode="nonlinear" identifier="TP"'
    )}>
        <${formatTag('assessment-section')} title="Section 1" visible="true" identifier="S1">
            ${items
              .map(item => {
                const relativePath = item.href.replace(foldername + '/', '').replace(foldername, '');
                return `<${formatTag('assessment-item-ref')} href="${relativePath}" identifier="${item.identifier}"/>`;
              })
              .join('\n')}
        </${formatTag('assessment-section')}>
    </${formatTag('test-part')}>
    <${formatTag('outcome-processing')}>
        <${formatTag('set-outcome-value')} identifier="SCORE">
            <${formatTag('sum')}>
                <${formatTag('test-variables')} ${formatAttributes('base-type="float" variable-identifier="SCORE"')}/>
            </${formatTag('sum')}>
        </${formatTag('set-outcome-value')}>
    </${formatTag('outcome-processing')}>
</${formatTag('assessment-test')}>`;
  const formattedXML = xmlFormat(xmlString, {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  });
  return formattedXML;
};

const getDependencyReferences = (pathPath: string, $: cheerio.CheerioAPI, version: '2.x' | '3.0') => {
  const filenames = [];

  // Get qti-assessment-item identifiers
  $(formatTagByVersion('assessment-item-ref', version)).each((i, elem) => {
    const identifier = $(elem).attr('identifier');
    if (identifier) {
      filenames.push(identifier);
    }
  });

  qtiReferenceAttributes.forEach(selector => {
    $(`[${selector}]`).each((i, elem) => {
      if (elem.type !== 'tag' || elem.name !== formatTagByVersion('assessment-item-ref', version)) {
        const attr = $(elem).attr(selector);
        if (attr) {
          const directoryName = dirname(pathPath);
          const filename = `${directoryName}/${attr}`;
          filenames.push(filename);
        }
      }
    });
  });

  return filenames;
};
