import { expect, test } from 'vitest';

import { objectToImg } from '.';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const transformObjectTags = (xml: string) => qtiTransform(xml).fnCh(objectToImg).xml();

test('transform object type="img to img tag', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
        <object type="image/png" width="206" height="280" data="images/ukair.png">UK Map</object>`;

  const xpect = xml`<?xml version="1.0" encoding="UTF-8"?>
        <img width="206" height="280" src="images/ukair.png" alt="UK Map" />`;

  const result = await transformObjectTags(input);
  const areEqual = await areXmlEqual(result, xpect);
  expect(areEqual).toEqual(true);
});
