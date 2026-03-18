#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const packages = [
  {
    name: '@citolab/qti-convert',
    dir: 'packages/qti-convert-core'
  },
  {
    name: '@citolab/qti-browser-import',
    dir: 'packages/qti-browser-import'
  },
  {
    name: '@citolab/qti-convert-tao-pci',
    dir: 'packages/qti-convert-tao-pci'
  },
  {
    name: '@citolab/qti-convert-cli',
    dir: 'packages/qti-convert-cli'
  }
];

const internalPackageNames = new Set(packages.map(pkg => pkg.name));
const packageByName = new Map(packages.map(pkg => [pkg.name, pkg]));

function printUsage() {
  console.error('Usage: npm run publish:all -- <version> [--dry-run] [--skip-tests] [--skip-build] [--allow-dirty]');
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(version);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  });
}

function updateDependencyBlock(deps, version) {
  if (!deps) {
    return deps;
  }

  let changed = false;
  for (const [name, currentValue] of Object.entries(deps)) {
    if (!internalPackageNames.has(name)) {
      continue;
    }

    const nextValue = `^${version}`;
    if (currentValue !== nextValue) {
      deps[name] = nextValue;
      changed = true;
    }
  }

  return changed ? deps : deps;
}

function updatePackageManifest(pkg, version) {
  const manifestPath = resolve(repoRoot, pkg.dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  manifest.version = version;
  updateDependencyBlock(manifest.dependencies, version);
  updateDependencyBlock(manifest.devDependencies, version);
  updateDependencyBlock(manifest.peerDependencies, version);
  updateDependencyBlock(manifest.optionalDependencies, version);

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function ensureGitIsClean() {
  const result = runCapture('git', ['status', '--short']);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (result.stdout.trim()) {
    console.error('Refusing to publish from a dirty working tree. Commit or stash changes, or pass --allow-dirty.');
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const version = args.find(arg => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');
const skipBuild = args.includes('--skip-build');
const allowDirty = args.includes('--allow-dirty');

if (!version || !isValidVersion(version)) {
  printUsage();
  process.exit(1);
}

if (!allowDirty) {
  ensureGitIsClean();
}

for (const pkg of packages) {
  if (!packageByName.has(pkg.name)) {
    console.error(`Unknown package configured: ${pkg.name}`);
    process.exit(1);
  }
}

console.log(`Synchronizing workspace package versions to ${version}`);
for (const pkg of packages) {
  updatePackageManifest(pkg, version);
}

if (existsSync(resolve(repoRoot, 'package-lock.json'))) {
  run('npm', ['install', '--package-lock-only']);
}

for (const pkg of packages) {
  const packageLockPath = resolve(repoRoot, pkg.dir, 'package-lock.json');
  if (existsSync(packageLockPath)) {
    run('npm', ['install', '--package-lock-only'], { cwd: resolve(repoRoot, pkg.dir) });
  }
}

if (!skipBuild) {
  run('npm', ['run', 'build']);
}

if (!skipTests) {
  run('npm', ['test']);
}

for (const pkg of packages) {
  const publishArgs = ['publish', '--workspace', pkg.name, '--access', 'public'];
  if (dryRun) {
    publishArgs.push('--dry-run');
  }

  console.log(`Publishing ${pkg.name}@${version}`);
  run('npm', publishArgs);
}
