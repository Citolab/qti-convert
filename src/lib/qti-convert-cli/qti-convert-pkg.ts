#!/usr/bin/env node
import { convertPackageFile } from '../qti-converter/converter/package-converter';

const pkg = process.argv[2];

try {
  const outputFileName = pkg.replace('.zip', '-qti3.zip');
  await convertPackageFile(pkg, outputFileName);
  console.log('Successfully converted the package: ' + outputFileName + '.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
