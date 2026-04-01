import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { convertSpreadsheetToQtiPackage } from './convert-spreadsheet';
import { generateQtiPackageFromQuestions } from './qti-generator';

describe('generateQtiPackageFromQuestions', () => {
  test('creates a QTI package zip with manifest, test, and items', async () => {
    const result = await generateQtiPackageFromQuestions(
      [
        {
          type: 'multiple_choice',
          prompt: 'Capital of France?',
          options: [
            { id: 'A', text: 'Paris', isCorrectAnswer: true },
            { id: 'B', text: 'Berlin', isCorrectAnswer: false }
          ],
          points: 2
        }
      ],
      {
        packageIdentifier: 'geo-demo',
        testTitle: 'Geography Demo'
      }
    );

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const manifest = await zip.file('imsmanifest.xml')?.async('string');
    const assessment = await zip.file('assessment-test.xml')?.async('string');
    const item = await zip.file('items/item-001.xml')?.async('string');

    expect(result.packageName).toBe('geo-demo.zip');
    expect(manifest).toContain('imsqti_test_xmlv3p0');
    expect(assessment).toContain('Geography Demo');
    expect(item).toContain('Capital of France?');
    expect(item).toContain('<qti-value>A</qti-value>');
    expect(item).toContain('max-choices="1"');
    expect(result.summary.generatedItems).toBe(1);
    expect(result.summary.warnings).toHaveLength(0);
  });

  test('converts a spreadsheet end to end with a provided question inferer', async () => {
    const progressStages: string[] = [];
    const result = await convertSpreadsheetToQtiPackage(
      `Question,Answer A,Answer B,Correct,Points
2+2?,3,4,B,1`,
      async spreadsheet => [
        {
          type: 'multiple_choice',
          prompt: spreadsheet.rows[0].Question,
          options: [
            { id: 'A', text: spreadsheet.rows[0]['Answer A'], isCorrectAnswer: false },
            { id: 'B', text: spreadsheet.rows[0]['Answer B'], isCorrectAnswer: true }
          ],
          points: 1
        }
      ],
      {
        packageIdentifier: 'math-demo',
        onProgress: event => {
          progressStages.push(event.stage);
        }
      }
    );

    const zip = await JSZip.loadAsync(await result.packageBlob.arrayBuffer());
    const item = await zip.file('items/item-001.xml')?.async('string');

    expect(result.questions[0].prompt).toBe('2+2?');
    expect(item).toContain('2+2?');
    expect(item).toContain('<qti-value>B</qti-value>');
    expect(result.processable).toBe(true);
    expect(result.summary.generatedItems).toBe(1);
    expect(progressStages).toEqual([
      'parse_started',
      'parse_completed',
      'mapping_started',
      'mapping_completed',
      'generation_started',
      'item_generated',
      'package_completed'
    ]);
  });

  test('uses built-in WebLLM inference with overridable llmSettings', async () => {
    const progressStages: string[] = [];
    const result = await convertSpreadsheetToQtiPackage(`Question,Answer A,Answer B
Pick one,Left,Right`, {
      packageIdentifier: 'llm-demo',
      llmSettings: {
        model: 'Qwen-Test-Model',
        createEngine: async () => ({
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        questions: [
                          {
                            type: 'multiple_choice',
                            prompt: 'Pick one',
                            options: [
                              { id: 'A', text: 'Left', isCorrectAnswer: true },
                              { id: 'B', text: 'Right', isCorrectAnswer: false }
                            ]
                          }
                        ]
                      })
                    }
                  }
                ]
              })
            }
          }
        })
      },
      onProgress: event => {
        progressStages.push(event.stage);
      }
    });

    const zip = await JSZip.loadAsync(await result.packageBlob.arrayBuffer());
    const item = await zip.file('items/item-1.xml')?.async('string');

    expect(result.questions).toHaveLength(1);
    expect(result.processable).toBe(true);
    expect(item).toContain('Pick one');
    expect(result.summary.generatedItems).toBe(1);
    expect(progressStages).toContain('llm_loading_started');
    expect(progressStages).toContain('llm_loading_completed');
  });

  test('processes large spreadsheets in chunks and merges results in order', async () => {
    const prompts: string[] = [];
    const result = await convertSpreadsheetToQtiPackage(
      `Question,Answer A,Answer B
Q1,A1,B1
Q2,A2,B2
Q3,A3,B3
Q4,A4,B4
Q5,A5,B5
Q6,A6,B6`,
      {
        packageIdentifier: 'chunked-demo',
        llmSettings: {
          chunkSize: 2,
          createEngine: async () => ({
            chat: {
              completions: {
                create: async (request: { messages: Array<{ content: string }> }) => {
                  const prompt = request.messages[1].content;
                  prompts.push(prompt);
                  const chunkMatch = prompt.match(/"chunkIndex":\s*(\d+)/);
                  const chunkIndex = Number(chunkMatch?.[1] || 1);
                  const base = (chunkIndex - 1) * 2;
                  return {
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            questions: [
                              {
                                type: 'multiple_choice',
                                prompt: `Q${base + 1}`,
                                options: [
                                  { id: 'A', text: `A${base + 1}`, isCorrectAnswer: true },
                                  { id: 'B', text: `B${base + 1}`, isCorrectAnswer: false }
                                ]
                              },
                              {
                                type: 'multiple_choice',
                                prompt: `Q${base + 2}`,
                                options: [
                                  { id: 'A', text: `A${base + 2}`, isCorrectAnswer: true },
                                  { id: 'B', text: `B${base + 2}`, isCorrectAnswer: false }
                                ]
                              }
                            ]
                          })
                        }
                      }
                    ]
                  };
                }
              }
            }
          })
        }
      }
    );

    expect(prompts).toHaveLength(3);
    expect(result.questions).toHaveLength(6);
    expect(result.processable).toBe(true);
    expect(result.questions[0].identifier).toBe('item-1');
    expect(result.questions[5].identifier).toBe('item-6');
    expect(result.questions[5].prompt).toBe('Q6');
  });

  test('uses deterministic parsing for text answer a-e spreadsheets', async () => {
    const result = await convertSpreadsheetToQtiPackage(`text,answer,a,b,c,d,e
What is 2+2?,B,3,4,5,6,7`, {
      packageIdentifier: 'deterministic-demo',
      llmSettings: {
        createEngine: async () => {
          throw new Error('LLM should not be called for deterministic spreadsheet format');
        }
      }
    });

    const zip = await JSZip.loadAsync(await result.packageBlob.arrayBuffer());
    const item = await zip.file('items/item-1.xml')?.async('string');

    expect(result.questions[0].prompt).toBe('What is 2+2?');
    expect(result.processable).toBe(true);
    expect(item).toContain('What is 2+2?');
    expect(item).toContain('>4<');
    expect(item).toContain('<qti-value>B</qti-value>');
    expect(item).not.toContain('longer shared text if present');
    expect(item).not.toContain('Option 1');
  });

  test('returns an unprocessable result for unrelated spreadsheets without calling the llm', async () => {
    const progressStages: string[] = [];
    const result = await convertSpreadsheetToQtiPackage(
      `Name,Department,Extension
Alice,Finance,1042
Bob,Operations,2041`,
      {
        llmSettings: {
          createEngine: async () => {
            throw new Error('LLM should not be called for unprocessable spreadsheets');
          }
        },
        onProgress: event => {
          progressStages.push(event.stage);
        }
      }
    );

    expect(result.processable).toBe(false);
    expect(result.reason).toContain('does not appear to contain question-like rows');
    expect(result.questions).toHaveLength(0);
    expect(result.packageBlob).toBeUndefined();
    expect(result.packageName).toBeUndefined();
    expect(result.summary.generatedItems).toBe(0);
    expect(progressStages).toEqual(['parse_started', 'parse_completed', 'mapping_started', 'mapping_completed']);
  });

  test('uses deterministic parsing for row-oriented item export spreadsheets', async () => {
    const result = await convertSpreadsheetToQtiPackage(
      `SE_ItemLabel,element_type,Element_type_displayLabel,Element_Text_Plain,Element_Text_HTML,CorrectAnswer
item-1,stimulus,Stimulus,Democracy means citizens vote,,
item-1,question,Item Question,What is democracy?,,
item-1,choice_box_1,Response Option,Rule by one person,,A
item-1,choice_box_2,Response Option,Rule by citizens,,B`,
      {
        packageIdentifier: 'row-export-demo',
        llmSettings: {
          createEngine: async () => {
            throw new Error('LLM should not be called for row-oriented spreadsheet format');
          }
        }
      }
    );

    const zip = await JSZip.loadAsync(await result.packageBlob.arrayBuffer());
    const item = await zip.file('items/item-1.xml')?.async('string');

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].prompt).toBe('What is democracy?');
    expect(result.questions[0].stimulus).toBe('Democracy means citizens vote');
    expect(item).toContain('What is democracy?');
    expect(item).toContain('Democracy means citizens vote');
    expect(item).toContain('<qti-value>B</qti-value>');
  });

  test('resolves correct options from correctResponse text when flags are missing', async () => {
    const result = await generateQtiPackageFromQuestions(
      [
        {
          type: 'multiple_choice',
          prompt: 'Pick the correct value',
          correctResponse: '4',
          options: [
            { id: 'A', text: '3' },
            { id: 'B', text: '4' },
            { id: 'C', text: '5' }
          ]
        }
      ],
      {
        packageIdentifier: 'fallback-answer-demo'
      }
    );

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const item = await zip.file('items/item-001.xml')?.async('string');

    expect(item).toContain('<qti-value>B</qti-value>');
  });

  test('keeps multiple choice items without a resolved correct answer and reports a warning', async () => {
    const result = await generateQtiPackageFromQuestions(
      [
        {
          type: 'multiple_choice',
          prompt: 'Pick one',
          options: [
            { id: 'A', text: 'Left' },
            { id: 'B', text: 'Right' }
          ]
        }
      ],
      {
        packageIdentifier: 'warning-demo'
      }
    );

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const item = await zip.file('items/item-001.xml')?.async('string');

    expect(item).toContain('<qti-choice-interaction');
    expect(item).not.toContain('<qti-correct-response>');
    expect(result.summary.generatedItems).toBe(1);
    expect(result.summary.warnings).toHaveLength(1);
    expect(result.summary.warnings[0].message).toContain('does not contain a resolved correct response');
  });

  test('renders extended text items and two-column layout when requested', async () => {
    const result = await generateQtiPackageFromQuestions(
      [
        {
          type: 'extended_text',
          stimulus:
            'Airport notice\n\nPassengers should remain with their luggage at all times and report unattended bags immediately.',
          prompt: 'Explain what the notice tells passengers to do.',
          correctResponse: 'key',
          expectedLength: 200,
          layout: 'two_column',
          points: 3
        }
      ],
      {
        packageIdentifier: 'open-demo'
      }
    );

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const item = await zip.file('items/item-001.xml')?.async('string');

    expect(item).toContain('qti-layout-row');
    expect(item).toContain('qti-layout-col6');
    expect(item).toContain('<qti-extended-text-interaction');
    expect(item).toContain('expected-length="200"');
  });

  test('writes stimulus images into the qti package and item xml', async () => {
    const result = await generateQtiPackageFromQuestions(
      [
        {
          type: 'multiple_choice',
          prompt: 'What do you see?',
          stimulusImages: [
            {
              fileName: 'image1.png',
              mimeType: 'image/png',
              data: new Uint8Array([137, 80, 78, 71])
            }
          ],
          options: [
            { id: 'A', text: 'A cat' },
            { id: 'B', text: 'A dog' }
          ]
        }
      ],
      {
        packageIdentifier: 'image-demo'
      }
    );

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const item = await zip.file('items/item-001.xml')?.async('string');
    const image = await zip.file('assets/image1.png')?.async('uint8array');

    expect(item).toContain('<img src="../assets/image1.png"');
    expect(image).toBeDefined();
    expect(Array.from(image || [])).toEqual([137, 80, 78, 71]);
  });
});
