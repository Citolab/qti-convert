import * as cheerio from 'cheerio';

// This method converts qti out of the Dutch Extension Profile (dep)
export const depConvert = ($: cheerio.CheerioAPI) => {
  const dialogTriggers = $('.dep-dialogTrigger'); // because data-stimulus-idref is also use in shared stimulus query by class
  for (const dialogTrigger of dialogTriggers) {
    const ref = $(dialogTrigger).attr('data-stimulus-idref');
    if (ref) {
      // wrap ref in button
      const triggerContent = $.html(dialogTrigger);
      const button = $(`<button popovertarget="${ref}">${triggerContent}</button>`);
      $(dialogTrigger).replaceWith(button);
      const dialog = $(`#${ref}`);
      dialog.attr('popover', ref);
    }
  }
};

export default depConvert;
