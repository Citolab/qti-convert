import { expect, test } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

import { qtiTransform } from '../../qti-transform';
import type { WrapStimulusInSectionResolver } from '.';

const xml = String.raw;

type MetaMap = Record<string, { stimulusIdentifier?: string | null; title?: string; isInfo?: boolean }>;

const makeResolver = (meta: MetaMap): WrapStimulusInSectionResolver => ({
  getItemMeta: async (_href, identifier) => meta[identifier] ?? null
});

const load = (xmlString: string) => cheerio.load(xmlString, { xmlMode: true, xml: true });

const sectionItems = ($: cheerio.CheerioAPI, section: Element) =>
  $(section)
    .find('qti-assessment-item-ref')
    .toArray()
    .map(e => $(e).attr('identifier'));

test('groups consecutive shared-stimulus items and sets keep-together', async () => {
  const input = xml`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="P1">
    <qti-assessment-item-ref identifier="ITM-1" href="1.xml" />
    <qti-assessment-item-ref identifier="ITM-2" href="2.xml" />
    <qti-assessment-item-ref identifier="ITM-3" href="3.xml" />
  </qti-test-part>
</qti-assessment-test>`;

  const out = await (
    await qtiTransform(input).wrapStimulusInSection(
      makeResolver({
        'ITM-1': { stimulusIdentifier: 'STIM-A', title: 'Vraag 1' },
        'ITM-2': { stimulusIdentifier: 'STIM-A', title: 'Vraag 2' },
        'ITM-3': { stimulusIdentifier: null, title: 'Vraag 3' }
      })
    )
  ).xml();

  const $ = load(out);
  const sections = $('qti-assessment-section').toArray();
  expect(sections.length).toBe(2);
  expect($(sections[0]).attr('keep-together')).toBe('true');
  expect($(sections[1]).attr('keep-together')).toBeUndefined();
  expect(sectionItems($, sections[0])).toEqual(['ITM-1', 'ITM-2']);
  expect(sectionItems($, sections[1])).toEqual(['ITM-3']);
  expect($('qti-test-part').attr('data-navigation-entity')).toBe('section');
  expect($('qti-test-part').attr('data-cito-navigate')).toBeUndefined();
});

test('does not merge info items', async () => {
  const input = xml`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="P1">
    <qti-assessment-item-ref identifier="INFO-1" href="i.xml" category="dep-informational" />
    <qti-assessment-item-ref identifier="ITM-2" href="2.xml" />
    <qti-assessment-item-ref identifier="ITM-3" href="3.xml" />
  </qti-test-part>
</qti-assessment-test>`;

  const out = await (
    await qtiTransform(input).wrapStimulusInSection(
      makeResolver({
        'INFO-1': { stimulusIdentifier: 'STIM-X', title: 'Informatie' },
        'ITM-2': { stimulusIdentifier: 'STIM-X', title: 'Vraag 2' },
        'ITM-3': { stimulusIdentifier: 'STIM-X', title: 'Vraag 3' }
      })
    )
  ).xml();

  const $ = load(out);
  const sections = $('qti-assessment-section').toArray();
  expect(sections.length).toBe(2);
  expect(sectionItems($, sections[0])).toEqual(['INFO-1']);
  expect($(sections[0]).attr('keep-together')).toBeUndefined();
  expect(sectionItems($, sections[1])).toEqual(['ITM-2', 'ITM-3']);
  expect($(sections[1]).attr('keep-together')).toBe('true');
});

test('does not rewrite when no shared-stimulus group exists', async () => {
  const input = xml`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="P1">
    <qti-assessment-item-ref identifier="ITM-1" href="1.xml" />
    <qti-assessment-item-ref identifier="ITM-2" href="2.xml" />
    <qti-assessment-item-ref identifier="ITM-3" href="3.xml" />
  </qti-test-part>
</qti-assessment-test>`;

  const out = await (
    await qtiTransform(input).wrapStimulusInSection(
      makeResolver({
        'ITM-1': { stimulusIdentifier: 'STIM-A' },
        'ITM-2': { stimulusIdentifier: 'STIM-B' },
        'ITM-3': { stimulusIdentifier: null }
      })
    )
  ).xml();

  const $ = load(out);
  expect($('qti-assessment-section').length).toBe(0);
  expect($('qti-test-part').attr('data-navigation-entity')).toBeUndefined();
  expect($('qti-assessment-item-ref').length).toBe(3);
});

test('normalizes existing shared-stimulus sections', async () => {
  const input = xml`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="P1">
    <qti-assessment-section identifier="SOURCE-SECTION" visible="true">
      <qti-assessment-item-ref identifier="ITM-1" href="1.xml" />
      <qti-assessment-item-ref identifier="ITM-2" href="2.xml" />
    </qti-assessment-section>
    <qti-assessment-section identifier="SINGLE" visible="true">
      <qti-assessment-item-ref identifier="ITM-3" href="3.xml" />
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

  const assignmentsOut: Array<{ itemIdentifier: string; sectionIdentifier: string }> = [];
  const out = await (
    await qtiTransform(input).wrapStimulusInSection(
      makeResolver({
        'ITM-1': { stimulusIdentifier: 'STIM-A', title: 'Vraag 1' },
        'ITM-2': { stimulusIdentifier: 'STIM-A', title: 'Vraag 2' },
        'ITM-3': { stimulusIdentifier: null, title: 'Vraag 3' }
      }),
      { assignmentsOut }
    )
  ).xml();

  const $ = load(out);
  const sections = $('qti-assessment-section').toArray();
  expect(sections.length).toBe(2);
  expect($(sections[0]).attr('keep-together')).toBe('true');
  expect(sectionItems($, sections[1])).toEqual(['ITM-3']);
  expect(assignmentsOut.map(a => a.itemIdentifier)).toEqual(['ITM-1', 'ITM-2', 'ITM-3']);
});

test('leaves a test part alone when it is a single wrapping section', async () => {
  const input = xml`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="P1">
    <qti-assessment-section identifier="ROOT" visible="true">
      <qti-assessment-section identifier="SUB" visible="true">
        <qti-assessment-item-ref identifier="ITM-1" href="1.xml" />
        <qti-assessment-item-ref identifier="ITM-2" href="2.xml" />
      </qti-assessment-section>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

  const out = await (
    await qtiTransform(input).wrapStimulusInSection(
      makeResolver({
        'ITM-1': { stimulusIdentifier: 'STIM-A' },
        'ITM-2': { stimulusIdentifier: 'STIM-A' }
      })
    )
  ).xml();

  const $ = load(out);
  expect($('qti-assessment-section[identifier="ROOT"]').length).toBe(1);
  expect($('qti-assessment-section[identifier="SUB"]').length).toBe(1);
  expect($('qti-test-part').attr('data-navigation-entity')).toBeUndefined();
});
