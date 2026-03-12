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
