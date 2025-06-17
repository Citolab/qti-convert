// import convert from 'qti30upgrader';

import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };
import { cleanXMLString } from 'src/lib/qti-helper';

export const initializeSaxonJS = async () => {
  if (typeof globalThis.SaxonJS === 'undefined') {
    try {
      // Try to import saxon-js if we're in Node.js
      if (typeof window === 'undefined') {
        const saxonModule = await import('saxon-js');
        globalThis.SaxonJS = saxonModule.default || saxonModule;
      } else {
        // In browser, check if it's already loaded via script tag
        if (typeof (window as any).SaxonJS !== 'undefined') {
          globalThis.SaxonJS = (window as any).SaxonJS;
        } else {
          throw new Error('SaxonJS not available in browser. Please include the SaxonJS script tag.');
        }
      }
    } catch (error) {
      throw new Error(`Failed to initialize SaxonJS: ${error.message}`);
    }
  }
  return globalThis.SaxonJS;
};

const convert = async (qti2: string) => {
  try {
    await initializeSaxonJS();
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
