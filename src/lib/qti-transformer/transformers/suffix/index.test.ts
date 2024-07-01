import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils';
import { suffixa } from '.';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent)
    .fnCh($ => suffixa($, ['qti-simple-choice'], 'post'))
    .xml();
  return modifiedContent;
};

test('transform object type="video to video tag', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1" min-choices="0">
      <qti-simple-choice identifier="CHOICE_1"></qti-simple-choice>
      <qti-simple-choice identifier="CHOICE_2"></qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1" min-choices="0">
      <qti-simple-choice-post identifier="CHOICE_1"></qti-simple-choice-post>
      <qti-simple-choice-post identifier="CHOICE_2"></qti-simple-choice-post>
    </qti-choice-interaction>
  </qti-item-body>
`;
  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
