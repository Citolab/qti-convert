import { expect, test } from 'vitest';
import * as cheerio from 'cheerio';
import { convert, type ProcessedMap } from './index';

const taoItem = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item tool-name="TAO">
  <qti-item-body>
    <qti-custom-interaction response-identifier="RESPONSE">
      <qti-portable-custom-interaction custom-interaction-type-identifier="textReaderInteraction" module="textReaderInteraction" data-button-labels__prev="&lt;" data-button-labels__next="&gt;" data-one-page-navigation="true">
        <qti-interaction-modules>
          <qti-interaction-module id="textReaderInteraction" primary-path="textReaderInteraction/runtime/textReaderInteraction.min.js"></qti-interaction-module>
        </qti-interaction-modules>
        <properties>
          <property key="pageHeight">400</property>
        </properties>
        <markup><div class="row btn btn-info">x</div></markup>
      </qti-portable-custom-interaction>
    </qti-custom-interaction>
  </qti-item-body>
</qti-assessment-item>`;

test('convert applies tao pci enhancements and injects proxy module file', async () => {
  const files: ProcessedMap = new Map([
    ['items/item1.xml', { type: 'item', content: taoItem }]
  ]);

  const result = await convert(files);

  const item = String(result.get('items/item1.xml')?.content || '');
  expect(item).toContain('data-legacy-pci-proxy="1"');
  expect(item).toContain('data-require-paths=');
  expect(item).toContain('data-use-default-shims="true"');
  expect(item).toContain('qti-layout-row');
  expect(item).toContain('__legacy_proxy_0');
  expect(item).toContain('modules/bootstrap/bootstrap.min.css');
  expect(item).toContain('data-legacy-pci-source-module="textReaderInteraction"');

  const $ = cheerio.load(item, { xmlMode: true, xml: true });
  const legacyConfigRaw =
    $('qti-portable-custom-interaction').attr('data-legacy-pci-config') || '{}';
  const legacyConfig = JSON.parse(legacyConfigRaw) as {
    buttonLabels?: { prev?: string; next?: string };
    onePageNavigation?: string;
  };
  expect(legacyConfig.buttonLabels?.prev).toEqual('<');
  expect(legacyConfig.buttonLabels?.next).toEqual('>');
  expect(legacyConfig.onePageNavigation).toEqual('true');

  const proxyPath = 'items/item1.legacy-pci-proxy.0.js';
  expect(result.has(proxyPath)).toEqual(true);
  expect(String(result.get(proxyPath)?.content || '')).toContain('qtiCustomInteractionContext.register');
  expect(result.has('items/modules/mathjax/MathJax.js')).toEqual(true);
  expect(result.has('items/modules/bootstrap/bootstrap.min.css')).toEqual(true);
});


test('convert does not inject bundled assets when item is not TAO', async () => {
  const nonTao = `<?xml version=\"1.0\"?><qti-assessment-item tool-name=\"CitoLab\"><qti-item-body><qti-portable-custom-interaction module=\"x\"></qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`;
  const files: ProcessedMap = new Map([
    ['items/non-tao.xml', { type: 'item', content: nonTao }]
  ]);

  const result = await convert(files);
  const item = String(result.get('items/non-tao.xml')?.content || '');
  expect(item).not.toContain('data-legacy-pci-proxy=\"1\"');
  expect(result.has('items/modules/mathjax/mathJax.js')).toEqual(false);
});

test('convert normalizes legacy bootstrap button classes', async () => {
  const legacyButtonItem = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item tool-name="TAO">
  <qti-item-body>
    <qti-custom-interaction response-identifier="RESPONSE">
      <qti-portable-custom-interaction custom-interaction-type-identifier="textReaderInteraction" module="textReaderInteraction">
        <qti-interaction-modules>
          <qti-interaction-module id="textReaderInteraction" primary-path="textReaderInteraction/runtime/textReaderInteraction.min.js"></qti-interaction-module>
        </qti-interaction-modules>
        <markup><button class="btn-info small">&gt;</button></markup>
      </qti-portable-custom-interaction>
    </qti-custom-interaction>
  </qti-item-body>
</qti-assessment-item>`;

  const files: ProcessedMap = new Map([
    ['items/legacy-buttons.xml', { type: 'item', content: legacyButtonItem }]
  ]);

  const result = await convert(files);
  const item = String(result.get('items/legacy-buttons.xml')?.content || '');

  expect(item).toContain('class="btn btn-info btn-sm"');
  expect(item).not.toContain('class="btn-info small"');
});

test('convert runs upgradePci for TAO legacy portable custom interaction structure', async () => {
  const legacyWrappedItem = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item tool-name="TAO">
  <qti-item-body>
    <qti-custom-interaction response-identifier="RESPONSE">
      <qti-portable-custom-interaction custom-interaction-type-identifier="textReaderInteraction">
        <modules>
          <module id="textReaderInteraction" primary-path="textReaderInteraction/runtime/textReaderInteraction.min.js"></module>
        </modules>
        <properties key="buttonLabels">
          <property key="prev">&lt;</property>
          <property key="next">&gt;</property>
        </properties>
        <markup><button class="btn-info small">&gt;</button></markup>
      </qti-portable-custom-interaction>
    </qti-custom-interaction>
  </qti-item-body>
</qti-assessment-item>`;

  const files: ProcessedMap = new Map([
    ['items/legacy-upgrade.xml', { type: 'item', content: legacyWrappedItem }]
  ]);

  const result = await convert(files);
  const item = String(result.get('items/legacy-upgrade.xml')?.content || '');
  const $ = cheerio.load(item, { xmlMode: true, xml: true });
  const legacyConfigRaw =
    $('qti-portable-custom-interaction').attr('data-legacy-pci-config') || '{}';
  const legacyConfig = JSON.parse(legacyConfigRaw) as {
    buttonLabels?: { prev?: string; next?: string };
  };

  expect(item).not.toContain('<qti-custom-interaction');
  expect(item).toContain('<qti-interaction-markup>');
  expect(item).toContain('data-legacy-pci-config=');
  expect(legacyConfig.buttonLabels?.prev).toEqual('<');
  expect(legacyConfig.buttonLabels?.next).toEqual('>');
  expect(item).toContain('class="btn btn-info btn-sm"');
});
