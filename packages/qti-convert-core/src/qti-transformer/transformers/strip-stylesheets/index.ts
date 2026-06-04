import * as cheerio from 'cheerio';

export interface StripStylesheetsOptions {
  /** Pattern to match stylesheets to remove (supports wildcards) */
  removePattern?: string;
  /** Pattern to match stylesheets to keep (supports wildcards) */
  keepPattern?: string;
  /**
   * Also strip stylesheets from stimulus files referenced via
   * `qti-assessment-stimulus-ref` (requires a {@link StimulusResolver}).
   * Defaults to `true`; set to `false` to leave stimulus stylesheets untouched.
   */
  stimulus?: boolean;
}

/**
 * Resolver used to reach the stimulus files referenced via
 * `qti-assessment-stimulus-ref`. Those files live outside the current document,
 * so reading and writing them is delegated to the caller (zip in the browser,
 * filesystem in node, ...).
 */
export interface StimulusResolver {
  /**
   * Read the raw XML of the stimulus referenced by `href` (the value of the
   * `href` attribute on the `qti-assessment-stimulus-ref`). Return
   * `null`/`undefined` when the file can't be found.
   */
  readStimulus: (href: string) => Promise<string | null | undefined>;
  /** Persist the updated stimulus XML for `href`. */
  writeStimulus: (href: string, content: string) => Promise<void>;
}

export function stripStylesheets($: cheerio.CheerioAPI, options?: StripStylesheetsOptions) {
  stripStylesheetsFromDoc($, options);
}

/**
 * Strips stylesheets from the given document AND from every stimulus file it
 * references through `qti-assessment-stimulus-ref`. Because those stimulus files
 * are separate documents, a {@link StimulusResolver} is required to read and
 * write them back.
 */
export async function stripStylesheetsWithStimulusRefs(
  $: cheerio.CheerioAPI,
  resolver: StimulusResolver,
  options?: StripStylesheetsOptions
) {
  stripStylesheetsFromDoc($, options);

  // Stimulus stripping is opt-out via `options.stimulus === false`
  if (options?.stimulus === false) return;

  // Collect referenced stimulus files (dedupe, an item may reference the same one twice)
  const hrefs = new Set<string>();
  $('qti-assessment-stimulus-ref').each((_, element) => {
    const href = $(element).attr('href');
    if (href) hrefs.add(href);
  });

  for (const href of hrefs) {
    const content = await resolver.readStimulus(href);
    if (!content) continue;

    const $stimulus = cheerio.load(content, {
      xmlMode: true,
      xml: true,
      _useHtmlParser2: true,
      decodeEntities: true
    } as unknown as cheerio.CheerioOptions);

    stripStylesheetsFromDoc($stimulus, options);
    await resolver.writeStimulus(href, $stimulus.xml());
  }
}

function stripStylesheetsFromDoc($: cheerio.CheerioAPI, options?: StripStylesheetsOptions) {
  if (!options || (!options.removePattern && !options.keepPattern)) {
    // Remove all stylesheets when no options are specified
    $('qti-stylesheet').remove();
    return;
  }

  $('qti-stylesheet').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    let shouldRemove = false;

    // If keepPattern is specified, only remove if it doesn't match the keep pattern
    if (options.keepPattern) {
      shouldRemove = !matchesPattern(href, options.keepPattern);
    }
    // If removePattern is specified, remove if it matches the remove pattern
    else if (options.removePattern) {
      shouldRemove = matchesPattern(href, options.removePattern);
    }

    if (shouldRemove) {
      $(element).remove();
    }
  });
}

/**
 * Matches a filename against a pattern with wildcard support
 * Patterns:
 * - *searchTerm: ends with searchTerm
 * - searchTerm*: starts with searchTerm
 * - *searchTerm*: contains searchTerm
 * - searchTerm: exact match
 */
function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    // Contains pattern: *searchTerm*
    const searchTerm = pattern.slice(1, -1);
    return filename.includes(searchTerm);
  } else if (pattern.startsWith('*')) {
    // Ends with pattern: *searchTerm
    const searchTerm = pattern.slice(1);
    return filename.endsWith(searchTerm);
  } else if (pattern.endsWith('*')) {
    // Starts with pattern: searchTerm*
    const searchTerm = pattern.slice(0, -1);
    return filename.startsWith(searchTerm);
  } else {
    // Exact match
    return filename === pattern;
  }
}
