import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, test } from 'vitest';
import { hasXmllint, prepareQtiSchema, QTI3_XSD_URL, validateXml } from '../test-utils/xsd-validator';
import { upgradeQti2toQti3 } from './convert-qti2-to-qti3';

// Validates the QTI 3 output against the official IMS XSD (skipped without xmllint or network).
// The TAO fixtures are left out: their QTI 2.2 input is itself not valid (identifiers starting with a digit,
// inline script and style), which the TAO PCI conversion handles later.
const FIXTURES = path.join(__dirname, 'fixtures');
const names = readdirSync(FIXTURES)
  .filter(name => name.endsWith('.qti2.xml') && !name.startsWith('tao-'))
  .map(name => name.replace(/\.qti2\.xml$/, ''));

describe.skipIf(!hasXmllint)('QTI 3 output validates against imsqti_asiv3p0p1_v1p0.xsd', () => {
  let schema: string | null = null;
  beforeAll(async () => {
    schema = await prepareQtiSchema('qti3', QTI3_XSD_URL);
  });

  test.each(names)('%s', name => {
    if (!schema) return;
    const output = upgradeQti2toQti3(readFileSync(path.join(FIXTURES, `${name}.qti2.xml`), 'utf8'));
    expect(validateXml(output, schema)).toBe('');
  });
});
