import JSZip from 'jszip';
import { baseNameFromPackageFile, paperDocumentFileName, paperZipFileName, resolveFileNameBase } from './file-names.js';
import { loadPackage, type PackageSource } from './load-package.js';
import { renderDocx, renderDocxDocument } from './render-docx.js';
import { renderPdf, renderPdfDocument } from './render-pdf.js';
import type {
  DocxExportResult,
  ExportOptions,
  PaperAssessment,
  PaperDocumentKind,
  PaperFormat,
  PdfExportResult,
  ZipExportFile,
  ZipExportOptions,
  ZipExportResult
} from './types.js';

export type ConvertToDocxResult = DocxExportResult & { paper: PaperAssessment };
export type ConvertToPdfResult = PdfExportResult & { paper: PaperAssessment };

function withInferredFileNameBase<T extends ExportOptions>(source: PackageSource, options: T): T {
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
  const paper = await loadPackage(source, opts);
  const docx = await renderDocx(paper, opts);
  return { ...docx, paper };
}

/** Load a QTI package and export a PDF document. */
export async function convertPackageToPdf(
  source: PackageSource,
  options: ExportOptions = {}
): Promise<ConvertToPdfResult> {
  const opts = withInferredFileNameBase(source, options);
  const paper = await loadPackage(source, opts);
  const pdf = await renderPdf(paper, opts);
  return { ...pdf, paper };
}

const DEFAULT_DOCUMENTS: PaperDocumentKind[] = ['questions', 'answerSheet', 'answerKey'];

/** Render the chosen paper documents for an already loaded assessment and zip them. */
export async function renderPaperZip(
  paper: PaperAssessment,
  options: ZipExportOptions = {}
): Promise<Omit<ZipExportResult, 'paper'>> {
  const formats: PaperFormat[] = options.formats?.length ? options.formats : ['docx'];
  const documents = options.documents?.length ? options.documents : DEFAULT_DOCUMENTS;
  const base = resolveFileNameBase(options.fileNameBase, paper.title);
  const locale = options.locale || 'en';

  const files: ZipExportFile[] = [];
  for (const format of formats) {
    for (const kind of documents) {
      const bytes =
        format === 'docx'
          ? await renderDocxDocument(paper, kind, options)
          : await renderPdfDocument(paper, kind, options);
      files.push({ name: paperDocumentFileName(base, kind, format, locale), kind, format, bytes });
    }
  }

  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.bytes);
  return {
    zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    fileName: paperZipFileName(base, locale),
    files
  };
}

/**
 * Load a QTI package and export a zip with a question booklet, an answer sheet
 * and an answer key (Word by default; PDF or both via `formats`).
 */
export async function convertPackageToZip(
  source: PackageSource,
  options: ZipExportOptions = {}
): Promise<ZipExportResult> {
  const opts = withInferredFileNameBase(source, options);
  const paper = await loadPackage(source, opts);
  return { ...(await renderPaperZip(paper, opts)), paper };
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
