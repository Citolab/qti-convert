import fs from 'node:fs';
import path from 'node:path';

const sourceZipPath = process.env.QTI_PCI_ZIP_PATH || '/Users/marcelhoekstra/Downloads/PCI.zip';
const targetDir = path.resolve(process.cwd(), 'storybook-assets');
const targetZipPath = path.join(targetDir, 'PCI.zip');
const saxonTargetDir = path.resolve(process.cwd(), 'public/assets/saxon-js');
const saxonTargetPath = path.join(saxonTargetDir, 'SaxonJS2.rt.js');
const saxonLicenseTargetPath = path.join(saxonTargetDir, 'LICENSE.txt');

fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(saxonTargetDir, { recursive: true });

if (!fs.existsSync(sourceZipPath)) {
  console.warn(`[storybook-assets] Source ZIP not found: ${sourceZipPath}`);
  console.warn('[storybook-assets] Keeping existing storybook-assets/PCI.zip (if present).');
} else {
  fs.copyFileSync(sourceZipPath, targetZipPath);
  console.info(`[storybook-assets] Copied ${sourceZipPath} -> ${targetZipPath}`);
}

const saxonCandidates = [
  process.env.QTI_SAXON_JS_PATH,
  '/Users/marcelhoekstra/repos/qti-playground/public/assets/saxon-js/SaxonJS2.rt.js',
].filter(Boolean);

const saxonLicenseCandidates = [
  process.env.QTI_SAXON_LICENSE_PATH,
  '/Users/marcelhoekstra/repos/qti-playground/public/assets/saxon-js/LICENSE.txt',
].filter(Boolean);

const saxonSourcePath = saxonCandidates.find((candidate) => fs.existsSync(candidate));
if (saxonSourcePath) {
  fs.copyFileSync(saxonSourcePath, saxonTargetPath);
  console.info(`[storybook-assets] Copied ${saxonSourcePath} -> ${saxonTargetPath}`);
} else {
  console.warn('[storybook-assets] Could not find SaxonJS2.rt.js to copy.');
  console.warn('[storybook-assets] Set QTI_SAXON_JS_PATH or keep using CDN fallback in story args.');
}

const saxonLicenseSourcePath = saxonLicenseCandidates.find((candidate) => fs.existsSync(candidate));
if (saxonLicenseSourcePath) {
  fs.copyFileSync(saxonLicenseSourcePath, saxonLicenseTargetPath);
}
