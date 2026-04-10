/* @vitest-environment jsdom */

import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { convertGoogleFormToQtiPackage, parseGoogleForm } from '../src/converters';

const GOOGLE_FORM_HTML = `<!DOCTYPE html>
<html>
  <head><title>Form</title></head>
  <body>
    <script>
      FB_PUBLIC_LOAD_DATA_ = [null,[
        "This form checks general knowledge.",
        [
          ["q1","Pick one fruit","Choose the best answer",2,[[111,[["Apple"],["Banana"],["Pear"]],1]],null,null,null],
          ["q2","Pick all prime numbers","Multiple answers are allowed",4,[[222,[["2"],["3"],["4"]],0]],null,null,null],
          ["q3","Pick a country","Dropdown example",3,[[333,[["France"],["Germany"]],0]],null,null,null],
          ["q4","Type the capital of France","Short answer",0,[[444,null,1]],null,null,null],
          ["q5","Explain your reasoning","Paragraph answer",1,[[555,null,0]],null,null,null],
          ["q6","Rate the lesson","1 means poor, 5 means excellent",5,[[666,null,1,1,5]],null,null,null],
          ["q7","Match each city to a country","Grid example",7,[
            [777,[["France"],["Germany"]],1,"Paris"],
            [778,[["France"],["Germany"]],1,"Berlin"]
          ],null,null,null]
        ],
        null,null,null,null,null,null,
        "Knowledge Check"
      ],null,"knowledge-check-form"];
    </script>
  </body>
</html>`;

describe('Google Forms support', () => {
  test('parses supported Google Forms questions from FB_PUBLIC_LOAD_DATA_', () => {
    const parsed = parseGoogleForm(GOOGLE_FORM_HTML);

    expect(parsed.title).toBe('Knowledge Check');
    expect(parsed.description).toBe('This form checks general knowledge.');
    expect(parsed.questions).toHaveLength(8);
    expect(parsed.questions[0]).toMatchObject({
      type: 'multiple_choice',
      prompt: 'Pick one fruit',
      selectionMode: 'single'
    });
    expect(parsed.questions[1]).toMatchObject({
      type: 'multiple_choice',
      prompt: 'Pick all prime numbers',
      selectionMode: 'multiple'
    });
    expect(parsed.questions[3]).toMatchObject({
      type: 'short_text',
      prompt: 'Type the capital of France'
    });
    expect(parsed.questions[4]).toMatchObject({
      type: 'extended_text',
      prompt: 'Explain your reasoning'
    });
    expect(parsed.questions[5]?.options?.map(option => option.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(parsed.questions[6]).toMatchObject({
      title: 'Match each city to a country - Paris',
      stimulus: 'Match each city to a country',
      prompt: 'Paris'
    });
    expect(parsed.questions[7]).toMatchObject({
      title: 'Match each city to a country - Berlin',
      prompt: 'Berlin'
    });
  });

  test('converts Google Forms HTML to a QTI package', async () => {
    const result = await convertGoogleFormToQtiPackage(GOOGLE_FORM_HTML, {
      packageIdentifier: 'google-form-demo'
    });

    const zip = await JSZip.loadAsync(result.packageBlob as Blob);
    const multiChoiceItem = await zip.file('items/google-form-item-1.xml')?.async('string');
    const shortTextItem = await zip.file('items/google-form-item-4.xml')?.async('string');
    const scaleItem = await zip.file('items/google-form-item-6.xml')?.async('string');
    const gridRowItem = await zip.file('items/google-form-item-7-1.xml')?.async('string');

    expect(result.formTitle).toBe('Knowledge Check');
    expect(result.questions).toHaveLength(8);
    expect(multiChoiceItem).toContain('Pick one fruit');
    expect(multiChoiceItem).toContain('>Apple<');
    expect(shortTextItem).toContain('qti-text-entry-interaction');
    expect(scaleItem).toContain('>5<');
    expect(gridRowItem).toContain('Match each city to a country');
    expect(gridRowItem).toContain('>France<');
  });
});
