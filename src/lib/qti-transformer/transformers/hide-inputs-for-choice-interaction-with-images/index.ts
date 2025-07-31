import * as cheerio from 'cheerio';

export function hideInputsForChoiceInteractionWithImages($: cheerio.CheerioAPI) {
  $('qti-choice-interaction').each(function () {
    const $choiceInteraction = $(this);
    const $simpleChoices = $choiceInteraction.find('qti-simple-choice');

    // Check if there are any simple choices
    if ($simpleChoices.length === 0) {
      return; // Skip if no simple choices found
    }

    let allHaveImages = true;

    // Check each simple choice for images
    for (const choice of $simpleChoices) {
      const $choice = $(choice);
      const hasImage = $choice.find('img').length > 0;
      if (!hasImage) {
        allHaveImages = false;
        break; // Break out of the loop if any choice does not have an image
      }
    }
    // If all simple choices contain images, add the class
    if (allHaveImages) {
      const currentClasses = $choiceInteraction.attr('class') || '';
      const newClasses = currentClasses ? `${currentClasses} qti-input-control-hidden` : 'qti-input-control-hidden';
      $choiceInteraction.attr('class', newClasses);
    }
  });
}
