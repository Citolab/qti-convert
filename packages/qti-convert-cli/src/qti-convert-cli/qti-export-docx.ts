#!/usr/bin/env node
/**
 * qti-export-docx — export a QTI package ZIP to a Word document.
 *
 * Usage:
 *   qti-export-docx <package.zip> [-o out.docx] [--no-answer-key] [--separate-answer-key] [--locale nl|en] [--pdf]
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  convertPackageToDocx,
  convertPackageToPdf,
  type ExportOptions,
} from '@citolab/qti-convert-export';

function usage(): never {
  console.error(`Usage: qti-export-docx <package.zip> [options]

Options:
  -o, --output <file>       Output path (default: <title>.docx / .pdf)
  --pdf                     Export PDF instead of Word
  --no-answer-key           Omit answer key section
  --separate-answer-key     Write answer key as a second file
  --locale <nl|en>          Labels language (default: en)
`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) usage();

const pkg = args.find(a => !a.startsWith('-'));
if (!pkg) usage();

let output: string | undefined;
let pdf = false;
const options: ExportOptions = { locale: 'en', includeAnswerKey: true };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--output') {
    output = args[++i];
  } else if (a === '--pdf') {
    pdf = true;
  } else if (a === '--no-answer-key') {
    options.includeAnswerKey = false;
  } else if (a === '--separate-answer-key') {
    options.separateAnswerKey = true;
  } else if (a === '--locale') {
    const loc = args[++i];
    if (loc === 'en' || loc === 'nl') options.locale = loc;
  }
}

try {
  if (pdf) {
    const result = await convertPackageToPdf(pkg!, options);
    const outPath = output || result.fileName;
    await writeFile(outPath, result.assessment);
    console.log(`Wrote ${outPath} (${result.paper.items.length} items)`);
    if (result.answerKey && result.answerKeyFileName) {
      const keyPath = output
        ? path.join(path.dirname(outPath), result.answerKeyFileName)
        : result.answerKeyFileName;
      await writeFile(keyPath, result.answerKey);
      console.log(`Wrote ${keyPath}`);
    }
  } else {
    const result = await convertPackageToDocx(pkg!, options);
    const outPath = output || result.fileName;
    await writeFile(outPath, result.assessment);
    console.log(`Wrote ${outPath} (${result.paper.items.length} items)`);
    if (result.answerKey && result.answerKeyFileName) {
      const keyPath = output
        ? path.join(path.dirname(outPath), result.answerKeyFileName)
        : result.answerKeyFileName;
      await writeFile(keyPath, result.answerKey);
      console.log(`Wrote ${keyPath}`);
    }
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
