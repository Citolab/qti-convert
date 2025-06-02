// import convert from 'qti30upgrader';

import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };
import { cleanXMLString } from 'src/lib/qti-helper';

// if (!saxon) {
//   try {
//     // Dynamically import saxon-js only if not already loaded
//     const module = await import('saxon-js');
//     saxonJS = module.default || module;
//     globalThis.SaxonJS = saxonJS; // cache it globally if you want
//   } catch (err) {
//     throw new Error('SaxonJS could not be loaded: ' + err.message);
//   }
// }
// const env = saxon.getPlatform();
// const doc = env.parseXmlFromString(env.readFile('./node_modules/qti30upgrader/qti2xTo30.xsl'));
// doc._saxonBaseUri = 'dummy';
// const sef = saxon.compile(doc);

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

export const convertQti2toQti3 = async (qti2: string): Promise<string> => {
  // Read the existing content of the manifest.xml file
  qti2 = cleanXMLString(qti2);
  // Modify the content as needed
  const qti3 = await convert(qti2);

  // Return the modified content as a string
  return qti3;
};
