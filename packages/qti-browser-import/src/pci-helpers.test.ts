import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createModuleResolutionFetcher,
  detectPciBaseUrl,
} from './pci-helpers';

describe('pci-helpers', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('detectPciBaseUrl respects an explicit data-base-url', async () => {
    const baseUrl = await detectPciBaseUrl({
      packageRootUrl: '/__qti_pkg__/pkg',
      itemDirUrl: '/__qti_pkg__/pkg/items/item-1',
      xmlText: '<qti-portable-custom-interaction data-base-url="/already/fixed/"/>',
    });

    expect(baseUrl).toBe('/already/fixed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('detectPciBaseUrl prefers the item directory when item-local modules exist', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      const ok = url === '/__qti_pkg__/pkg/items/item-1/modules/GraphingInteraction.js';
      return new Response('', { status: ok ? 200 : 404 });
    });

    const baseUrl = await detectPciBaseUrl({
      packageRootUrl: '/__qti_pkg__/pkg',
      itemDirUrl: '/__qti_pkg__/pkg/items/item-1',
      xmlText: '<qti-portable-custom-interaction module="GraphingInteraction"/>',
    });

    expect(baseUrl).toBe('/__qti_pkg__/pkg/items/item-1');
  });

  test('createModuleResolutionFetcher normalizes joins and avoids double slashes', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/__qti_pkg__/pkg/items/item-1/modules/module_resolution.js') {
        return new Response(JSON.stringify({ paths: { graph: 'GraphingInteraction' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('', { status: 404 });
    });

    const getConfig = createModuleResolutionFetcher({
      packageRootUrl: '/__qti_pkg__/pkg',
      itemDirUrl: '/__qti_pkg__/pkg/items/item-1/',
    });

    const config = await getConfig('/modules/module_resolution.js');

    expect(config).toEqual({ paths: { graph: 'GraphingInteraction' } });
    expect(fetchMock).toHaveBeenCalledWith('/__qti_pkg__/pkg/items/item-1/modules/module_resolution.js', {
      method: 'GET',
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      '/__qti_pkg__/pkg/items/item-1//modules/module_resolution.js',
    );
  });

  test('createModuleResolutionFetcher falls back from .js to .json', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/module_resolution.js')) {
        return new Response('', { status: 404 });
      }
      if (url.endsWith('/module_resolution.json')) {
        return new Response(JSON.stringify({ paths: { raphael: 'modules/lib/raphael' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('', { status: 404 });
    });

    const getConfig = createModuleResolutionFetcher({
      packageRootUrl: '/__qti_pkg__/pkg',
      itemDirUrl: '/__qti_pkg__/pkg/items/item-5',
    });

    const config = await getConfig('/modules/module_resolution.js');

    expect(config).toEqual({ paths: { raphael: 'modules/lib/raphael' } });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      '/__qti_pkg__/pkg/items/item-5/modules/module_resolution.json',
    );
  });
});
