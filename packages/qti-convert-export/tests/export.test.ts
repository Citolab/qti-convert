import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  convertPackageToDocx,
  convertPackageToPdf,
  loadPackageFromFiles,
  parseItemXml,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures/sample-package');

async function readFixtureFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  async function walk(dir: string, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        files.set(rel.replace(/\\/g, '/'), new Uint8Array(await readFile(full)));
      }
    }
  }
  await walk(fixtureDir);
  return files;
}

async function zipFixture(): Promise<Uint8Array> {
  const files = await readFixtureFiles();
  const zip = new JSZip();
  for (const [p, bytes] of files) zip.file(p, bytes);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseItemXml', () => {
  it('parses choice single and multi', async () => {
    const files = await readFixtureFiles();
    const assets = new Map();
    const single = parseItemXml(new TextDecoder().decode(files.get('ITEM_CHOICE.xml')!), assets);
    expect(single.interaction.kind).toBe('choice');
    if (single.interaction.kind === 'choice') {
      expect(single.interaction.multi).toBe(false);
      expect(single.interaction.choices).toHaveLength(3);
    }
    expect(single.answerKey?.summary).toMatch(/Xenon/);

    const multi = parseItemXml(new TextDecoder().decode(files.get('ITEM_CHOICE_MULTI.xml')!), assets);
    expect(multi.interaction.kind).toBe('choice');
    if (multi.interaction.kind === 'choice') {
      expect(multi.interaction.multi).toBe(true);
    }
  });

  it('parses text entry, extended text, match, order, gap, hottext, select-point', async () => {
    const files = await readFixtureFiles();
    const assets = new Map();

    const text = parseItemXml(new TextDecoder().decode(files.get('ITEM_TEXT.xml')!), assets);
    expect(text.interaction.kind).toBe('textEntry');
    expect(text.answerKey?.summary).toMatch(/kat/);

    const ext = parseItemXml(new TextDecoder().decode(files.get('ITEM_EXTENDED.xml')!), assets);
    expect(ext.interaction.kind).toBe('extendedText');

    const match = parseItemXml(new TextDecoder().decode(files.get('ITEM_MATCH.xml')!), assets);
    expect(match.interaction.kind).toBe('match');
    expect(match.answerKey?.summary).toMatch(/Vermogen/);

    const order = parseItemXml(new TextDecoder().decode(files.get('ITEM_ORDER.xml')!), assets);
    expect(order.interaction.kind).toBe('order');
    expect(order.answerKey?.summary).toMatch(/Hypothese/);

    const gap = parseItemXml(new TextDecoder().decode(files.get('ITEM_GAP.xml')!), assets);
    expect(gap.interaction.kind).toBe('gapMatch');
    expect(gap.answerKey?.values?.length).toBe(2);

    const hot = parseItemXml(new TextDecoder().decode(files.get('ITEM_HOTTEXT.xml')!), assets);
    expect(hot.interaction.kind).toBe('hottext');

    const sp = parseItemXml(new TextDecoder().decode(files.get('ITEM_SELECT_POINT.xml')!), assets);
    expect(sp.interaction.kind).toBe('selectPoint');
  });
});

describe('loadPackageFromFiles', () => {
  it('loads all sample items', async () => {
    const files = await readFixtureFiles();
    const paper = await loadPackageFromFiles(files);
    expect(paper.title).toBe('Export sample toets');
    expect(paper.items.length).toBe(9);
    const kinds = paper.items.map(i => i.interaction.kind);
    expect(kinds).toContain('choice');
    expect(kinds).toContain('match');
    expect(kinds).toContain('selectPoint');
    // Relative package images are hydrated
    expect(paper.assets.has('resources/atom.png')).toBe(true);
  });
});

describe('image refs', () => {
  it('resolves relative paths against the item location', async () => {
    const { resolveAssetRef, decodeHtmlEntities } = await import('../src/xml-utils.js');
    expect(resolveAssetRef('../resources/atom.png', 'items/item01.xml')).toBe('resources/atom.png');
    expect(resolveAssetRef('https://example.com/a.png', 'items/item01.xml')).toBe(
      'https://example.com/a.png'
    );
    expect(decodeHtmlEntities('schema&#x2019;s 10&#xb0;C')).toBe("schema’s 10°C");
  });
});

describe('file names', () => {
  it('derives download base from the QTI zip name', async () => {
    const { baseNameFromPackageFile, exportDownloadNames } = await import('../src/file-names.js');
    expect(baseNameFromPackageFile('Kennisnet Demotoets.package.zip')).toBe('Kennisnet Demotoets');
    expect(baseNameFromPackageFile('/tmp/foo.qti30.zip')).toBe('foo');
    const names = exportDownloadNames('Kennisnet Demotoets', 'docx');
    expect(names.fileName).toBe('Kennisnet Demotoets.docx');
    expect(names.answerKeyFileName).toBe('Kennisnet Demotoets-correction.docx');
  });
});

describe('convertPackageToDocx / Pdf', () => {
  it('exports a non-empty docx with answer key', async () => {
    const zip = await zipFixture();
    const result = await convertPackageToDocx(zip, { locale: 'nl', includeAnswerKey: true });
    expect(result.paper.items.length).toBe(9);
    expect(result.assessment.byteLength).toBeGreaterThan(2000);
    expect(result.fileName).toMatch(/\.docx$/);
    // DOCX is a zip — starts with PK
    expect(result.assessment[0]).toBe(0x50);
    expect(result.assessment[1]).toBe(0x4b);
  });

  it('exports a separate answer key docx by default (Kennisnet style)', async () => {
    const zip = await zipFixture();
    const result = await convertPackageToDocx(zip, {
      locale: 'nl',
      fileNameBase: 'My Demo Toets',
    });
    expect(result.answerKey).toBeDefined();
    expect(result.fileName).toBe('My Demo Toets.docx');
    expect(result.answerKeyFileName).toBe('My Demo Toets-correction.docx');
  });

  it('can put correction in the question document and as a separate file', async () => {
    const zip = await zipFixture();
    const result = await convertPackageToDocx(zip, {
      correctionInDocument: true,
      correctionSeparate: true,
      fileNameBase: 'Both',
    });
    expect(result.answerKey).toBeDefined();
    expect(result.assessment.byteLength).toBeGreaterThan(2000);
  });

  it('can omit all correction sheets', async () => {
    const zip = await zipFixture();
    const result = await convertPackageToDocx(zip, {
      correctionInDocument: false,
      correctionSeparate: false,
    });
    expect(result.answerKey).toBeUndefined();
  });

  it('exports a non-empty pdf', async () => {
    const zip = await zipFixture();
    const result = await convertPackageToPdf(zip, { locale: 'nl', includeAnswerKey: true });
    expect(result.assessment.byteLength).toBeGreaterThan(500);
    expect(result.fileName).toMatch(/\.pdf$/);
    // PDF magic
    expect(String.fromCharCode(...result.assessment.slice(0, 4))).toBe('%PDF');
  });
});
