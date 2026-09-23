import { expect, test } from 'vitest';
import { QTI2_ELEMENT_NAMES, qti2ElementNameToQti3, qti3ElementNameToQti2 } from './qti-names';

test('every QTI 2 element name round-trips through its QTI 3 name', () => {
  for (const name of QTI2_ELEMENT_NAMES) {
    const qti3 = qti2ElementNameToQti3(name);
    expect(qti3, name).toMatch(/^qti-[a-z0-9-]+$/);
    expect(qti3ElementNameToQti2(qti3!), qti3!).toBe(name);
  }
});

test('irregular and unknown names', () => {
  expect(qti2ElementNameToQti3('durationLT')).toBe('qti-duration-lt');
  expect(qti3ElementNameToQti2('qti-duration-gte')).toBe('durationGTE');
  expect(qti2ElementNameToQti3('div')).toBeNull();
  expect(qti3ElementNameToQti2('div')).toBeNull();
  // QTI 3-only elements fall back to camelCase
  expect(qti3ElementNameToQti2('qti-shared-stimulus-thing')).toBe('sharedStimulusThing');
});
