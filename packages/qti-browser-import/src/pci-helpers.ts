import type { ModuleResolutionConfig } from '@citolab/qti-convert/qti-transformer';

// ---------------------------------------------------------------------------
// URL probing helpers
// ---------------------------------------------------------------------------

const urlExistsCache = new Map<string, Promise<boolean>>();

async function urlExists(path: string): Promise<boolean> {
  if (urlExistsCache.has(path)) return urlExistsCache.get(path)!;
  const p = (async () => {
    try {
      const res = await fetch(path, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  })();
  urlExistsCache.set(path, p);
  return p;
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function joinBaseAndPath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

// ---------------------------------------------------------------------------
// detectPciBaseUrl
// ---------------------------------------------------------------------------

export interface DetectPciBaseUrlOptions {
  packageRootUrl: string;
  itemDirUrl?: string | null;
  itemStemDirUrl?: string | null;
  /** Raw XML string of the item — used to extract module names and declared paths. */
  xmlText: string;
}

/**
 * Probes the served package to determine the best `baseUrl` for RequireJS so
 * that PCI modules can be resolved.  Returns `packageRootUrl` as a fallback.
 */
export async function detectPciBaseUrl(options: DetectPciBaseUrlOptions): Promise<string> {
  const { packageRootUrl, itemDirUrl, itemStemDirUrl, xmlText } = options;

  // Prefer explicit conversion-provided baseUrl when present.
  const explicitBaseMatch = xmlText.match(
    /<qti-portable-custom-interaction\b[^>]*\bdata-base-url="([^"]+)"/i
  );
  const explicitBase = explicitBaseMatch?.[1]?.trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, '');

  const baseCandidates = [itemDirUrl, itemStemDirUrl, packageRootUrl].filter(Boolean) as string[];
  if (baseCandidates.length === 0) return packageRootUrl;

  const scriptPaths = new Set<string>();

  const moduleIdRegex = /<qti-portable-custom-interaction\b[^>]*\bmodule="([^"]+)"/gi;
  let moduleMatch: RegExpExecArray | null = null;
  while ((moduleMatch = moduleIdRegex.exec(xmlText))) {
    const normalizedId = (moduleMatch[1] || '').trim().replace(/\.js$/i, '');
    if (!normalizedId) continue;
    scriptPaths.add(`modules/${encodePathSegments(normalizedId)}.js`);
  }

  const modulePathRegex = /<qti-interaction-module\b[^>]*>/gi;
  let moduleElMatch: RegExpExecArray | null = null;
  while ((moduleElMatch = modulePathRegex.exec(xmlText))) {
    const moduleTag = moduleElMatch[0] || '';
    const primary = (moduleTag.match(/\bprimary-path="([^"]+)"/i)?.[1] || '').trim();
    const fallback = (moduleTag.match(/\bfallback-path="([^"]+)"/i)?.[1] || '').trim();
    if (primary) scriptPaths.add(primary.replace(/^\/+/, ''));
    if (fallback) scriptPaths.add(fallback.replace(/^\/+/, ''));
  }

  if (scriptPaths.size === 0) return packageRootUrl;

  const score = new Map<string, number>();
  for (const base of baseCandidates) score.set(base, 0);

  for (const base of baseCandidates) {
    for (const path of scriptPaths) {
      const direct = joinBaseAndPath(base, path);
      if (await urlExists(direct)) {
        score.set(base, (score.get(base) || 0) + 2);
        continue;
      }
      const inModules = joinBaseAndPath(base, `modules/${path.replace(/^\/+/, '')}`);
      if (await urlExists(inModules)) {
        score.set(base, (score.get(base) || 0) + 1);
      }
    }
  }

  let best = packageRootUrl;
  let bestScore = -1;
  for (const base of baseCandidates) {
    const s = score.get(base) || 0;
    if (s > bestScore) {
      best = base;
      bestScore = s;
    }
  }

  if (bestScore <= 0) return itemDirUrl || itemStemDirUrl || packageRootUrl;

  // If itemDirUrl scores equally or better than root, prefer it.
  if (itemDirUrl) {
    const declaredPaths = new Set<string>();
    const modulePathRegex2 = /<qti-interaction-module\b[^>]*>/gi;
    let m: RegExpExecArray | null = null;
    while ((m = modulePathRegex2.exec(xmlText))) {
      const tag = m[0] || '';
      const primary = (tag.match(/\bprimary-path="([^"]+)"/i)?.[1] || '').trim();
      const fallback = (tag.match(/\bfallback-path="([^"]+)"/i)?.[1] || '').trim();
      if (primary) declaredPaths.add(primary.replace(/^\/+/, ''));
      if (fallback) declaredPaths.add(fallback.replace(/^\/+/, ''));
    }

    const pathsToProbe = Array.from(declaredPaths).slice(0, 20);
    let itemHits = 0;
    let rootHits = 0;
    for (const path of pathsToProbe) {
      if (await urlExists(joinBaseAndPath(itemDirUrl, path))) itemHits += 1;
      if (await urlExists(joinBaseAndPath(packageRootUrl, path))) rootHits += 1;
    }
    if (itemHits > 0 && itemHits >= rootHits) return itemDirUrl;
  }

  return best;
}

