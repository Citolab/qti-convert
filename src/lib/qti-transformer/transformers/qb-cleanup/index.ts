import * as cheerio from 'cheerio';

export function qbCleanup($: cheerio.CheerioAPI) {
  /* remove default body class */
  const itemBody = $('qti-item-body');
  if (itemBody.length > 0) {
    itemBody.removeClass('defaultBody');

    if (itemBody.attr('class') === '') {
      itemBody.removeAttr('class');
    }
    itemBody.html(
      itemBody
        .html()
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#xa0;/g, ' ')
    );
    $('.content').attr('class', 'container');

    $('div#leftbody').length && $('div#leftbody').contents().unwrap();
    $('div#body').length && $('div#body').contents().unwrap();
    $('div#mc').length && $('div#mc').contents().unwrap();
    $('div#question').length && $('div#question').contents().unwrap();

    $('td > p').length && $('td > p').contents().unwrap();

    $(`div[class^="cito_genclass"]`).each((index, element) => {
      $(element).replaceWith($(element).html());
    });

    $('p').each((index, element) => {
      const $element = $(element);
      if ($element.html().trim() === '') {
        $element.remove();
      }
    });

    $('qti-rubric-block > qti-content-body div').each(function () {
      const innerHtml = $(this).html().trim();
      const textContent = $(this).text().trim();

      if (!textContent || textContent === '&nbsp;' || innerHtml === '<br/>') {
        $(this).remove();
      } else {
        if ($(this).contents().first().is('br')) {
          $(this).contents().first().remove();
        }
      }
    });
    // reset scores before response processing
    const variableIds: string[] = [];
    $('qti-set-outcome-value').each(function () {
      const variableId = $(this).attr('identifier');
      if (variableId && !variableIds.includes(variableId)) {
        variableIds.push(variableId);
      }
    });
    const resetTemplate = (id: string) => {
      return `<qti-set-outcome-value identifier="${id}">
      <qti-base-value base-type="integer">0</qti-base-value>
    </qti-set-outcome-value>`;
    };
    const responseProcessing = $('qti-response-processing');
    if (responseProcessing) {
      for (const variableId of variableIds) {
        const resetCode = resetTemplate(variableId);
        responseProcessing.prepend(resetCode);
      }
    }
  }

  // $('div:has(qti-extended-text-interaction)').contents().unwrap();
}
