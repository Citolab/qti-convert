import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeAll, describe, expect, test } from 'vitest';
import { convertPackageFilesToQti21, convertQti3toQti21 } from './index';

// Validates the QTI 2.1 output against the official IMS XSD with xmllint. The XSD is downloaded once and
// cached; MathML, XInclude and APIP are replaced by lax stubs so only the QTI part is checked strictly.
// Skipped when xmllint or the network is unavailable.

const CACHE_DIR = path.join(os.tmpdir(), 'qti-convert-xsd-cache');
const QTI21_XSD = path.join(CACHE_DIR, 'qti21-local.xsd');

const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const laxSchema = (namespace: string, element: string) => `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${namespace}" elementFormDefault="qualified">
  <xs:element name="${element}"><xs:complexType mixed="true"><xs:sequence><xs:any processContents="skip" minOccurs="0" maxOccurs="unbounded"/></xs:sequence><xs:anyAttribute processContents="skip"/></xs:complexType></xs:element>
</xs:schema>`;

const prepareSchema = async (): Promise<boolean> => {
  if (existsSync(QTI21_XSD)) return true;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const [qti, xml] = await Promise.all(
      ['https://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p2.xsd', 'https://www.w3.org/2001/xml.xsd'].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.text();
      })
    );
    writeFileSync(path.join(CACHE_DIR, 'xml.xsd'), xml);
    writeFileSync(path.join(CACHE_DIR, 'mathml-stub.xsd'), laxSchema('http://www.w3.org/1998/Math/MathML', 'math'));
    writeFileSync(path.join(CACHE_DIR, 'xinclude-stub.xsd'), laxSchema('http://www.w3.org/2001/XInclude', 'include'));
    writeFileSync(
      path.join(CACHE_DIR, 'apip-stub.xsd'),
      laxSchema('http://www.imsglobal.org/xsd/apip/apipv1p0/imsapip_qtiv1p0', 'apipAccessibility')
    );
    writeFileSync(
      QTI21_XSD,
      qti
        .replace('http://www.imsglobal.org/xsd/w3/2001/xml.xsd', 'xml.xsd')
        .replace('http://www.imsglobal.org/xsd/w3/2001/XInclude.xsd', 'xinclude-stub.xsd')
        .replace('http://www.w3.org/Math/XMLSchema/mathml2/mathml2.xsd', 'mathml-stub.xsd')
        .replace('http://www.imsglobal.org/profile/apip/apipv1p0/apipv1p0_qtiextv2p1_v1p0.xsd', 'apip-stub.xsd')
    );
    return true;
  } catch (error) {
    console.warn('QTI 2.1 XSD could not be downloaded, skipping XSD validation:', error);
    return false;
  }
};

const validate = (xml: string): string => {
  const file = path.join(CACHE_DIR, `validate-${process.pid}-${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', QTI21_XSD, file], { stdio: 'pipe' });
    return '';
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error).replaceAll(file, '<output>');
  }
};

const qti3 = (body: string, head = '') => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="t" adaptive="false" time-dependent="false" xml:lang="en">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  ${head}
  <qti-item-body>${body}</qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>
  <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="A" show-hide="show"><qti-content-body><p>Modal</p></qti-content-body></qti-modal-feedback>
</qti-assessment-item>`;

const choice = `<qti-choice-interaction response-identifier="RESPONSE" max-choices="1" orientation="horizontal" data-max-selections-message="x">
  <qti-prompt>Pick</qti-prompt><qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice>
</qti-choice-interaction>`;

const cases: Record<string, string> = {
  'feedback, MathML and shared vocabulary': qti3(`
    <div class="qti-layout-row" data-x="1"><div class="qti-layout-col6"><p>Solve <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p></div></div>
    ${choice}
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="A" show-hide="show"><qti-content-body><p>Right</p></qti-content-body></qti-feedback-block>
    <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Rubric</p></qti-content-body></qti-rubric-block>`),
  'HTML5 media and elements': qti3(`
    <figure><img src="a.png" alt="a"/><figcaption>A</figcaption></figure>
    <section><p>Section</p></section>
    <audio controls="controls"><source src="a.mp3" type="audio/mpeg"/></audio>
    <video src="v.mp4" width="100"/>
    ${choice}`),
  'graphic interaction image': qti3(`
    <qti-select-point-interaction response-identifier="RESPONSE" max-choices="1"><qti-prompt>Click</qti-prompt><img src="map.png" width="60" height="40" alt="Map"/></qti-select-point-interaction>`),
  'SSML': qti3(`<p xmlns:ssml="http://www.w3.org/2001/10/synthesis">Say <ssml:sub alias="hello">hi</ssml:sub></p>${choice}`),
  'PCI': qti3(`
    <qti-portable-custom-interaction response-identifier="RESPONSE" custom-interaction-type-identifier="likert" module="likert">
      <qti-interaction-markup><div>markup</div></qti-interaction-markup>
    </qti-portable-custom-interaction>`)
};

describe.skipIf(!hasXmllint)('QTI 2.1 output validates against imsqti_v2p1p2.xsd', async () => {
  let schemaReady = false;
  beforeAll(async () => {
    schemaReady = await prepareSchema();
  });

  test.each(Object.entries(cases))('%s', (_name, input) => {
    if (!schemaReady) return;
    expect(validate(convertQti3toQti21(input).xml)).toBe('');
  });

  test('inlined shared stimulus', () => {
    if (!schemaReady) return;
    const item = qti3(choice).replace(
      '<qti-item-body>',
      '<qti-assessment-stimulus-ref identifier="S" href="s.xml"/><qti-item-body>'
    );
    const stimulus = `<qti-assessment-stimulus xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="S" title="S">
      <qti-stylesheet href="s.css" type="text/css"/><qti-stimulus-body><p>Passage</p></qti-stimulus-body></qti-assessment-stimulus>`;
    expect(validate(convertQti3toQti21(item, { resolveStimulus: () => stimulus }).xml)).toBe('');
  });

  test('export fixture package', async () => {
    if (!schemaReady) return;
    const fixtureDir = path.resolve(__dirname, '../../../qti-convert-export/tests/fixtures/sample-package');
    const files = new Map(
      readdirSync(fixtureDir)
        .filter(name => name.endsWith('.xml') && name !== 'imsmanifest.xml')
        .map(name => [name, readFileSync(path.join(fixtureDir, name), 'utf8')] as const)
    );
    for (const [name, xml] of (await convertPackageFilesToQti21(files)).files) {
      expect(validate(xml as string), name).toBe('');
    }
  });
});
