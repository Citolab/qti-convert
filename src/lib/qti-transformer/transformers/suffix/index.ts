import * as cheerio from 'cheerio';

export function suffixa($: cheerio.CheerioAPI, elements: string[], suffix: string) {
  $('*').each((i, el: cheerio.Element) => {
    if (elements.includes(el.name)) {
      el.name = `${el.name}-${suffix}`;
    }
  });
}
