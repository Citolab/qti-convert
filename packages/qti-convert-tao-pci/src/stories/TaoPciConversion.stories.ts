import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect, waitFor } from 'storybook/test';
import JSZip from 'jszip';
import { convertQti2toQti3 } from '@citolab/qti-convert/qti-convert';
import { qtiTransform } from '@citolab/qti-convert/qti-transformer';
import {
  ensurePackageServiceWorkerReady,
  getUpgraderStylesheetBlobUrl,
  makePackageUrl,
  normalizeZipPath,
  putBlobFileInPackageCache,
  putTextFileInPackageCache
} from '@citolab/qti-browser-import';
import { convert } from '../index';

type XmlKind = 'item' | 'test' | 'other';

interface PreparedPackage {
  packageId: string;
  testUrl: string;
  itemRefs: { identifier: string; title: string }[];
  convertedItemCount: number;
}

interface StoryArgs {
  zipUrl: string;
  saxonJsUrl: string;
  componentsCdnUrl: string;
  componentsCssUrl: string;
}

const meta: Meta<StoryArgs> = {
  title: 'TAO PCI/Converted ZIP Preview',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Fetches a TAO QTI package ZIP, converts QTI 2.x to QTI 3, runs @citolab/qti-convert-tao-pci, then renders using qti-components loaded from a configurable CDN/module URL.'
      }
    }
  },
  argTypes: {
    zipUrl: { control: 'text' },
    saxonJsUrl: { control: 'text' },
    componentsCdnUrl: { control: 'text' },
    componentsCssUrl: { control: 'text' }
  },
  args: {
    zipUrl: '/external-pci/PCI.zip',
    saxonJsUrl: '/assets/saxon-js/SaxonJS2.rt.js',
    componentsCdnUrl: '/local-qti-components-cdn/index.js',
    componentsCssUrl: '/local-qti-components-dist/item.css'
  }
};

export default meta;
type Story = StoryObj<StoryArgs>;

function resolveHref(baseFilePath: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, `https://example.com/${baseFilePath}`).pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
}

function getDirPath(filePath: string): string {
  const normalized = normalizeZipPath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx + 1) : '';
}

function prepareItemXmlForRuntime(xmlString: string, itemPath: string, packageId: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  } catch {
    return xmlString;
  }

  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) return xmlString;

  const itemDir = getDirPath(itemPath);
  const baseUrl = makePackageUrl(packageId, itemDir);
  const packageRootUrl = makePackageUrl(packageId, '');
  const origin = window.location.origin;
  const toAbsoluteModulePath = (value: string | null): string | null => {
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed || /^(data:|blob:|https?:)/i.test(trimmed)) return trimmed;

    const resolved = resolveHref(itemPath, trimmed);
    if (!resolved) return trimmed;
    return `${origin}${makePackageUrl(packageId, resolved)}`;
  };

  const all = Array.from(doc.getElementsByTagName('*'));
  const pcis = all.filter(
    el => el.localName === 'qti-portable-custom-interaction' || el.localName === 'portableCustomInteraction'
  );
  const interactionModules = all.filter(el => el.localName === 'qti-interaction-module' || el.localName === 'module');

  for (const moduleEl of interactionModules) {
    const primary = toAbsoluteModulePath(moduleEl.getAttribute('primary-path'));
    if (primary !== null) moduleEl.setAttribute('primary-path', primary);
    const fallback = toAbsoluteModulePath(moduleEl.getAttribute('fallback-path'));
    if (fallback !== null) moduleEl.setAttribute('fallback-path', fallback);
  }

  for (const pci of pcis) {
    pci.setAttribute('data-base-url', `${origin}${baseUrl}`);
    const legacySourceModule = pci.getAttribute('data-legacy-pci-source-module')?.trim();
    if (legacySourceModule) {
      pci.setAttribute('module', legacySourceModule);
      pci.removeAttribute('data-legacy-pci-source-module');
      const modulesRoot = Array.from(pci.getElementsByTagName('*')).find(
        el => el.localName === 'qti-interaction-modules' || el.localName === 'interactionModules'
      );
      if (modulesRoot) {
        Array.from(modulesRoot.getElementsByTagName('*'))
          .filter(
            el =>
              (el.localName === 'qti-interaction-module' || el.localName === 'module') &&
              (el.getAttribute('id') || '').includes('__legacy_proxy_')
          )
          .forEach(el => el.remove());
      }
    }
  }

  const stylesheets = all.filter(el => el.localName === 'qti-stylesheet' || el.localName === 'stylesheet');
  for (const stylesheet of stylesheets) {
    const href = stylesheet.getAttribute('href')?.trim() || '';
    if (!href || /^(data:|blob:|https?:)/i.test(href)) continue;
    const resolved = resolveHref(itemPath, href);
    if (!resolved) continue;
    stylesheet.setAttribute('href', `${origin}${makePackageUrl(packageId, resolved)}`);
  }

  return new XMLSerializer().serializeToString(doc);
}

