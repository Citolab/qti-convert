import * as cheerio from 'cheerio';

export function objectToVideo($: cheerio.CheerioAPI) {
  const objectEl = $('object[type^="video"]');
  const videoAttributes = {
    width: objectEl.attr('width'),
    height: objectEl.attr('height'),
    controls: objectEl.attr('data-dep-controls') === 'true' ? 'true' : undefined
  };

  const sourceEl = $('<source>').attr({
    src: objectEl.attr('data'),
    type: objectEl.attr('type')
  });

  const videoEl = $('<video>').attr(videoAttributes).append(sourceEl);
  objectEl.replaceWith(videoEl);
}
