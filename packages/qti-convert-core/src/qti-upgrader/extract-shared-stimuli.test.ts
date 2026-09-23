import * as cheerio from 'cheerio';
import { beforeAll, describe, expect, test } from 'vitest';
import { hasXmllint, prepareQtiSchema, QTI3_XSD_URL, validateXml } from '../test-utils/xsd-validator';
import { extractSharedStimuli, type SharedStimulusPackageFiles } from './extract-shared-stimuli';

const load = (xml: string) => cheerio.load(xml, { xml: true });

const passage = (imgSrc: string, text = 'De Waddenzee is een ondiepe zee tussen de Waddeneilanden en het vasteland.') => `
    <h2>De Waddenzee</h2>
    <p>${text} Twee keer per dag valt een groot deel droog. Dan kun je over de bodem lopen, maar alleen met een gids, want het water komt snel terug.</p>
    <p><img src="${imgSrc}" alt="Wad"/></p>`;

const choice = (id: string) => `
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-prompt>Vraag ${id}</qti-prompt>
      <qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>`;

const item = (id: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${id}" title="${id}" adaptive="false" time-dependent="false" xml:lang="nl-NL">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>${body}
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>
</qti-assessment-item>`;

const columns = (left: string, right: string) => `
    <div class="qti-layout-row">
      <div class="qti-layout-col6">${left}</div>
      <div class="qti-layout-col6">${right}</div>
    </div>`;

const manifest = (items: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="M">
  <resources>
${items.map(path => `    <resource identifier="${path.replace(/\W/g, '_')}" type="imsqti_item_xmlv3p0" href="${path}"><file href="${path}"/></resource>`).join('\n')}
  </resources>
</manifest>`;

const buildPackage = (): SharedStimulusPackageFiles => {
  const items: Record<string, string> = {
    'items/i1.xml': item('i1', `\n    <p>Lees de tekst en beantwoord de vraag.</p>${passage('../img/wad.png')}${choice('1')}`),
    'items/i2.xml': item('i2', `${passage('../img/wad.png')}${choice('2')}`),
    'items/sub/i3.xml': item('i3', `${passage('../../img/wad.png')}${choice('3')}`),
    // near-duplicate: one word differs
    'items/i4.xml': item('i4', `${passage('../img/wad.png', 'De Waddenzee is een ondiepe zee tussen de eilanden en het vasteland.')}${choice('4')}`),
    // nothing shared
    'items/i5.xml': item('i5', `<p>Hoeveel is 3 + 4?</p>${choice('5')}`),
    // passage in the left column of a two-column layout
    'items/i6.xml': item('i6', columns('<p>Een andere tekst over vogels die in de winter naar het zuiden trekken en in het voorjaar terugkomen om te broeden in de duinen en de polders. Sommige soorten vliegen duizenden kilometers.</p>', choice('6'))),
    'items/i7.xml': item('i7', columns('<p>Een andere tekst over vogels die in de winter naar het zuiden trekken en in het voorjaar terugkomen om te broeden in de duinen en de polders. Sommige soorten vliegen duizenden kilometers.</p>', choice('7'))),
    // only a short shared instruction: not worth a stimulus
    'items/i8.xml': item('i8', `<p>Kies het juiste antwoord.</p>${choice('8')}`),
    'items/i9.xml': item('i9', `<p>Kies het juiste antwoord.</p>${choice('9')}`)
  };
  const files: SharedStimulusPackageFiles = new Map();
  files.set('imsmanifest.xml', { type: 'manifest', content: manifest(Object.keys(items)) });
  for (const [path, content] of Object.entries(items)) files.set(path, { type: 'item', content });
  files.set('img/wad.png', { type: 'other', content: new Uint8Array([1, 2, 3]) });
  return files;
};

describe('extractSharedStimuli', () => {
  const input = buildPackage();
  const { files, report } = extractSharedStimuli(input);
  const xml = (path: string) => files.get(path)!.content as string;
  const passageStimulus = report.stimuli.find(s => s.title === 'De Waddenzee')!;
  const columnStimulus = report.stimuli.find(s => s !== passageStimulus)!;

  test('extracts one stimulus per shared passage', () => {
    expect(report.stimuli).toHaveLength(2);
    expect(passageStimulus.items.sort()).toEqual(['items/i1.xml', 'items/i2.xml', 'items/sub/i3.xml']);
    expect(columnStimulus.items.sort()).toEqual(['items/i6.xml', 'items/i7.xml']);
    expect(passageStimulus.path).toMatch(/^stimuli\/STIM_[0-9a-f]{8}\.xml$/);
  });

  test('creates the stimulus file with rebased assets', () => {
    const $ = load(xml(passageStimulus.path));
    const root = $('qti-assessment-stimulus');
    expect(root.attr('xmlns')).toBe('http://www.imsglobal.org/xsd/imsqtiasi_v3p0');
    expect(root.attr('identifier')).toBe(passageStimulus.identifier);
    expect(root.attr('xml:lang')).toBe('nl-NL');
    expect($('qti-stimulus-body > h2').text()).toBe('De Waddenzee');
    expect($('qti-stimulus-body > p > img').attr('src')).toBe('../img/wad.png');
  });

  test('replaces the passage in the items by a stimulus ref', () => {
    const $i1 = load(xml('items/i1.xml'));
    const ref = $i1('qti-assessment-stimulus-ref');
    expect(ref.attr('identifier')).toBe(passageStimulus.identifier);
    expect(ref.attr('href')).toBe(`../${passageStimulus.path}`);
    expect(ref.next()[0].name).toBe('qti-item-body');
    expect($i1('qti-item-body h2, qti-item-body img')).toHaveLength(0);
    // the item's own intro stays
    expect($i1('qti-item-body > p').text()).toBe('Lees de tekst en beantwoord de vraag.');
    expect($i1('qti-choice-interaction')).toHaveLength(1);

    expect(load(xml('items/sub/i3.xml'))('qti-assessment-stimulus-ref').attr('href')).toBe(`../../${passageStimulus.path}`);
  });

  test('removes an emptied layout column and unwraps a single remaining column', () => {
    const $ = load(xml('items/i6.xml'));
    expect($('.qti-layout-row, .qti-layout-col6')).toHaveLength(0);
    expect($('qti-item-body > qti-choice-interaction')).toHaveLength(1);
    expect($('qti-assessment-stimulus-ref').attr('identifier')).toBe(columnStimulus.identifier);
  });

  test('registers the stimuli in the manifest', () => {
    const $ = load(xml('imsmanifest.xml'));
    const resource = $(`resource[identifier="${passageStimulus.identifier}"]`);
    expect(resource.attr('type')).toBe('imsqti_stimulus_xmlv3p0');
    expect(resource.find('file').toArray().map(f => f.attribs.href)).toEqual([passageStimulus.path, 'img/wad.png']);
    for (const id of ['items_i1_xml', 'items_i2_xml', 'items_sub_i3_xml']) {
      expect($(`resource[identifier="${id}"] > dependency`).attr('identifierref'), id).toBe(passageStimulus.identifier);
    }
    expect($('resource[identifier="items_i4_xml"] > dependency')).toHaveLength(0);
  });

  test('only reports near-duplicates and leaves other items untouched', () => {
    expect(report.nearDuplicates.map(d => d.items.sort())).toEqual(
      expect.arrayContaining([['items/i1.xml', 'items/i4.xml'], ['items/i2.xml', 'items/i4.xml']])
    );
    expect(report.nearDuplicates.every(d => d.items.includes('items/i4.xml'))).toBe(true);
    for (const path of ['items/i4.xml', 'items/i5.xml', 'items/i8.xml', 'items/i9.xml']) {
      expect(files.get(path)!.content, path).toBe(input.get(path)!.content);
    }
    expect(files.get('img/wad.png')).toBe(input.get('img/wad.png'));
  });

  test('does not turn a shared logo into a stimulus', () => {
    const logo = '<p><img src="logo.png" alt="Logo"/></p>';
    const result = extractSharedStimuli(
      new Map([
        ['a.xml', { type: 'item' as const, content: item('a', `${logo}${choice('a')}`) }],
        ['b.xml', { type: 'item' as const, content: item('b', `${logo}${choice('b')}`) }]
      ])
    );
    expect(result.report.stimuli).toEqual([]);
  });

  test('does nothing when there is no shared content', () => {
    const single = new Map([...input].filter(([path]) => path === 'items/i5.xml' || path === 'imsmanifest.xml'));
    const result = extractSharedStimuli(single);
    expect(result.report).toEqual({ stimuli: [], nearDuplicates: [] });
    expect([...result.files]).toEqual([...single]);
  });

  describe.skipIf(!hasXmllint)('output validates against the QTI 3 XSD', () => {
    let schema: string | null = null;
    beforeAll(async () => {
      schema = await prepareQtiSchema('qti3', QTI3_XSD_URL);
    });
    test.each(['items/i1.xml', 'items/sub/i3.xml', 'items/i6.xml'])('%s', path => {
      if (!schema) return;
      expect(validateXml(xml(path), schema)).toBe('');
    });
    test('stimulus files', () => {
      if (!schema) return;
      for (const stimulus of report.stimuli) expect(validateXml(xml(stimulus.path), schema), stimulus.path).toBe('');
    });
  });
});
