import * as cheerio from 'cheerio';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'fs';
import xmlFormat from 'xml-formatter';

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
