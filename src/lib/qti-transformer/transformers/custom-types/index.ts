import * as cheerio from 'cheerio';
import { Element } from 'domhandler';

export function customTypes($: cheerio.CheerioAPI, param: string = 'type') {
  $('*').each((i, element: Element) => {
    const classList = $(element).attr('class')?.split(' ');
    if (classList) {
      classList.forEach(str => {
        if (str.startsWith(`${param}:`)) {
          element.name = `${element.name}-${str.slice(`${param}:`.length)}`;
        }
      });
    }
  });
}
