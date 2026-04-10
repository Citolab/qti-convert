import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { convertDocxToQtiPackage, extractQuestionsFromParagraphs, parseDocx } from '../src/converters';

const createDocxBuffer = async (paragraphs: string[]): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
      ${paragraphs
        .map(
          paragraph =>
            `<w:p>${paragraph
              .split('\n')
              .map(
                (line, index) =>
                  `${index > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${line
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;')}</w:t></w:r>`
              )
              .join('')}</w:p>`
        )
        .join('')}
    </w:body>
  </w:document>`;

  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'arraybuffer' });
};

const createDocxBufferWithImage = async (paragraphs: string[], imageParagraphIndex: number): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <w:body>
      ${paragraphs
        .map((paragraph, paragraphIndex) => {
          const textRuns = paragraph
            .split('\n')
            .map(
              (line, index) =>
                `${index > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${line
                  .replaceAll('&', '&amp;')
                  .replaceAll('<', '&lt;')
                  .replaceAll('>', '&gt;')}</w:t></w:r>`
            )
            .join('');
          const imageRun =
            paragraphIndex === imageParagraphIndex
              ? `<w:r><w:drawing><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r>`
              : '';
          return `<w:p>${textRuns}${imageRun}</w:p>`;
        })
        .join('')}
    </w:body>
  </w:document>`;

  const relationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  </Relationships>`;

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relationshipsXml);
  zip.file('word/media/image1.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'arraybuffer' });
};

