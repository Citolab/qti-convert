import { expect, test, vi } from 'vitest';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const customTemplate = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-response-processing xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-set-outcome-value identifier="FEEDBACK">
    <qti-base-value base-type="identifier">WELL_DONE</qti-base-value>
  </qti-set-outcome-value>
</qti-response-processing>`;

const itemWithTemplate = (attributes: string) => xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="ITEM-1">
  <qti-response-processing ${attributes}/>
</qti-assessment-item>`;

test('inlines a custom template and drops the template attribute', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);

  const result = await qtiTransform(
    itemWithTemplate('template="https://example.com/rptemplates/random_feedback.xml"')
  ).inlineResponseProcessingTemplate(getTemplateContent, { cache: false });

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="ITEM-1">
  <qti-response-processing>
    <qti-set-outcome-value identifier="FEEDBACK">
      <qti-base-value base-type="identifier">WELL_DONE</qti-base-value>
    </qti-set-outcome-value>
  </qti-response-processing>
</qti-assessment-item>`;

  expect(getTemplateContent).toHaveBeenCalledWith('https://example.com/rptemplates/random_feedback.xml', {
    template: 'https://example.com/rptemplates/random_feedback.xml',
    templateLocation: undefined,
    attribute: 'template'
  });
  expect(await areXmlEqual(result.xml(), expectedOutput)).toBe(true);
});

test('leaves the standard IMS templates untouched', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);
  const input = itemWithTemplate('template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"');

  const result = await qtiTransform(input).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false
  });

  expect(getTemplateContent).not.toHaveBeenCalled();
  expect(await areXmlEqual(result.xml(), input)).toBe(true);
});

test('inlines a standard template when includeStandardTemplates is set', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);

  const result = await qtiTransform(
    itemWithTemplate('template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"')
  ).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false,
    includeStandardTemplates: true
  });

  expect(getTemplateContent).toHaveBeenCalledTimes(1);
  expect(result.xml()).toContain('WELL_DONE');
});

test('falls back to template-location when the template cannot be resolved', async () => {
  const getTemplateContent = vi
    .fn()
    .mockImplementation(async (url: string) => (url.endsWith('.xml') ? customTemplate : null));

  const result = await qtiTransform(
    itemWithTemplate(
      'template="https://example.com/rptemplates/random_feedback" template-location="templates/random_feedback.xml"'
    )
  ).inlineResponseProcessingTemplate(getTemplateContent, { cache: false });

  expect(getTemplateContent).toHaveBeenCalledTimes(2);
  expect(result.xml()).toContain('WELL_DONE');
  expect(result.xml()).not.toContain('template-location');
});

test('resolves relative template references against baseUrl', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);

  await qtiTransform(
    itemWithTemplate('template-location="../templates/random_feedback.xml"')
  ).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false,
    baseUrl: 'https://example.com/package/items/'
  });

  expect(getTemplateContent).toHaveBeenCalledWith(
    'https://example.com/package/templates/random_feedback.xml',
    expect.anything()
  );
});

test('keeps response rules that are written inside the element', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="ITEM-1">
  <qti-response-processing template="https://example.com/rptemplates/random_feedback.xml">
    <qti-set-outcome-value identifier="SCORE">
      <qti-base-value base-type="float">1</qti-base-value>
    </qti-set-outcome-value>
  </qti-response-processing>
</qti-assessment-item>`;

  const result = await qtiTransform(input).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false
  });

  expect(getTemplateContent).not.toHaveBeenCalled();
  expect(await areXmlEqual(result.xml(), input)).toBe(true);
});

test('overwrites inline rules when overwriteExistingRules is set', async () => {
  const getTemplateContent = vi.fn().mockResolvedValue(customTemplate);
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="ITEM-1">
  <qti-response-processing template="https://example.com/rptemplates/random_feedback.xml">
    <qti-set-outcome-value identifier="SCORE">
      <qti-base-value base-type="float">1</qti-base-value>
    </qti-set-outcome-value>
  </qti-response-processing>
</qti-assessment-item>`;

  const result = await qtiTransform(input).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false,
    overwriteExistingRules: true
  });

  expect(result.xml()).toContain('WELL_DONE');
  expect(result.xml()).not.toContain('SCORE');
});

test('keeps the item unchanged when the template cannot be fetched', async () => {
  const getTemplateContent = vi.fn().mockRejectedValue(new Error('boom'));
  const input = itemWithTemplate('template="https://example.com/rptemplates/random_feedback.xml"');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const result = await qtiTransform(input).inlineResponseProcessingTemplate(getTemplateContent, {
    cache: false
  });

  expect(await areXmlEqual(result.xml(), input)).toBe(true);
  warn.mockRestore();
});
