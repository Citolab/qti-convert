import JSZip from 'jszip';
import {
  ConversionIssue,
  ConversionSummary,
  GenerateQtiPackageOptions,
  QuestionLayout,
  StructuredMediaAsset,
  StructuredOption,
  StructuredQuestion
} from './types';

type NormalizedItem = {
  questionIndex: number;
  identifier: string;
  title: string;
  type: 'multiple_choice' | 'extended_text';
  stimulus: string;
  stimulusImages: Array<StructuredMediaAsset & { id: string }>;
  prompt: string;
  expectedLength: number;
  layout: Exclude<QuestionLayout, 'auto'>;
  maxScore: number;
  options: Array<Required<Pick<StructuredOption, 'id' | 'text'>> & { isCorrectAnswer: boolean }>;
  correctResponse: string;
  correctIdentifiers: string[];
  selectionMode: 'single' | 'multiple';
};

type NormalizedQuestionResult = {
  item?: NormalizedItem;
  warnings: ConversionIssue[];
  errors: ConversionIssue[];
};

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const padNumber = (index: number) => String(index).padStart(3, '0');

const sanitizeIdentifier = (value: string, fallback: string): string => {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || fallback;
};

const shouldUseTwoColumnLayout = (stimulus: string, layout: QuestionLayout | undefined): boolean => {
  if (!stimulus) {
    return false;
  }
  if (layout === 'two_column') {
    return true;
  }
  if (layout === 'single_column') {
    return false;
  }
  const lineCount = stimulus.split(/\r?\n/).filter(Boolean).length;
  return stimulus.length >= 280 || lineCount >= 4;
};

const normalizeOptions = (options: StructuredOption[] | undefined): NormalizedItem['options'] =>
  (options || [])
    .map((option, index) => ({
      id: sanitizeIdentifier(option.id || String.fromCharCode(65 + index), `CHOICE_${index + 1}`),
      text: (option.text || '').trim(),
      isCorrectAnswer: Boolean(option.isCorrectAnswer)
    }))
    .filter(option => option.text);

const tokenizeCorrectResponse = (value: string): string[] =>
  value
    .split(/[;,|/]+/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);

const resolveCorrectIdentifiers = (
  normalizedOptions: NormalizedItem['options'],
  rawCorrectResponse: string
): string[] => {
  const explicitIdentifiers = normalizedOptions.filter(option => option.isCorrectAnswer).map(option => option.id);
  if (explicitIdentifiers.length > 0) {
    return explicitIdentifiers;
  }

  const correctResponse = rawCorrectResponse.trim();
  if (!correctResponse) {
    return [];
  }

  const tokens = tokenizeCorrectResponse(correctResponse);
  const tokenSet = new Set(tokens.length > 0 ? tokens : [correctResponse.toLowerCase()]);
  return normalizedOptions
    .filter((option, index) => {
      const numericId = String(index + 1);
      return (
        tokenSet.has(option.id.toLowerCase()) ||
        tokenSet.has(option.text.toLowerCase()) ||
        tokenSet.has(numericId)
      );
    })
    .map(option => option.id);
};

const normalizeQuestion = (question: StructuredQuestion, index: number, options: GenerateQtiPackageOptions): NormalizedQuestionResult => {
  const prompt = (question.prompt || '').trim();
  if (!prompt) {
    return {
      warnings: [],
      errors: [
        {
          severity: 'error',
          questionIndex: index + 1,
          identifier: question.identifier,
          message: 'Question is missing a prompt.'
        }
      ]
    };
  }

  const type = question.type === 'extended_text' ? 'extended_text' : 'multiple_choice';
  const stimulus = (question.stimulus || '').trim();
  const fallbackIdentifier = `item-${padNumber(index + 1)}`;
  const identifier = sanitizeIdentifier(question.identifier || fallbackIdentifier, fallbackIdentifier);
  const title = (question.title || prompt).trim();
  const layout = shouldUseTwoColumnLayout(stimulus, question.layout) ? 'two_column' : 'single_column';
  const maxScore = Number.isFinite(question.points) ? Number(question.points) : (options.pointsDefault ?? 1);
  const stimulusImages = (question.stimulusImages || []).map((asset, assetIndex) => ({
    ...asset,
    id: sanitizeIdentifier(asset.id || `${identifier}-image-${assetIndex + 1}`, `${identifier}-image-${assetIndex + 1}`)
  }));

  if (type === 'extended_text') {
    return {
      item: {
        questionIndex: index + 1,
        identifier,
        title,
        type,
        stimulus,
        stimulusImages,
        prompt,
        expectedLength: question.expectedLength && question.expectedLength > 0 ? question.expectedLength : 200,
        layout,
        maxScore,
        options: [],
        correctResponse: (question.correctResponse || '').trim(),
        correctIdentifiers: [],
        selectionMode: 'single'
      },
      warnings: [],
      errors: []
    };
  }

  const normalizedOptions = normalizeOptions(question.options);
  if (normalizedOptions.length < 2) {
    return {
      warnings: [],
      errors: [
        {
          severity: 'error',
          questionIndex: index + 1,
          identifier,
          message: 'Question must contain at least two options.'
        }
      ]
    };
  }
  const rawCorrectResponse = (question.correctResponse || '').trim();
  const correctIdentifiers = resolveCorrectIdentifiers(normalizedOptions, rawCorrectResponse);
  const warnings: ConversionIssue[] =
    correctIdentifiers.length === 0
      ? [
          {
            severity: 'warning',
            questionIndex: index + 1,
            identifier,
            message: 'Question does not contain a resolved correct response. Generated item without qti-correct-response.'
          }
        ]
      : [];

  return {
    item: {
      questionIndex: index + 1,
      identifier,
      title,
      type,
      stimulus,
      stimulusImages,
      prompt,
      expectedLength: 200,
      layout,
      maxScore,
      options: normalizedOptions,
      correctResponse: rawCorrectResponse,
      correctIdentifiers,
      selectionMode: correctIdentifiers.length > 1 ? 'multiple' : 'single'
    },
    warnings,
    errors: []
  };
};