describe('docx-parser', () => {
  test('extracts likely questions from numbered paragraphs and ignores booklet boilerplate', () => {
    const questions = extractQuestionsFromParagraphs([
      'Booklet 01',
      'This booklet contains 20 questions.',
      'Read the text carefully before answering.',
      'Democracy means citizens vote in free elections.',
      '1. What is democracy?',
      'A. Rule by one person',
      'B. Rule by citizens',
      '2. Explain why voting matters.'
    ]);

    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-1',
      prompt: 'What is democracy?',
      stimulus: 'Read the text carefully before answering.\n\nDemocracy means citizens vote in free elections.',
      options: [
        { id: 'A', text: 'Rule by one person' },
        { id: 'B', text: 'Rule by citizens' }
      ],
      layout: 'auto'
    });
    expect(questions[1]).toEqual({
      type: 'extended_text',
      identifier: 'item-2',
      prompt: 'Explain why voting matters.',
      stimulus: undefined,
      options: undefined,
      layout: 'single_column',
      points: undefined
    });
  });

  test('parses docx buffers into paragraph text', async () => {
    const buffer = await createDocxBuffer(['Booklet 01', '1. What is 2+2?', 'A. 3', 'B. 4']);
    const document = await parseDocx(buffer);

    expect(document.paragraphs).toEqual(['Booklet 01', '1. What is 2+2?', 'A. 3', 'B. 4']);
  });

  test('splits line breaks inside a single word paragraph into separate logical lines', async () => {
    const buffer = await createDocxBuffer(['Booklet 01\n1. What is 2+2?\nA. 3\nB. 4\n2. Explain your answer.']);
    const document = await parseDocx(buffer);
    const questions = extractQuestionsFromParagraphs(document.paragraphs);

    expect(document.paragraphs).toEqual(['Booklet 01', '1. What is 2+2?', 'A. 3', 'B. 4', '2. Explain your answer.']);
    expect(questions).toHaveLength(2);
    expect(questions[0].prompt).toBe('What is 2+2?');
    expect(questions[1].prompt).toBe('Explain your answer.');
  });

  test('converts docx documents to qti packages', async () => {
    const buffer = await createDocxBuffer([
      'Booklet 01',
      'Democracy means citizens vote in free elections.',
      '1. What is democracy?',
      'A. Rule by one person',
      'B. Rule by citizens'
    ]);

    const result = await convertDocxToQtiPackage(buffer, {
      packageIdentifier: 'docx-demo',
      testTitle: 'DOCX Demo'
    });

    const zip = await JSZip.loadAsync(await result.packageBlob.arrayBuffer());
    const item = await zip.file('items/item-1.xml')?.async('string');

    expect(result.questions).toHaveLength(1);
    expect(result.preview.paragraphCount).toBe(5);
    expect(item).toContain('What is democracy?');
    expect(item).toContain('Rule by citizens');
    expect(result.summary.generatedItems).toBe(1);
  });

  test('prefers local llm segmentation and normalization for docx conversion', async () => {
    const buffer = await createDocxBuffer(['In welk jaar werd de VOC opgericht?', '1568', '1595', '1602', '1648']);

    let requestCount = 0;
    const result = await convertDocxToQtiPackage(buffer, {
      packageIdentifier: 'docx-llm-demo',
      llmSettings: {
        createEngine: async () => ({
          chat: {
            completions: {
              create: async () => {
                requestCount += 1;
                if (requestCount === 1) {
                  return {
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            items: [{ blockIndexes: [0, 1, 2, 3, 4] }]
                          })
                        }
                      }
                    ]
                  };
                }

                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          questions: [
                            {
                              type: 'multiple_choice',
                              prompt: 'In welk jaar werd de VOC opgericht?',
                              options: [
                                { id: 'A', text: '1568' },
                                { id: 'B', text: '1595' },
                                { id: 'C', text: '1602', isCorrectAnswer: true },
                                { id: 'D', text: '1648' }
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
    });

    expect(requestCount).toBe(2);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].type).toBe('multiple_choice');
    expect(result.questions[0].options).toHaveLength(4);
  });

  test('attaches extracted docx images to the segmented item they belong to', async () => {
    const buffer = await createDocxBufferWithImage(['1. First question?', '2. Second question with image?'], 1);

    let requestCount = 0;
    const result = await convertDocxToQtiPackage(buffer, {
      packageIdentifier: 'docx-image-placement-demo',
      llmSettings: {
        createEngine: async () => ({
          chat: {
            completions: {
              create: async () => {
                requestCount += 1;
                if (requestCount === 1) {
                  // Segmentation request
                  return {
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            items: [{ blockIndexes: [0] }, { blockIndexes: [1, 2] }]
                          })
                        }
                      }
                    ]
                  };
                }

                // Batch normalization request (all items in one call)
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          items: [
                            {
                              itemIndex: 0,
                              questions: [{ type: 'extended_text', prompt: 'First question?' }]
                            },
                            {
                              itemIndex: 1,
                              questions: [{ type: 'extended_text', prompt: 'Second question with image?' }]
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
    });

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].stimulusImages).toBeUndefined();
    expect(result.questions[1].stimulusImages).toHaveLength(1);
    expect(result.questions[1].stimulusImages?.[0].fileName).toBe('image1.png');
  });

  test('assigns image blocks to the nearest segmented item even if the llm omits image indexes', async () => {
    const buffer = await createDocxBufferWithImage(['1. First question?', '2. Second question with image?'], 1);

    let requestCount = 0;
    const result = await convertDocxToQtiPackage(buffer, {
      packageIdentifier: 'docx-image-nearest-demo',
      llmSettings: {
        createEngine: async () => ({
          chat: {
            completions: {
              create: async () => {
                requestCount += 1;
                if (requestCount === 1) {
                  // Segmentation request (image index omitted)
                  return {
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            items: [{ blockIndexes: [0] }, { blockIndexes: [1] }]
                          })
                        }
                      }
                    ]
                  };
                }

                // Batch normalization request (all items in one call)
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          items: [
                            {
                              itemIndex: 0,
                              questions: [{ type: 'extended_text', prompt: 'First question?' }]
                            },
                            {
                              itemIndex: 1,
                              questions: [{ type: 'extended_text', prompt: 'Second question with image?' }]
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
    });

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].stimulusImages).toBeUndefined();
    expect(result.questions[1].stimulusImages).toHaveLength(1);
  });

  test('treats lettered and bulleted lines as simple choices and extracts score markers', () => {
    const questions = extractQuestionsFromParagraphs([
      '1. Choose the correct answer. 2p',
      'A. First option',
      'B. Second option',
      '• Third option'
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-1',
      prompt: 'Choose the correct answer.',
      stimulus: undefined,
      options: [
        { id: 'A', text: 'First option' },
        { id: 'B', text: 'Second option' },
        { id: 'C', text: 'Third option' }
      ],
      layout: 'single_column',
      points: 2
    });
  });

  test('treats plain uppercase A B C D lines as simple choices when they appear as a block', () => {
    const questions = extractQuestionsFromParagraphs([
      '1. In welke eeuw brak er in de Nederlanden een opstand uit tegen de Spaanse koning?',
      'A vijftiende eeuw',
      'B zestiende eeuw',
      'C zeventiende eeuw',
      'D achttiende eeuw'
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-1',
      prompt: 'In welke eeuw brak er in de Nederlanden een opstand uit tegen de Spaanse koning?',
      stimulus: undefined,
      options: [
        { id: 'A', text: 'vijftiende eeuw' },
        { id: 'B', text: 'zestiende eeuw' },
        { id: 'C', text: 'zeventiende eeuw' },
        { id: 'D', text: 'achttiende eeuw' }
      ],
      layout: 'single_column',
      points: undefined
    });
  });

  test('converts underline placeholders into extended text prompts', () => {
    const questions = extractQuestionsFromParagraphs(['1. Write the missing word: ________ 1p']);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual({
      type: 'extended_text',
      identifier: 'item-1',
      prompt: 'Write the missing word:',
      stimulus: undefined,
      options: undefined,
      layout: 'single_column',
      points: 1
    });
  });

  test('treats lowercase lettered subquestions as separate extended text items, not simple choices', () => {
    const questions = extractQuestionsFromParagraphs([
      '5. Answer the following.',
      'a. Explain your answer.',
      'b. Give an example.',
      'c. Add one argument.'
    ]);

    expect(questions).toHaveLength(3);
    expect(questions[0]).toEqual({
      type: 'extended_text',
      identifier: 'item-2',
      prompt: 'Explain your answer.',
      stimulus: 'Answer the following.',
      options: undefined,
      layout: 'auto',
      points: undefined
    });
    expect(questions[1].prompt).toBe('Give an example.');
    expect(questions[2].prompt).toBe('Add one argument.');
  });

  test('splits embedded question runs and handles unlabeled numeric and text option blocks', () => {
    const questions = extractQuestionsFromParagraphs([
      'In welk jaar werd de VOC opgericht?',
      '1568',
      '1595',
      '1602',
      '1648 5. a Benoem een reden waarom de VOC werd opgericht. b Waarom moesten de schepen van de VOC een aantal tussenstops maken? 6. Door de blokkade van Antwerpen, vluchten veel kooplieden en arbeidskrachten naar Amsterdam. Zij nemen kennis en contacten mee. Welk begrip past het beste bij deze zin. Kies uit:',
      'Sociale bevolkingsgroep',
      'Natuurlijke bevolkingsgroei',
      'Regenten',
      'Monopolie 7. Noem 3 specerijen die de Nederlanders uit Indonesië haalde. 1 = 2 = 3 ='
    ]);

    expect(questions).toHaveLength(5);
    expect(questions[0]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-1',
      prompt: 'In welk jaar werd de VOC opgericht?',
      stimulus: undefined,
      options: [
        { id: 'A', text: '1568' },
        { id: 'B', text: '1595' },
        { id: 'C', text: '1602' },
        { id: 'D', text: '1648' }
      ],
      layout: 'single_column',
      points: undefined
    });
    expect(questions[1].prompt).toBe('Benoem een reden waarom de VOC werd opgericht.');
    expect(questions[2].prompt).toBe('Waarom moesten de schepen van de VOC een aantal tussenstops maken?');
    expect(questions[3]).toEqual({
      type: 'multiple_choice',
      identifier: 'item-4',
      prompt:
        'Door de blokkade van Antwerpen, vluchten veel kooplieden en arbeidskrachten naar Amsterdam. Zij nemen kennis en contacten mee. Welk begrip past het beste bij deze zin. Kies uit:',
      stimulus: undefined,
      options: [
        { id: 'A', text: 'Sociale bevolkingsgroep' },
        { id: 'B', text: 'Natuurlijke bevolkingsgroei' },
        { id: 'C', text: 'Regenten' },
        { id: 'D', text: 'Monopolie' }
      ],
      layout: 'single_column',
      points: undefined
    });
    expect(questions[4].type).toBe('extended_text');
    expect(questions[4].prompt).toBe('Noem 3 specerijen die de Nederlanders uit Indonesië haalde. 1 = 2 = 3 =');
  });
});
