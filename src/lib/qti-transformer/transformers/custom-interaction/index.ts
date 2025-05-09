import * as cheerio from 'cheerio';

export async function customInteraction($: cheerio.CheerioAPI, baseRef: string, baseItem: string) {
  const qtiCustomInteraction = $('qti-custom-interaction');
  const qtiCustomInteractionObject = qtiCustomInteraction.find('object');

  // Get the response identifier
  qtiCustomInteraction.attr('data-base-ref', baseRef);
  qtiCustomInteraction.attr('data-base-item', baseRef + baseItem);
  qtiCustomInteraction.attr('data', qtiCustomInteractionObject.attr('data'));
  qtiCustomInteraction.attr('width', qtiCustomInteractionObject.attr('width'));
  qtiCustomInteraction.attr('height', qtiCustomInteractionObject.attr('height'));

  qtiCustomInteractionObject.remove();

  return $;
}
