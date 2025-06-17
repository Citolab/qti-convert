// import convert from 'qti30upgrader';

import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };
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

export const convertQti2toQti3 = async (qti2: string): Promise<string> => {
  // Read the existing content of the manifest.xml file
  qti2 = cleanXMLString(qti2);
  // Modify the content as needed
  const qti3 = await convert(qti2);

  // Return the modified content as a string
  return qti3;
};
