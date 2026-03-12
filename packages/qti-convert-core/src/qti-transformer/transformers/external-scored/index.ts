import * as cheerio from 'cheerio';

export const externalScored = ($: cheerio.CheerioAPI) => {
  const assessmentItem = $('qti-assessment-item');
  const responseProcessing = assessmentItem.find('qti-response-processing');

  if (responseProcessing.length === 0) {
    const outcomeDeclaration = assessmentItem.find('qti-outcome-declaration[identifier="SCORE"]');
    outcomeDeclaration.attr('external-scored', 'human');
  }
};

export default externalScored;
