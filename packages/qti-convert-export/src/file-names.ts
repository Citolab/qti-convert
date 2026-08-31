import type { ExportLocale } from './types.js';

/** Sanitize a base name for download filenames. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w\-+.() ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'assessment';
}

/**
 * Strip package archive extensions from a zip filename.
 * e.g. "My Toets.package.zip" → "My Toets"
 */
export function baseNameFromPackageFile(fileName: string): string {
  let base = fileName.trim();
  // Drop path segments if a path was passed
  base = base.replace(/^.*[\\/]/, '');
  // Peel off archive / package suffixes (order matters: .zip first, then .qti30 / .package)
  for (let i = 0; i < 3; i++) {
    const next = base
      .replace(/\.(zip)$/i, '')
      .replace(/\.(qti\d*|qti)$/i, '')
      .replace(/\.(package|pkg)$/i, '');
    if (next === base) break;
    base = next;
  }
  return safeFileName(base) || 'assessment';
}

export function exportDownloadNames(
  base: string,
  ext: 'docx' | 'pdf',
  _locale: ExportLocale = 'en'
): { fileName: string; answerKeyFileName: string } {
  const safe = safeFileName(base);
  return {
    fileName: `${safe}.${ext}`,
    answerKeyFileName: `${safe}-correction.${ext}`,
  };
}

/** Prefer explicit option, else fall back to assessment title. */
export function resolveFileNameBase(
  optionsBase: string | undefined,
  assessmentTitle: string
): string {
  if (optionsBase?.trim()) return safeFileName(optionsBase.trim());
  return safeFileName(assessmentTitle);
}
