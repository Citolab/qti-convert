export type {
  DocxExportResult,
  ExportLocale,
  ExportOptions,
  PaperAnswerKey,
  PaperArea,
  PaperAssessment,
  PaperAsset,
  PaperBodyNode,
  PaperContentBlock,
  PaperDocumentKind,
  PaperFormat,
  PaperHotspot,
  PaperImageRef,
  PaperInteraction,
  PaperInteractionKind,
  PaperItem,
  PaperItemPart,
  PaperOption,
  PaperStimulus,
  ParseOptions,
  PdfExportResult,
  ZipExportFile,
  ZipExportOptions,
  ZipExportResult
} from './types.js';

export { resolveCorrectionPlacement } from './types.js';
export { getLocaleStrings } from './locale.js';
export {
  baseNameFromPackageFile,
  exportDownloadNames,
  paperDocumentFileName,
  paperZipFileName,
  resolveFileNameBase,
  safeFileName
} from './file-names.js';
export { loadPackage, loadPackageFromFiles, hydrateImageAssets, type PackageSource } from './load-package.js';
export { parseItemXml } from './parse-item.js';
export { composeDocument } from './compose.js';
export type { LayoutBlock, LayoutDocument, InlineNode } from './layout.js';
export { renderDocx, renderDocxDocument, layoutToDocx } from './render-docx.js';
export { renderPdf, renderPdfDocument, layoutToPdf } from './render-pdf.js';
export {
  convertPackageToDocx,
  convertPackageToPdf,
  convertPackageToZip,
  convertFilesToDocx,
  renderPaperZip,
  type ConvertToDocxResult,
  type ConvertToPdfResult
} from './convert.js';
