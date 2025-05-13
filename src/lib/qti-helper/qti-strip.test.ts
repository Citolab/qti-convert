// import { readFileSync, writeFile } from 'fs';
// import { removeMediaFromPackage } from './qti-helper';
import { expect, test } from 'vitest';
import {
  createAssessmentTest,
  createOrCompleteManifest,
  createPackageZip,
  createPackageZipsPerItem
} from '../qti-helper-node';
import { writeFileSync } from 'fs';

const pkg = '/Users/marcelh/Downloads/examen_single/select-point';

// test(
//   'strip media',
//   async () => {
//     // const pkg = `/`;
//     // const outputFileName = pkg.replace('.zip', '-stripped.zip');
//     // const file = readFileSync(pkg);
//     // const blob = await removeMediaFromPackage(file);
//     // const buffer = Buffer.from(await blob.arrayBuffer());

//     // await writeFile(outputFileName, buffer, () => 'Successfully converted the package: ' + outputFileName + '.');
//     expect(false).toEqual(false);
//   },
//   { timeout: 100000 }
// );

test(
  'create test',
  async () => {
    const assessment = await createAssessmentTest(pkg);
    writeFileSync(`${pkg}/test.xml`, assessment);
    console.log('Successfully added/completed the test.');
    expect(false).toEqual(false);
  },
  { timeout: 100000 }
);

test(
  'create manifest',
  async () => {
    const manifest = await createOrCompleteManifest(pkg);
    writeFileSync(`${pkg}/imsmanifest.xml`, manifest);
    console.log('Successfully added/completed the manifest.');
    expect(false).toEqual(false);
  },
  { timeout: 100000 }
);

// test(
//   'create package',
//   async () => {
//     await createPackageZip(pkg);
//     expect(false).toEqual(false);
//   },
//   { timeout: 100000 }
// );

// test(
//   'create package per item',
//   async () => {
//     await createPackageZipsPerItem(pkg);
//     expect(false).toEqual(false);
//   },
//   { timeout: 100000 }
// );

test(
  'test file to test',
  async () => {
    expect(false).toEqual(false);
  },
  { timeout: 100000 }
);
