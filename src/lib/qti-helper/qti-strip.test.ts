import { readFileSync, writeFile } from 'fs';
import { removeMediaFromPackage } from './qti-helper';
import { expect, test } from 'vitest';
test(
  'strip media',
  async () => {
    const pkg = `/Users/marcelh/Downloads/qti-bio-2.zip`;
    ///Users/marcelh/Downloads/qti-bio-2.zip
    const outputFileName = pkg.replace('.zip', '-stripped.zip');
    const file = readFileSync(pkg);
    const blob = await removeMediaFromPackage(file);
    const buffer = Buffer.from(await blob.arrayBuffer());

    await writeFile(outputFileName, buffer, () => 'Successfully converted the package: ' + outputFileName + '.');
    expect(false).toEqual(false);
  },
  { timeout: 100000 }
);