function forcePciIframeMode(xmlString: string): string {
  return xmlString.replace(/<qti-portable-custom-interaction\b[^>]*>/g, tag => {
    if (/\sdata-use-iframe="[^"]*"/i.test(tag)) {
      return tag.replace(/\sdata-use-iframe="[^"]*"/i, ' data-use-iframe="true"');
    }
    return tag.replace(/>$/, ' data-use-iframe="true">');
  });
}

function classifyXmlKind(xml: string): XmlKind {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement?.localName;
    if (root === 'qti-assessment-item' || root === 'assessmentItem') return 'item';
    if (root === 'qti-assessment-test' || root === 'assessmentTest') return 'test';
    return 'other';
  } catch {
    return 'other';
  }
}

function getIdentifierFromItem(xml: string, fallback: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return doc.documentElement.getAttribute('identifier') || fallback;
  } catch {
    return fallback;
  }
}

function extractItemRefs(testXml: string): { identifier: string; href: string }[] {
  try {
    const doc = new DOMParser().parseFromString(testXml, 'text/xml');
    return Array.from(doc.getElementsByTagName('*'))
      .filter(el => el.localName === 'qti-assessment-item-ref' || el.localName === 'assessmentItemRef')
      .map(el => ({
        identifier: el.getAttribute('identifier') || '',
        href: el.getAttribute('href') || ''
      }))
      .filter(el => Boolean(el.href));
  } catch {
    return [];
  }
}

function normalizeTestItemRefIdentifiers(
  testXml: string,
  testPath: string,
  convertedXmlByPath: Map<string, string>
): string {
  try {
    const doc = new DOMParser().parseFromString(testXml, 'application/xml');
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) return testXml;

    const refs = Array.from(doc.getElementsByTagName('*')).filter(
      el => el.localName === 'qti-assessment-item-ref' || el.localName === 'assessmentItemRef'
    );

    let changed = false;
    for (const ref of refs) {
      const href = ref.getAttribute('href') || '';
      const resolvedPath = resolveHref(testPath, href) || href;
      const itemXml = convertedXmlByPath.get(resolvedPath);
      if (!itemXml) continue;
      const actualIdentifier = getIdentifierFromItem(itemXml, resolvedPath);
      if (!actualIdentifier) continue;
      if (ref.getAttribute('identifier') !== actualIdentifier) {
        ref.setAttribute('identifier', actualIdentifier);
        changed = true;
      }
    }

    return changed ? new XMLSerializer().serializeToString(doc) : testXml;
  } catch {
    return testXml;
  }
}

