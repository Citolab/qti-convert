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
        if ($(this).contents().last().is('br')) {
          $(this).contents().last().remove();
        }
      }
    });

    // Search for empty div with class qti-layout-col6 and add non-breaking space
    const columnElements = $('.qti-layout-col6');
    for (const column of columnElements) {
      if ($(column).text().trim() === '') {
        $(column).html('\u00A0');
      }
    }

    // Convert custom classes to QTI orientation and stacking classes
    $('qti-choice-interaction').each(function () {
      const $element = $(this);
      const currentClasses = $element.attr('class') || '';
      let newClasses = currentClasses;

      // Convert column-based classes to stacking classes
      if (currentClasses.includes('two-columns')) {
        newClasses = newClasses.replace('two-columns', 'qti-choices-stacking-2');
      }
      if (currentClasses.includes('three-columns')) {
        newClasses = newClasses.replace('three-columns', 'qti-choices-stacking-3');
      }
      if (currentClasses.includes('four-columns')) {
        newClasses = newClasses.replace('four-columns', 'qti-choices-stacking-4');
      }
      if (currentClasses.includes('five-columns')) {
        newClasses = newClasses.replace('five-columns', 'qti-choices-stacking-5');
      }
      if (currentClasses.includes('one-column')) {
        newClasses = newClasses.replace('one-column', 'qti-choices-stacking-1');
      }

      // Convert orientation classes
      if (currentClasses.includes('horizontal')) {
        newClasses = newClasses.replace(/\bhorizontal\b/g, 'qti-orientation-horizontal');
      }
      if (currentClasses.includes('vertical')) {
        newClasses = newClasses.replace(/\bvertical\b/g, 'qti-orientation-vertical');
      }

      // Remove alignment classes that might conflict or are not needed
      newClasses = newClasses.replace(/\bcenteralign\b/g, '').trim();

      // Clean up multiple spaces and set the new class
      newClasses = newClasses.replace(/\s+/g, ' ').trim();

      if (newClasses !== currentClasses) {
        if (newClasses === '') {
          $element.removeAttr('class');
        } else {
          $element.attr('class', newClasses);
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