const renderXhtmlTextBlock = (text: string, className?: string): string => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => `<p>${escapeXml(chunk).replaceAll('\n', '<br/>')}</p>`)
    .join('');
  return `<div xmlns="http://www.w3.org/1999/xhtml"${className ? ` class="${escapeXml(className)}"` : ''}>${paragraphs || `<p>${escapeXml(text)}</p>`}</div>`;
};

const renderStimulusImages = (item: NormalizedItem): string =>
  item.stimulusImages
    .map(
      image =>
        `<div xmlns="http://www.w3.org/1999/xhtml" class="qti-item-image"><img src="../assets/${escapeXml(image.fileName)}" alt="${escapeXml(image.altText || '')}"/></div>`
    )
    .join('\n');

const renderInteraction = (item: NormalizedItem): string => {
  if (item.type === 'extended_text') {
    return `<qti-extended-text-interaction xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" response-identifier="RESPONSE" expected-length="${item.expectedLength}">
        </qti-extended-text-interaction>`;
  }

  return `<qti-choice-interaction xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" response-identifier="RESPONSE" max-choices="${item.selectionMode === 'multiple' ? item.correctIdentifiers.length : 1}">
        <qti-prompt>${escapeXml(item.prompt)}</qti-prompt>
${item.options
  .map(option => `        <qti-simple-choice identifier="${escapeXml(option.id)}">${escapeXml(option.text)}</qti-simple-choice>`)
  .join('\n')}
      </qti-choice-interaction>`;
};

const renderItemBody = (item: NormalizedItem): string => {
  if (item.layout === 'two_column' && item.stimulus) {
    return `<qti-item-body>
    <div xmlns="http://www.w3.org/1999/xhtml" class="qti-layout-row">
      <div class="qti-layout-col6">
        ${renderXhtmlTextBlock(item.stimulus)}
        ${renderStimulusImages(item)}
      </div>
      <div class="qti-layout-col6">
        ${item.type === 'extended_text' ? renderXhtmlTextBlock(item.prompt) : ''}
        ${renderInteraction(item)}
      </div>
    </div>
  </qti-item-body>`;
  }

  return `<qti-item-body>
    ${item.stimulus ? renderXhtmlTextBlock(item.stimulus, 'qti-item-stimulus') : ''}
    ${item.stimulusImages.length > 0 ? renderStimulusImages(item) : ''}
    ${item.type === 'multiple_choice' ? renderInteraction(item) : `${renderXhtmlTextBlock(item.prompt)}\n    ${renderInteraction(item)}`}
  </qti-item-body>`;
};

const renderResponseDeclaration = (item: NormalizedItem): string => {
  if (item.type === 'extended_text') {
    return `  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>`;
  }

  if (item.correctIdentifiers.length === 0) {
    return `  <qti-response-declaration identifier="RESPONSE" cardinality="${item.selectionMode}" base-type="identifier"/>`;
  }

  return `  <qti-response-declaration identifier="RESPONSE" cardinality="${item.selectionMode}" base-type="identifier">
    <qti-correct-response>
${item.correctIdentifiers.map(identifier => `      <qti-value>${escapeXml(identifier)}</qti-value>`).join('\n')}
    </qti-correct-response>
  </qti-response-declaration>`;
};

const renderResponseProcessing = (item: NormalizedItem): string =>
  item.type === 'multiple_choice' && item.correctIdentifiers.length > 0
    ? `  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`
    : '';

const renderAssessmentItem = (item: NormalizedItem): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
  identifier="${escapeXml(item.identifier)}"
  title="${escapeXml(item.title)}"
  adaptive="false"
  time-dependent="false">
${renderResponseDeclaration(item)}
  <qti-outcome-declaration identifier="MAX_SCORE" cardinality="single" base-type="float">
    <qti-default-value>
      <qti-value>${item.maxScore}</qti-value>
    </qti-default-value>
  </qti-outcome-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
    <qti-default-value>
      <qti-value>0</qti-value>
    </qti-default-value>
  </qti-outcome-declaration>
