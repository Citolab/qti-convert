import * as cheerio from 'cheerio';
import { qtiReferenceAttributes } from '../../qti-transform';
import { removeDoubleSlashes } from '../utils';
export function changeAssetLocation(
  $: cheerio.CheerioAPI,
  getNewUrl: (oldUrl: string) => string,
  srcAttributes = qtiReferenceAttributes,
  skipBase64 = true
) {
  changeLocation($, getNewUrl, srcAttributes, skipBase64);
  return $;
}

export async function changeAssetLocationAsync(
  $: cheerio.CheerioAPI,
  getNewUrlAsync: (oldUrl: string) => Promise<string>,
  srcAttributes = qtiReferenceAttributes,
  skipBase64 = true
) {
  await changeLocation($, getNewUrlAsync, srcAttributes, skipBase64);
  return $;
}

async function changeLocation(
  $: cheerio.CheerioAPI,
  getNewUrl: ((oldUrl: string) => Promise<string>) | ((oldUrl: string) => string),
  srcAttributes = qtiReferenceAttributes,
  skipBase64 = true
) {
  for (const attribute of srcAttributes) {
    for (const node of $(`[${attribute}]`)) {
      // change asset location
      const srcValue = $(node).attr(attribute)!;
      if (!(skipBase64 && srcValue.startsWith('data:'))) {
        const urlPromiseOrValue = getNewUrl(srcValue);
        const newSrcValue = typeof urlPromiseOrValue === 'string' ? urlPromiseOrValue : await urlPromiseOrValue;
        $(node).attr(attribute, removeDoubleSlashes(newSrcValue));
      }
    }
  }
}
