import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import unittest from '.';

const xml = String.raw;

test('transform choice min-choices="0" to min-choices="1"', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1" min-choices="0">
    </qti-choice-interaction>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1" min-choices="1">
    </qti-choice-interaction>
`;
  const result = await qtiTransform(input)
    .fnCh($ => unittest($))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('add min-choices="1" if not exists', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
      <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      </qti-choice-interaction>
  `;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
      <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1" min-choices="1">
      </qti-choice-interaction>
  `;
  const result = await qtiTransform(input)
    .fnCh($ => unittest($))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
