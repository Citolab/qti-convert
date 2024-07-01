import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils';
import { toMathMLWebcomponents } from '.';

const xml = String.raw;

const transformObjectTags = (xmlContent: string) => {
  const modifiedContent = qtiTransform(xmlContent).fnCh(toMathMLWebcomponents).xml();
  return modifiedContent;
};

test('transform mathml to mathml webcomponents', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <math>
  <mrow>
    <msup>
      <mi>x</mi><mn>2</mn>
    </msup>
    <msup>
      <mi>y</mi><mn>2</mn>
    </msup>
  </mrow>
</math>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <math-ml>
  <math-row>
    <math-sup>
      <math-i>x</math-i><math-n>2</math-n>
    </math-sup>
    <math-sup>
      <math-i>y</math-i><math-n>2</math-n>
    </math-sup>
  </math-row>
</math-ml>

`;
  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
