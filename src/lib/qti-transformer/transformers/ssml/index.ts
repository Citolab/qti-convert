import * as cheerio from 'cheerio';

export const ssmlSubToSpan = ($: cheerio.CheerioAPI) => {
  // Convert <ssml:sub> to <span data-ssml-sub-alias="...">
  $('ssml\\:sub').each((_, elem) => {
    const $elem = $(elem);
    const alias = $elem.attr('alias') || '';
    const content = $elem.html() || '';

    const $span = $('<span></span>').attr('data-ssml-sub-alias', alias).html(content);

    $elem.replaceWith($span);
  });

  // Convert <ssml:break> to <span data-ssml-break-time="..." data-ssml-break-strength="..."></span>
  $('ssml\\:break').each((_, elem) => {
    const $elem = $(elem);
    const time = $elem.attr('time');
    const strength = $elem.attr('strength');

    const $span = $('<span></span>');
    if (time) $span.attr('data-ssml-break-time', time);
    if (strength) $span.attr('data-ssml-break-strength', strength);

    $elem.replaceWith($span);
  });

  // Convert <ssml:say-as> to <span data-ssml-say-as="..." data-ssml-say-as-format="..." data-ssml-say-as-detail="...">
  $('ssml\\:say-as').each((_, elem) => {
    const $elem = $(elem);
    const interpretAs = $elem.attr('interpret-as');
    const format = $elem.attr('format');
    const detail = $elem.attr('detail');
    const content = $elem.html() || '';

    const $span = $('<span></span>').html(content);
    if (interpretAs) $span.attr('data-ssml-say-as', interpretAs);
    if (format) $span.attr('data-ssml-say-as-format', format);
    if (detail) $span.attr('data-ssml-say-as-detail', detail);

    $elem.replaceWith($span);
  });

  // Convert <ssml:phoneme> to <span data-ssml-phoneme-ph="..." data-ssml-phoneme-alphabet="...">
  $('ssml\\:phoneme').each((_, elem) => {
    const $elem = $(elem);
    const ph = $elem.attr('ph');
    const alphabet = $elem.attr('alphabet');
    const content = $elem.html() || '';

    const $span = $('<span></span>').html(content);
    if (ph) $span.attr('data-ssml-phoneme-ph', ph);
    if (alphabet) $span.attr('data-ssml-phoneme-alphabet', alphabet);

    $elem.replaceWith($span);
  });

  // Convert <ssml:prosody> to <span data-ssml-prosody-pitch="..." data-ssml-prosody-rate="..." data-ssml-prosody-volume="..." data-ssml-prosody-contour="..." data-ssml-prosody-range="..." data-ssml-prosody-duration="...">
  $('ssml\\:prosody').each((_, elem) => {
    const $elem = $(elem);
    const pitch = $elem.attr('pitch');
    const rate = $elem.attr('rate');
    const volume = $elem.attr('volume');
    const contour = $elem.attr('contour');
    const range = $elem.attr('range');
    const duration = $elem.attr('duration');
    const content = $elem.html() || '';

    const $span = $('<span></span>').html(content);
    if (pitch) $span.attr('data-ssml-prosody-pitch', pitch);
    if (rate) $span.attr('data-ssml-prosody-rate', rate);
    if (volume) $span.attr('data-ssml-prosody-volume', volume);
    if (contour) $span.attr('data-ssml-prosody-contour', contour);
    if (range) $span.attr('data-ssml-prosody-range', range);
    if (duration) $span.attr('data-ssml-prosody-duration', duration);

    $elem.replaceWith($span);
  });

  // Convert <ssml:emphasis> to <span data-ssml-emphasis-level="...">
  $('ssml\\:emphasis').each((_, elem) => {
    const $elem = $(elem);
    const level = $elem.attr('level');
    const content = $elem.html() || '';

    const $span = $('<span></span>').html(content);
    if (level) $span.attr('data-ssml-emphasis-level', level);

    $elem.replaceWith($span);
  });

  // Convert <ssml:voice> to <span data-ssml-voice-gender="..." data-ssml-voice-age="..." data-ssml-voice-variant="..." data-ssml-voice-name="..." data-ssml-voice-languages="...">
  $('ssml\\:voice').each((_, elem) => {
    const $elem = $(elem);
    const gender = $elem.attr('gender');
    const age = $elem.attr('age');
    const variant = $elem.attr('variant');
    const name = $elem.attr('name');
    const languages = $elem.attr('languages');
    const content = $elem.html() || '';

    const $span = $('<span></span>').html(content);
    if (gender) $span.attr('data-ssml-voice-gender', gender);
    if (age) $span.attr('data-ssml-voice-age', age);
    if (variant) $span.attr('data-ssml-voice-variant', variant);
    if (name) $span.attr('data-ssml-voice-name', name);
    if (languages) $span.attr('data-ssml-voice-languages', languages);

    $elem.replaceWith($span);
  });
};

export default ssmlSubToSpan;
