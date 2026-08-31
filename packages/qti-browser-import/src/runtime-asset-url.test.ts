import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __test__ } from './import-qti-package';

const { resolveRuntimeAssetUrl, resetRuntimeAssetUrlCache } = __test__;

const ORIGIN = 'https://player.example';
const PKG = `${ORIGIN}/__qti_pkg__/pkg-1`;

/**
 * These run in a plain Node environment, so stand in for the two browser globals the resolver
 * touches. `window.location.origin` is only used to parse the URL, never to rewrite it.
 */
function stubBrowserGlobals(): void {
  vi.stubGlobal('window', { location: { origin: ORIGIN } });
}

/** Responds 200 for the listed URLs and 404 for anything else, recording what was asked for. */
function stubFetch(okUrls: string[]): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    return {
      ok: okUrls.includes(url),
      status: okUrls.includes(url) ? 200 : 404,
      headers: { get: () => '' },
    } as unknown as Response;
  });
  return { calls };
}

describe('resolveRuntimeAssetUrl', () => {
  beforeEach(() => {
    stubBrowserGlobals();
    resetRuntimeAssetUrlCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns the package URL itself, never a blob: URL', async () => {
    // Regression guard. This value is written into the item XML and persisted in the package
    // cache, so it has to outlive the document that produced it. An object URL is revoked with
    // its creating document, which made the cached item load exactly once and fail with
    // ERR_FILE_NOT_FOUND on every later visit.
    const moduleUrl = `${PKG}/resources/modules/pci-example/pci-module.js`;
    stubFetch([moduleUrl]);

    const resolved = await resolveRuntimeAssetUrl(moduleUrl);

    expect(resolved).toBe(moduleUrl);
    expect(resolved.startsWith('blob:')).toBe(false);
  });

  test('probes the .js variant for an extensionless module id', async () => {
    // Module resolution configs name modules without an extension.
    const bare = `${PKG}/resources/modules/pci-example/pci-module`;
    const { calls } = stubFetch([`${bare}.js`]);

    const resolved = await resolveRuntimeAssetUrl(bare);

    expect(resolved).toBe(`${bare}.js`);
    expect(calls).toEqual([bare, `${bare}.js`]);
  });

  test('falls through to the .json variant', async () => {
    const bare = `${PKG}/resources/modules/pci-example/module_resolution`;
    stubFetch([`${bare}.json`]);

    expect(await resolveRuntimeAssetUrl(bare)).toBe(`${bare}.json`);
  });

  test('keeps a stylesheet on its package URL so relative url() still resolves', async () => {
    // The old implementation inlined CSS into a blob and rewrote every url() to absolute. Served
    // from its own package URL the stylesheet needs no rewriting - and stays cacheable.
    const cssUrl = `${PKG}/resources/modules/pci-example/assets/theme.css`;
    stubFetch([cssUrl]);

    expect(await resolveRuntimeAssetUrl(cssUrl)).toBe(cssUrl);
  });

  test('leaves non-http references untouched', async () => {
    const { calls } = stubFetch([]);

    expect(await resolveRuntimeAssetUrl('data:text/javascript,void 0')).toBe('data:text/javascript,void 0');
    expect(await resolveRuntimeAssetUrl('./relative/module.js')).toBe('./relative/module.js');
    expect(calls).toEqual([]);
  });

  test('throws when no candidate resolves, so a broken package is not silently cached', async () => {
    const missing = `${PKG}/resources/modules/gone/pci-module`;
    stubFetch([]);

    await expect(resolveRuntimeAssetUrl(missing)).rejects.toThrow(/Runtime asset missing/);
  });

  test('caches a resolved URL instead of refetching it', async () => {
    const moduleUrl = `${PKG}/resources/modules/pci-example/pci-module.js`;
    const { calls } = stubFetch([moduleUrl]);

    await resolveRuntimeAssetUrl(moduleUrl);
    await resolveRuntimeAssetUrl(moduleUrl);

    expect(calls).toEqual([moduleUrl]);
  });
});
