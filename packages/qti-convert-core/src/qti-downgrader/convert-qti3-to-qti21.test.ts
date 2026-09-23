import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import * as xml2js from 'xml2js';
import { describe, expect, test } from 'vitest';
import { convertQti2toQti3 } from '../qti-converter-node/converter/converter';
import {
  convertManifestToQti21,
  convertPackageFilesToQti21,
  convertPackageToQti21,
  convertQti3toQti21,
  QTI3_SHARED_VOCABULARY_CSS
} from './index';

const load = (xml: string) => cheerio.load(xml, { xmlMode: true, xml: true });

/** Compares element structure, text and attributes, ignoring namespace declarations and schema locations. */
async function xmlStructure(xml: string) {
  const parser = new xml2js.Parser({
    trim: true,
    normalize: true,
    attrNameProcessors: [name => name],
    attrValueProcessors: [value => value]
  });
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => !key.startsWith('xmlns') && key !== 'xsi:schemaLocation')
          .map(([key, value]) => [key, strip(value)])
      );
    }
    return node;
  };
  return strip(await parser.parseStringPromise(xml));
}

const qti3Choice = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd"
  identifier="choice" title="Choice" adaptive="false" time-dependent="false" xml:lang="en">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>A</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body>
    <div class="qti-layout-row" data-foo="bar" aria-label="row">
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1" data-max-selections-message="no">
        <qti-prompt>Kies één &amp; alleen één</qti-prompt>
        <qti-simple-choice identifier="A">A</qti-simple-choice>
        <qti-simple-choice identifier="B">B</qti-simple-choice>
      </qti-choice-interaction>
    </div>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><mi mathvariant="bold">x</mi></math>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>
  <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="correct" show-hide="show">
    <qti-content-body><p>Well done</p></qti-content-body>
  </qti-modal-feedback>
