import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  composeDocument,
  convertPackageToDocx,
  convertPackageToPdf,
  convertPackageToZip,
  loadPackageFromFiles,
  parseItemXml,
  renderDocxDocument,
  renderPdfDocument,
  type LayoutBlock,
  type PaperInteraction,
  type PaperItem,
} from '../src/index.js';
import { sanitizePdfText } from '../src/render-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures/sample-package');

async function readFixtureFiles(dir: string = fixtureDir): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  async function walk(current: string, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        files.set(rel.replace(/\\/g, '/'), new Uint8Array(await readFile(full)));
      }
    }
  }
  await walk(dir);
  return files;
}

async function zipFixture(dir: string = fixtureDir): Promise<Uint8Array> {
  const files = await readFixtureFiles(dir);
  const zip = new JSZip();
  for (const [p, bytes] of files) zip.file(p, bytes);
  return zip.generateAsync({ type: 'uint8array' });
}

const nestedFixtureDir = path.join(__dirname, 'fixtures/nested-package');
const brokenTestFixtureDir = path.join(__dirname, 'fixtures/broken-test-package');
const allTypesDir = path.join(__dirname, 'fixtures/all-types-package');

const kindOf = (item: PaperItem, part = 0) => item.parts[part]?.interaction.kind;

function interaction<K extends PaperInteraction['kind']>(item: PaperItem, kind: K, part = 0) {
  const ix = item.parts[part]?.interaction;
  if (ix?.kind !== kind) throw new Error(`expected ${kind}, got ${ix?.kind}`);
  return ix as Extract<PaperInteraction, { kind: K }>;
}

async function fixtureItem(name: string, dir = fixtureDir): Promise<PaperItem> {
  const files = await readFixtureFiles(dir);
  return parseItemXml(new TextDecoder().decode(files.get(name)!), new Map(), name);
}

const qti3 = (decls: string, body: string) =>
  `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="X" title="X">${decls}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`;

