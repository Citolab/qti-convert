import * as cheerio from 'cheerio';

// Maps the DEP dialog settings onto the matching <dep-popup> attributes.
const dialogAttributes: [string, string][] = [
  ['data-dep-dialog-caption', 'caption'],
  ['data-dep-dialog-width', 'width'],
  ['data-dep-dialog-height', 'height'],
  ['data-dep-dialog-resizemode', 'resizemode'],
  ['data-dep-dialog-modal', 'modal']
];

export const depConvertExtended = ($: cheerio.CheerioAPI) => {
  // Find all triggers that reference a dialog
  const dialogTriggers = $('.dep-dialogTrigger');

  for (const trigger of dialogTriggers) {
    const $trigger = $(trigger);
    const ref = $trigger.attr('data-stimulus-idref');
    if (!ref) continue;

    const dialog = $(`[id="${ref}"]`);
    if (!dialog.length) continue;

    // Only copy settings that are present: an empty attribute is not "unset" for dep-popup
    // (modal="" means modal, width="" becomes 0).
    const depPopup = $('<dep-popup></dep-popup>');
    for (const [dialogAttribute, popupAttribute] of dialogAttributes) {
      const value = dialog.attr(dialogAttribute);
      if (value) depPopup.attr(popupAttribute, value);
    }

    // data-stimulus-idref is also the shared-stimulus hook of qti-components, which empties every
    // element carrying it; left on the trigger, the thumbnail would be wiped before it is shown.
    $trigger.removeAttr('data-stimulus-idref');

    const popupContent = $('<div slot="popup"></div>').append(dialog.contents());
    dialog.remove();

    // Replace the trigger with the dep-popup, which then wraps the trigger and the dialog content
    $trigger.before(depPopup);
    depPopup.append($trigger, popupContent);
  }
};

export default depConvertExtended;