</qti-assessment-item>`;

describe('convertQti3toQti21', () => {
  test('renames elements and attributes and sets the QTI 2.1 namespace', () => {
    const { xml, warnings } = convertQti3toQti21(qti3Choice);
    const $ = load(xml);
    const root = $('assessmentItem');

    expect(xml).not.toMatch(/<qti-/);
    expect(xml).not.toMatch(/xml-model/);
    expect(xml).toContain('<prompt>Kies één &amp; alleen één</prompt>');
    expect(root.attr('xmlns')).toBe('http://www.imsglobal.org/xsd/imsqti_v2p1');
    expect(root.attr('xsi:schemaLocation')).toContain('imsqti_v2p1p2.xsd');
    expect(root.attr('timeDependent')).toBe('false');
    expect(root.attr('xml:lang')).toBe('en');
    expect($('responseDeclaration').attr('baseType')).toBe('identifier');
    expect($('choiceInteraction').attr('responseIdentifier')).toBe('RESPONSE');
    expect($('choiceInteraction').attr('maxChoices')).toBe('1');
    expect($('simpleChoice')).toHaveLength(2);
    expect($('responseProcessing').attr('template')).toBe(
      'http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct'
    );
    expect($('outcomeDeclaration').attr('externalScored')).toBeUndefined();
    expect(warnings.map(w => w.code)).toEqual(
      expect.arrayContaining(['removed-attribute', 'data-attributes-removed', 'shared-vocabulary-classes'])
    );
  });

  test('unwraps qti-content-body, strips data-* and aria-*, keeps MathML untouched', () => {
    const { xml, warnings } = convertQti3toQti21(qti3Choice);
    const $ = load(xml);
    expect($('modalFeedback > p').text()).toBe('Well done');
    expect($('modalFeedback').attr('showHide')).toBe('show');
    expect($('[data-foo]')).toHaveLength(0);
    expect($('[dataMaxSelectionsMessage]')).toHaveLength(0);
    // QTI 2.1 has no aria-*, role or dir
    expect($('div').attr('aria-label')).toBeUndefined();
    expect(warnings.map(w => w.code)).toContain('accessibility-attributes-removed');
    expect($('mi').attr('mathvariant')).toBe('bold');
  });

  test('converts an image-only gap text to gapImg', () => {
    const { xml, warnings } = convertQti3toQti21(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="g" adaptive="false" time-dependent="false">
      <qti-item-body><qti-gap-match-interaction response-identifier="RESPONSE">
        <qti-gap-text identifier="W1" match-max="1"><img src="a.png" alt="A"/></qti-gap-text>
        <qti-gap-text identifier="W2" match-max="1">text</qti-gap-text>
        <p>A <qti-gap identifier="G1"/></p>
      </qti-gap-match-interaction></qti-item-body></qti-assessment-item>`);
    const $ = load(xml);
    expect($('gapImg').attr('identifier')).toBe('W1');
    expect($('gapImg').attr('matchMax')).toBe('1');
    expect($('gapImg > object').attr('data')).toBe('a.png');
    expect($('gapText').text()).toBe('text');
    expect(warnings.map(w => w.code)).toContain('gap-text-to-gap-img');
  });

  test('adds the shared vocabulary stylesheet when asked', () => {
    const { xml, warnings } = convertQti3toQti21(qti3Choice, { sharedVocabularyStylesheetHref: '../qti3-shared-vocabulary.css' });
    const $ = load(xml);
    expect($('stylesheet').attr('href')).toBe('../qti3-shared-vocabulary.css');
    expect($('stylesheet').attr('type')).toBe('text/css');
    expect($('stylesheet').next()[0].name).toBe('itemBody');
    expect(warnings.map(w => w.code)).toContain('shared-vocabulary-stylesheet');
    expect(warnings.map(w => w.code)).not.toContain('shared-vocabulary-classes');

    // without qti-* classes there is nothing to style
    const plain = convertQti3toQti21(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="p" adaptive="false" time-dependent="false"><qti-item-body><p>x</p></qti-item-body></qti-assessment-item>`,
      { sharedVocabularyStylesheetHref: 'qti3-shared-vocabulary.css' }
    );
    expect(plain.xml).not.toContain('stylesheet');
  });

  test('maps irregular operator names', () => {
    const { xml } = convertQti3toQti21(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="x" adaptive="false" time-dependent="false">
      <qti-response-processing><qti-response-condition><qti-response-if>
        <qti-duration-lt><qti-variable identifier="duration"/><qti-base-value base-type="duration">10</qti-base-value></qti-duration-lt>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
      </qti-response-if></qti-response-condition></qti-response-processing></qti-assessment-item>`);
    expect(xml).toContain('<durationLT>');
    expect(xml).toContain('<setOutcomeValue identifier="SCORE">');
  });

  test('inlines a shared stimulus and rebases its assets', () => {
    const item = `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i1" adaptive="false" time-dependent="false">
      <qti-assessment-stimulus-ref identifier="S1" href="../stimuli/s1.xml" title="Passage"/>
      <qti-item-body><p>Question</p></qti-item-body>
    </qti-assessment-item>`;
    const stimulus = `<qti-assessment-stimulus xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="S1" title="Passage" xml:lang="nl">
      <qti-stylesheet href="style.css" type="text/css"/>
      <qti-stimulus-body><p>Passage text</p><img src="img/a.png" alt="a"/></qti-stimulus-body>
    </qti-assessment-stimulus>`;
    const hrefs: string[] = [];
    const { xml, warnings } = convertQti3toQti21(item, { resolveStimulus: href => (hrefs.push(href), stimulus) });
    const $ = load(xml);

    expect(hrefs).toEqual(['../stimuli/s1.xml']);
    expect($('assessmentStimulusRef')).toHaveLength(0);
    expect($('itemBody > div.qti-shared-stimulus > p').first().text()).toBe('Passage text');
    expect($('itemBody > div.qti-shared-stimulus').attr('xml:lang')).toBe('nl');
    expect($('img').attr('src')).toBe('../stimuli/img/a.png');
    expect($('stylesheet').attr('href')).toBe('../stimuli/style.css');
    expect($('stylesheet').next()[0].name).toBe('itemBody');
    expect(warnings.map(w => w.code)).toContain('stimulus-inlined');
  });

  test('removes an unresolvable stimulus ref with a warning', () => {
    const { xml, warnings } = convertQti3toQti21(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i1" adaptive="false" time-dependent="false">
      <qti-assessment-stimulus-ref identifier="S1" href="s1.xml"/><qti-item-body/></qti-assessment-item>`);
    expect(xml).not.toContain('stimulus');
    expect(warnings.map(w => w.code)).toContain('stimulus-unresolved');
  });

  test('converts HTML5 media and graphic interaction images to object', () => {
    const { xml, warnings } = convertQti3toQti21(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="m" adaptive="false" time-dependent="false">
      <qti-item-body>
        <audio controls="controls"><source src="media/a.mp3" type="audio/mpeg"/>Audio</audio>
        <video src="media/v.mp4" width="320"/>
        <figure><img src="x.png" alt="x"/><figcaption>X</figcaption></figure>
        <qti-select-point-interaction response-identifier="RESPONSE" max-choices="1">
          <img src="map.png" width="60" height="40" alt="Map"/>
        </qti-select-point-interaction>
      </qti-item-body></qti-assessment-item>`);
    const $ = load(xml);

    expect($('audio, video, figure, figcaption')).toHaveLength(0);
    expect($('object[data="media/a.mp3"]').attr('type')).toBe('audio/mpeg');
    expect($('object[data="media/a.mp3"]').text()).toBe('Audio');
    // object is inline in QTI 2.1, so directly in the item body it gets a block wrapper
    expect($('itemBody > div > object[data="media/a.mp3"]')).toHaveLength(1);
    expect($('object[data="media/v.mp4"]').attr('type')).toBe('video/mp4');
    expect($('object[data="media/v.mp4"]').attr('width')).toBe('320');
    const background = $('selectPointInteraction > object');
    expect(background.attr('data')).toBe('map.png');
    expect(background.attr('type')).toBe('image/png');
    expect(background.attr('width')).toBe('60');
    expect(background.text()).toBe('Map');
    expect(warnings.map(w => w.code)).toEqual(
      expect.arrayContaining(['media-to-object', 'img-to-object', 'html5-element'])
    );
  });

  test('wraps a PCI in a customInteraction', () => {
    const { xml, warnings } = convertQti3toQti21(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="p" adaptive="false" time-dependent="false">
      <qti-item-body>
        <qti-portable-custom-interaction response-identifier="RESPONSE" custom-interaction-type-identifier="likert" module="likert">
          <qti-interaction-markup><div>markup</div></qti-interaction-markup>
        </qti-portable-custom-interaction>
      </qti-item-body></qti-assessment-item>`);
    expect(xml).not.toMatch(/<qti-/);
    const $ = load(xml);
    expect($('customInteraction').attr('responseIdentifier')).toBe('RESPONSE');
    expect(xml).toContain('<pci:portableCustomInteraction');
    expect(xml).toContain('customInteractionTypeIdentifier="likert"');
    expect(xml).toContain('<pci:interactionMarkup>');
    expect(warnings.map(w => w.code)).toContain('pci');
  });

  test('leaves QTI 2.x input unchanged', () => {
    const input = `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="x"/>`;
    const { xml, warnings } = convertQti3toQti21(input);
    expect(xml).toBe(input);
    expect(warnings[0].code).toBe('already-qti2');
  });

  test('round-trips QTI 2.1 -> QTI 3 -> QTI 2.1', async () => {
    const qti21 = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p2.xsd"
  identifier="roundtrip" title="Round trip" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
    <correctResponse><value>W1 G1</value></correctResponse>
    <mapping defaultValue="0"><mapEntry mapKey="W1 G1" mappedValue="1"/></mapping>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <outcomeDeclaration identifier="FEEDBACK" cardinality="single" baseType="identifier"/>
  <itemBody>
    <p>Intro <textEntryInteraction responseIdentifier="RESPONSE2" expectedLength="10"/></p>
    <gapMatchInteraction responseIdentifier="RESPONSE" shuffle="false">
      <gapText identifier="W1" matchMax="1">word</gapText>
      <p>A <gap identifier="G1"/> sentence.</p>
    </gapMatchInteraction>
    <feedbackBlock outcomeIdentifier="FEEDBACK" identifier="fb" showHide="show"><p>Feedback</p></feedbackBlock>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/map_response"/>
</assessmentItem>`;
    const qti3 = await convertQti2toQti3(qti21);
    expect(qti3).toContain('<qti-gap-match-interaction');
    const { xml } = convertQti3toQti21(qti3);
    expect(await xmlStructure(xml)).toEqual(await xmlStructure(qti21));
  });
});

