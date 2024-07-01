import * as cheerio from 'cheerio';
import { Element } from 'cheerio';

export function toMathMLWebcomponents($: cheerio.CheerioAPI) {
  $('math')
    .each((i, item) => {
      item.tagName = `math-ml`;
    })
    .find('*')
    .each((i, item: Element) => {
      item.tagName = `math-${item.tagName.substring(1)}`;
    });
}
