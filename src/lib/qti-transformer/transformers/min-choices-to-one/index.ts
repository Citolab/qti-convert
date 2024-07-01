import * as cheerio from 'cheerio';

export const minChoicesToOne = ($: cheerio.CheerioAPI) => {
  const choiceInteraction = $('qti-choice-interaction');
  const minChoices = choiceInteraction.attr('min-choices');

  if (!minChoices) {
    choiceInteraction.attr('min-choices', '1');
  } else if (minChoices === '0') {
    choiceInteraction.attr('min-choices', '1');
  }
};

export default minChoicesToOne;
