/* @vitest-environment jsdom */

import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { convertSpreadsheetToQtiPackage } from './convert-spreadsheet';
import { parseSpreadsheet } from './spreadsheet-parser';

const BRIGHTSPACE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <item ident="ITEM-1" label="Question 1">
    <presentation>
      <flow>
        <material>
          <mattext texttype="text/html">What is 2+2?</mattext>
        </material>
      </flow>
      <response_lid ident="RESPONSE" rcardinality="Single">
        <render_choice>
          <flow_label>
            <response_label ident="A">
              <flow_mat>
                <material>
                  <mattext texttype="text/plain">3</mattext>
                </material>
              </flow_mat>
            </response_label>
          </flow_label>
          <flow_label>
            <response_label ident="B">
              <flow_mat>
                <material>
                  <mattext texttype="text/plain">4</mattext>
                </material>
              </flow_mat>
            </response_label>
          </flow_label>
        </render_choice>
      </response_lid>
    </presentation>
    <resprocessing>
      <respcondition>
        <conditionvar>
          <varequal respident="RESPONSE">B</varequal>
        </conditionvar>
        <setvar action="Set">100</setvar>
      </respcondition>
    </resprocessing>
  </item>
  <item ident="ITEM-2" label="Question 2">
    <presentation>
      <flow>
        <material>
          <mattext texttype="text/plain">Which numbers are even?</mattext>
        </material>
      </flow>
      <response_lid ident="RESPONSE" rcardinality="Multiple">
        <render_choice>
          <flow_label>
            <response_label ident="A">
              <flow_mat>
                <material>
                  <mattext texttype="text/plain">1</mattext>
                </material>
              </flow_mat>
            </response_label>
          </flow_label>
          <flow_label>
            <response_label ident="B">
              <flow_mat>
                <material>
                  <mattext texttype="text/plain">2</mattext>
                </material>
              </flow_mat>
            </response_label>
          </flow_label>
          <flow_label>
            <response_label ident="C">
              <flow_mat>
                <material>
                  <mattext texttype="text/plain">4</mattext>
                </material>
              </flow_mat>
            </response_label>
          </flow_label>
        </render_choice>
      </response_lid>
    </presentation>
    <resprocessing>
      <respcondition>
        <conditionvar>
          <varequal respident="RESPONSE">B</varequal>
        </conditionvar>
        <setvar action="Set">100</setvar>
      </respcondition>
      <respcondition>
        <conditionvar>
          <varequal respident="RESPONSE">C</varequal>
        </conditionvar>
        <setvar action="Set">100</setvar>
      </respcondition>
    </resprocessing>
  </item>
  <item ident="ITEM-3" label="Question 3">
    <presentation>
      <flow>
        <material>
          <mattext texttype="text/plain">Type the capital of France.</mattext>
        </material>
      </flow>
      <response_str ident="RESPONSE">
        <render_fib fibtype="String" maxchars="32"/>
      </response_str>
    </presentation>
    <resprocessing>
      <respcondition>
        <conditionvar>
          <varequal respident="RESPONSE">Paris</varequal>
        </conditionvar>
        <setvar action="Set">100</setvar>
      </respcondition>
    </resprocessing>
  </item>
  <item ident="ITEM-4" label="Question 4">
    <presentation>
      <flow>
        <material>
          <mattext texttype="text/plain">Explain why voting matters.</mattext>
        </material>
      </flow>
      <response_str ident="RESPONSE">
        <render_fib fibtype="String" rows="6" columns="60"/>
      </response_str>
    </presentation>
  </item>
</questestinterop>`;

describe('Brightspace QuestestInterop support', () => {
  test('parses Brightspace XML into deterministic rows', async () => {
    const spreadsheet = await parseSpreadsheet(BRIGHTSPACE_XML, { format: 'xml', fileName: 'brightspace.xml' });

    expect(spreadsheet.format).toBe('xml');
    expect(spreadsheet.fileName).toBe('brightspace.xml');
    expect(spreadsheet.rows).toHaveLength(4);
    expect(spreadsheet.rows[0].identifier).toBe('ITEM-1');
    expect(spreadsheet.rows[0].prompt).toBe('What is 2+2?');
    expect(spreadsheet.rows[0].correctResponse).toBe('B');
    expect(spreadsheet.rows[1].questionType).toBe('multiple_choice');
    expect(spreadsheet.rows[1].selectionMode).toBe('multiple');
    expect(spreadsheet.rows[1].correctResponse).toBe('B,C');
    expect(spreadsheet.rows[2].questionType).toBe('short_text');
    expect(spreadsheet.rows[2].expectedLength).toBe('32');
    expect(spreadsheet.rows[3].questionType).toBe('extended_text');
    expect(JSON.parse(spreadsheet.rows[0].optionsJson)).toEqual([
      { id: 'A', text: '3' },
      { id: 'B', text: '4' }
    ]);
  });

  test('converts Brightspace XML without invoking the LLM', async () => {
    const result = await convertSpreadsheetToQtiPackage(BRIGHTSPACE_XML, {
      packageIdentifier: 'brightspace-demo',
      llmSettings: {
        createEngine: async () => {
          throw new Error('LLM should not be called for Brightspace XML');
        }
      }
    });

    const zip = await JSZip.loadAsync(result.packageBlob as Blob);
    const item = await zip.file('items/ITEM-1.xml')?.async('string');

    expect(result.questions).toHaveLength(4);
    expect(result.questions[0].identifier).toBe('ITEM-1');
    expect(result.questions[0].title).toBe('Question 1');
    expect(result.questions[0].prompt).toBe('What is 2+2?');
    expect(result.questions[1].selectionMode).toBe('multiple');
    expect(result.questions[1].correctResponse).toBe('B,C');
    expect(result.questions[2].type).toBe('short_text');
    expect(result.questions[2].correctResponse).toBe('Paris');
    expect(result.questions[3].type).toBe('extended_text');
    expect(item).toContain('What is 2+2?');
    expect(item).toContain('>4<');
    expect(item).toContain('<qti-value>B</qti-value>');

    const multiSelectItem = await zip.file('items/ITEM-2.xml')?.async('string');
    const shortTextItem = await zip.file('items/ITEM-3.xml')?.async('string');
    const essayItem = await zip.file('items/ITEM-4.xml')?.async('string');

    expect(multiSelectItem).toContain('max-choices="2"');
    expect(multiSelectItem).toContain('<qti-value>B</qti-value>');
    expect(multiSelectItem).toContain('<qti-value>C</qti-value>');
    expect(shortTextItem).toContain('qti-text-entry-interaction');
    expect(shortTextItem).toContain('<qti-value>Paris</qti-value>');
    expect(shortTextItem).toContain('match_correct.xml');
    expect(essayItem).toContain('qti-extended-text-interaction');
    expect(essayItem).toContain('expected-length="60"');
  });
});
