#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { convertPackageToQti21, type Qti21Warning } from '@citolab/qti-convert/qti-downgrader';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Please provide a QTI 3 .zip file path or a folder containing .zip files as an argument.');
  process.exit(1);
}

const printWarnings = (warnings: Qti21Warning[]) => {
  for (const warning of warnings) {
    console.warn(`  [${warning.code}]${warning.file ? ` ${warning.file}:` : ''} ${warning.message}`);
  }
};

const convert = async (inputZipPath: string, outputZipPath: string) => {
  const { zip, warnings } = await convertPackageToQti21(readFileSync(inputZipPath));
  writeFileSync(outputZipPath, zip);
  console.log(`Successfully converted: ${outputZipPath}`);
  printWarnings(warnings);
};

try {
  if (!existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  if (statSync(inputPath).isDirectory()) {
    const outputFolder = path.join(path.dirname(inputPath), `${path.basename(inputPath)}-qti21`);
    if (!existsSync(outputFolder)) {
      mkdirSync(outputFolder, { recursive: true });
    }

    const zipFiles = readdirSync(inputPath).filter(fileName => fileName.toLowerCase().endsWith('.zip'));
    if (zipFiles.length === 0) {
      console.log(`No .zip files found in folder: ${inputPath}`);
      process.exit(0);
    }

    for (const zipFileName of zipFiles) {
      await convert(
        path.join(inputPath, zipFileName),
        path.join(outputFolder, zipFileName.replace(/\.zip$/i, '-qti21.zip'))
      );
    }
    console.log(`Converted ${zipFiles.length} package(s) to: ${outputFolder}`);
  } else {
    if (!inputPath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Expected a .zip file, got: ${inputPath}`);
    }
    await convert(inputPath, inputPath.replace(/\.zip$/i, '-qti21.zip'));
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
