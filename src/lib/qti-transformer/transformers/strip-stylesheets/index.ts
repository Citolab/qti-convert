import * as cheerio from 'cheerio';

export function stripStylesheets($: cheerio.CheerioAPI) {
  $('qti-stylesheet').remove();
}
