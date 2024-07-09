import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import { externalScored } from '.';

const xml = String.raw;

test('add external-scoring attribute if processing template is not provided', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" />
  </qti-assessment-item>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"  external-scored="human"/>
  </qti-assessment-item>`;

  const result = await qtiTransform(input).fnCh(externalScored).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
