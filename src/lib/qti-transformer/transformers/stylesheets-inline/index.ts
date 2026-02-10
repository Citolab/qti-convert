import * as cheerio from 'cheerio';

type GetStylesheetContent = (href: string) => Promise<string | null | undefined>;
const DEFAULT_CACHE_PREFIX = 'qti-convert:stylesheet-inline:';
const DEFAULT_MAX_CACHE_SIZE = 50 * 1024;

export interface StylesheetsInlineOptions {
  cache?: boolean;
  maxCacheSize?: number;
  cacheKeyPrefix?: string;
}

export async function stylesheetsInline(
  $: cheerio.CheerioAPI,
  getStylesheetContent: GetStylesheetContent = fetchStylesheetContent,
  options: StylesheetsInlineOptions = {}
) {
  const cacheEnabled = options.cache !== false;
  const maxCacheSize = options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  const cacheKeyPrefix = options.cacheKeyPrefix ?? DEFAULT_CACHE_PREFIX;
  const stylesheetCache = new Map<string, string>();

  const stylesheets = $('qti-stylesheet').toArray();

  for (const stylesheet of stylesheets) {
    const href = $(stylesheet).attr('href');
    if (!href) {
      continue;
    }

    try {
      const cssContent = await getCssContent(href, getStylesheetContent, {
        cacheEnabled,
        maxCacheSize,
        cacheKeyPrefix,
        stylesheetCache
      });

      if (typeof cssContent === 'string') {
        $(stylesheet).text(cssContent);
      }
    } catch (error) {
      console.warn(`Failed to inline stylesheet "${href}"`, error);
    }
  }

  return $;
}

async function fetchStylesheetContent(href: string): Promise<string> {
  const response = await fetch(href);
  if (!response.ok) {
    throw new Error(`Failed to fetch stylesheet: ${href}`);
  }

  return response.text();
}

async function getCssContent(
  href: string,
  getStylesheetContent: GetStylesheetContent,
  settings: {
    cacheEnabled: boolean;
    maxCacheSize: number;
    cacheKeyPrefix: string;
    stylesheetCache: Map<string, string>;
  }
) {
  if (settings.stylesheetCache.has(href)) {
    return settings.stylesheetCache.get(href);
  }

  const cacheKey = `${settings.cacheKeyPrefix}${encodeURIComponent(href)}`;
  const storage = getStorage();
  if (settings.cacheEnabled && storage) {
    const cachedContent = readFromStorage(storage, cacheKey);
    if (cachedContent !== null) {
      settings.stylesheetCache.set(href, cachedContent);
      return cachedContent;
    }
  }

  const cssContent = await getStylesheetContent(href);
  if (typeof cssContent !== 'string') {
    return cssContent;
  }

  settings.stylesheetCache.set(href, cssContent);

  if (settings.cacheEnabled && storage && cssContent.length <= settings.maxCacheSize) {
    writeToStorage(storage, cacheKey, cssContent);
  }

  return cssContent;
}

function getStorage(): Storage | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  return sessionStorage;
}

function readFromStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeToStorage(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch (_error) {
    // noop
  }
}

export default stylesheetsInline;
