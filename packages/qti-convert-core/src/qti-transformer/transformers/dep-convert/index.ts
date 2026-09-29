import * as cheerio from 'cheerio';

// This method converts qti out of the Dutch Extension Profile (dep)
export const depConvert = ($: cheerio.CheerioAPI) => {
  // Only target .dep-dialogTrigger elements that aren't already inside buttons
  const dialogTriggers = $('.dep-dialogTrigger').not('button .dep-dialogTrigger');

  for (const dialogTrigger of dialogTriggers) {
    const ref = $(dialogTrigger).attr('data-stimulus-idref');
    if (ref) {
      // Check if this trigger has already been processed
      const parentIsButton = $(dialogTrigger).parent().is('button');
      if (!parentIsButton) {
        // data-stimulus-idref is also the shared-stimulus hook of qti-components, which empties
        // every element carrying it; the button's popovertarget takes over the reference.
        $(dialogTrigger).removeAttr('data-stimulus-idref');
        // An image that opens an enlargement should look like the image, not like a button; the
        // cursor shows it can be clicked. A text trigger keeps the button look.
        const isImageOnly =
          $(dialogTrigger).text().trim() === '' && $(dialogTrigger).find('img, picture, svg').length > 0;
        const style = isImageOnly ? 'background: none; border: 0; padding: 0; cursor: zoom-in;' : 'cursor: pointer;';
        // wrap ref in button
        const triggerContent = $.html(dialogTrigger);
        const button = $(
          `<button type="button" popovertarget="${ref}" style="${style}">${triggerContent}</button>`
        );
        $(dialogTrigger).replaceWith(button);
        const dialog = $(`#${ref}`);
        dialog.attr('popover', '');
      }
    }
  }
};

export default depConvert;
