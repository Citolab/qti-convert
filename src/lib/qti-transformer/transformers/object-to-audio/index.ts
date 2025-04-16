import * as cheerio from 'cheerio';

export function objectToAudio($: cheerio.CheerioAPI) {
  const audioElements = $('audio');
  // set controls attribute based on data-dep-controls
  for (let i = 0; i < audioElements.length; i++) {
    const audioEl = $(audioElements[i]);
    // check if data-dep-controls or controls attribute is set and not false
    const shouldHaveControls =
      audioEl.attr('data-dep-controls') === 'true' ||
      audioEl.attr('controls') === 'true' ||
      (audioEl.attr('controls') !== null && audioEl.attr('controls') !== undefined);
    if (shouldHaveControls) {
      audioEl.attr('controls', 'controls');
    } else {
      audioEl.removeAttr('controls');
    }
  }
  const objectElements = $('object[type^="audio"]');
  if (objectElements.length === 0) {
    return;
  }
  for (let i = 0; i < objectElements.length; i++) {
    const objectEl = $(objectElements[i]);
    const audioAttributes = {
      width: objectEl.attr('width'),
      height: objectEl.attr('height'),
      controls: objectEl.attr('data-dep-controls') === 'true' ? 'true' : undefined
    };

    const sourceEl = $('<source>').attr({
      src: objectEl.attr('data'),
      type: objectEl.attr('type')
    });

    const audioEl = $('<audio>').attr(audioAttributes).append(sourceEl);
    objectEl.replaceWith(audioEl);
  }
}
