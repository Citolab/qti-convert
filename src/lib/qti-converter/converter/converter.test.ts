import { qtiTransform } from 'src/lib/qti-transformer';
import { convertPackageStream, convertQti2toQti3 } from '../index';
import { expect, test } from 'vitest';
import * as xml2js from 'xml2js';
import { createReadStream, writeFile } from 'fs';
import unzipper from 'unzipper';

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

// test('convert package', async () => {
//   const zip = 'test.zip';
//   const zipStream = createReadStream(zip).pipe(unzipper.Parse({ forceStream: true }));
//   // zipStream.on('entry', entry => {
//   //   console.log('Processing:', entry.path);
//   //   entry.autodrain(); // Drain entry so the stream continues
//   // });

//   // zipStream.on('finish', () => {
//   //   console.log('Finished reading ZIP');
//   // });
//   const updatedStream = await convertPackageStream(zipStream);

//   writeFile('test-qti3.zip', updatedStream, () => {
//     console.log('done');
//   });
// });

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

test('convert a TAO PCI', async () => {
  const qti2 = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" xmlns:html5="html5" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p2 http://www.imsglobal.org/xsd/qti/qtiv2p2/imsqti_v2p2.xsd" identifier="i605b50d60c465892a88c0651ffd390" title="decisiontask" label="decisiontask" xml:lang="en-US" adaptive="false" timeDependent="false" toolName="TAO" toolVersion="3.4.0-sprint134">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/> 
  <stylesheet href="style/custom/tao-user-styles.css" type="text/css" media="all" title=""/>
  <itemBody>
    <div class="grid-row">
      <div class="col-12"/>
    </div>
    <div class="grid-row">
      <div class="col-12"/>
    </div>
    <div class="grid-row">
      <div class="col-12">
        <customInteraction responseIdentifier="RESPONSE">
          <portableCustomInteraction xmlns="http://www.imsglobal.org/xsd/portableCustomInteraction"
          customInteractionTypeIdentifier="decisiontask" hook="decisiontask/runtime/decisiontask.amd.js" version="0.0.10">
            <resources>
              <libraries>
                <lib id="IMSGlobal/jquery_2_1_1"/>
                <lib id="decisiontask/runtime/js/renderer"/>
              </libraries><stylesheets>
                <link href="decisiontask/runtime/css/base.css" type="text/css" title="base"/><link href="decisiontask/runtime/css/decisiontask.css" type="text/css" title="decisiontask"/></stylesheets><mediaFiles><file src="decisiontask/runtime/assets/feedback0.wav" type="application/octet-stream"/><file src="decisiontask/runtime/assets/feedback1.wav" type="application/octet-stream"/><file src="decisiontask/runtime/assets/feedback2.wav" type="application/octet-stream"/><file src="decisiontask/runtime/assets/feedback3.wav" type="application/octet-stream"/><file src="decisiontask/runtime/assets/feedback4.wav" type="application/octet-stream"/><file src="decisiontask/runtime/assets/feedback5.wav" type="application/octet-stream"/></mediaFiles></resources>
            <properties>
              <properties key="data">
                <properties key="0">
                  <property key="stimulusindex">1</property>
                  <property key="stimulus">5 + 7 = 12</property>
                  <property key="response">1
</property>
                </properties>
                <properties key="1">
                  <property key="stimulusindex">2</property>
                  <property key="stimulus">4 + 4 = 9</property>
                  <property key="response">2
</property>
                </properties>
                <properties key="2">
                  <property key="stimulusindex">3</property>
                  <property key="stimulus">7 + 6 = 13</property>
                  <property key="response">1</property>
                </properties>
              </properties>
              <property key="uploadedFname">stimuli_IIL_item.csv</property>
              <property key="feedback">true</property>
              <property key="shufflestimuli"></property>
              <property key="respkey"></property>
              <property key="tlimit">0</property>
              <property key="level">2</property>
              <property key="buttonlabel0">True</property>
              <property key="buttonlabel1">False</property>
              <property key="buttonlabel2"></property>
              <property key="buttonlabel3"></property>
              <property key="buttonlabel4"></property>
              <property key="buttonlabel5"></property>
              <property key="buttonlabel6"></property>
              <property key="buttonlabel7"></property>
            </properties>
            <markup xmlns="http://www.w3.org/1999/xhtml">
              <div class="decisiontask">
                <div class="prompt"/>
                <div class="globalWrapper"/>
              </div>
            </markup>
          </portableCustomInteraction>
        </customInteraction>
      </div>
    </div>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>
</assessmentItem>

`;

  const expectedResult = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>
<qti-assessment-item xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" identifier="i605b50d60c465892a88c0651ffd390" title="decisiontask" label="decisiontask" xml:lang="en-US" adaptive="false" time-dependent="false" tool-name="TAO" tool-version="3.4.0-sprint134">
  <qti-stylesheet href="decisiontask/runtime/css/decisiontask.css" type="text/css"/>
  <qti-stylesheet href="decisiontask/runtime/css/base.css" type="text/css"/>
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-stylesheet href="style/custom/tao-user-styles.css" type="text/css" media="all" title=""/>
  <qti-item-body>
    <div class="grid-row">
      <div class="col-12"/>
    </div>
    <div class="grid-row">
      <div class="col-12"/>
    </div>
    <div class="grid-row">
      <div class="col-12">
        <qti-portable-custom-interaction custom-interaction-type-identifier="decisiontask" version="0.0.10" data-data__0__stimulusindex="1" data-data__0__stimulus="5 + 7 = 12" data-data__0__response="1" data-data__1__stimulusindex="2" data-data__1__stimulus="4 + 4 = 9" data-data__1__response="2" data-data__2__stimulusindex="3" data-data__2__stimulus="7 + 6 = 13" data-data__2__response="1" data-uploaded-fname="stimuli_IIL_item.csv" data-feedback="true" data-shufflestimuli="" data-respkey="" data-tlimit="0" data-level="2" data-buttonlabel0="True" data-buttonlabel1="False" data-buttonlabel2="" data-buttonlabel3="" data-buttonlabel4="" data-buttonlabel5="" data-buttonlabel6="" data-buttonlabel7="" data-0__stimulusindex="1" data-0__stimulus="5 + 7 = 12" data-0__response="1" data-1__stimulusindex="2" data-1__stimulus="4 + 4 = 9" data-1__response="2" data-2__stimulusindex="3" data-2__stimulus="7 + 6 = 13" data-2__response="1" data-stimulusindex="3" data-stimulus="7 + 6 = 13" data-response="1" module="decisiontask" response-identifier="RESPONSE">
          <qti-interaction-modules>
            <qti-interaction-module id="IMSGlobal/jquery_2_1_1" primary-path="IMSGlobal/jquery_2_1_1"/>
            <qti-interaction-module id="decisiontask/runtime/js/renderer" primary-path="decisiontask/runtime/js/renderer"/>
            <qti-interaction-module id="decisiontask" primary-path="decisiontask/runtime/decisiontask.amd.js"/>
          </qti-interaction-modules>
          <qti-interaction-markup>
            <div class="decisiontask">
              <div class="prompt"/>
              <div class="globalWrapper"/>
            </div>
          </qti-interaction-markup>
        </qti-portable-custom-interaction>
      </div>
    </div>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>
</qti-assessment-item>`;
  const qti3 = await convertQti2toQti3(qti2);
  const transform = qtiTransform(qti3);
  const transformResult = await transform
    // .stripStylesheets()
    .objectToImg()
    .objectToVideo()
    .objectToAudio()
    .stripMaterialInfo()
    .minChoicesToOne()
    .externalScored()
    .qbCleanup()
    .depConvert()
    .upgradePci();
  const transformedQti3 = transformResult.xml();
  console.log(transformedQti3);
  const areEqual = await areXmlEqual(transformedQti3, expectedResult);
  expect(areEqual).toEqual(true);
});
