import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils';
import { customTypes } from '.';

test('transform element with class type:', async () => {
  const input = `<?xml version="1.0" encoding="UTF-8"?>
      <qti-simple-choice class="type:stats" identifier="CHOICE_1"></qti-simple-choice>
`;
  const expectedOutput = `<?xml version="1.0" encoding="UTF-8"?>
      <qti-simple-choice-stats class="type:stats" identifier="CHOICE_1"></qti-simple-choice-stats>
`;
  const result = await qtiTransform(input).fnCh(customTypes).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('transform element with class extend:', async () => {
  const input = `<?xml version="1.0" encoding="UTF-8"?>
      <qti-simple-choice class="extend:stats" identifier="CHOICE_1"></qti-simple-choice>
`;
  const expectedOutput = `<?xml version="1.0" encoding="UTF-8"?>
      <qti-simple-choice-stats class="extend:stats" identifier="CHOICE_1"></qti-simple-choice-stats>
`;
  const result = await qtiTransform(input)
    .fnCh($ => customTypes($, 'extend'))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
