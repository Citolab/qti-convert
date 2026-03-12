import { afterEach, expect, test, vi } from 'vitest';
import { qtiTransform } from '../../qti-transform';
import { areXmlEqual } from '../utils-node-only';

const xml = String.raw;

function createStorageMock(initialData: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initialData));
  return {
    length: store.size,
    clear() {
      store.clear();
      this.length = store.size;
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] || null;
    },
    removeItem(key: string) {
      store.delete(key);
      this.length = store.size;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
      this.length = store.size;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('inline qti-stylesheet content from href', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/main.css" type="text/css"/>
</qti-assessment-item>`;

  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/main.css" type="text/css">.root{display:block;}</qti-stylesheet>
</qti-assessment-item>`;

  const result = (
    await qtiTransform(input).stylesheetsInline(async href => {
      if (href === 'styles/main.css') {
        return '.root{display:block;}';
      }
      return null;
    })
  ).xml();

  const areEqual = await areXmlEqual(result, expectedOutput);
  expect(areEqual).toEqual(true);
});

test('skip qti-stylesheet without href', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet type="text/css">.existing{color:red;}</qti-stylesheet>
</qti-assessment-item>`;

  const result = (
    await qtiTransform(input).stylesheetsInline(async () => {
      throw new Error('should not be called');
    })
  ).xml();

  const areEqual = await areXmlEqual(result, input);
  expect(areEqual).toEqual(true);
});

test('cache stylesheet in sessionStorage and reuse within transform', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/main.css" type="text/css"/>
  <qti-stylesheet href="styles/main.css" type="text/css"/>
</qti-assessment-item>`;
  const expectedOutput = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/main.css" type="text/css">.cached{display:block;}</qti-stylesheet>
  <qti-stylesheet href="styles/main.css" type="text/css">.cached{display:block;}</qti-stylesheet>
</qti-assessment-item>`;

  const storage = createStorageMock();
  vi.stubGlobal('sessionStorage', storage);

  const getStylesheetContent = vi.fn(async () => '.cached{display:block;}');

  const result = (await qtiTransform(input).stylesheetsInline(getStylesheetContent)).xml();
  const areEqual = await areXmlEqual(result, expectedOutput);

  expect(getStylesheetContent).toHaveBeenCalledTimes(1);
  expect(areEqual).toEqual(true);
  expect(storage.getItem('qti-convert:stylesheet-inline:styles%2Fmain.css')).toEqual('.cached{display:block;}');
});

test('use stylesheet from sessionStorage cache when available', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/main.css" type="text/css"/>
</qti-assessment-item>`;

  const storage = createStorageMock({
    'qti-convert:stylesheet-inline:styles%2Fmain.css': '.from-storage{color:blue;}'
  });
  vi.stubGlobal('sessionStorage', storage);

  const getStylesheetContent = vi.fn(async () => '.from-loader{color:red;}');

  const result = (await qtiTransform(input).stylesheetsInline(getStylesheetContent)).xml();

  expect(getStylesheetContent).not.toHaveBeenCalled();
  expect(result).toContain('.from-storage{color:blue;}');
});

test('do not cache stylesheet when content exceeds maxCacheSize', async () => {
  const input = xml`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-stylesheet href="styles/large.css" type="text/css"/>
</qti-assessment-item>`;

  const storage = createStorageMock();
  vi.stubGlobal('sessionStorage', storage);

  await qtiTransform(input).stylesheetsInline(async () => '.this-is-too-large', { maxCacheSize: 5 });

  expect(storage.getItem('qti-convert:stylesheet-inline:styles%2Flarge.css')).toEqual(null);
});