// ---------------------------------------------------------------------------
// createModuleResolutionFetcher
// ---------------------------------------------------------------------------

export interface ModuleResolutionFetcherOptions {
  packageRootUrl: string;
  itemDirUrl?: string | null;
  itemStemDirUrl?: string | null;
}

function parseModuleResolutionConfig(text: string): ModuleResolutionConfig | null {
  const tryJson = (t: string) => {
    try {
      return JSON.parse(t) as ModuleResolutionConfig;
    } catch {
      return null;
    }
  };

  const normalize = (cfg: ModuleResolutionConfig | null) => {
    if (!cfg) return null;
    if (!cfg.paths || typeof cfg.paths !== 'object') return null;
    return cfg;
  };

  const trimmed = text.trim();

  // 1) Plain JSON
  const direct = normalize(tryJson(trimmed));
  if (direct) return direct;

  // 2) Common AMD wrappers: define(...), require.config(...), requirejs.config(...)
  const cleaned = trimmed
    .replace(/^define\(/, '')
    .replace(/^requirejs\.config\(/, '')
    .replace(/^require\.config\(/, '')
    .replace(/\);?\s*$/, '')
    .replace(/^\(/, '')
    .replace(/\)\s*$/, '')
    .trim();
  const wrapped = normalize(tryJson(cleaned));
  if (wrapped) return wrapped;

  // 3) Last-resort: extract the first JSON object from inside the file.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const inner = trimmed.slice(firstBrace, lastBrace + 1);
    const extracted = normalize(tryJson(inner));
    if (extracted) return extracted;
  }

  return null;
}

const moduleResolutionCache = new Map<string, Promise<ModuleResolutionConfig | null>>();

async function tryFetchModuleResolution(url: string): Promise<ModuleResolutionConfig | null> {
  if (moduleResolutionCache.has(url)) return moduleResolutionCache.get(url)!;
  const p = (async () => {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) return null;
      const txt = await res.text();
      return parseModuleResolutionConfig(txt);
    } catch {
      return null;
    }
  })();
  moduleResolutionCache.set(url, p);
  return p;
}

/**
 * Returns a `getModuleResolutionConfig` function compatible with
 * `configurePciAsync`.  Probes item-local paths before falling back to the
 * package root, so per-item configs take precedence over shared package configs.
 */
export function createModuleResolutionFetcher(
  options: ModuleResolutionFetcherOptions
): (fileUrl: string) => Promise<ModuleResolutionConfig> {
  const { packageRootUrl, itemDirUrl, itemStemDirUrl } = options;
  const emptyConfig: ModuleResolutionConfig = { paths: {} };

  return async (fileUrl: string): Promise<ModuleResolutionConfig> => {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (url: string) => {
      if (seen.has(url)) return;
      seen.add(url);
      candidates.push(url);
    };

    const maybePushAtBase = (base: string | null | undefined, url: string) => {
      if (!base) return;
      // If base already points at /modules, avoid doubling: /modules/module_resolution.js → /module_resolution.js
      if (base.endsWith('/modules') && url.startsWith('/modules/')) {
        push(joinBaseAndPath(base, url.slice('/modules/'.length)));
        return;
      }
      push(joinBaseAndPath(base, url));
    };

    // Prefer item-specific configs — some packages ship per-item module_resolution files.
    maybePushAtBase(itemDirUrl, fileUrl);
    if (itemStemDirUrl) maybePushAtBase(itemStemDirUrl, fileUrl);
    maybePushAtBase(packageRootUrl, fileUrl);

    // Also try .json ↔ .js extension swap
    if (fileUrl.endsWith('.js')) {
      const alt = `${fileUrl.slice(0, -3)}.json`;
      maybePushAtBase(itemDirUrl, alt);
      if (itemStemDirUrl) maybePushAtBase(itemStemDirUrl, alt);
      maybePushAtBase(packageRootUrl, alt);
    } else if (fileUrl.endsWith('.json')) {
      const alt = `${fileUrl.slice(0, -5)}.js`;
      maybePushAtBase(itemDirUrl, alt);
      if (itemStemDirUrl) maybePushAtBase(itemStemDirUrl, alt);
      maybePushAtBase(packageRootUrl, alt);
    }

    for (const url of candidates) {
      const parsed = await tryFetchModuleResolution(url);
      if (parsed) return parsed;
    }
    return emptyConfig;
  };
}

