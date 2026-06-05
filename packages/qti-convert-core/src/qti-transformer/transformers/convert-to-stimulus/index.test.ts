import { expect, test } from 'vitest';
import * as cheerio from 'cheerio';

import { convertToStimulus } from '.';

const xml = String.raw;

const item = (identifier: string, leftXml: string, rightXml: string) => xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${identifier}">
  <qti-item-body>
    <div class="content">
      <div class="qti-layout-row">
        <div class="qti-layout-col6">${leftXml}</div>
        <div class="qti-layout-col6">${rightXml}</div>
      </div>
    </div>
  </qti-item-body>
</qti-assessment-item>`;

const load = (s: string) => cheerio.load(s, { xmlMode: true, xml: true });

test('extracts identical left columns into a shared stimulus and rewrites items', async () => {
  const items = new Map([
    ['depitems/a.xml', item('ITM-A', '<p>Shared source text</p>', '<div id="question"><p>Q A</p></div>')],
    ['depitems/b.xml', item('ITM-B', '<p>Shared source text</p>', '<div id="question"><p>Q B</p></div>')]
  ]);

  const result = await convertToStimulus({ items });

  // One stimulus file produced under ref/
  expect(result.stimuli.size).toBe(1);
  const [stimulusPath, stimulusXml] = [...result.stimuli.entries()][0];
  expect(stimulusPath).toMatch(/^ref\/stimulus-.*\.xml$/);
  const $s = load(stimulusXml);
  expect($s('qti-assessment-stimulus').length).toBe(1);
  expect($s('qti-stimulus-body').text()).toContain('Shared source text');
  const stimulusId = $s('qti-assessment-stimulus').attr('identifier')!;

  // Both items rewritten: stimulus-ref + in-body shared-stimulus div, right column preserved
  for (const path of ['depitems/a.xml', 'depitems/b.xml']) {
    const $i = load(result.items.get(path)!);
    const ref = $i('qti-assessment-stimulus-ref');
    expect(ref.attr('identifier')).toBe(stimulusId);
    expect(ref.attr('href')).toBe(`../${stimulusPath}`);
    expect($i('div.qti-shared-stimulus').attr('data-stimulus-idref')).toBe(stimulusId);
    // left column no longer holds the raw source; right column question intact
    expect($i('#question').length).toBe(1);
    expect($i('qti-item-body').text()).not.toContain('Shared source text');
  }
});

test('does not extract when left columns differ', async () => {
  const items = new Map([
    ['a.xml', item('ITM-A', '<p>Source A</p>', '<div id="question"><p>Q A</p></div>')],
    ['b.xml', item('ITM-B', '<p>Source B</p>', '<div id="question"><p>Q B</p></div>')]
  ]);

  const result = await convertToStimulus({ items });

  expect(result.stimuli.size).toBe(0);
  expect(result.items.get('a.xml')).toBe(items.get('a.xml'));
  expect(result.items.get('b.xml')).toBe(items.get('b.xml'));
});

test('ignores whitespace differences when comparing left columns', async () => {
  const items = new Map([
    ['a.xml', item('ITM-A', '<p>Shared</p>', '<div id="question"><p>Q A</p></div>')],
    ['b.xml', item('ITM-B', '<p>Shared</p>   \n  ', '<div id="question"><p>Q B</p></div>')]
  ]);

  const result = await convertToStimulus({ items });
  expect(result.stimuli.size).toBe(1);
});

test('skips items that already reference a stimulus', async () => {
  const withRef = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="ITM-A">
  <qti-assessment-stimulus-ref identifier="RES-existing" href="../ref/existing.xml" />
  <qti-item-body>
    <div class="qti-layout-row">
      <div class="qti-layout-col6"><p>Shared source text</p></div>
      <div class="qti-layout-col6"><div id="question"><p>Q A</p></div></div>
    </div>
  </qti-item-body>
</qti-assessment-item>`;
  const items = new Map([
    ['a.xml', withRef],
    ['b.xml', item('ITM-B', '<p>Shared source text</p>', '<div id="question"><p>Q B</p></div>')]
  ]);

  const result = await convertToStimulus({ items });

  // Only one item has the shared content available; below minItems -> no extraction
  expect(result.stimuli.size).toBe(0);
  expect(result.items.get('a.xml')).toBe(withRef);
});

test('updates the manifest with stimulus resource and item dependencies', async () => {
  const items = new Map([
    ['depitems/a.xml', item('ITM-A', '<p>Shared source text</p>', '<div id="question"><p>Q A</p></div>')],
    ['depitems/b.xml', item('ITM-B', '<p>Shared source text</p>', '<div id="question"><p>Q B</p></div>')]
  ]);
  const manifest = {
    path: 'imsmanifest.xml',
    xml: xml`<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="MANIFEST">
  <resources>
    <resource identifier="ITM-A" type="imsqti_item_xmlv3p0" href="depitems/a.xml"><file href="depitems/a.xml" /></resource>
    <resource identifier="ITM-B" type="imsqti_item_xmlv3p0" href="depitems/b.xml"><file href="depitems/b.xml" /></resource>
  </resources>
</manifest>`
  };

  const result = await convertToStimulus({ items, manifest });

  const $ = load(result.manifest!.xml);
  const stimulusResource = $('resource[type="imsqti_stimulus_xmlv3p0"]');
  expect(stimulusResource.length).toBe(1);
  const stimulusId = stimulusResource.attr('identifier')!;
  expect(stimulusResource.attr('href')).toMatch(/^ref\/stimulus-.*\.xml$/);

  for (const id of ['ITM-A', 'ITM-B']) {
    const dep = $(`resource[identifier="${id}"] dependency`);
    expect(dep.attr('identifierref')).toBe(stimulusId);
  }
});