describe('convertManifestToQti21', () => {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_metadata_v3p0" identifier="M">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="test" type="imsqti_test_xmlv3p0" href="test.xml"><file href="test.xml"/><dependency identifierref="item"/></resource>
    <resource identifier="item" type="imsqti_item_xmlv3p0" href="items/item.xml">
      <file href="items/item.xml"/><dependency identifierref="stim"/>
    </resource>
    <resource identifier="stim" type="imsqti_stimulus_xmlv3p0" href="stimuli/s1.xml">
      <file href="stimuli/s1.xml"/><file href="stimuli/style.css"/><dependency identifierref="img"/>
    </resource>
    <resource identifier="img" type="webcontent" href="stimuli/img/a.png"><file href="stimuli/img/a.png"/></resource>
  </resources>
</manifest>`;

  test('converts namespaces, schema version and resource types', () => {
    const $ = load(convertManifestToQti21(manifest));
    expect($('manifest').attr('xmlns')).toBe('http://www.imsglobal.org/xsd/imscp_v1p1');
    expect($('manifest').attr('xmlns:imsqti')).toBe('http://www.imsglobal.org/xsd/imsqti_metadata_v2p1');
    expect($('schema').text()).toBe('QTIv2.1 Package');
    expect($('schemaversion').text()).toBe('1.0.0');
    expect($('resource#test, resource[identifier="test"]').attr('type')).toBe('imsqti_test_xmlv2p1');
    expect($('resource[identifier="item"]').attr('type')).toBe('imsqti_item_xmlv2p1');
    expect($('resource[identifier="stim"]').attr('type')).toBe('webcontent');
  });

  test('replaces inlined stimulus resources by their files and dependencies', () => {
    const $ = load(convertManifestToQti21(manifest, new Set(['stimuli/s1.xml'])));
    expect($('resource[identifier="stim"]')).toHaveLength(0);
    const item = $('resource[identifier="item"]');
    expect(item.find('dependency').toArray().map(d => d.attribs.identifierref)).toEqual(['img']);
    expect(item.find('file').toArray().map(f => f.attribs.href)).toEqual(['items/item.xml', 'stimuli/style.css']);
  });
});

describe('package conversion', () => {
  const fixture = path.resolve(__dirname, '../../../qti-convert-export/tests/fixtures/sample-package');
  const readFolder = (folder: string, prefix = ''): Map<string, Uint8Array> => {
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name);
      if (statSync(full).isDirectory()) {
        for (const [p, c] of readFolder(full, `${prefix}${name}/`)) files.set(p, c);
      } else {
        files.set(`${prefix}${name}`, readFileSync(full));
      }
    }
    return files;
  };

  test('converts every QTI file of the sample package', async () => {
    const input = readFolder(fixture);
    const { files } = await convertPackageFilesToQti21(input);
    expect([...files.keys()].sort()).toEqual([...input.keys()].sort());

    for (const [filePath, content] of files) {
      if (!filePath.endsWith('.xml')) {
        expect(content).toBe(input.get(filePath));
        continue;
      }
      const xml = content as string;
      expect(xml, filePath).not.toMatch(/<qti-/);
      if (filePath === 'imsmanifest.xml') {
        expect(xml).toContain('imsqti_item_xmlv2p1');
        expect(xml).not.toContain('v3p0');
      } else {
        expect(load(xml).root().children().first().attr('xmlns'), filePath).toBe(
          'http://www.imsglobal.org/xsd/imsqti_v2p1'
        );
      }
    }
    const test = load(files.get('AssessmentTest.xml') as string);
    expect(test('assessmentTest > testPart > assessmentSection > assessmentItemRef')).toHaveLength(9);
    expect(test('testPart').attr('navigationMode')).toBe('linear');
  });

  test('inlines stimuli, drops the stimulus file and round-trips through a zip', async () => {
    const zip = new JSZip();
    zip.file(
      'imsmanifest.xml',
      `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="M"><resources>
        <resource identifier="item" type="imsqti_item_xmlv3p0" href="items/item.xml"><file href="items/item.xml"/><dependency identifierref="stim"/></resource>
        <resource identifier="stim" type="imsqti_stimulus_xmlv3p0" href="stimuli/s1.xml"><file href="stimuli/s1.xml"/></resource>
      </resources></manifest>`
    );
    zip.file(
      'items/item.xml',
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="item" adaptive="false" time-dependent="false">
        <qti-assessment-stimulus-ref identifier="stim" href="../stimuli/s1.xml"/><qti-item-body><p>Q</p></qti-item-body></qti-assessment-item>`
    );
    zip.file(
      'stimuli/s1.xml',
      `<qti-assessment-stimulus xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="stim" title="S"><qti-stimulus-body><p>Passage</p></qti-stimulus-body></qti-assessment-stimulus>`
    );

    const { zip: output, warnings } = await convertPackageToQti21(await zip.generateAsync({ type: 'uint8array' }));
    const result = await JSZip.loadAsync(output);

    expect(Object.keys(result.files).filter(f => !result.files[f].dir).sort()).toEqual([
      'imsmanifest.xml',
      'items/item.xml'
    ]);
    expect(await result.file('items/item.xml')!.async('string')).toContain(
      '<div class="qti-shared-stimulus"><p>Passage</p></div>'
    );
    const manifest = await result.file('imsmanifest.xml')!.async('string');
    expect(manifest).not.toContain('stim');
    expect(warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'stimulus-inlined', file: 'items/item.xml' })])
    );
  });

  test('uses the conversion callbacks when given', async () => {
    const files = new Map<string, string>([
      ['imsmanifest.xml', '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="M"/>'],
      ['item.xml', '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" adaptive="false" time-dependent="false"/>'],
      ['test.xml', '<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="t"/>']
    ]);
    const seen: string[] = [];
    const { files: converted } = await convertPackageFilesToQti21(files, {
      convertItem: async (xml, context) => {
        seen.push(`item:${context.path}`);
        const result = convertQti3toQti21(xml, { filePath: context.path });
        return { ...result, xml: result.xml.replace('identifier="i"', 'identifier="custom"') };
      },
      convertAssessment: (xml, context) => (seen.push(`test:${context.path}`), convertQti3toQti21(xml)),
      convertManifest: async xml => (seen.push('manifest'), xml.replace('identifier="M"', 'identifier="M2"'))
    });
    expect(seen).toEqual(['item:item.xml', 'test:test.xml', 'manifest']);
    expect(converted.get('item.xml')).toContain('<assessmentItem');
    expect(converted.get('item.xml')).toContain('identifier="custom"');
    expect(converted.get('imsmanifest.xml')).toContain('identifier="M2"');
  });

  test('the shared vocabulary stylesheet has the 1EdTech utilities, a row-relative grid and no page rules', () => {
    const css = QTI3_SHARED_VOCABULARY_CSS;
    // 1EdTech utility classes
    for (const rule of ['.qti-display-flex {', '.qti-margin-t-4 {', '.qti-align-center {', '.qti-list-style-type-lower-alpha {', '.qti-underline {']) {
      expect(css, rule).toContain(rule);
    }
    // no rules for the page itself
    expect(css).not.toMatch(/^\s*(body|html)\s*\{/m);
    expect(css).not.toMatch(/^\s*\.container(-fluid)?\b[^{]*\{/m);
    // the grid is relative to the row
    expect(css).toContain('.qti-layout-col6 { width:48.93617021276595%; }');
    expect(css).not.toMatch(/qti-layout-col\d+\s*\{\s*width:\d+px/);
    // defaults for the 1EdTech custom properties and the missing-comma fix
    expect(css).toContain('--table-border-color:');
    expect(css).toContain('.qti-float-clear-both { clear: both; }');
  });

  test('adds qti3-shared-vocabulary.css to the package for items that use shared vocabulary classes', async () => {
    const item = (id: string, body: string) =>
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${id}" adaptive="false" time-dependent="false"><qti-item-body>${body}</qti-item-body></qti-assessment-item>`;
    const files = new Map<string, string>([
      [
        'imsmanifest.xml',
        `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="M"><resources>
          <resource identifier="A" type="imsqti_item_xmlv3p0" href="items/a.xml"><file href="items/a.xml"/></resource>
          <resource identifier="B" type="imsqti_item_xmlv3p0" href="items/b.xml"><file href="items/b.xml"/></resource>
        </resources></manifest>`
      ],
      ['items/a.xml', item('A', '<div class="qti-layout-row"><div class="qti-layout-col6"><p>x</p></div></div>')],
      ['items/b.xml', item('B', '<p>y</p>')]
    ]);

    const { files: converted } = await convertPackageFilesToQti21(files);
    expect(converted.get('qti3-shared-vocabulary.css')).toBe(QTI3_SHARED_VOCABULARY_CSS);
    expect(load(converted.get('items/a.xml') as string)('stylesheet').attr('href')).toBe('../qti3-shared-vocabulary.css');
    expect(converted.get('items/b.xml')).not.toContain('stylesheet');
    const $manifest = load(converted.get('imsmanifest.xml') as string);
    const css = $manifest('resource[href="qti3-shared-vocabulary.css"]');
    expect(css.attr('type')).toBe('webcontent');
    expect(css.find('file').attr('href')).toBe('qti3-shared-vocabulary.css');
    expect($manifest('resource[identifier="A"] dependency').attr('identifierref')).toBe(css.attr('identifier'));
    expect($manifest('resource[identifier="B"] dependency')).toHaveLength(0);

    // the stylesheet goes next to the manifest (the package root), also when that is a folder in the zip
    const nested = new Map([...files].map(([path, content]) => [`pkg/${path}`, content]));
    const { files: nestedConverted } = await convertPackageFilesToQti21(nested);
    expect(nestedConverted.has('pkg/qti3-shared-vocabulary.css')).toBe(true);
    expect(load(nestedConverted.get('pkg/items/a.xml') as string)('stylesheet').attr('href')).toBe('../qti3-shared-vocabulary.css');
    expect(load(nestedConverted.get('pkg/imsmanifest.xml') as string)('resource[href="qti3-shared-vocabulary.css"]')).toHaveLength(1);

    const { files: withoutCss } = await convertPackageFilesToQti21(files, { injectSharedVocabularyStylesheet: false });
    expect(withoutCss.has('qti3-shared-vocabulary.css')).toBe(false);
    expect(withoutCss.get('items/a.xml')).not.toContain('stylesheet');
  });
});
