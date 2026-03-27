import { describe, expect, test } from 'vitest';
import { createQuestionPrompt, inferQuestionsFromRawResponse } from './mapping';

describe('question inference helpers', () => {
  test('extracts normalized multiple choice questions from JSON responses', () => {
    const inference = inferQuestionsFromRawResponse(`{
      "questions": [
        {
          "type": "multiple_choice",
          "stimulus": "Read the text",
          "prompt": "What is correct?",
          "options": [
            { "id": "A", "text": "Option 1", "isCorrectAnswer": false },
            { "id": "B", "text": "Option 2", "isCorrectAnswer": true }
          ],
          "layout": "two_column",
          "points": 2
        }
      ]
    }`);

    expect(inference.questions).toEqual([
      {
        type: 'multiple_choice',
        identifier: 'item-1',
        title: undefined,
        stimulus: 'Read the text',
        prompt: 'What is correct?',
        options: [
          { id: 'A', text: 'Option 1', isCorrectAnswer: false },
          { id: 'B', text: 'Option 2', isCorrectAnswer: true }
        ],
        correctResponse: undefined,
        expectedLength: undefined,
        layout: 'two_column',
        points: 2
      }
    ]);
  });

  test('extracts normalized extended text questions', () => {
    const inference = inferQuestionsFromRawResponse(`{
      "items": [
        {
          "type": "open_text",
          "stimulus": "Longer source text",
          "prompt": "Explain the main idea.",
          "correctResponse": "key",
          "expectedLength": 250
        }
      ]
    }`);

    expect(inference.questions[0]).toEqual({
      type: 'extended_text',
      identifier: 'item-1',
      title: undefined,
      stimulus: 'Longer source text',
      prompt: 'Explain the main idea.',
      options: undefined,
      correctResponse: 'key',
      expectedLength: 250,
      layout: 'auto',
      points: undefined
    });
  });

  test('repairs malformed llm json before parsing', () => {
    const inference = inferQuestionsFromRawResponse(`{
      questions: [
        {
          type: 'multiple_choice',
          prompt: 'What is correct?',
          options: [
            { id: 'A', text: 'Option 1', isCorrectAnswer: false },
            { id: 'B', text: 'Option 2', isCorrectAnswer: true },
          ],
        }
      ]
    }`);

    expect(inference.questions[0]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-1',
      title: undefined,
      stimulus: undefined,
      prompt: 'What is correct?',
      options: [
        { id: 'A', text: 'Option 1', isCorrectAnswer: false },
        { id: 'B', text: 'Option 2', isCorrectAnswer: true }
      ],
      correctResponse: undefined,
      expectedLength: undefined,
      layout: 'auto',
      points: undefined
    });
  });

  test('extracts the question payload when the model echoes extra json first', () => {
    const inference = inferQuestionsFromRawResponse(`The spreadsheet looks like this:
    {
      "columns": ["text", "answer", "a", "b", "c"],
      "sampleRows": [
        { "text": "Q1", "answer": "B", "a": "1", "b": "2", "c": "3" }
      ]
    }

    Final answer:
    {
      "questions": [
        {
          "type": "multiple_choice",
          "prompt": "Q1",
          "options": [
            { "id": "A", "text": "1", "isCorrectAnswer": false },
            { "id": "B", "text": "2", "isCorrectAnswer": true },
            { "id": "C", "text": "3", "isCorrectAnswer": false }
          ]
        }
      ]
    }`);

    expect(inference.questions).toHaveLength(1);
    expect(inference.questions[0].prompt).toBe('Q1');
  });

  test('creates a prompt with parsed spreadsheet rows', () => {
    const prompt = createQuestionPrompt({
      columns: ['Question', 'Answer A', 'Answer B', 'Correct'],
      rows: [{ Question: 'Q1', 'Answer A': 'A1', 'Answer B': 'B1', Correct: 'B' }],
      format: 'csv',
      fileName: 'demo.csv'
    });

    expect(prompt).toContain('"rows"');
    expect(prompt).toContain('"Question": "Q1"');
    expect(prompt).toContain('correctResponse');
  });

  test('bounds the prompt payload for local model context windows', () => {
    const prompt = createQuestionPrompt({
      columns: ['Question', 'Answer A'],
      rows: Array.from({ length: 30 }, (_, index) => ({
        Question: `Question ${index + 1} ${'x'.repeat(400)}`,
        'Answer A': `Answer ${index + 1}`
      })),
      format: 'csv',
      fileName: 'large.csv'
    });

    expect(prompt).toContain('"totalRowCount": 30');
    expect(prompt).toContain('Chunk trimmed for local model limits');
    expect(prompt).toContain('Question 13');
    expect(prompt).not.toContain('x'.repeat(300));
  });
});
