import * as cheerio from 'cheerio';
import { qtiReferenceAttributes } from '../../qti-transform';
import { removeDoubleSlashes } from '../utils';

export function changeAssetLocation(
  $: cheerio.CheerioAPI,
  getNewUrl: (oldUrl: string) => string,
  srcAttributes = qtiReferenceAttributes,
  skipBase64 = true
) {
  for (const attribute of srcAttributes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $(`[${attribute}]`).each((_: any, node: any) => {
      // change asset location
      const srcValue = $(node).attr(attribute)!;
      if (!(skipBase64 && srcValue.startsWith('data:'))) {
        const url = getNewUrl(srcValue);
        const newSrcValue = removeDoubleSlashes(srcValue.replace(srcValue, url));
        $(node).attr(attribute, newSrcValue);
      }
    });
  }
}
