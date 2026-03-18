import fs from 'node:fs';
import path from 'node:path';

const requiredAssets = [
  path.resolve(process.cwd(), 'storybook-assets/PCI.zip'),
  path.resolve(process.cwd(), 'public/assets/saxon-js/SaxonJS2.rt.js'),
  path.resolve(process.cwd(), 'public/assets/saxon-js/LICENSE.txt'),
];

let missingAsset = false;

requiredAssets.forEach((assetPath) => {
  if (fs.existsSync(assetPath)) {
    console.info(`[storybook-assets] Found ${assetPath}`);
    return;
  }

  missingAsset = true;
  console.error(`[storybook-assets] Missing required repository asset: ${assetPath}`);
});

if (missingAsset) {
  process.exitCode = 1;
}
