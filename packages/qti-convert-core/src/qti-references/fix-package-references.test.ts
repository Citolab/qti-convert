import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { fixPackageReferences, fixPackageReferencesZip, PackageReferenceResolver } from './index';

const QTI2 = 'http://www.imsglobal.org/xsd/imsqti_v2p1';
const QTI3 = 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const encoder = new TextEncoder();
const decode = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : new TextDecoder('utf-8', { ignoreBOM: true }).decode(content);

const qti2Item = (body: string, head = '') =>
  encoder.encode(
    `\ufeff<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<assessmentItem identifier="i" xmlns="${QTI2}">\n  ${head}\n  <itemBody>${body}</itemBody>\n` +
      '  <responseProcessing templateLocation="/templates/rp.xml" />\n</assessmentItem>'
  );

const pkg = (item: Uint8Array | string, extra: Record<string, Uint8Array | string> = {}) =>
  new Map<string, Uint8Array | string>(
    Object.entries({
      'imsmanifest.xml': '<manifest/>',
      'questions/q1.xml': item,
      'mediafiles/a.png': PNG,
      'css/q1.css': 'p {}',
      'templates/rp.xml': '<responseProcessing/>',
      ...extra
    })
  );

const srcs = (files: Map<string, string | Uint8Array>, path = 'questions/q1.xml', selector = 'img') => {
  const $ = cheerio.load(decode(files.get(path)!), { xml: true });
  return $(selector)
    .toArray()
    .map(el => $(el).attr('src'));
};

