#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { createOrCompleteManifest } from '../qti-helper';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

try {
  const manifest = await createOrCompleteManifest(folderLocation);
  writeFileSync(`${folderLocation}/imsmanifest.xml`, manifest);
  console.log('Successfully added/completed the manifest.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
