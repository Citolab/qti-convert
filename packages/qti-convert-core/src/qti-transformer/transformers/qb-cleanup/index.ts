import * as cheerio from 'cheerio';

export function qbCleanup($: cheerio.CheerioAPI) {
  const itemBodies = $('qti-item-body');
  if (itemBodies.length > 0) {
    itemBodies.each((_, itemBodyEl) => {
      const itemBody = $(itemBodyEl);

      const html = itemBody.html();
      if (typeof html === 'string') {
        itemBody.html(html.replace(/\u00A0/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#xa0;/g, ' '));
      }

      const directContentWrappers = itemBody
        .children('div.content, div.container')
        .filter((_, el) => {
          const classValue = ($(el).attr('class') || '').trim();
          return classValue === 'content' || classValue === 'container';
        });

      if (directContentWrappers.length > 0) {
        directContentWrappers.contents().unwrap();
        itemBody.addClass('custom-qti-style cito-style');
      }
    });

    $('.content').attr('class', 'container');
    $('div#leftbody').length && $('div#leftbody').contents().unwrap();
    $('div#body').length && $('div#body').contents().unwrap();
    $('div#mc').length && $('div#mc').contents().unwrap();
    $('div#question').length && $('div#question').contents().unwrap();
    $('td > p').length && $('td > p').contents().unwrap();

    $(`div[class^="cito_genclass"]`).each((index, element) => {
      $(element).replaceWith($(element).html());
    });

    // Clean up empty and unnecessary spans
    function cleanupSpans() {
      let changed = true;
      while (changed) {
        changed = false;

        $('span').each(function () {
          const $span = $(this);
          const textContent = $span.text().trim();
          const htmlContent = $span.html().trim();

          // Check if span contains QTI elements that should be preserved
          const hasQtiElements =
            $span.find(
              '[class*="qti-"], [id*="qti-"], qti-gap, qti-gap-text, qti-gap-match-interaction, qti-extended-text-interaction, qti-choice-interaction, qti-text-entry-interaction, qti-inline-choice-interaction, qti-hottext-interaction, qti-order-interaction, qti-associate-interaction, qti-match-interaction, qti-hotspot-interaction, qti-select-point-interaction, qti-graphic-order-interaction, qti-graphic-associate-interaction, qti-graphic-gap-match-interaction, qti-position-object-interaction, qti-slider-interaction, qti-draw-interaction, qti-upload-interaction'
            ).length > 0;

          // Spans can also wrap media/other non-text content (e.g. <img>) that must not be removed.
          const hasMediaElements =
            $span.find('img, video, audio, object, iframe, embed, svg, math, table, qti-media-interaction').length > 0;

          // If span has no text but contains media/non-text content, unwrap it (keep the content).
          if (!textContent && hasMediaElements) {
            const attributes = $span.get(0)?.attribs;
            const hasAttributes = attributes && Object.keys(attributes).length > 0;
            if (!hasAttributes) {
              $span.replaceWith($span.contents());
              changed = true;
            }
            return;
          }

          // If span is completely empty (no text, no meaningful content) AND doesn't contain QTI elements
          if ((!textContent || htmlContent === '' || htmlContent === '&nbsp;') && !hasQtiElements) {
            $span.remove();
            changed = true;
            return;
          }

          // If span contains only whitespace AND doesn't contain QTI elements, remove it
          if (!textContent && htmlContent.match(/^[\s&nbsp;]*$/) && !hasQtiElements) {
            $span.remove();
            changed = true;
            return;
          }

          // Check if span has attributes (preserve spans with classes, ids, etc.)
          const attributes = $span.get(0)?.attribs;
          const hasAttributes = attributes && Object.keys(attributes).length > 0;

          // Don't unwrap spans that have attributes
          if (hasAttributes) {
            return;
          }

          // Special handling for the problematic pattern: <span> <span>text</span></span>
          // This should become just "text"
          const children = $span.children('span');
          if (children.length === 1) {
            const childSpan = children.first();
            const childText = childSpan.text().trim();

            // If the child span has text and the outer span only has whitespace + the child
            if (childText) {
              const outerContents = $span.contents();
              let hasOnlyWhitespaceAndOneSpan = true;

              outerContents.each(function () {
                const node = $(this);
                if (node.is('span')) {
                  // This is our child span, that's fine
                  return;
                } else if (node.get(0).nodeType === 3) {
                  // Text node
                  // Check if it's only whitespace
                  if (node.text().trim()) {
                    hasOnlyWhitespaceAndOneSpan = false;
                  }
                } else {
                  // Other element
                  hasOnlyWhitespaceAndOneSpan = false;
                }
              });

              if (hasOnlyWhitespaceAndOneSpan) {
                // Replace the outer span with just the child span's content
                $span.replaceWith(childSpan.contents());
                changed = true;
                return;
              }
            }
          }

          // Handle other nested span patterns
          const parent = $span.parent();

          // Case: Multiple nested empty spans - look for patterns like <span><span></span></span>
          if (children.length === 1) {
            const childSpan = children.first();
            const childText = childSpan.text().trim();
            const childHtml = childSpan.html().trim();

            // If child span is empty, remove it and check if parent becomes empty
            if (!childText || childHtml === '' || childHtml === '&nbsp;') {
              childSpan.remove();
              // After removing child, check if this span is now empty
              if (!$span.text().trim()) {
                $span.remove();
                changed = true;
                return;
              }
            }
          }

          // Case: Very specific case - unwrap spans that are clearly redundant wrappers
          // Only unwrap if the span is a clear wrapper with no semantic purpose
          if (children.length === 0 && textContent) {
            // Check if this is a problematic pattern like <span> <span>text</span></span>
            const nextSibling = $span.next();
            const prevSibling = $span.prev();
            const parentTagName = parent.prop('tagName')?.toLowerCase();

            // Only unwrap in very specific cases where we're sure it's not semantic
            // Don't unwrap spans inside semantic elements like strong, em, etc.
            const semanticParents = ['strong', 'em', 'b', 'i', 'u', 'mark', 'small', 'del', 'ins', 'sub', 'sup'];
            const isInSemanticParent = semanticParents.includes(parentTagName || '');

            // Only unwrap if it's clearly a wrapper in a paragraph and not in semantic context
            if (!isInSemanticParent && parentTagName === 'p' && !prevSibling.length && !nextSibling.length) {
              $span.contents().unwrap();
              changed = true;
              return;
            }
          }
        });
      }
    }

    // Run span cleanup
    cleanupSpans();

    // Clean up UserSRVet paragraphs with redundant strong/bold nesting
    function cleanupUserSRVetBoldNesting() {
      // 1) If an element inside a <strong> has class UserSRVet, remove that class.
      $('strong .UserSRVet').each(function () {
        const $el = $(this);
        $el.removeClass('UserSRVet');
        if (($el.attr('class') || '').trim() === '') {
          $el.removeAttr('class');
        }
      });

      // 2) If an element has class UserSRVet and contains an inner <strong>, unwrap the <strong>.
      $('.UserSRVet').each(function () {
        const $userEl = $(this);
        $userEl.find('strong').each(function () {
          const $strong = $(this);

          // Avoid "wordword" concatenation when <strong> is directly followed by an element (e.g. <span>).
          const strongNode = $strong.get(0) as unknown as { next?: { type?: string; name?: string } };
          if (strongNode?.next?.type === 'tag' && !/\s$/.test($strong.text())) {
            $strong.after(' ');
          }

          $strong.replaceWith($strong.contents());
        });
      });
    }

    // Run UserSRVet cleanup
    cleanupUserSRVetBoldNesting();

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
      const $column = $(column);
      const text = $column.text().replace(/\u00A0/g, '').trim();
      if (text !== '') continue;

      // Some columns contain non-text content (e.g. video/media interactions) and should not be replaced by &nbsp;.
      const hasNonTextContent = $column
        .find('*')
        .toArray()
        .some((el) => {
          const tagName = (el as unknown as { tagName?: string }).tagName?.toLowerCase();
          if (!tagName) return false;

          if (tagName.startsWith('qti-')) return true;
          if (tagName.startsWith('dep:')) return true;

          if (['video', 'audio', 'img', 'object', 'iframe', 'embed', 'svg', 'math', 'table'].includes(tagName)) {
            return true;
          }

          const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs;
          return !!attribs && Object.keys(attribs).length > 0;
        });

      if (!hasNonTextContent) {
        $column.html('\u00A0');
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
}
