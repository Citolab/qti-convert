import * as cheerio from 'cheerio';

export interface StripStylesheetsOptions {
  /** Pattern to match stylesheets to remove (supports wildcards) */
  removePattern?: string;
  /** Pattern to match stylesheets to keep (supports wildcards) */
  keepPattern?: string;
}

export function stripStylesheets($: cheerio.CheerioAPI, options?: StripStylesheetsOptions) {
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
