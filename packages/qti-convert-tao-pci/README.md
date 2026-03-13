# @citolab/qti-convert-tao-pci

TAO-specific PCI conversion companion package for `@citolab/qti-convert`.

## API

```ts
import { convert } from '@citolab/qti-convert-tao-pci';

const convertedFiles = await convert(processedFilesMap);
```

`convert(...)`:
- expects input XML to be already upgraded to QTI 3 and PCI-upgraded upstream
- applies TAO class/style conversion previously handled by `convert-tao-styles`
- injects TAO PCI metadata (`data-require-paths`, `data-legacy-pci-proxy`, `data-legacy-pci-config`)
- injects required `qti-interaction-module` entries
- copies bundled TAO PCI module resources into `modules/**`
- adds Bootstrap 3 stylesheet resource to `modules/bootstrap/bootstrap.min.css`

## Storybook PCI test

Run:

```bash
npm run storybook --workspace=@citolab/qti-convert-tao-pci
```

Story: `TAO PCI/Converted ZIP Preview`

What it does:
- fetches ZIP input (default `/external-pci/PCI.zip`)
- converts QTI 2.x -> QTI 3
- applies `@citolab/qti-convert-tao-pci`
- renders using qti-components loaded via configurable module/CSS URLs

Default local ZIP mapping:
- before Storybook starts, `prepare:storybook-assets` copies:
  `QTI_PCI_ZIP_PATH` (or `/Users/marcelhoekstra/Downloads/PCI.zip`)
  to `storybook-assets/PCI.zip`
- `/external-pci/PCI.zip` serves that copied file.
- the same script also copies SaxonJS runtime to
  `public/assets/saxon-js/SaxonJS2.rt.js` from:
  `QTI_SAXON_JS_PATH` or `/Users/marcelhoekstra/repos/qti-playground/public/assets/saxon-js/SaxonJS2.rt.js`

Optional local qti-components mapping:

```bash
QTI_COMPONENTS_CDN_DIR=/Users/marcelhoekstra/repos/qti-components/cdn \
QTI_COMPONENTS_DIST_DIR=/Users/marcelhoekstra/repos/qti-components/dist \
npm run storybook --workspace=@citolab/qti-convert-tao-pci
```

Then set story args to:
- `saxonJsUrl`: `/assets/saxon-js/SaxonJS2.rt.js` (default, local) or your own URL
- `componentsCdnUrl`: `/local-qti-components-cdn/index.js`
- `componentsCssUrl`: `/local-qti-components-dist/item.css`
