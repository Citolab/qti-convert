import * as cheerio from 'cheerio';
import { Element } from 'domhandler';

export function suffixa($: cheerio.CheerioAPI, elements: string[], suffix: string) {
  $('*').each((i, el: Element) => {
    if (elements.includes(el.name)) {
      el.name = `${el.name}-${suffix}`;
    }
  });
}
