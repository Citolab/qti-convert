import { expect, test } from 'vitest';

import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';
import { stripStylesheets } from '.';

const xml = String.raw;

test('remove stylesheets from qti', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/assessment.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input).fnCh(stripStylesheets).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('remove stylesheets with removePattern - exact match', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: 'css/main.css' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('remove stylesheets with removePattern - starts with wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/theme-light.css" type="text/css" />
      <qti-stylesheet href="css/theme-dark.css" type="text/css" />
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: 'css/theme*' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('remove stylesheets with removePattern - ends with wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="styles/old-theme.css" type="text/css" />
      <qti-stylesheet href="styles/old-layout.css" type="text/css" />
      <qti-stylesheet href="styles/new-theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="styles/new-theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: '*old*' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('remove stylesheets with removePattern - contains wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/deprecated-styles.css" type="text/css" />
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="js/deprecated-script.js" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: '*deprecated*' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('keep stylesheets with keepPattern - exact match', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-stylesheet href="css/layout.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { keepPattern: 'css/main.css' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('keep stylesheets with keepPattern - starts with wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/core-main.css" type="text/css" />
      <qti-stylesheet href="css/core-theme.css" type="text/css" />
      <qti-stylesheet href="css/plugin.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/core-main.css" type="text/css" />
      <qti-stylesheet href="css/core-theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { keepPattern: 'css/core*' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('keep stylesheets with keepPattern - ends with wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="styles/main.css" type="text/css" />
      <qti-stylesheet href="styles/theme.css" type="text/css" />
      <qti-stylesheet href="styles/layout.js" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="styles/main.css" type="text/css" />
      <qti-stylesheet href="styles/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { keepPattern: '*.css' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('keep stylesheets with keepPattern - contains wildcard', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/essential-theme.css" type="text/css" />
      <qti-stylesheet href="css/optional-plugin.css" type="text/css" />
      <qti-stylesheet href="css/essential-layout.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/essential-theme.css" type="text/css" />
      <qti-stylesheet href="css/essential-layout.css" type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { keepPattern: '*essential*' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('handle stylesheets without href attribute', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet type="text/css" />
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-item-body></qti-item-body>
      </qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: 'css/main.css' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('no stylesheets removed when pattern does not match', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
</qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, { removePattern: 'nonexistent.css' }))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('empty options object behaves like no options', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
      <qti-stylesheet href="css/main.css" type="text/css" />
      <qti-stylesheet href="css/theme.css" type="text/css" />
      <qti-item-body></qti-item-body>
  </qti-assessment-item>
`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
  <qti-assessment-item>
        <qti-item-body></qti-item-body>
        </qti-assessment-item>
`;
  const result = await qtiTransform(input)
    .fnCh($ => stripStylesheets($, {}))
    .xml();
  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});
