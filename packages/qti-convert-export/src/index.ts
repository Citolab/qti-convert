export type {
  DocxExportResult,
  ExportLocale,
  ExportOptions,
  PaperAnswerKey,
  PaperAssessment,
  PaperAsset,
  PaperContentBlock,
  PaperInteraction,
  PaperItem,
  PdfExportResult,
} from './types.js';

export { resolveCorrectionPlacement } from './types.js';
export { getLocaleStrings } from './locale.js';
export {
  baseNameFromPackageFile,
  exportDownloadNames,
  resolveFileNameBase,
  safeFileName,
} from './file-names.js';
export { loadPackage, loadPackageFromFiles, hydrateImageAssets, type PackageSource } from './load-package.js';
export { parseItemXml } from './parse-item.js';
export { renderDocx } from './render-docx.js';
export { renderPdf } from './render-pdf.js';
export {
  convertPackageToDocx,
  convertPackageToPdf,
  convertFilesToDocx,
  type ConvertToDocxResult,
  type ConvertToPdfResult,
} from './convert.js';
