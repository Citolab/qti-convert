import * as cheerio from 'cheerio';

export function objectToVideo($: cheerio.CheerioAPI) {
  const videoElements = $('video');
  // set controls attribute based on data-dep-controls
  for (let i = 0; i < videoElements.length; i++) {
    const videoEl = $(videoElements[i]);
    // check if data-dep-controls or controls attribute is set and not false
    const shouldHaveControls =
      videoEl.attr('data-dep-controls') === 'true' ||
      videoEl.attr('controls') === 'true' ||
      (videoEl.attr('controls') !== null && videoEl.attr('controls') !== undefined);
    if (shouldHaveControls) {
      // add the controls attribute without a value
      videoEl.attr('controls', '');
    } else {
      videoEl.removeAttr('controls');
    }
  }
  const objectElements = $('object[type^="video"]');
  if (objectElements.length === 0) {
    return;
  }
  for (let i = 0; i < objectElements.length; i++) {
    const objectEl = $(objectElements[i]);
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
}
