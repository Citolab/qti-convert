import * as cheerio from 'cheerio';

export async function customInteraction($: cheerio.CheerioAPI, baseRef: string, baseItem: string) {
  const qtiCustomInteraction = $('qti-custom-interaction');
  const qtiCustomInteractionObject = qtiCustomInteraction.find('object');

  // Get the response identifier
  const responseIdentifier = qtiCustomInteraction.attr('response-identifier');

  // Only proceed if we have a response identifier
  if (responseIdentifier) {
    // Create the new state declaration element
    const stateDeclaration = `<qti-response-declaration identifier="${responseIdentifier}_STATE" cardinality="single" base-type="string"></qti-response-declaration>`;

    // Find the existing response declaration
    const existingDeclaration = $(`qti-response-declaration[identifier="${responseIdentifier}"]`);

    // Insert the new declaration before the existing one
    if (existingDeclaration.length > 0) {
      existingDeclaration.before(stateDeclaration);
    }
  }

  qtiCustomInteraction.attr('data-base-ref', baseRef);
  qtiCustomInteraction.attr('data-base-item', baseRef + baseItem);
  qtiCustomInteraction.attr('data', qtiCustomInteractionObject.attr('data'));
  qtiCustomInteraction.attr('width', qtiCustomInteractionObject.attr('width'));
  qtiCustomInteraction.attr('height', qtiCustomInteractionObject.attr('height'));

  qtiCustomInteractionObject.remove();

  return $;
}
