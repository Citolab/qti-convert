import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils';
import { stripStylesheets } from '.';

const xml = String.raw;

test('remove stylesheets from qti', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
      <qti-stylesheet href="css/assessment.css" type="text/css" />
      <qti-item-body></qti-item-body>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
      <qti-item-body></qti-item-body>
`;
  const result = await qtiTransform(input).fnCh(stripStylesheets).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
