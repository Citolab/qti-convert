#!/usr/bin/env node
import { createPackageZip } from '@citolab/qti-convert/qti-helper-node';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

try {
  await createPackageZip(folderLocation);
  console.log('Done.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
