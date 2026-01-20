import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createAssessmentTest, createOrCompleteManifest } from './qti-helper';

const writeItem = (filePath: string, identifier: string) => {
  writeFileSync(
    filePath,
    `<?xml version="1.0" encoding="utf-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" identifier="${identifier}" title="${identifier}">
  <itemBody/>
</assessmentItem>`
  );
};

test('createAssessmentTest uses relative hrefs to the target folder', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qti-create-assessment-'));
  mkdirSync(path.join(root, 'items'), { recursive: true });

  writeItem(path.join(root, 'items', '32gn9p.xml'), 'ITM-32gn9p');
  writeItem(path.join(root, 'items', '32kmjv.xml'), 'ITM-32kmjv');

  const assessment = await createAssessmentTest(root);
  expect(assessment).toContain('href="items/32gn9p.xml"');
  expect(assessment).toContain('href="items/32kmjv.xml"');
  expect(assessment).not.toContain(normalizePathForAssertion(root));
});

test('createAssessmentTest accepts a file path and uses its directory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qti-create-assessment-'));
  mkdirSync(path.join(root, 'items'), { recursive: true });

  writeItem(path.join(root, 'items', '32gn9p.xml'), 'ITM-32gn9p');
  writeFileSync(path.join(root, 'test.xml'), '');

  const assessment = await createAssessmentTest(path.join(root, 'test.xml'));
  expect(assessment).toContain('href="items/32gn9p.xml"');
});

test('createOrCompleteManifest uses relative hrefs to the target folder', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qti-create-manifest-'));
  mkdirSync(path.join(root, 'items'), { recursive: true });

  writeItem(path.join(root, 'items', '32gn9p.xml'), 'ITM-32gn9p');

  const manifest = await createOrCompleteManifest(root);
  expect(manifest).toContain('href="items/32gn9p.xml"');
  expect(manifest).not.toContain(normalizePathForAssertion(root));
});

function normalizePathForAssertion(p: string) {
  return p.replaceAll('\\', '/');
}

