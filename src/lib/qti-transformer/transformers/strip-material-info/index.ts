import * as cheerio from 'cheerio';

export function stripMaterialInfo($: cheerio.CheerioAPI) {
  $('qti-companion-materials-info').remove();
}