describe('fixPackageReferences', () => {
  test('fixes package-root-relative and root-absolute references', () => {
    const item = qti2Item('<img src="mediafiles/a.png" alt="" />', '<stylesheet href="css/q1.css" type="text/css" />');
    const result = fixPackageReferences(pkg(item));
    const xml = decode(result.files.get('questions/q1.xml')!);
    expect(xml).toContain('<img src="../mediafiles/a.png" alt="" />');
    expect(xml).toContain('<stylesheet href="../css/q1.css" type="text/css" />');
    expect(xml).toContain('templateLocation="../templates/rp.xml"');
    expect(result.fixed.map(f => [f.attribute, f.method, f.target])).toEqual([
      ['href', 'package-root', 'css/q1.css'],
      ['src', 'package-root', 'mediafiles/a.png'],
      ['templateLocation', 'package-root', 'templates/rp.xml']
    ]);
    expect(result.unresolved).toEqual([]);
  });

  test('only changes the references (byte-for-byte, BOM included)', () => {
    const item = qti2Item('<img src="mediafiles/a.png" alt="" /><br />');
    const fixed = decode(fixPackageReferences(pkg(item)).files.get('questions/q1.xml')!);
    expect(fixed).toBe(
      decode(item)
        .replace('src="mediafiles/a.png"', 'src="../mediafiles/a.png"')
        .replace('"/templates/rp.xml"', '"../templates/rp.xml"')
    );
    expect(fixed.startsWith('\ufeff')).toBe(true);
  });

  test('leaves correct references and other files alone', () => {
    const item = decode(
      qti2Item('<img src="../mediafiles/a.png" alt=""/><a href="https://example.com/x.png">x</a>')
    ).replace('/templates/rp.xml', '../templates/rp.xml');
    const files = pkg(item);
    const result = fixPackageReferences(files);
    expect(result.fixed).toEqual([]);
    expect(result.unresolved).toEqual([]);
    for (const [path, content] of files) expect(result.files.get(path)).toBe(content);
  });

  test('is idempotent', () => {
    const first = fixPackageReferences(pkg(qti2Item('<img src="mediafiles/a.png"/>')));
    const second = fixPackageReferences(first.files);
    expect(second.fixed).toEqual([]);
    expect([...second.files]).toEqual([...first.files]);
  });

  test('finds files by name, also for paths on the author computer', () => {
    const item = qti2Item(
      '<img src="images/a.png"/><img src="C:\\Users\\me\\b.png"/><img src="file:///C:/tmp/c%20d.png"/>'
    );
    const result = fixPackageReferences(pkg(item, { 'media/deep/b.png': PNG, 'media/c d.png': PNG }));
    expect(srcs(result.files)).toEqual(['../mediafiles/a.png', '../media/deep/b.png', '../media/c%20d.png']);
    expect(new Set(result.fixed.filter(f => f.attribute === 'src').map(f => f.method))).toEqual(new Set(['file-name']));
    expect(fixPackageReferences(pkg(item), { searchByFileName: false }).unresolved.length).toBeGreaterThan(0);
  });

  test('prefers the file whose folders match and reports a tie', () => {
    const item = qti2Item('<img src="media/x/a.png"/><img src="other/b.png"/>');
    const result = fixPackageReferences(
      pkg(item, { 'm1/x/a.png': PNG, 'm2/y/a.png': PNG, 'p/b.png': PNG, 'q/b.png': PNG })
    );
    expect(srcs(result.files)).toEqual(['../m1/x/a.png', 'other/b.png']);
    expect(result.unresolved[0].value).toBe('other/b.png');
    expect(result.unresolved[0].candidates.sort()).toEqual(['p/b.png', 'q/b.png']);
  });

  test('corrects the case and keeps query strings and URL encoding', () => {
    const item = qti2Item('<img src="../MediaFiles/A.PNG"/><img src="mediafiles/my%20image.png?v=2"/>');
    const result = fixPackageReferences(pkg(item, { 'mediafiles/my image.png': PNG }));
    expect(srcs(result.files)).toEqual(['../mediafiles/a.png', '../mediafiles/my%20image.png?v=2']);
    expect(result.fixed.filter(f => f.attribute === 'src').map(f => f.method)).toEqual(['case', 'package-root']);
  });

  test('handles QTI 3 items and tests, modules and loose attributes', () => {
    const item = `<qti-assessment-item xmlns="${QTI3}" identifier="i"><qti-item-body>
      <qti-portable-custom-interaction response-identifier="R" module="m">
        <qti-interaction-modules><qti-interaction-module id="m" primary-path="modules/m"/></qti-interaction-modules>
      </qti-portable-custom-interaction>
      <object data="mediafiles/a.png" type="image/png"><param name="flag" value="true"/><param name="img" value="mediafiles/a.png"/></object>
    </qti-item-body></qti-assessment-item>`;
    const test = `<qti-assessment-test xmlns="${QTI3}" identifier="t"><qti-test-part identifier="p">
      <qti-assessment-section identifier="s"><qti-assessment-item-ref identifier="i" href="q1.xml"/>
      <qti-assessment-item-ref identifier="gone" href="gone.xml"/></qti-assessment-section></qti-test-part></qti-assessment-test>`;
    const result = fixPackageReferences(
      new Map<string, string | Uint8Array>([
        ['pkg/imsmanifest.xml', '<manifest/>'],
        ['pkg/items/q1.xml', item],
        ['pkg/tests/test.xml', test],
        ['pkg/modules/m.js', ''],
        ['pkg/mediafiles/a.png', PNG]
      ])
    );
    const $ = cheerio.load(result.files.get('pkg/items/q1.xml') as string, { xml: true });
    // the package root is the folder of the manifest; the .js extension stays left out
    expect($('qti-interaction-module').attr('primary-path')).toBe('../modules/m');
    expect($('object').attr('data')).toBe('../mediafiles/a.png');
    expect(
      $('param')
        .toArray()
        .map(p => $(p).attr('value'))
    ).toEqual(['true', '../mediafiles/a.png']);
    const $test = cheerio.load(result.files.get('pkg/tests/test.xml') as string, { xml: true });
    expect($test('qti-assessment-item-ref').first().attr('href')).toBe('../items/q1.xml');
    expect(result.unresolved.map(u => [u.file, u.value])).toEqual([['pkg/tests/test.xml', 'gone.xml']]);
  });

  test('fixes a zipped package', async () => {
    const zip = new JSZip();
    for (const [path, content] of pkg(qti2Item('<img src="mediafiles/a.png"/>'))) zip.file(path, content);
    const {
      zip: output,
      fixed,
      unresolved
    } = await fixPackageReferencesZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(fixed).toHaveLength(2);
    expect(unresolved).toEqual([]);
    const result = await JSZip.loadAsync(output);
    expect(await result.file('questions/q1.xml')!.async('string')).toContain('src="../mediafiles/a.png"');
  });

  test('the resolver works with only the paths of a zip', async () => {
    const zip = new JSZip();
    for (const [path, content] of pkg(qti2Item('<img src="mediafiles/a.png"/>'))) zip.file(path, content);
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    const resolver = new PackageReferenceResolver(Object.keys(loaded.files));
    expect(resolver.rootDir).toBe('');
    expect(resolver.resolve('questions/q1.xml', 'mediafiles/a.png', 'src')).toEqual({
      target: 'mediafiles/a.png',
      method: 'package-root',
      newValue: '../mediafiles/a.png',
      candidates: []
    });
    expect(resolver.resolve('questions/q1.xml', '../mediafiles/a.png', 'src')).toEqual({
      target: 'mediafiles/a.png',
      method: '',
      candidates: []
    });
    expect(resolver.resolve('questions/q1.xml', '/templates/rp.xml')?.newValue).toBe('../templates/rp.xml');
  });

  test('the resolver skips what is not a file reference and stays inside the package', () => {
    const resolver = new PackageReferenceResolver([
      'pkg/imsmanifest.xml',
      'pkg/items/q1.xml',
      'pkg/img/a.png',
      'pkg/img/'
    ]);
    expect(resolver.rootDir).toBe('pkg');
    for (const value of ['https://example.com/a.png', 'data:image/png;base64,AAAA', '#part', '', '  ']) {
      expect(resolver.resolve('pkg/items/q1.xml', value, 'src')).toBeUndefined();
    }
    expect(resolver.resolve('pkg/items/q1.xml', 'true', 'value')).toBeUndefined();
    expect(resolver.resolve('pkg/items/q1.xml', '../../../etc/passwd', 'src')).toEqual({ method: '', candidates: [] });
    expect(resolver.resolve('pkg/items/q1.xml', '../../img/a.png')?.target).toBe('pkg/img/a.png');
    expect(new PackageReferenceResolver(['b/x.png', 'a/x.png']).resolve('q.xml', 'x.png')?.candidates).toEqual([
      'a/x.png',
      'b/x.png'
    ]);
    expect(
      new PackageReferenceResolver(['img/a.png'], { searchByFileName: false }).resolve('q/q.xml', 'a.png')?.target
    ).toBeUndefined();
  });
});
