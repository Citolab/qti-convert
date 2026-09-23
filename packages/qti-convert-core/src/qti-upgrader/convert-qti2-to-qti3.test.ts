import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import JSZip from 'jszip';
import { beforeAll, describe, expect, test } from 'vitest';
import { convertPackageFilesToQti21 } from '../qti-downgrader';
import { upgradeQti2toQti3 } from './convert-qti2-to-qti3';

// The original XSLT, run with Saxon-JS, is the reference implementation for the parity tests.
import sef from '../../../../node_modules/qti30upgrader/qti2xTo30.sef.json' assert { type: 'json' };

const xsltUpgrade = async (xml: string): Promise<string> => {
  const result = await globalThis.SaxonJS.transform(
    { stylesheetText: JSON.stringify(sef), sourceType: 'xml', sourceText: xml, destination: 'serialized' },
    'async'
  );
  return result.principalResult;
};

type Canonical = { name: string; attrs: Record<string, string>; children: (Canonical | string)[] } | string;

/** Namespace-aware canonical form: expanded names, attributes without namespace declarations, trimmed text. */
const canonical = (xml: string): Canonical[] => {
  const $ = cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: true } });
  const ns = (el: Element, prefix: string): string => {
    if (prefix === 'xml') return 'xml';
    const attr = prefix ? `xmlns:${prefix}` : 'xmlns';
    for (let n: any = el; n && n.type === 'tag'; n = n.parent) if (attr in n.attribs) return n.attribs[attr];
    return '';
  };
  const walk = (node: AnyNode): Canonical | null => {
    // CDATA and escaped text are equivalent (Saxon serializes CDATA sections as escaped text)
    const text = node.type === 'text' ? node.data : node.type === 'cdata' ? ((node.children[0] as any)?.data ?? '') : null;
    if (text !== null) return text.trim() ? text.replace(/\s+/g, ' ').trim() : null;
    if (node.type === 'directive' && !/^\?xml\s/.test(node.data)) return node.data.replace(/\s+/g, ' ');
    if (node.type === 'comment') return `<!--${node.data}-->`;
    if (node.type !== 'tag') return null;
    const [prefix, local] = node.name.includes(':') ? node.name.split(':') : ['', node.name];
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attribs)) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      const [p, l] = name.includes(':') ? name.split(':') : ['', name];
      attrs[p ? `{${ns(node, p)}}${l}` : l] = value;
    }
    return { name: `{${ns(node, prefix)}}${local}`, attrs, children: node.children.map(walk).filter(c => c !== null) };
  };
  return $.root().contents().toArray().map(walk).filter(c => c !== null);
};

const kitchenSinkItem = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="http://www.imsglobal.org/xsd/qti/qtiv2p2/imsqti_v2p2.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>
<!-- leading comment -->
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" xmlns:m="http://www.w3.org/1998/Math/MathML"
  xmlns:ssml="http://www.w3.org/2010/10/synthesis" xmlns:apip="http://www.imsglobal.org/xsd/apip/apipv1p0/imsapip_qtiv1p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:unused="urn:unused"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p2 http://www.imsglobal.org/xsd/qti/qtiv2p2/imsqti_v2p2.xsd"
  identifier="sink" title="Kitchen &amp; sink" adaptive="false" timeDependent="false" xml:lang="nl-NL" toolName="x">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>A</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float" normalMaximum="1"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <templateDeclaration identifier="T" cardinality="single" baseType="integer" paramVariable="false" mathVariable="true"/>
  <templateProcessing><setTemplateValue identifier="T"><randomInteger min="1" max="9"/></setTemplateValue></templateProcessing>
  <stylesheet href="style.css" type="text/css"/>
  <itemBody class="body" data-custom="yes">
    <?custom-pi keep me?>
    <p aria-label="intro" data-fooBar="x">Tekst met één <b>vet</b> &amp; <m:math display="inline"><m:mi mathvariant="bold">x</m:mi><m:mo>+</m:mo></m:math> <ssml:sub alias="sub">s</ssml:sub></p>
    <object type="image/png" data="img/a.png" width="10" height="20">Alt tekst</object>
    <table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1" minChoices="0">
      <prompt>Kies</prompt>
      <simpleChoice identifier="A" fixed="true">A <printedVariable identifier="T"/></simpleChoice>
      <simpleChoice identifier="B" showHide="show" templateIdentifier="T">B</simpleChoice>
    </choiceInteraction>
    <feedbackInline outcomeIdentifier="FB" identifier="A" showHide="show">inline</feedbackInline>
    <rubricBlock view="scorer"><stylesheet href="r.css" type="text/css"/><p>rubric</p></rubricBlock>
    <templateBlock templateIdentifier="T" identifier="1" showHide="show"><p>template</p></templateBlock>
    <feedbackBlock outcomeIdentifier="FB" identifier="B" showHide="hide"><p>block</p></feedbackBlock>
    <apip:apipAccessibility><apip:companionMaterialsInfo/></apip:apipAccessibility>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>
  <modalFeedback outcomeIdentifier="FB" identifier="C" showHide="show" title="Modal">modal <b>text</b></modalFeedback>
