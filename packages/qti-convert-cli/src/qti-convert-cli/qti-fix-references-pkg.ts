#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixPackageReferencesZip } from '@citolab/qti-convert/qti-references';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Please provide a QTI .zip file path or a folder containing .zip files as an argument.');
  process.exit(1);
}

const fix = async (inputZipPath: string, outputZipPath: string) => {
  const { zip, fixed, unresolved } = await fixPackageReferencesZip(readFileSync(inputZipPath));
  writeFileSync(outputZipPath, zip);
  console.log(`${outputZipPath}: ${fixed.length} reference(s) fixed, ${unresolved.length} not found`);
  for (const reference of fixed) {
    console.log(`  [${reference.method}] ${reference.file}: ${reference.value} -> ${reference.newValue}`);
  }
  for (const reference of unresolved) {
    const candidates = reference.candidates.length ? ` (candidates: ${reference.candidates.join(', ')})` : '';
    console.warn(`  [not found] ${reference.file}: ${reference.value}${candidates}`);
  }
};

try {
  if (!existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  if (statSync(inputPath).isDirectory()) {
    const outputFolder = path.join(path.dirname(inputPath), `${path.basename(inputPath)}-fixed`);
    if (!existsSync(outputFolder)) {
      mkdirSync(outputFolder, { recursive: true });
    }

    const zipFiles = readdirSync(inputPath).filter(fileName => fileName.toLowerCase().endsWith('.zip'));
    if (zipFiles.length === 0) {
      console.log(`No .zip files found in folder: ${inputPath}`);
      process.exit(0);
    }

    for (const zipFileName of zipFiles) {
      await fix(
        path.join(inputPath, zipFileName),
        path.join(outputFolder, zipFileName.replace(/\.zip$/i, '-fixed.zip'))
      );
    }
  } else {
    if (!inputPath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Expected a .zip file, got: ${inputPath}`);
    }
    await fix(inputPath, inputPath.replace(/\.zip$/i, '-fixed.zip'));
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
