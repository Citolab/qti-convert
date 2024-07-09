#!/usr/bin/env node

import { removeMediaFromPackage } from '../qti-helper';

const pkg = process.argv[2];
const mediaTypes = process.argv[3] || 'audio,video';

try {
  const outputFileName = pkg.replace('.zip', '-stripped.zip');
  const filters = mediaTypes.split(',').map(x => x.trim());
  await removeMediaFromPackage(pkg, outputFileName, filters);
  console.log('Successfully converted the package: ' + outputFileName + '.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
