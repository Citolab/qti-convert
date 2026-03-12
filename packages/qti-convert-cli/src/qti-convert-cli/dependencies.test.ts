import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

test('package.json includes runtime dependency for SaxonJS', () => {
  const packageJsonPath = `${process.cwd()}/package.json`;
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.['saxon-js']).toBeTruthy();
  expect(packageJson.devDependencies?.['saxon-js']).toBeFalsy();
});
