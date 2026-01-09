#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { convertPackageFile } from '../qti-converter-node/converter/package-converter';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Please provide a .zip file path or a folder containing .zip files as an argument.');
  process.exit(1);
}

try {
  const saxonModule = await import('saxon-js'); // Ensure saxon-js is installed
  globalThis.SaxonJS = saxonModule.default || saxonModule;

  if (!existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  const stats = statSync(inputPath);

  if (stats.isDirectory()) {
    const inputFolder = inputPath;
    const parentDirectory = path.dirname(inputFolder);
    const folderName = path.basename(inputFolder);
    const outputFolder = path.join(parentDirectory, `${folderName}-qti3`);

    if (!existsSync(outputFolder)) {
      mkdirSync(outputFolder, { recursive: true });
    }

    const zipFiles = readdirSync(inputFolder).filter(fileName => fileName.toLowerCase().endsWith('.zip'));
    if (zipFiles.length === 0) {
      console.log(`No .zip files found in folder: ${inputFolder}`);
      process.exit(0);
    }

    for (const zipFileName of zipFiles) {
      const inputZipPath = path.join(inputFolder, zipFileName);
      const outputZipPath = path.join(outputFolder, zipFileName.replace(/\.zip$/i, '-qti3.zip'));
      await convertPackageFile(inputZipPath, outputZipPath);
      console.log(`Successfully converted: ${outputZipPath}`);
    }

    console.log(`Converted ${zipFiles.length} package(s) to: ${outputFolder}`);
  } else {
    if (!inputPath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Expected a .zip file, got: ${inputPath}`);
    }

    const outputFileName = inputPath.replace(/\.zip$/i, '-qti3.zip');
    await convertPackageFile(inputPath, outputFileName);
    console.log('Successfully converted the package: ' + outputFileName + '.');
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
