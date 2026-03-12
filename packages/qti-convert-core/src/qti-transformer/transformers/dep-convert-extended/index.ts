import * as cheerio from 'cheerio';

export const depConvertExtended = ($: cheerio.CheerioAPI) => {
  // Find all triggers that reference a dialog
  const dialogTriggers = $('.dep-dialogTrigger');

  for (const trigger of dialogTriggers) {
    const ref = $(trigger).attr('data-stimulus-idref');
    if (!ref) continue;

    const dialog = $(`#${ref}`);
    if (!dialog.length) continue;

    // Extract attributes from the dialog
    const caption = dialog.attr('data-dep-dialog-caption') || '';
    const width = dialog.attr('data-dep-dialog-width') || '';
    const height = dialog.attr('data-dep-dialog-height') || '';
    const resizemode = dialog.attr('data-dep-dialog-resizemode') || '';
    const modal = dialog.attr('data-dep-dialog-modal') || '';

    // Extract inner HTML
    const triggerHtml = $.html(trigger);
    const popupHtml = dialog.html();

    // Create dep-popup element
    const depPopup = `
      <dep-popup
        caption="${caption}"
        width="${width}"
        height="${height}"
        resizemode="${resizemode}"
        modal="${modal}">
        ${triggerHtml}
        <div slot="popup">${popupHtml}</div>
      </dep-popup>
    `;

    // Replace the trigger + dialog with the dep-popup
    // We assume they are siblings or close in DOM structure
    // Remove original dialog first
    dialog.remove();

    // Replace trigger with dep-popup
    $(trigger).replaceWith(depPopup);
  }
};

export default depConvertExtended;
