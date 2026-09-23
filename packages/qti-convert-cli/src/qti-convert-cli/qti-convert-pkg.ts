#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { convertPackageFile, type SharedStimuliReport } from '@citolab/qti-convert/qti-convert-node';

const args = process.argv.slice(2);
const inputPath = args.find(arg => !arg.startsWith('--'));
const extractSharedStimuli = args.includes('--extract-stimuli');

if (!inputPath) {
  console.error('Usage: qti-convert-pkg <zip|folder-with-zips> [--extract-stimuli]');
  process.exit(1);
}

const printReport = (report: SharedStimuliReport) => {
  for (const stimulus of report.stimuli) {
    console.log(`  shared stimulus ${stimulus.path} ("${stimulus.title}") used by: ${stimulus.items.join(', ')}`);
  }
  for (const duplicate of report.nearDuplicates) {
    console.log(`  similar but not identical (${duplicate.similarity}), not extracted: ${duplicate.items.join(' <> ')}`);
  }
};
const options = { extractSharedStimuli, onSharedStimuliReport: printReport };

try {
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
      await convertPackageFile(inputZipPath, outputZipPath, options);
      console.log(`Successfully converted: ${outputZipPath}`);
    }

    console.log(`Converted ${zipFiles.length} package(s) to: ${outputFolder}`);
  } else {
    if (!inputPath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Expected a .zip file, got: ${inputPath}`);
    }

    const outputFileName = inputPath.replace(/\.zip$/i, '-qti3.zip');
    await convertPackageFile(inputPath, outputFileName, options);
    console.log('Successfully converted the package: ' + outputFileName + '.');
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