function buildSyntheticTestXml(items: Array<{ identifier: string; path: string }>): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<qti-assessment-test xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
  identifier="All" title="ALL items"
  tool-name="CitoLab" tool-version="qti-convert-tao-pci-storybook"
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
    <qti-default-value><qti-value>0</qti-value></qti-default-value>
  </qti-outcome-declaration>
  <qti-test-part identifier="RES-ALL" title="Testpart-1" navigation-mode="nonlinear" submission-mode="simultaneous">
    <qti-assessment-section identifier="section_1" title="section 1" visible="true" keep-together="false">
      ${items
        .map(
          item =>
            `<qti-assessment-item-ref identifier="${item.identifier}" href="${item.path}"><qti-weight identifier="WEIGHT" value="1" /></qti-assessment-item-ref>`
        )
        .join('')}
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;
}

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureSaxonJsLoaded(saxonJsUrl: string): Promise<void> {
  const win = window as unknown as { SaxonJS?: unknown };
  if (win.SaxonJS) return;
  const candidates = Array.from(
    new Set([
      saxonJsUrl,
      '/assets/saxon-js/SaxonJS2.rt.js',
      'https://unpkg.com/saxon-js@2.7.0/SaxonJS2.rt.js',
      'https://cdn.jsdelivr.net/npm/saxon-js@2.7.0/SaxonJS2.rt.js'
    ])
  );

  const errors: string[] = [];
  for (const src of candidates) {
    try {
      await loadScript(src);
      if (win.SaxonJS) return;
      errors.push(`Loaded ${src} but window.SaxonJS is missing`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Failed to load SaxonJS. Attempts: ${errors.join(' | ')}`);
}

async function preparePackageFromZip(zipUrl: string, saxonJsUrl: string): Promise<PreparedPackage> {
  await ensurePackageServiceWorkerReady();
  await ensureSaxonJsLoaded(saxonJsUrl);

  const packageId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const response = await fetch(zipUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ZIP from ${zipUrl} (${response.status})`);
  }

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const files = Object.values(zip.files).filter(entry => !entry.dir);

  const xmlByPath = new Map<string, string>();
  let testFilePath: string | null = null;

  for (const entry of files) {
    const path = normalizeZipPath(entry.name);
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xml') {
      const text = await entry.async('text');
      xmlByPath.set(path, text);
      const kind = classifyXmlKind(text);
      if (kind === 'test' && !testFilePath) {
        testFilePath = path;
      }
      continue;
    }
  }

  const xsltJsonUrl = await getUpgraderStylesheetBlobUrl();
  const convertedXmlByPath = new Map<string, string>();

  for (const [path, xml] of xmlByPath.entries()) {
    const kind = classifyXmlKind(xml);
    if (kind !== 'item' && kind !== 'test') {
      convertedXmlByPath.set(path, xml);
      continue;
    }

    let converted = await convertQti2toQti3(xml, xsltJsonUrl);
    const folderPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const baseRef = makePackageUrl(packageId, '');

    const transformed = qtiTransform(converted)
      .objectToImg()
      .objectToVideo()
      .objectToAudio()
      .ssmlSubToSpan()
      .minChoicesToOne()
      .externalScored()
      .customInteraction(kind === 'test' ? baseRef : '', kind === 'item' ? folderPath : '')
      .qbCleanup()
      .depConvert()
      .upgradePci()
      .xml();

    converted = forcePciIframeMode(transformed);
    convertedXmlByPath.set(path, converted);
  }

  const taoInput = new Map<string, { content: string; type: 'item' | 'test' | 'manifest' | 'other' }>();
  for (const [path, xml] of convertedXmlByPath.entries()) {
    const kind = classifyXmlKind(xml);
    if (kind === 'item') taoInput.set(path, { content: xml, type: 'item' });
    if (kind === 'test') taoInput.set(path, { content: xml, type: 'test' });
  }

  const taoOutput = await convert(taoInput);
  for (const [path, processed] of taoOutput.entries()) {
    if (typeof processed.content === 'string') {
      convertedXmlByPath.set(path, processed.content);
    }
  }

  if (!testFilePath) {
    const syntheticItems = Array.from(convertedXmlByPath.entries())
      .filter(([, xml]) => classifyXmlKind(xml) === 'item')
      .map(([path, xml]) => ({ identifier: getIdentifierFromItem(xml, path), path }));
    if (syntheticItems.length > 0) {
      const syntheticPath = 'all-items.xml';
      convertedXmlByPath.set(syntheticPath, buildSyntheticTestXml(syntheticItems));
      testFilePath = syntheticPath;
    }
  }

  if (testFilePath) {
    const testXml = convertedXmlByPath.get(testFilePath);
    if (testXml) {
      convertedXmlByPath.set(testFilePath, normalizeTestItemRefIdentifiers(testXml, testFilePath, convertedXmlByPath));
    }
  }

  for (const entry of files) {
    const path = normalizeZipPath(entry.name);
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xml') {
      const xml = convertedXmlByPath.get(path) || (await entry.async('text'));
      await putTextFileInPackageCache(packageId, path, xml, 'application/xml');
    } else {
      await putBlobFileInPackageCache(packageId, path, await entry.async('blob'));
    }
  }

  // Ensure every converted XML is cacheable, including synthetic files like all-items.xml.
  for (const [path, xml] of convertedXmlByPath.entries()) {
    await putTextFileInPackageCache(packageId, path, xml, 'application/xml');
  }

  for (const [path, processed] of taoOutput.entries()) {
    if (processed.type === 'other') {
      if (typeof processed.content === 'string') {
        const lower = path.toLowerCase();
        const contentType = lower.endsWith('.css')
          ? 'text/css'
          : lower.endsWith('.js')
            ? 'application/javascript'
            : lower.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream';
        await putTextFileInPackageCache(packageId, path, processed.content, contentType);
      } else {
        await putBlobFileInPackageCache(packageId, path, new Blob([processed.content as BlobPart]));
      }
    }
  }

  for (const [path, xml] of convertedXmlByPath.entries()) {
    if (classifyXmlKind(xml) !== 'item') continue;
    const patched = prepareItemXmlForRuntime(xml, path, packageId);
    convertedXmlByPath.set(path, patched);
    await putTextFileInPackageCache(packageId, path, patched, 'application/xml');
  }

  if (!testFilePath) {
    throw new Error('No test XML found and no synthetic test could be generated.');
  }

  const convertedTestXml = convertedXmlByPath.get(testFilePath);
  if (!convertedTestXml) {
    throw new Error(`Converted test XML missing for ${testFilePath}`);
  }

  const refs = extractItemRefs(convertedTestXml).map(ref => {
    const resolved = resolveHref(testFilePath!, ref.href) || ref.href;
    return {
      identifier: ref.identifier || resolved,
      title: ref.identifier || resolved
    };
  });

  return {
    packageId,
    testUrl: makePackageUrl(packageId, testFilePath),
    itemRefs: refs,
    convertedItemCount: Array.from(convertedXmlByPath.values()).filter(xml => classifyXmlKind(xml) === 'item').length
  };
}