</assessmentItem>`;

const kitchenSinkTest = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="T1" title="Test" toolName="x">
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <timeLimits maxTime="600" allowLateSubmission="false"/>
  <testPart identifier="P1" navigationMode="nonlinear" submissionMode="simultaneous">
    <itemSessionControl maxAttempts="1" showFeedback="false" allowReview="true"/>
    <assessmentSection identifier="S1" title="Section" visible="true">
      <selection select="1" withReplacement="false"/>
      <ordering shuffle="true"/>
      <rubricBlock view="candidate"><p>Instructions</p></rubricBlock>
      <assessmentItemRef identifier="I1" href="items/i1.xml" category="c1"><weight identifier="W" value="2"/></assessmentItemRef>
      <assessmentSectionRef identifier="S2" href="s2.xml"/>
    </assessmentSection>
    <branchRule target="EXIT_TEST"><gte><variable identifier="SCORE"/><baseValue baseType="float">1</baseValue></gte></branchRule>
  </testPart>
  <outcomeProcessing>
    <setOutcomeValue identifier="SCORE"><sum><testVariables variableIdentifier="SCORE" weightIdentifier="W"/></sum></setOutcomeValue>
    <outcomeCondition><outcomeIf><lt><variable identifier="SCORE"/><baseValue baseType="float">0</baseValue></lt>
      <setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue></outcomeIf>
      <outcomeElse><setOutcomeValue identifier="SCORE"><numberCorrect/></setOutcomeValue></outcomeElse></outcomeCondition>
  </outcomeProcessing>
</assessmentTest>`;

const readZipXml = async (file: string) => {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const entries = Object.entries(zip.files).filter(([name]) => name.endsWith('.xml') && !name.endsWith('imsmanifest.xml'));
  return Promise.all(entries.map(async ([name, entry]) => [name, await entry.async('string')] as const));
};

const corpus = async (): Promise<(readonly [string, string])[]> => {
  const packagesDir = path.resolve(__dirname, '../../..');
  const taoZips = readdirSync(path.join(packagesDir, 'qti-convert-tao-pci/storybook-assets'))
    .filter(name => name.endsWith('.zip'))
    .map(name => path.join(packagesDir, 'qti-convert-tao-pci/storybook-assets', name));
  const tao = (await Promise.all(taoZips.map(readZipXml))).flat();

  // Realistic QTI 2.1 input: the QTI 3 export fixtures, downgraded
  const fixtureDir = path.join(packagesDir, 'qti-convert-export/tests/fixtures/sample-package');
  const fixtureFiles = new Map(
    readdirSync(fixtureDir)
      .filter(name => name.endsWith('.xml') && name !== 'imsmanifest.xml')
      .map(name => [name, readFileSync(path.join(fixtureDir, name), 'utf8')] as const)
  );
  const downgraded = [...convertPackageFilesToQti21(fixtureFiles).files].map(
    ([name, content]) => [`downgraded/${name}`, content as string] as const
  );

  return [['kitchen-sink-item', kitchenSinkItem], ['kitchen-sink-test', kitchenSinkTest], ...tao, ...downgraded];
};

