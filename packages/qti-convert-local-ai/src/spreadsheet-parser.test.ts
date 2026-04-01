import ExcelJS from 'exceljs';
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

  test('parses csv files when papaparse is resolved through default export interop', async () => {
    const file = new File(
      [`Question,Answer A,Answer B,Correct\nLargest mammal?,Elephant,Blue whale,B`],
      'questions.csv',
      { type: 'text/csv' }
    );

    const spreadsheet = await parseSpreadsheet(file);

    expect(spreadsheet.format).toBe('csv');
    expect(spreadsheet.rows[0]).toEqual({
      Question: 'Largest mammal?',
      'Answer A': 'Elephant',
      'Answer B': 'Blue whale',
      Correct: 'B'
    });
  });

  test('parses xlsx buffers and preserves the selected sheet name', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Questions');
    worksheet.columns = [
      { header: 'Question', key: 'Question' },
      { header: 'Answer A', key: 'Answer A' },
      { header: 'Answer B', key: 'Answer B' },
      { header: 'Correct', key: 'Correct' },
      { header: 'Points', key: 'Points' }
    ];
    worksheet.addRow({
      Question: 'Largest planet?',
      'Answer A': 'Mars',
      'Answer B': 'Jupiter',
      Correct: 'B',
      Points: 3
    });
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    const spreadsheet = await parseSpreadsheet(buffer, { sheetName: 'Questions', format: 'xlsx' });

    expect(spreadsheet.sheetName).toBe('Questions');
    expect(spreadsheet.rows[0].Question).toBe('Largest planet?');
    expect(spreadsheet.rows[0].Points).toBe('3');
  });

  test('parses xlsx input without relying on the Node Buffer global', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Questions');
    worksheet.columns = [
      { header: 'Question', key: 'Question' },
      { header: 'Answer A', key: 'Answer A' },
      { header: 'Answer B', key: 'Answer B' },
      { header: 'Correct', key: 'Correct' }
    ];
    worksheet.addRow({ Question: 'Largest ocean?', 'Answer A': 'Atlantic', 'Answer B': 'Pacific', Correct: 'B' });
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    const originalBuffer = globalThis.Buffer;
    // Simulate the browser runtime where Buffer is not available.
    globalThis.Buffer = undefined;

    try {
      const spreadsheet = await parseSpreadsheet(buffer, { sheetName: 'Questions', format: 'xlsx' });

      expect(spreadsheet.sheetName).toBe('Questions');
      expect(spreadsheet.rows[0].Question).toBe('Largest ocean?');
      expect(spreadsheet.rows[0].Correct).toBe('B');
    } finally {
      globalThis.Buffer = originalBuffer;
    }
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
