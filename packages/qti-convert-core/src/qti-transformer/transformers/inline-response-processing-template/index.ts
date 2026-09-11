import * as cheerio from 'cheerio';

/**
 * Resolves the raw XML of a response processing template.
 *
 * It is called with the value of the `template-location` attribute first — that is the
 * resolvable url — and, when that yields nothing, with the `template` identifier. Return
 * `null`/`undefined` to signal "cannot resolve this one" so the next candidate (or nothing at
 * all) is used.
 */
export type ResponseProcessingTemplateResolver = (
  url: string,
  context: {
    /** Raw value of the `template` attribute, if present. */
    template?: string;
    /** Raw value of the `template-location` attribute, if present. */
    templateLocation?: string;
    /** Which of the two attributes `url` came from. */
    attribute: 'template' | 'template-location';
  }
) => Promise<string | null | undefined>;

export interface InlineResponseProcessingTemplateOptions {
  /**
   * Base url/path used to resolve relative `template` / `template-location` values before they
   * are handed to the resolver.
   */
  baseUrl?: string;
  /**
   * Also inline the three templates every player implements natively (`match_correct`,
   * `map_response`, `map_response_point`). Default `false`: those are left untouched.
   */
  includeStandardTemplates?: boolean;
  /**
   * Template names (last path segment, without `.xml`) that are treated as natively supported
   * and therefore skipped. Defaults to the IMS supplied templates.
   */
  standardTemplates?: string[];
  /**
   * Inline the template even when the element already contains response rules. Default `false`
   * because the spec prefers the rules written inside the element itself.
   */
  overwriteExistingRules?: boolean;
  /**
   * Keep the `template` / `template-location` attributes after inlining. Default `false`, since
   * players such as qti-components clear the element content when a `template` is present.
   */
  keepTemplateAttributes?: boolean;
  /** Cache resolved templates in sessionStorage when available. Default `true`. */
  cache?: boolean;
  maxCacheSize?: number;
  cacheKeyPrefix?: string;
}

const DEFAULT_CACHE_PREFIX = 'qti-convert:rp-template:';
const DEFAULT_MAX_CACHE_SIZE = 50 * 1024;
const DEFAULT_STANDARD_TEMPLATES = ['match_correct', 'map_response', 'map_response_point'];

/** `.../rptemplates/match_correct.xml` -> `match_correct` */
export function responseProcessingTemplateName(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop() || withoutQuery;
  return lastSegment.replace(/\.xml$/i, '');
}

/**
 * Replaces `template` / `template-location` references on `qti-response-processing` with the
 * actual rules from the referenced template, so scoring never needs a network request.
 */
export async function inlineResponseProcessingTemplate(
  $: cheerio.CheerioAPI,
  getTemplateContent: ResponseProcessingTemplateResolver = fetchTemplateContent,
  options: InlineResponseProcessingTemplateOptions = {}
) {
  const standardTemplates = options.standardTemplates ?? DEFAULT_STANDARD_TEMPLATES;
  const settings = {
    cacheEnabled: options.cache !== false,
    maxCacheSize: options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    cacheKeyPrefix: options.cacheKeyPrefix ?? DEFAULT_CACHE_PREFIX,
    templateCache: new Map<string, string>()
  };

  const responseProcessings = $('qti-response-processing, responseProcessing').toArray();

  for (const responseProcessing of responseProcessings) {
    const el = $(responseProcessing);
    const template = el.attr('template') || undefined;
    const templateLocation = el.attr('template-location') || el.attr('templateLocation') || undefined;
    if (!template && !templateLocation) {
      continue;
    }

    if (
      !options.includeStandardTemplates &&
      template &&
      standardTemplates.includes(responseProcessingTemplateName(template))
    ) {
      continue;
    }

    if (!options.overwriteExistingRules && el.children().length > 0) {
      continue;
    }

    // `template` is a global identifier that a delivery engine is not expected to resolve over
    // the web; `template-location` is the resolvable url (usually a file inside the package), so
    // that is tried first and the identifier is only a fallback.
    const candidates: { url: string; attribute: 'template' | 'template-location' }[] = [];
    if (templateLocation) candidates.push({ url: templateLocation, attribute: 'template-location' });
    if (template) candidates.push({ url: template, attribute: 'template' });

    let rules: string | null = null;
    for (const candidate of candidates) {
      const url = resolveUrl(candidate.url, options.baseUrl);
      try {
        const content = await getTemplateXml(url, getTemplateContent, settings, {
          template,
          templateLocation,
          attribute: candidate.attribute
        });
        if (typeof content !== 'string' || content.trim() === '') {
          continue;
        }
        rules = extractResponseRules(content);
        if (rules) {
          break;
        }
        console.warn(`Response processing template "${url}" contains no response rules`);
      } catch (error) {
        console.warn(`Failed to resolve response processing template "${url}"`, error);
      }
    }

    if (!rules) {
      continue;
    }

    el.empty();
    el.append(rules);
    if (!options.keepTemplateAttributes) {
      el.removeAttr('template');
      el.removeAttr('template-location');
      el.removeAttr('templateLocation');
    }
  }

  return $;
}

function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/')) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\.\//, '')}`;
  }
}

interface TemplateCacheSettings {
  cacheEnabled: boolean;
  maxCacheSize: number;
  cacheKeyPrefix: string;
  templateCache: Map<string, string>;
}

async function getTemplateXml(
  url: string,
  getTemplateContent: ResponseProcessingTemplateResolver,
  settings: TemplateCacheSettings,
  context: Parameters<ResponseProcessingTemplateResolver>[1]
) {
  if (settings.templateCache.has(url)) {
    return settings.templateCache.get(url);
  }

  const cacheKey = `${settings.cacheKeyPrefix}${encodeURIComponent(url)}`;
  const storage = getStorage();
  if (settings.cacheEnabled && storage) {
    const cachedContent = readFromStorage(storage, cacheKey);
    if (cachedContent !== null) {
      settings.templateCache.set(url, cachedContent);
      return cachedContent;
    }
  }

  const templateXml = await getTemplateContent(url, context);
  if (typeof templateXml !== 'string') {
    return templateXml;
  }

  settings.templateCache.set(url, templateXml);

  if (settings.cacheEnabled && storage && templateXml.length <= settings.maxCacheSize) {
    writeToStorage(storage, cacheKey, templateXml);
  }

  return templateXml;
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

async function fetchTemplateContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch response processing template: ${url}`);
  }
  return response.text();
}

/**
 * Returns the response rules of a template document as an XML string, or null when the document
 * holds none.
 */
export function extractResponseRules(templateXml: string): string | null {
  const $template = cheerio.load(templateXml, {
    xmlMode: true,
    xml: true,
    _useHtmlParser2: true,
    decodeEntities: true
  } as unknown as cheerio.CheerioOptions);

  const root = $template('qti-response-processing, responseProcessing').first();
  const children = (root.length > 0 ? root.children() : $template.root().children()).toArray();

  const rules = children
    .map(child => {
      const $child = $template(child);
      // Namespace declarations from the template document would be copied verbatim into the item.
      for (const attribute of Object.keys(child.attribs || {})) {
        if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) {
          $child.removeAttr(attribute);
        }
      }
      return $template.xml($child);
    })
    .join('')
    .trim();

  return rules === '' ? null : rules;
}

export default inlineResponseProcessingTemplate;
