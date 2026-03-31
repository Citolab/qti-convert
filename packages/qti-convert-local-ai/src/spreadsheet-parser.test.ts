import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { buildDatasetPreview, parseSpreadsheet } from './spreadsheet-parser';

describe('parseSpreadsheet', () => {
  test('parses csv input into ordered columns and rows', async () => {
    const spreadsheet = await parseSpreadsheet(`Question,Answer A,Answer B,Correct,Points
Capital of France?,Paris,Berlin,A,2
2+2?,3,4,B,1`);

    expect(spreadsheet.format).toBe('csv');
    expect(spreadsheet.columns).toEqual(['Question', 'Answer A', 'Answer B', 'Correct', 'Points']);
    expect(spreadsheet.rows[0]).toEqual({
      Question: 'Capital of France?',
      'Answer A': 'Paris',
      'Answer B': 'Berlin',
      Correct: 'A',
      Points: '2'
    });
  });

  test('parses xlsx buffers and preserves the selected sheet name', async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
      { Question: 'Largest planet?', 'Answer A': 'Mars', 'Answer B': 'Jupiter', Correct: 'B', Points: 3 }
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Questions');
    const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const spreadsheet = await parseSpreadsheet(arrayBuffer, { sheetName: 'Questions', format: 'xlsx' });

    expect(spreadsheet.sheetName).toBe('Questions');
    expect(spreadsheet.rows[0].Question).toBe('Largest planet?');
    expect(spreadsheet.rows[0].Points).toBe('3');
  });

  test('builds compact dataset previews', async () => {
    const spreadsheet = await parseSpreadsheet(`Question,Answer A,Answer B,Correct
Q1,A1,B1,A
Q2,A2,B2,B`);

    const preview = buildDatasetPreview(spreadsheet, 1);

    expect(preview.rowCount).toBe(2);
    expect(preview.sampleRows).toHaveLength(1);
    expect(preview.columns).toEqual(['Question', 'Answer A', 'Answer B', 'Correct']);
  });
});
