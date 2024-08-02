import * as cheerio from 'cheerio';

export function objectToAudio($: cheerio.CheerioAPI) {
  const objectEl = $('object[type^="audio"]');
  const audioAttributes = {
    controls: objectEl.attr('data-dep-controls') === 'true' ? 'true' : undefined
  };

  const sourceEl = $('<source>').attr({
    src: objectEl.attr('data'),
    type: objectEl.attr('type')
  });

  const audioEl = $('<audio>').attr(audioAttributes).append(sourceEl);
  objectEl.replaceWith(audioEl);
}
