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
        // wrap ref in button
        const triggerContent = $.html(dialogTrigger);
        const button = $(`<button popovertarget="${ref}">${triggerContent}</button>`);
        $(dialogTrigger).replaceWith(button);
        const dialog = $(`#${ref}`);
        dialog.attr('popover', '');
      }
    }
  }
};

export default depConvert;