${renderItemBody(item)}
${renderResponseProcessing(item)}
</qti-assessment-item>`;

const renderAssessmentTest = (
  items: NormalizedItem[],
  options: Required<Pick<GenerateQtiPackageOptions, 'testIdentifier' | 'testTitle' | 'sectionIdentifier' | 'sectionTitle'>>
): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
  identifier="${escapeXml(options.testIdentifier)}"
  title="${escapeXml(options.testTitle)}">
  <qti-test-part identifier="PART-1" navigation-mode="nonlinear" submission-mode="simultaneous">
    <qti-assessment-section identifier="${escapeXml(options.sectionIdentifier)}" title="${escapeXml(options.sectionTitle)}" visible="true">
${items
  .map(item => `      <qti-assessment-item-ref identifier="${escapeXml(item.identifier)}" href="items/${escapeXml(item.identifier)}.xml"/>`)
  .join('\n')}
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

const renderManifest = (
  items: NormalizedItem[],
  options: Required<Pick<GenerateQtiPackageOptions, 'manifestIdentifier' | 'testIdentifier'>>
): string => `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"
  xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_metadata_v3p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  identifier="${escapeXml(options.manifestIdentifier)}"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd http://www.imsglobal.org/xsd/imsqti_metadata_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_metadatav3p0_v1p0.xsd">
  <metadata>
    <schema>QTI Package</schema>
    <schemaversion>3.0.0</schemaversion>
  </metadata>
  <resources>
    <resource identifier="${escapeXml(options.testIdentifier)}" type="imsqti_test_xmlv3p0" href="assessment-test.xml">
      <file href="assessment-test.xml"/>
    </resource>
${items
  .map(
    item => `    <resource identifier="${escapeXml(item.identifier)}" type="imsqti_item_xmlv3p0" href="items/${escapeXml(item.identifier)}.xml">
      <file href="items/${escapeXml(item.identifier)}.xml"/>
${item.stimulusImages.map(image => `      <file href="assets/${escapeXml(image.fileName)}"/>`).join('\n')}
    </resource>`
  )
  .join('\n')}
  </resources>
</manifest>`;

export const generateQtiPackageFromQuestions = async (
  questions: StructuredQuestion[],
  options: GenerateQtiPackageOptions = {}
): Promise<{ blob: Blob; packageName: string; summary: ConversionSummary }> => {
  const normalizedResults = questions.map((question, index) => normalizeQuestion(question, index, options));
  const items = normalizedResults.flatMap(result => (result.item ? [result.item] : []));
  const warnings = normalizedResults.flatMap(result => result.warnings);
  const errors = normalizedResults.flatMap(result => result.errors);

  if (items.length === 0) {
    throw new Error('No valid questions were available to generate a QTI package.');
  }

  const packageIdentifier = sanitizeIdentifier(options.packageIdentifier || 'spreadsheet-qti-package', 'spreadsheet-qti-package');
  const testIdentifier = sanitizeIdentifier(options.testIdentifier || `${packageIdentifier}-test`, `${packageIdentifier}-test`);
  const sectionIdentifier = sanitizeIdentifier(options.sectionIdentifier || 'section-1', 'section-1');
  const manifestIdentifier = sanitizeIdentifier(options.manifestIdentifier || `${packageIdentifier}-manifest`, `${packageIdentifier}-manifest`);
  const testTitle = options.testTitle || 'Imported Test';
  const sectionTitle = options.sectionTitle || 'Questions';

  const zip = new JSZip();
  zip.file(
    'imsmanifest.xml',
    renderManifest(items, {
      manifestIdentifier,
      testIdentifier
    })
  );
  zip.file(
    'assessment-test.xml',
    renderAssessmentTest(items, {
      testIdentifier,
      testTitle,
      sectionIdentifier,
      sectionTitle
    })
  );
  options.onProgress?.({
    stage: 'generation_started',
    message: `Generating ${items.length} QTI item${items.length === 1 ? '' : 's'}.`
  });
  for (const [index, item] of items.entries()) {
    zip.file(`items/${item.identifier}.xml`, renderAssessmentItem(item));
    for (const image of item.stimulusImages) {
      zip.file(`assets/${image.fileName}`, image.data);
    }
    options.onProgress?.({
      stage: 'item_generated',
      message: `Generated item ${index + 1} of ${items.length}.`,
      current: index + 1,
      total: items.length,
      itemIdentifier: item.identifier
    });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const packageName = `${packageIdentifier}.zip`;
  const summary: ConversionSummary = {
    totalQuestions: questions.length,
    generatedItems: items.length,
    skippedItems: questions.length - items.length,
    warnings,
    errors
  };
  options.onProgress?.({
    stage: 'package_completed',
    message: `Generated package ${packageName}.`,
    data: {
      packageName,
      itemCount: items.length,
      summary
    }
  });

  return {
    blob,
    packageName,
    summary
  };
};
