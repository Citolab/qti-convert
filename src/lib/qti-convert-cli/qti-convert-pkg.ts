#!/usr/bin/env node

import { convertPackageFile } from '../qti-converter-node/converter/package-converter';

const pkg = process.argv[2];

try {
  const saxonModule = await import('saxon-js'); // Ensure saxon-js is installed
  globalThis.SaxonJS = saxonModule.default || saxonModule;
  const outputFileName = pkg.replace('.zip', '-qti3.zip');
  await convertPackageFile(pkg, outputFileName);
  console.log('Successfully converted the package: ' + outputFileName + '.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
