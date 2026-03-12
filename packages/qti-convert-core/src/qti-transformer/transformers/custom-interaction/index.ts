import * as cheerio from 'cheerio';

export async function customInteraction(
  $: cheerio.CheerioAPI,
  baseRef: string,
  baseItem: string,
  force = false
) {
  const qtiCustomInteraction = $('qti-custom-interaction');
  const qtiCustomInteractionObject = qtiCustomInteraction.find('object');

  const setAttribute = (name: string, value?: string) => {
    if (!value) {
      return;
    }
    if (!force && qtiCustomInteraction.attr(name) !== undefined) {
      return;
    }
    qtiCustomInteraction.attr(name, value);
  };

  setAttribute('data-base-ref', baseRef);
  setAttribute('data-base-item', baseRef + baseItem);
  setAttribute('data', qtiCustomInteractionObject.attr('data'));
  setAttribute('width', qtiCustomInteractionObject.attr('width'));
  setAttribute('height', qtiCustomInteractionObject.attr('height'));

  qtiCustomInteractionObject.remove();

  return $;
}
