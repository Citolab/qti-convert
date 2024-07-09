import { expect, test } from 'vitest';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

const makeAbsolutePath = (mediaLocation: string, relativePath: string): string => {
  // Create a new URL object using the base URL
  const url = new URL(mediaLocation);

  // Resolve the relative path against the base URL
  const absoluteURL = new URL(relativePath, url);

  // Return the absolute URL as a string
  return absoluteURL.toString();
};

const baseUrl = 'https://example.com/';
const transformAssetLocation = (xml: string) =>
  qtiTransform(xml)
    .changeAssetLocation(url => {
      const newUrl = makeAbsolutePath(baseUrl, url);
      return newUrl;
    })
    .xml();

test('transform asset image location', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
        <img type="image/png" width="206" height="280" src="../../images/ukair.png" alt="UK Map" />`;

  const xpect = xml`<?xml version="1.0" encoding="UTF-8"?>
         <img type="image/png" width="206" height="280" src="https://example.com/images/ukair.png" alt="UK Map" />`;

  const result = await transformAssetLocation(input);
  const areEqual = await areXmlEqual(result, xpect);
  expect(areEqual).toEqual(true);
});
