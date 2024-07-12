#!/usr/bin/env node

import { writeFile } from 'fs';
import { removeMediaFromPackage } from '../qti-helper';

const pkg = process.argv[2];
const mediaTypes = process.argv[3] || 'audio,video';

try {
  const outputFileName = pkg.replace('.zip', '-stripped.zip');
  const filters = mediaTypes.split(',').map(x => x.trim());
  const blob = await removeMediaFromPackage(pkg, filters);
  const buffer = Buffer.from(await blob.arrayBuffer());

  await writeFile(outputFileName, buffer, () => 'Successfully converted the package: ' + outputFileName + '.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
