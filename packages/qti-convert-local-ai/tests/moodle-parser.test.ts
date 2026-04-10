/* @vitest-environment jsdom */

import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { convertSpreadsheetToQtiPackage, parseSpreadsheet } from '../src/converters';

const MOODLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question type="multichoice">
    <name>
      <text>Capital question</text>
    </name>
    <questiontext format="html">
      <text><![CDATA[What is the capital of France?]]></text>
    </questiontext>
    <answer fraction="0">
      <text>Berlin</text>
      <feedback>
        <text>No, Berlin is in Germany.</text>
      </feedback>
    </answer>
    <answer fraction="100">
      <text>Paris</text>
      <feedback>
        <text>Correct!</text>
      </feedback>
    </answer>
    <generalfeedback>
      <text>This is about European capitals.</text>
    </generalfeedback>
  </question>
  <question type="truefalse">
    <name>
      <text>Truth question</text>
    </name>
    <questiontext format="html">
      <text><![CDATA[The earth orbits the sun.]]></text>
    </questiontext>
    <answer fraction="100">
      <text>true</text>
    </answer>
    <answer fraction="0">
      <text>false</text>
    </answer>
  </question>
  <question type="shortanswer">
    <name>
      <text>Short answer question</text>
    </name>
    <questiontext format="html">
      <text><![CDATA[Type the capital of France.]]></text>
    </questiontext>
    <answer fraction="100">
      <text>Paris</text>
    </answer>
    <answer fraction="50">
      <text>paris</text>
    </answer>
  </question>
  <question type="numerical">
    <name>
      <text>Numerical question</text>
    </name>
    <questiontext format="html">
      <text><![CDATA[Type pi to two decimals.]]></text>
    </questiontext>
    <answer fraction="100">
      <text>3.14</text>
      <tolerance>0.01</tolerance>
    </answer>
  </question>
  <question type="ddmatch">
    <name>
      <text>Unsupported question</text>
    </name>
    <questiontext format="html">
      <text><![CDATA[Match capitals to countries.]]></text>
    </questiontext>
    <dragbox>
      <text>Paris</text>
    </dragbox>
    <drop>
      <text>France</text>
    </drop>
  </question>
</quiz>`;

describe('Moodle quiz XML support', () => {
  test('parses Moodle multichoice XML into deterministic rows', async () => {
    const spreadsheet = await parseSpreadsheet(MOODLE_XML, { format: 'xml', fileName: 'moodle.xml' });

    expect(spreadsheet.format).toBe('xml');
    expect(spreadsheet.fileName).toBe('moodle.xml');
    expect(spreadsheet.rows).toHaveLength(4);
    expect(spreadsheet.rows[0].identifier).toBe('moodle-item-1');
    expect(spreadsheet.rows[0].title).toBe('Capital question');
    expect(spreadsheet.rows[0].prompt).toBe('What is the capital of France?');
    expect(spreadsheet.rows[0].questionType).toBe('multiple_choice');
    expect(spreadsheet.rows[0].selectionMode).toBe('single');
    expect(spreadsheet.rows[0].correctResponse).toBe('B');
    expect(spreadsheet.rows[0].generalFeedback).toBe('This is about European capitals.');
    expect(spreadsheet.rows[1].questionType).toBe('multiple_choice');
    expect(spreadsheet.rows[1].correctResponse).toBe('A');
    expect(spreadsheet.rows[2].questionType).toBe('short_text');
    expect(spreadsheet.rows[2].correctResponse).toBe('Paris');
    expect(spreadsheet.rows[3].questionType).toBe('short_text');
    expect(spreadsheet.rows[3].correctResponse).toBe('3.14');
    expect(JSON.parse(spreadsheet.rows[0].optionsJson)).toEqual([
      { id: 'A', text: 'Berlin', feedback: 'No, Berlin is in Germany.' },
      { id: 'B', text: 'Paris', feedback: 'Correct!' }
    ]);
  });

  test('converts Moodle multichoice XML without invoking the LLM', async () => {
    const result = await convertSpreadsheetToQtiPackage(MOODLE_XML, {
      packageIdentifier: 'moodle-demo',
      llmSettings: {
        createEngine: async () => {
          throw new Error('LLM should not be called for Moodle XML');
        }
      }
    });

    const zip = await JSZip.loadAsync(result.packageBlob as Blob);
    const item = await zip.file('items/moodle-item-1.xml')?.async('string');

    expect(result.questions).toHaveLength(4);
    expect(result.questions[0].title).toBe('Capital question');
    expect(result.questions[0].prompt).toBe('What is the capital of France?');
    expect(result.questions[0].generalFeedback).toBe('This is about European capitals.');
    expect(item).toContain('Capital question');
    expect(item).toContain('What is the capital of France?');
    expect(item).toContain('>Paris<');
    expect(item).toContain('<qti-value>B</qti-value>');
    expect(item).toContain('max-choices="1"');
    expect(item).toContain('Paris: Correct!');
    expect(item).toContain('Berlin: No, Berlin is in Germany.');
    expect(item).toContain('This is about European capitals.');

    const trueFalseItem = await zip.file('items/moodle-item-2.xml')?.async('string');
    const shortAnswerItem = await zip.file('items/moodle-item-3.xml')?.async('string');
    const numericalItem = await zip.file('items/moodle-item-4.xml')?.async('string');
    const unsupportedItem = await zip.file('items/moodle-item-5.xml')?.async('string');

    expect(trueFalseItem).toContain('The earth orbits the sun.');
    expect(trueFalseItem).toContain('>true<');
    expect(trueFalseItem).toContain('<qti-value>A</qti-value>');
    expect(shortAnswerItem).toContain('qti-text-entry-interaction');
    expect(shortAnswerItem).toContain('<qti-value>Paris</qti-value>');
    expect(numericalItem).toContain('qti-text-entry-interaction');
    expect(numericalItem).toContain('<qti-value>3.14</qti-value>');
    expect(unsupportedItem).toBeUndefined();
  });
});
