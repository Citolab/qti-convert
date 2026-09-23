import { qtiTransform } from '../../qti-transformer';
import { convertManifestFile, convertPackageStream, convertQti2toQti3 } from '../index';
import { describe, expect, test } from 'vitest';
import * as xml2js from 'xml2js';
import { createReadStream, writeFile } from 'fs';
import unzipper from 'unzipper';
import * as cheerio from 'cheerio';

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
<?xml-model href="https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>
<qti-assessment-item xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd" identifier="textEntry" title="Richard III (Take 3)" adaptive="false" time-dependent="false">
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
  expect(transformedQti3).toContain('<qti-portable-custom-interaction');
  expect(transformedQti3).toContain('module="decisiontask"');
  expect(transformedQti3).not.toContain('data-legacy-pci-proxy');
  expect(transformedQti3).not.toContain('data-require-paths');
});

test('should convert manifest file with imscp prefix to default namespace', () => {
  const inputXml = `<?xml version="1.0" encoding="UTF-8"?>
<imscp:manifest identifier="MANIFEST-QTI-1" 
  xmlns:xml="http://www.w3.org/XML/1998/namespace" 
  xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" 
  xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_v2p0" 
  xmlns:xhtml="http://www.w3.org/1999/xhtml" 
  xmlns:imscp="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <imscp:organizations/>
  <imscp:resources>
    <imscp:resource identifier="Q80000" type="imsqti_item_xmlv2p1" href="questions/Q80000.xml">
      <imscp:metadata>
        <imsmd:lom>
          <imsmd:general>
            <imsmd:title>Test Question</imsmd:title>
          </imsmd:general>
        </imsmd:lom>
      </imscp:metadata>
      <imscp:file href="questions/Q80000.xml"/>
    </imscp:resource>
    <imscp:resource identifier="Q80001" type="imsqti_item_xmlv2p1" href="questions/Q80001.xml">
      <imscp:file href="questions/Q80001.xml"/>
    </imscp:resource>
  </imscp:resources>
</imscp:manifest>`;

  const expectedXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-QTI-1" 
  xmlns:xml="http://www.w3.org/XML/1998/namespace" 
  xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" 
  xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_v2p0" 
  xmlns:xhtml="http://www.w3.org/1999/xhtml" 
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <organizations/>
  <resources>
    <resource identifier="Q80000" type="imsqti_item_xmlv2p1" href="questions/Q80000.xml">
      <metadata>
        <imsmd:lom>
          <imsmd:general>
            <imsmd:title>Test Question</imsmd:title>
          </imsmd:general>
        </imsmd:lom>
      </metadata>
      <file href="questions/Q80000.xml"/>
    </resource>
    <resource identifier="Q80001" type="imsqti_item_xmlv2p1" href="questions/Q80001.xml">
      <file href="questions/Q80001.xml"/>
    </resource>
  </resources>
</manifest>`;

  // Load the XML with cheerio
  const $ = cheerio.load(inputXml, { xmlMode: true, xml: true });

  // Call the function under test
  const $result = convertManifestFile($);
  const result = $result.xml();

  // Log the actual result for debugging
  console.log('Input XML:');
  console.log(inputXml);
  console.log('\nActual Result:');
  console.log(result);
  console.log('\nExpected Result:');
  console.log(expectedXml);

  // Basic assertions to help debug
  expect(result).toContain('<manifest');
  expect(result).not.toContain('<imscp:manifest');
  expect(result).toContain('<organizations/>');
  expect(result).not.toContain('<imscp:organizations/>');
  expect(result).toContain('<resources>');
  expect(result).not.toContain('<imscp:resources>');
  expect(result).toContain('<resource identifier="Q80000"');
  expect(result).not.toContain('<imscp:resource');

  // You can add more specific assertions based on what you expect
  // For now, let's see what the function actually produces
});

test('convertPackageStreamToQti21 streams a QTI 3 zip to a QTI 2.1 zip', async () => {
  const { Readable, PassThrough } = await import('stream');
  const JSZip = (await import('jszip')).default;
  const { convertPackageStreamToQti21 } = await import('../index');
  const zip = new JSZip();
  zip.file(
    'item.xml',
    '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" adaptive="false" time-dependent="false"><qti-item-body><p>x</p></qti-item-body></qti-assessment-item>'
  );
  const input = Readable.from([await zip.generateAsync({ type: 'nodebuffer' })]);
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', chunk => chunks.push(chunk));

  const warnings = await convertPackageStreamToQti21(input, output);
  const result = await JSZip.loadAsync(Buffer.concat(chunks));
  expect(warnings).toEqual([]);
  expect(await result.file('item.xml')!.async('string')).toContain('<assessmentItem');
});

describe('shared stimulus extraction during the QTI 2 to 3 package conversion', async () => {
  const JSZip = (await import('jszip')).default;
  const passage =
    '<p>Dit is een lange leestekst die in beide items staat. Hij gaat over het weer in Nederland, dat vaak wisselvallig is: zon, regen en wind op een dag. Neem dus altijd een jas mee.</p>';
  const qti2Item = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="${id}" title="${id}" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier"/>
  <itemBody>${passage}<choiceInteraction responseIdentifier="RESPONSE" maxChoices="1"><simpleChoice identifier="A">A</simpleChoice></choiceInteraction></itemBody>
</assessmentItem>`;
  const zipBytes = async () => {
    const zip = new JSZip();
    zip.file(
      'imsmanifest.xml',
      `<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="M"><resources>
        <resource identifier="I1" type="imsqti_item_xmlv2p1" href="I1.xml"><file href="I1.xml"/></resource>
        <resource identifier="I2" type="imsqti_item_xmlv2p1" href="I2.xml"><file href="I2.xml"/></resource>
      </resources></manifest>`
    );
    zip.file('I1.xml', qti2Item('I1'));
    zip.file('I2.xml', qti2Item('I2'));
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  const assertExtracted = async (output: Buffer | Blob | Uint8Array) => {
    // JSZip can't read a Node Blob directly
    const result = await JSZip.loadAsync(output instanceof Blob ? new Uint8Array(await output.arrayBuffer()) : output);
    const stimulusPath = Object.keys(result.files).find(name => name.startsWith('stimuli/') && !result.files[name].dir);
    expect(stimulusPath).toMatch(/^stimuli\/STIM_\w+\.xml$/);
    expect(await result.file(stimulusPath!)!.async('string')).toContain('Dit is een lange leestekst');
    for (const item of ['I1.xml', 'I2.xml']) {
      const xml = await result.file(item)!.async('string');
      const $ = cheerio.load(xml, { xml: true });
      expect($('qti-assessment-stimulus-ref').attr('href')).toBe(stimulusPath);
      expect($('qti-item-body').text()).not.toContain('Dit is een lange leestekst');
    }
    expect(await result.file('imsmanifest.xml')!.async('string')).toContain('imsqti_stimulus_xmlv3p0');
  };

  test('node: convertPackageStream with extractSharedStimuli', async () => {
    const { Readable } = await import('stream');
    const unzipStream = Readable.from([await zipBytes()]).pipe(unzipper.Parse({ forceStream: true }));
    const reports: unknown[] = [];
    const output = await convertPackageStream(unzipStream, undefined, undefined, undefined, undefined, {
      extractSharedStimuli: true,
      onSharedStimuliReport: report => reports.push(report)
    });
    await assertExtracted(output);
    expect(reports).toHaveLength(1);
  });

  test('node: off by default', async () => {
    const { Readable } = await import('stream');
    const unzipStream = Readable.from([await zipBytes()]).pipe(unzipper.Parse({ forceStream: true }));
    const result = await JSZip.loadAsync(await convertPackageStream(unzipStream));
    expect(Object.keys(result.files).some(name => name.startsWith('stimuli/'))).toBe(false);
  });

  test('browser: convertPackage with extractSharedStimuli', async () => {
    const { convertPackage } = await import('../../qti-converter/converter/converter');
    const output = await convertPackage(await zipBytes(), undefined, undefined, undefined, undefined, {
      extractSharedStimuli: true
    });
    await assertExtracted(output);
  });
});