// ---------------------------------------------------------------------------
// normalizePciPaths  (DOM-level — for use with the qti-components callback API)
// ---------------------------------------------------------------------------

export interface NormalizePciPathsOptions {
  pciBaseUrl: string;
  packageRootUrl: string;
  itemDirUrl?: string | null;
  itemStemDirUrl?: string | null;
}

function stripLeadingPrefix(value: string, prefix: string): string {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
  if (value.startsWith(withSlash)) return value.slice(withSlash.length);
  if (value === prefix) return '';
  return value;
}

function maybeNormalize(value: string | null, options: NormalizePciPathsOptions): string | null {
  if (!value) return value;
  if (/^(data:|blob:|https?:)/.test(value)) return value;
  if (value.startsWith('/assets/')) return value;

  const { pciBaseUrl, packageRootUrl, itemDirUrl, itemStemDirUrl } = options;

  const shouldNormalize =
    value.startsWith('/') ||
    value.startsWith('__qti_pkg__/') ||
    value.startsWith('/__qti_pkg__/') ||
    value.startsWith('/items/') ||
    value.startsWith('modules/') ||
    value.startsWith('/modules/') ||
    value.startsWith(packageRootUrl) ||
    value.startsWith(itemDirUrl || '\x00') ||
    value.startsWith(itemStemDirUrl || '\x00') ||
    value.startsWith(pciBaseUrl);

  if (!shouldNormalize) return value;

  const packageRootPath = packageRootUrl.replace(/^\/+/, '');
  const pciBasePath = pciBaseUrl.replace(/^\/+/, '');
  const itemDirPath = (itemDirUrl || '').replace(/^\/+/, '');
  const itemStemDirPath = (itemStemDirUrl || '').replace(/^\/+/, '');

  let next = value.replace(/^\/+/, '');
  for (let i = 0; i < 4; i++) {
    const prev = next;
    if (itemStemDirPath) next = stripLeadingPrefix(next, itemStemDirPath);
    if (itemDirPath) next = stripLeadingPrefix(next, itemDirPath);
    next = stripLeadingPrefix(next, pciBasePath);
    next = stripLeadingPrefix(next, packageRootPath);
    next = next.replace(/^\/+/, '');
    if (next === prev) break;
  }

  if (pciBaseUrl.endsWith('/modules')) {
    if (next.startsWith('modules/')) next = next.slice('modules/'.length);
    if (next.startsWith('/modules/')) next = next.slice('/modules/'.length);
  }
  return next;
}

/**
 * Normalizes `primary-path` / `fallback-path` on `qti-interaction-module` elements
 * and the `module` attribute on `qti-portable-custom-interaction` elements so that
 * qti-components can safely prefix `baseUrl` without doubling path segments.
 *
 * For use with the DOM-based qti-components callback API (assessment page).
 */
export function normalizePciPaths(doc: Document | XMLDocument, options: NormalizePciPathsOptions): void {
  const { pciBaseUrl, itemDirUrl } = options;
  const effectiveBase = itemDirUrl || pciBaseUrl;

  doc.querySelectorAll('qti-interaction-module').forEach(el => {
    const primary = maybeNormalize(el.getAttribute('primary-path'), options);
    if (primary !== null) el.setAttribute('primary-path', primary);
    const fallback = maybeNormalize(el.getAttribute('fallback-path'), options);
    if (fallback !== null) el.setAttribute('fallback-path', fallback);
  });

  doc.querySelectorAll('qti-portable-custom-interaction').forEach(el => {
    if (effectiveBase) el.setAttribute('data-base-url', effectiveBase);

    const moduleValue = el.getAttribute('module')?.trim() || '';
    if (!moduleValue || /^(data:|blob:|https?:)/.test(moduleValue)) return;
    const normalized = maybeNormalize(moduleValue, options);
    if (normalized !== null && normalized !== moduleValue) {
      el.setAttribute('module', normalized);
    }
  });
}