async function waitForPackageUrl(url: string, timeoutMs = 12000): Promise<void> {
  const absolute = new URL(url, window.location.origin).toString();
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(absolute, { cache: 'no-store' });
      if (response.ok) return;
      lastStatus = response.status;
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (lastStatus !== null) {
    throw new Error(`Package resource not ready (${lastStatus}): ${url}`);
  }
  throw new Error(`Package resource not ready (${lastError || 'network error'}): ${url}`);
}

function queryInOpenShadows(root: ParentNode, selector: string): Element | null {
  const direct = root.querySelector(selector);
  if (direct) return direct;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode() as Element | null;
  while (current) {
    if ((current as HTMLElement).shadowRoot) {
      const inShadow = queryInOpenShadows((current as HTMLElement).shadowRoot!, selector);
      if (inShadow) return inShadow;
    }
    current = walker.nextNode() as Element | null;
  }
  return null;
}

async function ensureComponentsLoaded(args: StoryArgs): Promise<void> {
  const cssHref = new URL(args.componentsCssUrl, window.location.origin).toString();
  const existing = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).find(
    el => (el as HTMLLinkElement).href === cssHref
  );
  if (!existing) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }
  await import(/* @vite-ignore */ args.componentsCdnUrl);
}

function mountPreview(root: HTMLElement, status: HTMLElement, prepared: PreparedPackage): void {
  const itemRefs = prepared.itemRefs;
  const testUrl = prepared.testUrl;
  const first = itemRefs?.[0]?.identifier;
  const readyMarker = document.createElement('span');
  readyMarker.setAttribute('data-qti-ready', '0');
  readyMarker.style.display = 'none';
  root.appendChild(readyMarker);

  const test = document.createElement('qti-test');
  test.setAttribute('cache-transform', '');

  const nav = document.createElement('test-navigation');
  nav.setAttribute('auto-score-items', '');
  const container = document.createElement('test-container');
  container.setAttribute('test-url', testUrl);

  nav.appendChild(container);
  test.appendChild(nav);
  root.appendChild(test);

  const navigateToFirstItem = () => {
    const instance = test as unknown as { navigateTo?: (type: 'item' | 'section', id?: string) => void };
    instance.navigateTo?.('item', first);
  };

  test.addEventListener('qti-assessment-test-connected', () => {
    navigateToFirstItem();
  });

  test.addEventListener('qti-assessment-item-connected', () => {
    readyMarker.setAttribute('data-qti-ready', '1');
    status.textContent = `Rendered item ${first || ''}`.trim();
  });
}

export const ConvertAndRenderTaoPci: Story = {
  render: args => {
    const host = document.createElement('div');
    host.style.height = '100vh';
    host.style.width = '100%';
    host.style.display = 'grid';
    host.style.gridTemplateRows = 'auto 1fr';

    const header = document.createElement('div');
    header.style.padding = '10px 14px';
    header.style.fontFamily = 'system-ui, sans-serif';
    header.style.fontSize = '12px';
    header.style.borderBottom = '1px solid #e2e8f0';
    header.textContent = 'Converting package...';

    const root = document.createElement('div');
    root.style.height = '100%';
    root.style.width = '100%';

    host.appendChild(header);
    host.appendChild(root);

    void (async () => {
      try {
        const prepared = await preparePackageFromZip(args.zipUrl, args.saxonJsUrl);
        await waitForPackageUrl(prepared.testUrl);
        await ensureComponentsLoaded(args);
        header.textContent = `Converted ${prepared.convertedItemCount} item(s). Package: ${prepared.packageId}`;
        mountPreview(root, header, prepared);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        header.textContent = `Conversion/render failed: ${message}`;
      }
    })();

    return host;
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const ready = canvasElement.querySelector('[data-qti-ready="1"]');
        expect(ready).toBeTruthy();
      },
      { timeout: 30000, interval: 200 }
    );

    await waitFor(
      () => {
        const pciHost = queryInOpenShadows(canvasElement, 'qti-portable-custom-interaction');
        expect(pciHost).toBeTruthy();
      },
      { timeout: 30000, interval: 200 }
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Defaults to `/external-pci/PCI.zip` (served from `/Users/marcelhoekstra/Downloads`) and local qti-components (`/local-qti-components-cdn/index.js`, `/local-qti-components-dist/item.css`). `.storybook/main.ts` auto-maps `/Users/marcelhoekstra/repos/qti-components/{cdn,dist}`; override with `QTI_COMPONENTS_CDN_DIR` and `QTI_COMPONENTS_DIST_DIR` if needed.'
      }
    }
  }
};
