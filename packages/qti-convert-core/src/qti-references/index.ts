import JSZip from 'jszip';
import {
  fixPackageReferences,
  type FixPackageReferencesOptions,
  type ReferenceFixResult
} from './fix-package-references';

export * from './fix-package-references';

type ZipInput = Blob | ArrayBuffer | Uint8Array;

/**
 * Repairs the file references of a zipped QTI 2.x or 3 package. Works in Node and the browser.
 * @param outputType 'uint8array' (default, Node) or 'blob' (browser)
 */
export async function fixPackageReferencesZip(
  input: ZipInput,
  outputType?: 'uint8array',
  options?: FixPackageReferencesOptions
): Promise<Omit<ReferenceFixResult, 'files'> & { zip: Uint8Array }>;
export async function fixPackageReferencesZip(
  input: ZipInput,
  outputType: 'blob',
  options?: FixPackageReferencesOptions
): Promise<Omit<ReferenceFixResult, 'files'> & { zip: Blob }>;
export async function fixPackageReferencesZip(
  input: ZipInput,
  outputType: 'uint8array' | 'blob' = 'uint8array',
  options: FixPackageReferencesOptions = {}
) {
  const zip = await JSZip.loadAsync(input);
  const files = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.includes('__MACOSX') || path.endsWith('.DS_Store')) continue;
    files.set(path, await entry.async('uint8array'));
  }
  const { files: fixedFiles, fixed, unresolved } = fixPackageReferences(files, options);
  const outZip = new JSZip();
  for (const [path, content] of fixedFiles) outZip.file(path, content);
  return { zip: await outZip.generateAsync({ type: outputType, compression: 'DEFLATE' }), fixed, unresolved };
}
