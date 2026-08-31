import JSZip from 'jszip';
import { baseNameFromPackageFile } from './file-names.js';
import { loadPackage, type PackageSource } from './load-package.js';
import { renderDocx } from './render-docx.js';
import { renderPdf } from './render-pdf.js';
import type { DocxExportResult, ExportOptions, PaperAssessment, PdfExportResult } from './types.js';

export type ConvertToDocxResult = DocxExportResult & { paper: PaperAssessment };
export type ConvertToPdfResult = PdfExportResult & { paper: PaperAssessment };

function withInferredFileNameBase(source: PackageSource, options: ExportOptions): ExportOptions {
  if (options.fileNameBase?.trim()) return options;
  if (typeof source === 'string') {
    return { ...options, fileNameBase: baseNameFromPackageFile(source) };
  }
  // File extends Blob; also accept duck-typed { name } (cross-realm File can fail instanceof)
  const named =
    source &&
    typeof source === 'object' &&
    'name' in source &&
    typeof (source as { name?: unknown }).name === 'string'
      ? String((source as { name: string }).name)
      : '';
  if (named) {
    return { ...options, fileNameBase: baseNameFromPackageFile(named) };
  }
  return options;
}

/** Load a QTI package and export a Word document. */
export async function convertPackageToDocx(
  source: PackageSource,
  options: ExportOptions = {}
): Promise<ConvertToDocxResult> {
  const opts = withInferredFileNameBase(source, options);
  const paper = await loadPackage(source);
  const docx = await renderDocx(paper, opts);
  return { ...docx, paper };
}

/** Load a QTI package and export a PDF document. */
export async function convertPackageToPdf(
  source: PackageSource,
  options: ExportOptions = {}
): Promise<ConvertToPdfResult> {
  const opts = withInferredFileNameBase(source, options);
  const paper = await loadPackage(source);
  const pdf = await renderPdf(paper, opts);
  return { ...pdf, paper };
}

/**
 * Zip a folder map (path → bytes) into a QTI package buffer, then export to DOCX.
 * Useful when you already have unpacked files in memory.
 */
export async function convertFilesToDocx(
  files: Map<string, Uint8Array>,
  options: ExportOptions = {}
): Promise<ConvertToDocxResult> {
  const zip = new JSZip();
  for (const [path, bytes] of files) {
    zip.file(path, bytes);
  }
  const buffer = await zip.generateAsync({ type: 'uint8array' });
  return convertPackageToDocx(buffer, options);
}
