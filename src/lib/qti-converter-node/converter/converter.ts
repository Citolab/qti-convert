// import convert from 'qti30upgrader';

import saxon from 'saxon-js';

import styleSheetString from './../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };
import { cleanXMLString } from 'src/lib/qti-helper';

const convert = (qti2: string) => {
  // const env = saxon.getPlatform();
  // const doc = env.parseXmlFromString(env.readFile('./node_modules/qti30upgrader/qti2xTo30.xsl'));
  // doc._saxonBaseUri = 'dummy';
  // const sef = saxon.compile(doc);
  qti2 = cleanXMLString(qti2);

  return saxon
    .transform(
      {
        stylesheetText: JSON.stringify(styleSheetString), // './node_modules/qti30upgrader/qti2xTo30.sef.json',
        sourceType: 'xml',
        sourceText: qti2,
        destination: 'serialized'
      },
      'async'
    )
    .then(output => output.principalResult);
};

export const convertQti2toQti3 = async (qti2: string): Promise<string> => {
  // Read the existing content of the manifest.xml file
  qti2 = cleanXMLString(qti2);
  // Modify the content as needed
  const qti3 = await convert(qti2);

  // Return the modified content as a string
  return qti3;
};
