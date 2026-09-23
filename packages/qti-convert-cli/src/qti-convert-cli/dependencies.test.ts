import { readFileSync, readdirSync } from 'node:fs';

import { expect, test } from 'vitest';

test('CLI no longer depends on SaxonJS', () => {
  const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  expect(packageJson.dependencies?.['saxon-js']).toBeUndefined();

  const sourceDir = `${process.cwd()}/src/qti-convert-cli`;
  for (const file of readdirSync(sourceDir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    expect(readFileSync(`${sourceDir}/${file}`, 'utf8'), file).not.toContain('saxon-js');
  }
});
