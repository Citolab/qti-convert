import * as cheerio from 'cheerio';

export function objectToImg($: cheerio.CheerioAPI) {
  const objectEl = $('object[type^="image"]');
  const imgAttributes = {
    width: objectEl.attr('width'),
    height: objectEl.attr('height'),
    src: objectEl.attr('data'),
    alt: objectEl.text()
  };

  const imgEl = $('<img>').attr(imgAttributes);
  objectEl.replaceWith(imgEl);
}