describe('upgradeQti2toQti3 parity with qti2xTo30.xsl', async () => {
  beforeAll(async () => {
    const saxonModule = await import('saxon-js');
    globalThis.SaxonJS = saxonModule.default || saxonModule;
  });
  const inputs = await corpus();

  test('corpus is not empty', () => {
    expect(inputs.length).toBeGreaterThan(10);
  });

  test.each(inputs)('%s', async (_name, xml) => {
    const expected = canonical(await xsltUpgrade(xml));
    const actual = canonical(upgradeQti2toQti3(xml));
    expect(actual).toEqual(expected);
  });
});

describe('upgradeQti2toQti3 fixes compared to the XSLT', () => {
  const upgrade = (body: string) =>
    cheerio.load(
      upgradeQti2toQti3(
        `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="x" adaptive="false" timeDependent="false">${body}</assessmentItem>`
      ),
      { xml: true }
    );

  test('converts elements missing from the XSLT lists', () => {
    const $ = upgrade(
      '<responseProcessing><responseCondition><responseIf><durationLT><variable identifier="duration"/><baseValue baseType="duration">1</baseValue></durationLT><exitResponse/></responseIf></responseCondition></responseProcessing>'
    );
    expect($('qti-duration-lt')).toHaveLength(1);

    const test = cheerio.load(
      upgradeQti2toQti3(`<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="t" title="t">
        <testPart identifier="p" navigationMode="linear" submissionMode="individual"><assessmentSection identifier="s" title="s" visible="true">
          <assessmentItemRef identifier="i" href="i.xml"><variableMapping sourceIdentifier="A" targetIdentifier="B"/><templateDefault templateIdentifier="T"><baseValue baseType="integer">1</baseValue></templateDefault></assessmentItemRef>
        </assessmentSection></testPart>
        <outcomeProcessing><outcomeCondition><outcomeIf><isNull><variable identifier="X"/></isNull><exitTest/></outcomeIf><outcomeElseIf><isNull><variable identifier="Y"/></isNull><exitTest/></outcomeElseIf></outcomeCondition></outcomeProcessing>
        <testFeedback access="atEnd" outcomeIdentifier="F" showHide="show" identifier="f"><p>Done</p></testFeedback>
      </assessmentTest>`),
      { xml: true }
    );
    for (const name of ['qti-variable-mapping', 'qti-template-default', 'qti-outcome-else-if', 'qti-exit-test']) {
      expect(test(name).length, name).toBeGreaterThan(0);
    }
    expect(test('qti-test-feedback > qti-content-body > p').text()).toBe('Done');
  });

  test('converts a stimulus body', () => {
    const $ = cheerio.load(
      upgradeQti2toQti3(
        `<assessmentStimulus xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" identifier="s" title="s"><stimulusBody><p>Text</p></stimulusBody></assessmentStimulus>`
      ),
      { xml: true }
    );
    expect($('qti-assessment-stimulus > qti-stimulus-body > p').text()).toBe('Text');
  });

  test('keeps the children of a video object once and inline SVG in its namespace', () => {
    const $ = upgrade(
      '<itemBody><object type="video/mp4" data="v.mp4" width="100">fallback</object><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle stroke-width="2" r="4"/></svg></itemBody>'
    );
    expect($('video').text()).toBe('fallback');
    expect($('video > source').attr('src')).toBe('v.mp4');
    expect($('svg').attr('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect($('circle').attr('stroke-width')).toBe('2');
  });

  test('converts prefixed QTI 2 elements', () => {
    const xml = upgradeQti2toQti3(
      `<qti:assessmentItem xmlns:qti="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="x" adaptive="false" timeDependent="false"><qti:itemBody><qti:p>x</qti:p></qti:itemBody></qti:assessmentItem>`
    );
    expect(xml).toContain('<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"');
    expect(xml).toContain('<qti-item-body><p>x</p></qti-item-body>');
  });
});
