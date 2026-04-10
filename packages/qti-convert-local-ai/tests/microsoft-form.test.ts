/* @vitest-environment jsdom */

import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import {
  convertMicrosoftFormToQtiPackage,
  extractMicrosoftFormPrefetchRequest
} from '../src/converters';

const MICROSOFT_FORM_HTML = `<!DOCTYPE html>
<html>
  <head><title>Microsoft Forms</title></head>
  <body>
    <script>
      window.OfficeFormServerInfo = {
        "antiForgeryToken": "anti-forgery-token",
        "serverSessionId": "session-id-123",
        "prefetchFormUrl": "https://forms.office.com/formapi/api/tenant/users/user/light/runtimeForms('abc')?$expand=questions($expand=choices)"
      };
    </script>
  </body>
</html>`;

const MICROSOFT_RUNTIME_FORM_JSON = JSON.stringify({
  title: 'Knowledge Check',
  description: 'Imported from Microsoft Forms',
  questions: [
    {
      id: 'choice-single',
      order: 1,
      title: 'Pick one fruit',
      formsProRTQuestionTitle: 'Pick one fruit',
      type: 'Question.Choice',
      allowMultipleValues: false,
      questionInfo: JSON.stringify({
        Choices: [{ Description: 'Apple', IsAnswerKey: true }, { Description: 'Banana' }, { Description: 'Pear' }],
        ChoiceType: 1
      })
    },
    {
      id: 'choice-multi',
      order: 2,
      title: 'Pick all prime numbers',
      type: 'Question.Choice',
      allowMultipleValues: true,
      questionInfo: JSON.stringify({
        Choices: [{ Description: '2', IsAnswerKey: true }, { Description: '3', IsAnswerKey: true }, { Description: '4' }]
      })
    },
    {
      id: 'short-answer',
      order: 3,
      title: 'Type the capital of France',
      type: 'Question.TextField',
      questionInfo: JSON.stringify({
        Multiline: false,
        CorrectAnswer: 'Paris'
      })
    },
    {
      id: 'long-answer',
      order: 4,
      title: 'Explain your reasoning',
      type: 'Question.TextField',
      questionInfo: JSON.stringify({
        Multiline: true
      })
    },
    {
      id: 'rating',
      order: 5,
      title: 'Rate the lesson',
      type: 'Question.Rating',
      questionInfo: JSON.stringify({
        RatingLevel: 5
      })
    },
    {
      id: 'matrix',
      order: 6,
      title: 'Match each city to a country',
      type: 'Question.MatrixChoice',
      questionInfo: JSON.stringify({
        Choices: [{ Description: 'France' }, { Description: 'Germany' }],
        Rows: ['Paris', 'Berlin']
      })
    }
  ]
});

describe('Microsoft Forms support', () => {
  test('extracts the prefetch request and headers from OfficeFormServerInfo', () => {
    const prefetchRequest = extractMicrosoftFormPrefetchRequest(MICROSOFT_FORM_HTML);

    expect(prefetchRequest).toEqual({
      url: "https://forms.office.com/formapi/api/tenant/users/user/light/runtimeForms('abc')?$expand=questions($expand=choices)",
      headers: {
        __RequestVerificationToken: 'anti-forgery-token',
        'X-UserSessionId': 'session-id-123',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });
  });

  test('converts Microsoft Forms HTML to a QTI package through the runtime form API', async () => {
    const result = await convertMicrosoftFormToQtiPackage(MICROSOFT_FORM_HTML, {
      packageIdentifier: 'microsoft-form-demo',
      fetchRuntimeForm: async (url, init) => {
        expect(url).toContain("runtimeForms('abc')");
        expect(init?.headers).toMatchObject({
          __RequestVerificationToken: 'anti-forgery-token',
          'X-UserSessionId': 'session-id-123'
        });
        return MICROSOFT_RUNTIME_FORM_JSON;
      }
    });

    const zip = await JSZip.loadAsync(result.packageBlob as Blob);
    const multiChoiceItem = await zip.file('items/choice-single.xml')?.async('string');
    const shortTextItem = await zip.file('items/short-answer.xml')?.async('string');
    const ratingItem = await zip.file('items/rating.xml')?.async('string');
    const matrixRowItem = await zip.file('items/matrix-1.xml')?.async('string');

    expect(result.formTitle).toBe('Knowledge Check');
    expect(result.formDescription).toBe('Imported from Microsoft Forms');
    expect(result.questions).toHaveLength(7);
    expect(result.questions[0]).toMatchObject({
      type: 'multiple_choice',
      prompt: 'Pick one fruit',
      selectionMode: 'single'
    });
    expect(result.questions[1]).toMatchObject({
      type: 'multiple_choice',
      prompt: 'Pick all prime numbers',
      selectionMode: 'multiple'
    });
    expect(result.questions[2]).toMatchObject({
      type: 'short_text',
      prompt: 'Type the capital of France',
      correctResponse: 'Paris'
    });
    expect(result.questions[3]).toMatchObject({
      type: 'extended_text',
      prompt: 'Explain your reasoning'
    });
    expect(result.questions[4]?.options?.map(option => option.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(result.questions[5]).toMatchObject({
      title: 'Match each city to a country - Paris',
      stimulus: 'Match each city to a country',
      prompt: 'Paris'
    });
    expect(result.questions[6]).toMatchObject({
      title: 'Match each city to a country - Berlin',
      prompt: 'Berlin'
    });
    expect(multiChoiceItem).toContain('Pick one fruit');
    expect(multiChoiceItem).toContain('>Apple<');
    expect(shortTextItem).toContain('qti-text-entry-interaction');
    expect(ratingItem).toContain('>5<');
    expect(matrixRowItem).toContain('Match each city to a country');
    expect(matrixRowItem).toContain('>France<');
  });
});
