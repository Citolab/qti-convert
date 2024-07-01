import { convertQti2toQti3 } from '../index';
import { expect, test } from 'vitest';

import * as xml2js from 'xml2js';

async function areXmlEqual(xml1: string, xml2: string): Promise<boolean> {
  const parser = new xml2js.Parser({ ignoreAttrs: true, trim: true, normalize: true });

  try {
    const obj1 = await parser.parseStringPromise(xml1);
    const obj2 = await parser.parseStringPromise(xml2);

    return JSON.stringify(obj1) === JSON.stringify(obj2);
  } catch (error) {
    console.error('Error parsing XML:', error);
    return false;
  }
}

test('qti2 to qti3 convert should work', async () => {
  const input = `<?xml version="1.0" encoding="UTF-8"?>
  <assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1.xsd"
    identifier="textEntry" title="Richard III (Take 3)" adaptive="false" timeDependent="false">
    <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string" />
  
    <itemBody>
      <p>Identify the missing word in this famous quote from Shakespeare's Richard III.</p>
      <blockquote>
        <p>Now is the winter of our discontent<br /> Made glorious summer by this sun of <textEntryInteraction
            responseIdentifier="RESPONSE" expectedLength="15" />;<br /> And all the clouds
          that lour'd upon our house<br /> In the deep bosom of the ocean buried.</p>
      </blockquote>
    </itemBody>
  </assessmentItem>`;
  const expectedOutput = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>
<qti-assessment-item xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" identifier="textEntry" title="Richard III (Take 3)" adaptive="false" time-dependent="false">
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  
    <qti-item-body>
      <p>Identify the missing word in this famous quote from Shakespeare's Richard III.</p>
      <blockquote>
        <p>Now is the winter of our discontent<br/> Made glorious summer by this sun of <qti-text-entry-interaction response-identifier="RESPONSE" expected-length="15"/>;<br/> And all the clouds
          that lour'd upon our house<br/> In the deep bosom of the ocean buried.</p>
      </blockquote>
    </qti-item-body>
  </qti-assessment-item>`;
  const result = await convertQti2toQti3(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