describe('parseItemXml', () => {
  it('parses choice single and multi', async () => {
    const single = await fixtureItem('ITEM_CHOICE.xml');
    expect(interaction(single, 'choice').multi).toBe(false);
    expect(interaction(single, 'choice').options).toHaveLength(3);
    expect(single.answerKey?.summary).toMatch(/Xenon/);

    const multi = await fixtureItem('ITEM_CHOICE_MULTI.xml');
    expect(interaction(multi, 'choice').multi).toBe(true);
  });

  it('parses text entry, extended text, match, order, gap, hottext, select-point', async () => {
    const text = await fixtureItem('ITEM_TEXT.xml');
    expect(kindOf(text)).toBe('textEntry');
    expect(text.answerKey?.summary).toMatch(/kat/);

    expect(kindOf(await fixtureItem('ITEM_EXTENDED.xml'))).toBe('extendedText');

    const match = await fixtureItem('ITEM_MATCH.xml');
    expect(kindOf(match)).toBe('match');
    expect(match.answerKey?.summary).toMatch(/Vermogen/);

    const order = await fixtureItem('ITEM_ORDER.xml');
    expect(kindOf(order)).toBe('order');
    expect(order.answerKey?.summary).toMatch(/Hypothese/);

    const gap = await fixtureItem('ITEM_GAP.xml');
    expect(kindOf(gap)).toBe('gapMatch');
    expect(gap.answerKey?.values?.length).toBe(2);

    expect(kindOf(await fixtureItem('ITEM_HOTTEXT.xml'))).toBe('hottext');

    const sp = await fixtureItem('ITEM_SELECT_POINT.xml');
    expect(interaction(sp, 'selectPoint').correctAreas).toEqual([{ shape: 'circle', coords: [20, 20, 10] }]);
  });

  it('keeps every interaction of a multi-part item, labelled a, b', async () => {
    const item = await fixtureItem('ITEM_MULTI_PART.xml', allTypesDir);
    expect(item.parts.map(p => [p.label, p.interaction.kind])).toEqual([
      ['a', 'choice'],
      ['b', 'extendedText']
    ]);
    expect(item.points).toBe(3);
    expect(item.rubricHtml).toMatch(/reservevoedsel/);
    // Feedback is for the digital player only
    expect(JSON.stringify(item)).not.toMatch(/Geheime feedback/);
  });

  it('gives an associate interaction its options instead of empty match sets', async () => {
    const ix = interaction(await fixtureItem('ITEM_ASSOCIATE.xml', allTypesDir), 'associate');
    expect(ix.options.map(o => o.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(ix.correct).toEqual([
      ['appel', 'peer'],
      ['fiets', 'auto']
    ]);
  });

  it('numbers dropdown gaps and keeps their correct options', async () => {
    const item = await fixtureItem('ITEM_INLINE_CHOICE.xml', allTypesDir);
    const ix = interaction(item, 'inlineChoice');
    expect(ix.gaps.map(g => [g.label, g.correct])).toEqual([
      ['1', ['ging']],
      ['2', ['was']]
    ]);
    const html = item.body.find(n => n.type === 'html');
    expect(html?.type === 'html' && html.html).toMatch(/<paper-gap n="1"[^>]*\/>.*<paper-gap n="2"/);
  });

  it('leaves a single gap unnumbered and lists accepted alternatives', async () => {
    const item = await fixtureItem('ITEM_RICH.xml', allTypesDir);
    const ix = interaction(item, 'textEntry');
    expect(ix.gaps).toEqual([
      { label: '', responseId: 'RESPONSE', expectedLength: 15, accepted: ['Amsterdam', "A'dam"] }
    ]);
    expect(item.body.some(n => n.type === 'html' && n.html.includes('<paper-gap n=""'))).toBe(true);
  });

  it('labels hotspots on graphic interactions', async () => {
    const hotspot = interaction(await fixtureItem('ITEM_HOTSPOT.xml', allTypesDir), 'hotspot');
    expect(hotspot.image).toMatchObject({ path: 'resources/scene.png', width: 400, height: 300 });
    expect(hotspot.hotspots.map(h => [h.label, h.shape])).toEqual([
      ['A', 'circle'],
      ['B', 'rect'],
      ['C', 'poly']
    ]);
    const gapMatch = interaction(await fixtureItem('ITEM_GRAPHIC_GAP.xml', allTypesDir), 'graphicGapMatch');
    expect(gapMatch.hotspots.map(h => h.label)).toEqual(['1', '2', '3']);
    expect(gapMatch.options).toHaveLength(3);
  });

  it('parses slider, position object, drawing, upload and PCI', async () => {
    expect(interaction(await fixtureItem('ITEM_SLIDER.xml', allTypesDir), 'slider')).toMatchObject({
      min: 0,
      max: 150,
      step: 10,
      correct: 100
    });
    const position = interaction(await fixtureItem('ITEM_POSITION.xml', allTypesDir), 'positionObject');
    expect(position.image.path).toBe('resources/scene.png');
    expect(position.correctAreas).toEqual([{ shape: 'rect', coords: [60, 200, 180, 300] }]);
    expect(interaction(await fixtureItem('ITEM_DRAWING.xml', allTypesDir), 'drawing').image?.path).toBe(
      'resources/scene.png'
    );
    expect(kindOf(await fixtureItem('ITEM_UPLOAD.xml', allTypesDir))).toBe('upload');
    expect(interaction(await fixtureItem('ITEM_PCI.xml', allTypesDir), 'unsupported').interactionType).toBe(
      'qti-portable-custom-interaction'
    );
  });

  it('turns a media interaction into a note, not a question part', async () => {
    const item = await fixtureItem('ITEM_MEDIA.xml', allTypesDir);
    expect(item.parts.map(p => p.interaction.kind)).toEqual(['choice']);
    expect(item.body.some(n => n.type === 'media' && n.mediaType === 'audio')).toBe(true);
  });

  it('never prints a shuffled order item in its correct order', () => {
    const decl = `<qti-response-declaration identifier="R" cardinality="ordered" base-type="identifier"><qti-correct-response>${[
      'a',
      'b',
      'c',
      'd'
    ]
      .map(v => `<qti-value>${v}</qti-value>`)
      .join('')}</qti-correct-response></qti-response-declaration>`;
    for (const id of ['one', 'two', 'three', 'four', 'five', 'six']) {
      const xml = qti3(
        decl,
        `<qti-order-interaction response-identifier="R" shuffle="true">${['a', 'b', 'c', 'd']
          .map(v => `<qti-simple-choice identifier="${v}">${v}</qti-simple-choice>`)
          .join('')}</qti-order-interaction>`
      ).replace('identifier="X"', `identifier="${id}"`);
      const ix = interaction(parseItemXml(xml), 'order');
      expect(ix.options.map(o => o.identifier).join('')).not.toBe('abcd');
    }
  });

  it('respects fixed choices and keepSourceOrder when shuffling', () => {
    const xml = qti3(
      '',
      `<qti-choice-interaction response-identifier="R" shuffle="true">${['a', 'b', 'c', 'd', 'e', 'f']
        .map(v => `<qti-simple-choice identifier="${v}"${v === 'f' ? ' fixed="true"' : ''}>${v}</qti-simple-choice>`)
        .join('')}</qti-choice-interaction>`
    );
    const shuffled = interaction(parseItemXml(xml), 'choice').options.map(o => o.identifier);
    expect(shuffled[5]).toBe('f');
    expect(shuffled).toEqual(interaction(parseItemXml(xml), 'choice').options.map(o => o.identifier));
    const source = interaction(parseItemXml(xml, new Map(), '', { keepSourceOrder: true }), 'choice');
    expect(source.options.map(o => o.identifier)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('reads QTI 2.1 items', () => {
    const xml = `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="Q21" title="Q21">
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier"><correctResponse><value>B</value></correctResponse></responseDeclaration>
      <itemBody><p>Kies.</p><choiceInteraction responseIdentifier="RESPONSE" maxChoices="1"><prompt>Welke?</prompt>
        <simpleChoice identifier="A">Een</simpleChoice><simpleChoice identifier="B">Twee</simpleChoice></choiceInteraction></itemBody>
    </assessmentItem>`;
    const item = parseItemXml(xml);
    const ix = interaction(item, 'choice');
    expect(ix.options.map(o => o.html)).toEqual(['Een', 'Twee']);
    expect(ix.correct).toEqual(['B']);
    expect(item.parts[0].promptHtml).toBe('Welke?');
  });

  it('reads QTI 2.1 interactions with multi-word names', () => {
    const xml = `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="Q21" title="Q21">
      <responseDeclaration identifier="R1" cardinality="single" baseType="string"><correctResponse><value>kat</value></correctResponse></responseDeclaration>
      <itemBody>
        <p>De <textEntryInteraction responseIdentifier="R1" expectedLength="5"/> en de <inlineChoiceInteraction responseIdentifier="R2"><inlineChoice identifier="a">hond</inlineChoice></inlineChoiceInteraction>.</p>
        <gapMatchInteraction responseIdentifier="R3"><gapText identifier="W" matchMax="1">zuur</gapText><p>Het is <gap identifier="G"/>.</p></gapMatchInteraction>
        <extendedTextInteraction responseIdentifier="R4" expectedLines="4"/>
      </itemBody>
    </assessmentItem>`;
    const item = parseItemXml(xml);
    expect(item.parts.map(p => p.interaction.kind)).toEqual(['textEntry', 'inlineChoice', 'gapMatch', 'extendedText']);
    expect(interaction(item, 'textEntry').gaps[0].accepted).toEqual(['kat']);
  });

  it('keeps escaped markup characters as text', async () => {
    const xml = qti3(
      '',
      `<qti-choice-interaction response-identifier="R" max-choices="1"><qti-prompt>Waar is x &lt; y?</qti-prompt>
        <qti-simple-choice identifier="a">3&lt;5</qti-simple-choice><qti-simple-choice identifier="b">a &lt;b&gt; c &amp;amp; d</qti-simple-choice></qti-choice-interaction>`
    );
    const paper = { ...(await loadPackageFromFiles(await readFixtureFiles())), items: [parseItemXml(xml)] };
    const text = await docxText(await renderDocxDocument(paper, 'questions', { locale: 'nl' }));
    expect(text).toMatch(/Waar is x < y\?/);
    expect(text).toMatch(/3<5/);
    expect(text).toMatch(/a <b> c &amp; d/);
  });

  it('labels parts in reading order when text entries and dropdowns alternate', () => {
    const xml = qti3(
      '',
      `<p>Een <qti-text-entry-interaction response-identifier="T1"/>.</p>
       <p>Twee <qti-inline-choice-interaction response-identifier="C1"><qti-inline-choice identifier="x">x</qti-inline-choice></qti-inline-choice-interaction>.</p>
       <p>Drie <qti-text-entry-interaction response-identifier="T2"/>.</p>`
    );
    const item = parseItemXml(xml);
    const order = item.body.flatMap(n => (n.type === 'part' ? [item.parts[n.index].label] : []));
    expect(order).toEqual(['a', 'b']);
    expect(item.parts.map(p => p.interaction.kind)).toEqual(['inlineChoice', 'textEntry']);
  });

  it('records shared stimulus references relative to the item', async () => {
    const item = await fixtureItem('ITEM_STIM_A.xml', allTypesDir);
    expect(item.stimulusRefs).toEqual(['stimuli/vos.xml']);
  });
});

describe('loadPackageFromFiles', () => {
  it('loads all sample items', async () => {
    const files = await readFixtureFiles();
    const paper = await loadPackageFromFiles(files);
    expect(paper.title).toBe('Export sample toets');
    expect(paper.items.length).toBe(9);
    const kinds = paper.items.map(i => i.parts[0]?.interaction.kind);
    expect(kinds).toContain('choice');
    expect(kinds).toContain('match');
    expect(kinds).toContain('selectPoint');
    // Relative package images are hydrated
    expect(paper.assets.has('resources/atom.png')).toBe(true);
  });
});

describe('item href resolution', () => {
  it('resolves assessment item refs against the test file location', async () => {
    // The test lives in depitems/ and names its items as siblings ("item-a.xml"),
    // which is what the spec means by a relative href. Resolving those against
    // the package root finds nothing, and the paper used to come out with its
    // title and headers intact and zero questions.
    const files = await readFixtureFiles(nestedFixtureDir);
    const paper = await loadPackageFromFiles(files);

    expect(paper.title).toBe('Nested Toets');
    expect(paper.items).toHaveLength(2);
    // Order comes from the test, not the manifest.
    expect(paper.items.map(i => i.identifier)).toEqual(['ITM-A', 'ITM-B']);
    expect(paper.items[0].parts[0].interaction.kind).toBe('choice');
  });

  it('exports a populated docx for a nested package', async () => {
    const zip = await zipFixture(nestedFixtureDir);
    const result = await convertPackageToDocx(zip, { locale: 'nl' });
    expect(result.paper.items).toHaveLength(2);
    expect(result.assessment.byteLength).toBeGreaterThan(2000);
  });

  it('falls back to the manifest when the test references files that are absent', async () => {
    // This package's test says href="ITM-01xml" -- the dot lost before "xml" --
    // while its manifest correctly says "ITM-01.xml". Two non-empty but
    // unresolvable refs must not shadow a manifest that resolves.
    const files = await readFixtureFiles(brokenTestFixtureDir);
    const paper = await loadPackageFromFiles(files);

    expect(paper.items).toHaveLength(2);
    expect(paper.items.map(i => i.identifier)).toEqual(['ITM-01', 'ITM-02']);
  });

  it('keeps working when a test writes package-root-relative item hrefs', async () => {
    // The flat sample package: test and items share a directory, so the
    // test-relative and raw forms coincide. Guards against the resolution
    // change regressing the common case.
    const paper = await loadPackageFromFiles(await readFixtureFiles());
    expect(paper.items).toHaveLength(9);
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

/** Visible text of a .docx, paragraph by paragraph. */
async function docxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function allBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  return blocks.flatMap(b =>
    b.t === 'group'
      ? allBlocks(b.blocks)
      : b.t === 'table'
        ? [b, ...b.rows.flatMap(r => r.cells.flatMap(c => allBlocks(c.blocks)))]
        : [b]
  );
}

describe('loading packages with all item types', () => {
  it('keeps information-only items and resolves shared stimuli once', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    expect(paper.items).toHaveLength(18);
    expect(paper.items[0].parts).toHaveLength(0);
    expect(paper.stimuli.get('stimuli/vos.xml')?.title).toBe('De vos');
    expect(paper.assets.has('resources/scene.png')).toBe(true);
  });
});

describe('paper documents', () => {
  it('numbers only items with questions and prints a shared text once', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const text = await docxText(await renderDocxDocument(paper, 'questions', { locale: 'nl' }));
    expect(text).toMatch(/Deel 2: rekenen/);
    expect(text).toMatch(/Vraag 17/);
    expect(text).not.toMatch(/Vraag 18/);
    expect(text.match(/De vos is een roofdier/g)).toHaveLength(1);
    expect(text).toMatch(/Schrijf je antwoorden op het antwoordblad/);
  });

  it('keeps answer space out of the booklet and puts it on the answer sheet', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles());
    const booklet = allBlocks(composeDocument(paper, 'questions', { locale: 'nl' }).blocks);
    const sheet = allBlocks(composeDocument(paper, 'answerSheet', { locale: 'nl' }).blocks);
    expect(booklet.some(b => b.t === 'lines')).toBe(false);
    expect(sheet.some(b => b.t === 'lines')).toBe(true);
    const marks = (blocks: LayoutBlock[]) =>
      blocks.flatMap(b => (b.t === 'para' ? b.content.filter(n => n.t === 'mark') : []));
    expect(marks(booklet)).toHaveLength(0);
    expect(marks(sheet).length).toBeGreaterThan(0);
  });

  it('fills in the answer key with paper letters', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles());
    const key = allBlocks(composeDocument(paper, 'answerKey', { locale: 'nl' }).blocks);
    const filled = key.flatMap(b => (b.t === 'para' ? b.content.filter(n => n.t === 'mark' && n.filled) : []));
    // C for question 1, A and D for question 2, two hottext words, three match cells
    expect(filled.map(n => (n.t === 'mark' ? n.label : '')).filter(Boolean)).toEqual(['C', 'A', 'D', 'A', 'C']);
    const text = await docxText(await renderDocxDocument(paper, 'answerKey', { locale: 'nl' }));
    expect(text).toMatch(/kat/);
    expect(text).toMatch(/muizen/);
  });

  it('shows accepted alternatives and scoring rubrics in the answer key', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const text = await docxText(await renderDocxDocument(paper, 'answerKey', { locale: 'nl' }));
    expect(text).toMatch(/ook goed: A'dam/);
    expect(text).toMatch(/reservevoedsel/);
  });

  it('draws hotspot letters on the image', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const blocks = allBlocks(composeDocument(paper, 'workbook', { locale: 'en' }).blocks);
    const image = blocks.find(b => b.t === 'image' && b.overlays?.length);
    expect(image?.t === 'image' && image.overlays?.map(o => o.label)).toEqual(['A', 'B', 'C']);
  });

  it('uses no Dutch in an English export', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    for (const kind of ['workbook', 'answerSheet', 'answerKey'] as const) {
      const text = await docxText(await renderDocxDocument(paper, kind, { locale: 'en' }));
      expect(text).not.toMatch(/Vraag|Antwoord|alleen digitaal|Geen automatisch|afbeelding/);
    }
  });
});

