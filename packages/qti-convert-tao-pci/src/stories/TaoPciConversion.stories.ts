import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect, waitFor } from 'storybook/test';
import {
  prepareQtiPackageFromUrl,
  type PreparedQtiPackage,
} from '@citolab/qti-browser-import';

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

function mountPreview(root: HTMLElement, status: HTMLElement, prepared: PreparedQtiPackage): void {
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
        const prepared = await prepareQtiPackageFromUrl(args.zipUrl, {
          saxonJsUrl: args.saxonJsUrl,
          componentsCdnUrl: args.componentsCdnUrl,
          componentsCssUrl: args.componentsCssUrl,
        });
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

const baseStory: Story = {
  render: ConvertAndRenderTaoPci.render,
  play: ConvertAndRenderTaoPci.play,
  parameters: ConvertAndRenderTaoPci.parameters
};

export const ConvertAndRenderLikert: Story = {
  ...baseStory,
  args: {
    ...meta.args,
    zipUrl: '/storybook-assets/likert.zip'
  },
  parameters: {
    ...baseStory.parameters,
    docs: {
      description: {
        story: 'Uses `/storybook-assets/likert.zip` from the local Storybook assets.'
      }
    }
  }
};

export const ConvertAndRenderVerhoudingen: Story = {
  ...baseStory,
  args: {
    ...meta.args,
    zipUrl: '/storybook-assets/verhoudingen.zip'
  },
  parameters: {
    ...baseStory.parameters,
    docs: {
      description: {
        story: 'Uses `/storybook-assets/verhoudingen.zip` from the local Storybook assets.'
      }
    }
  }
};
