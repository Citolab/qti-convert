import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { describe, expect, test } from 'vitest';
import { upgradeQti2toQti3 } from './convert-qti2-to-qti3';

// fixtures/<name>.qti2.xml is the input, fixtures/<name>.qti3.xml the output of the original qti2xTo30.xsl
// (run with Saxon-JS when the XSLT was replaced), so the TypeScript upgrader is checked against it.
const FIXTURES = path.join(__dirname, 'fixtures');

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

describe('upgradeQti2toQti3 matches the qti2xTo30.xsl output', () => {
  const names = readdirSync(FIXTURES)
    .filter(name => name.endsWith('.qti2.xml'))
    .map(name => name.replace(/\.qti2\.xml$/, ''));

  test('fixtures are present', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  test.each(names)('%s', name => {
    const input = readFileSync(path.join(FIXTURES, `${name}.qti2.xml`), 'utf8');
    const expected = readFileSync(path.join(FIXTURES, `${name}.qti3.xml`), 'utf8');
    expect(canonical(upgradeQti2toQti3(input))).toEqual(canonical(expected));
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
