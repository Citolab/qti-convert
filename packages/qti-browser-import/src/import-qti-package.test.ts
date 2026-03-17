import { describe, expect, test } from 'vitest';
import { __test__ } from './import-qti-package';

describe('import-qti-package helpers', () => {
  test('preserves XML comments when repairing bare attributes', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <!-- config.json has 8 of the 9 dependencies. Missing only Graph. -->
  <qti-portable-custom-interaction response-identifier="RESPONSE">
    <qti-interaction-markup>
      <div hidden>ok</div>
    </qti-interaction-markup>
  </qti-portable-custom-interaction>
</qti-assessment-item>`;

    const output = __test__.repairBareAttributesInXml(input);

    expect(output).toContain('<!-- config.json has 8 of the 9 dependencies. Missing only Graph. -->');
    expect(output).toContain('<div hidden="">ok</div>');
    expect(output).not.toContain('has="" 8=""');
  });

  test('detects package root from nested imsmanifest.xml', () => {
    const rootDir = __test__.detectPackageRootDir([
      'PCI-Conformance/imsmanifest.xml',
      'PCI-Conformance/items/item-1/qti.xml',
      'PCI-Conformance/items/item-1/modules/module_resolution.js',
    ]);

    expect(rootDir).toBe('PCI-Conformance/');
  });

  test('rebases zip paths relative to the detected package root', () => {
    const rebased = __test__.rebaseToPackageRoot(
      'PCI-Conformance/items/item-5/modules/lib/raphael-2.3.0-min.js',
      'PCI-Conformance/',
    );

    expect(rebased).toBe('items/item-5/modules/lib/raphael-2.3.0-min.js');
  });

  test('recognizes QTI 3 assessment items without upgrading them', () => {
    const qti3 = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="item-1"/>`;

    expect(__test__.isQti3Xml(qti3)).toBe(true);
  });

  test('selects a single nested module_resolution file for root aliasing', () => {
    const pick = __test__.pickAliasedModuleResolutionPath(
      [
        'items/item-1/modules/module_resolution.js',
        'items/item-1/qti.xml',
      ],
      'module_resolution',
    );

    expect(pick).toBe('items/item-1/modules/module_resolution.js');
  });

  test('does not alias module_resolution when multiple nested candidates exist', () => {
    const pick = __test__.pickAliasedModuleResolutionPath(
      [
        'items/item-1/modules/module_resolution.js',
        'items/item-2/modules/module_resolution.js',
      ],
      'module_resolution',
    );

    expect(pick).toBeNull();
  });

  test('allows runtime-prepared XML to drop primary configuration markers after expansion', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item>
  <qti-portable-custom-interaction module="GraphingInteraction">
    <qti-interaction-modules primary-configuration="config.json" secondary-configuration="fallback.json">
      <qti-interaction-module id="raphael" primary-path="blob:raphael"/>
    </qti-interaction-modules>
  </qti-portable-custom-interaction>
</qti-assessment-item>`;

    const output = input
      .replace(' primary-configuration="config.json"', '')
      .replace(' secondary-configuration="fallback.json"', '');

    expect(output).not.toContain('primary-configuration=');
    expect(output).not.toContain('secondary-configuration=');
    expect(output).toContain('primary-path="blob:raphael"');
  });
});
