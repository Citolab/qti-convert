import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, test } from 'vitest';
import { hasXmllint, prepareQtiSchema, QTI21_XSD_URL, validateXml } from '../test-utils/xsd-validator';
import { convertPackageFilesToQti21, convertQti3toQti21 } from './index';

// Validates the QTI 2.1 output against the official IMS XSD (skipped without xmllint or network).
let schema: string | null = null;
const validate = (xml: string) => validateXml(xml, schema!);

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
  beforeAll(async () => {
    schema = await prepareQtiSchema('qti21', QTI21_XSD_URL);
  });

  test.each(Object.entries(cases))('%s', (_name, input) => {
    if (!schema) return;
    expect(validate(convertQti3toQti21(input, { sharedVocabularyStylesheetHref: 'qti3p0.css' }).xml)).toBe('');
  });

  test('inlined shared stimulus', () => {
    if (!schema) return;
    const item = qti3(choice).replace(
      '<qti-item-body>',
      '<qti-assessment-stimulus-ref identifier="S" href="s.xml"/><qti-item-body>'
    );
    const stimulus = `<qti-assessment-stimulus xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="S" title="S">
      <qti-stylesheet href="s.css" type="text/css"/><qti-stimulus-body><p>Passage</p></qti-stimulus-body></qti-assessment-stimulus>`;
    expect(validate(convertQti3toQti21(item, { resolveStimulus: () => stimulus }).xml)).toBe('');
  });

  test('export fixture package', async () => {
    if (!schema) return;
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
