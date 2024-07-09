import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import { stripMaterialInfo } from '.';

const xml = String.raw;

test('remove stylesheets from qti', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-companion-materials-info>
    <dep:dep-calculator>
      <dep:dep-description/>
      <dep:dep-calculator-type>
          basic
      </dep:dep-calculator-type>
      <dep:dep-switch>
          true
      </dep:dep-switch>
  </dep:dep-calculator>
  <dep:dep-symbolPicker>
      <dep:dep-description/>
      <dep:dep-symbols>
          &#x20ac;&#xe8;&#xe9;&#xeb;&#xea;&#xef;&#xf6;&#xe0;&#xe1;&#xa7;&#xb1;&#x2192;&#x2190;&#x2191;&#x2193;&#x2194;&#x2195;
      </dep:dep-symbols>
  </dep:dep-symbolPicker>
  <dep:dep-textMarker>
      <dep:dep-description/>
  </dep:dep-textMarker>
</qti-companion-materials-info>
  <qti-item-body></qti-item-body>
`;
  const expectedOutput = `<?xml version="1.0" encoding="UTF-8"?>
  <qti-item-body></qti-item-body>
`;
  const result = await qtiTransform(input).fnCh(stripMaterialInfo).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
