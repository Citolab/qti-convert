# @citolab/qti-browser-import

Browser-side helpers for importing QTI packages, caching extracted files, and normalizing PCI asset paths.

## Install

```sh
npm install @citolab/qti-browser-import
```

Peer dependencies:

```sh
npm install @citolab/qti-convert @citolab/qti-convert-tao-pci
```

## Exports

- package cache helpers from `qti-package-cache`
- import helpers from `import-qti-package`
- upgrader stylesheet helpers from `upgrader-stylesheet`
- PCI helpers from `pci-helpers`

## Example

```ts
import { makePackageUrl, normalizeZipPath } from '@citolab/qti-browser-import';

const path = normalizeZipPath('items/item.xml');
const url = makePackageUrl('demo-package', path);
```

## License

Apache-2.0
