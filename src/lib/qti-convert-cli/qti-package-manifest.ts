#!/usr/bin/env node

import { writeFileSync } from 'fs';
import path from 'path';
import { createOrCompleteManifest } from '../qti-helper-node';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

try {
  const invocationCwd = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
  const resolvedFolderLocation = path.resolve(invocationCwd, folderLocation);
  const manifest = await createOrCompleteManifest(resolvedFolderLocation);
  writeFileSync(path.join(resolvedFolderLocation, 'imsmanifest.xml'), manifest);
  console.log('Successfully added/completed the manifest.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
