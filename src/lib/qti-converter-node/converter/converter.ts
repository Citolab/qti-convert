// import convert from 'qti30upgrader';

import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };
import * as cheerio from 'cheerio';
import { cleanXMLString } from 'src/lib/qti-helper';

const convert = async (qti2: string) => {
  try {
    qti2 = cleanXMLString(qti2);
    if (!globalThis.SaxonJS) {
      console.error('SaxonJS is not loaded in the global scope.');
      throw new Error('SaxonJS is not available.');
    }
    const result = await globalThis.SaxonJS.transform(
      {
        stylesheetText: JSON.stringify(styleSheetString),
        sourceType: 'xml',
        sourceText: qti2,
        destination: 'serialized'
      },
      'async'
    );
    const qti3 = result.principalResult;
    return qti3;
  } catch (error) {
    console.error('Error during QTI conversion:', error);
    throw error;
  }
};

const normalizeConvertedQtiNamespace = (xml: string): string => {
  const $ = cheerio.load(xml, { xmlMode: true, xml: true });
  const qtiNamespacePrefixes = new Set<string>();
  const qtiNamespaceValue = 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0';
  const isQtiAssessmentRoot = (name: string) => {
    const localName = (name || '').split(':').pop();
    return (
      localName === 'qti-assessment-item' ||
      localName === 'qti-assessment-test' ||
      localName === 'assessment-item' ||
      localName === 'assessment-test'
    );
  };

  $('*').each((_, el) => {
    if (el.type !== 'tag' || !el.attribs) {
      return;
    }
    for (const [attrName, attrValue] of Object.entries(el.attribs)) {
      if (attrName.startsWith('xmlns:') && attrValue.toLowerCase().includes('imsqtiasi_v3p0')) {
        qtiNamespacePrefixes.add(attrName.slice('xmlns:'.length));
      }
    }
  });

  $('*').each((_, el) => {
    if (el.type !== 'tag') {
      return;
    }
    if (isQtiAssessmentRoot(el.name) && el.name.includes(':')) {
      qtiNamespacePrefixes.add(el.name.split(':')[0]);
    }
  });

  if (qtiNamespacePrefixes.size === 0) {
    return xml;
  }

  const root = $('*')
    .toArray()
    .find(el => el.type === 'tag' && isQtiAssessmentRoot(el.name));
  let qtiNamespace = (root && $(root).attr('xmlns')) || qtiNamespaceValue;

  for (const prefix of qtiNamespacePrefixes) {
    if (root) {
      qtiNamespace = $(root).attr(`xmlns:${prefix}`) || qtiNamespace;
    }
    $('*').each((_, el) => {
      if (el.type !== 'tag') {
        return;
      }
      if (el.name.startsWith(`${prefix}:`)) {
        const strippedName = el.name.slice(prefix.length + 1);
        el.name = strippedName.startsWith('qti-') ? strippedName : `qti-${strippedName}`;
      }
      if (el.attribs && Object.prototype.hasOwnProperty.call(el.attribs, `xmlns:${prefix}`)) {
        delete el.attribs[`xmlns:${prefix}`];
      }
    });
  }

  const normalizedRoot = $('*')
    .toArray()
    .find(el => el.type === 'tag' && isQtiAssessmentRoot(el.name));
  if (normalizedRoot) {
    $(normalizedRoot).attr('xmlns', qtiNamespace);
  }

  return cleanXMLString($.xml());
};

export const convertQti2toQti3 = async (qti2: string): Promise<string> => {
  // Read the existing content of the manifest.xml file
  qti2 = cleanXMLString(qti2);
  // Modify the content as needed
  const qti3 = await convert(qti2);

  // Return the modified content as a string
  return normalizeConvertedQtiNamespace(qti3);
};
