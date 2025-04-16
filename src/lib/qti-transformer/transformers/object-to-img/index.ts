import * as cheerio from 'cheerio';

export function objectToImg($: cheerio.CheerioAPI) {
  const objectElements = $('object[type^="image"]');
  if (objectElements.length === 0) {
    return;
  }
  for (let i = 0; i < objectElements.length; i++) {
    const objectEl = $(objectElements[i]);
    const imgAttributes = {
      width: objectEl.attr('width'),
      height: objectEl.attr('height'),
      src: objectEl.attr('data'),
      alt: objectEl.text()
    };

    const imgEl = $('<img>').attr(imgAttributes);
    objectEl.replaceWith(imgEl);
  }
}