describe('sources document', () => {
  it('moves shared texts to the sources booklet and refers to them from each question', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const sources = await docxText(await renderDocxDocument(paper, 'sources', { locale: 'nl' }));
    expect(sources).toMatch(/Bron 1: De vos/);
    expect(sources).toMatch(/De vos is een roofdier/);

    const booklet = await docxText(await renderDocxDocument(paper, 'questions', { locale: 'nl', separateSources: true }));
    expect(booklet).not.toMatch(/De vos is een roofdier/);
    // Both questions about the text say where to find it
    expect(booklet.match(/Gebruik bron 1 \(De vos\) uit het bronnenboekje\./g)).toHaveLength(2);
  });

  it('keeps shared texts in place when there is no sources document', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const workbook = await docxText(await renderDocxDocument(paper, 'workbook', { locale: 'nl' }));
    expect(workbook).toMatch(/De vos is een roofdier/);
    expect(workbook).not.toMatch(/bronnenboekje/);
  });
});

describe('convertPackageToZip', () => {
  it('zips a question booklet, answer sheet and answer key', async () => {
    const result = await convertPackageToZip(await zipFixture(), { locale: 'nl', fileNameBase: 'Toets' });
    expect(result.fileName).toBe('Toets-papier.zip');
    expect(result.files.map(f => f.name)).toEqual([
      'Toets - opgaven.docx',
      'Toets - antwoordblad.docx',
      'Toets - antwoordmodel.docx'
    ]);
    const zip = await JSZip.loadAsync(result.zip);
    expect(Object.keys(zip.files).sort()).toEqual(result.files.map(f => f.name).sort());
  });

  it('can include PDF and Word side by side', async () => {
    const result = await convertPackageToZip(await zipFixture(allTypesDir), {
      locale: 'en',
      fileNameBase: 'Test',
      formats: ['docx', 'pdf']
    });
    // The package has a shared stimulus, so a sources booklet comes along
    expect(result.files.map(f => f.name)).toEqual([
      'Test - questions.docx',
      'Test - sources.docx',
      'Test - answer-sheet.docx',
      'Test - answer-key.docx',
      'Test - questions.pdf',
      'Test - sources.pdf',
      'Test - answer-sheet.pdf',
      'Test - answer-key.pdf',
    ]);
    const pdf = result.files.find(f => f.name === 'Test - answer-key.pdf')!;
    expect(String.fromCharCode(...pdf.bytes.slice(0, 4))).toBe('%PDF');
  });
});

describe('PDF text', () => {
  it('keeps Windows-1252 characters and substitutes the rest', () => {
    expect(sanitizePdfText('“Café” – 10°C • x² ≤ π')).toBe('“Café” – 10°C • x² <= pi');
  });
});

describe('edge cases', () => {
  it('writes no empty table when nothing is numbered', async () => {
    const paper = await loadPackageFromFiles(await readFixtureFiles(allTypesDir));
    const info = { ...paper, items: paper.items.filter(i => !i.parts.length) };
    const zip = await JSZip.loadAsync(await renderDocxDocument(info, 'answerSheet', { locale: 'nl' }));
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const table of xml.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? []) expect(table).toContain('<w:tr');
  });

  it('continues a table row taller than a page on the next page', async () => {
    const lines = (id: string) => `<qti-extended-text-interaction response-identifier="${id}" expected-lines="20"/>`;
    const item = parseItemXml(qti3('', `${lines('A')}${lines('B')}${lines('C')}`));
    const paper = { ...(await loadPackageFromFiles(await readFixtureFiles())), items: [item] };
    const pdf = await PDFDocument.load(await renderPdfDocument(paper, 'answerSheet', { locale: 'nl' }));
    // 60 lines of 24pt never fit one A4 page
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
