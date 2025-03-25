#!/usr/bin/env node

import { existsSync, mkdirSync } from 'fs';
import { convertPackageFolder } from '../qti-converter-node';

const folderLocation = process.argv[2];

if (!folderLocation) {
  console.error('Please provide a folder location as an argument.');
  process.exit(1);
}

// output folder is will be on the same level as the input folder with the same name as the input folder plus '-qti3'
const lastDirectory = folderLocation.split('/').pop();
const parentDirectory = folderLocation.split('/').slice(0, -1).join('/');
const outputFolder = `${parentDirectory}/${lastDirectory}-qti3`;

try {
  if (!existsSync(outputFolder)) {
    await mkdirSync(outputFolder);
  }
  await convertPackageFolder(folderLocation, outputFolder);
  console.log('Conversion completed successfully.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
