import JSZip from 'jszip';
import {
  guessContentType,
  isRemoteUrl,
  loadXml,
  normalizePath,
  textContent,
} from './xml-utils.js';
import { parseItemXml } from './parse-item.js';
import type { PaperAssessment, PaperAsset, PaperContentBlock, PaperItem } from './types.js';

export type PackageSource = ArrayBuffer | Uint8Array | Blob | string;

async function toArrayBuffer(source: PackageSource): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    if (typeof window !== 'undefined') {
      throw new Error(
        'File path sources are only supported in Node.js. Pass a Blob or ArrayBuffer in the browser.'
      );
    }
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises');
    const buf = await readFile(source);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  if (source instanceof Uint8Array) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return source.arrayBuffer();
  }
  return source as ArrayBuffer;
}

async function loadZipEntries(source: PackageSource): Promise<Map<string, Uint8Array>> {
  const buffer = await toArrayBuffer(source);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);

  let prefix = '';
  const nestedManifest = names.find(n => n.endsWith('/imsmanifest.xml') && n !== 'imsmanifest.xml');
  if (!names.includes('imsmanifest.xml') && nestedManifest) {
    prefix = nestedManifest.slice(0, nestedManifest.length - 'imsmanifest.xml'.length);
  }

  const files = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    let relative = name;
    if (prefix && relative.startsWith(prefix)) {
      relative = relative.slice(prefix.length);
    }
    relative = normalizePath(relative);
    const bytes = await entry.async('uint8array');
    files.set(relative, bytes);
  }
  return files;
}

function findManifest(files: Map<string, Uint8Array>): string {
  if (files.has('imsmanifest.xml')) return 'imsmanifest.xml';
  for (const key of files.keys()) {
    if (key.toLowerCase().endsWith('imsmanifest.xml')) return key;
  }
  throw new Error('No imsmanifest.xml found in QTI package');
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function itemRefsFromAssessment(assessmentXml: string): { identifier: string; href: string }[] {
  const $ = loadXml(assessmentXml);
  const refs: { identifier: string; href: string }[] = [];
  $('qti-assessment-item-ref, assessmentItemRef').each((_, el) => {
    const identifier = $(el).attr('identifier') || '';
    const href = $(el).attr('href') || '';
    const category = ($(el).attr('category') || '').toLowerCase();
    if (!href) return;
    if (category === 'info' || category === 'introduction') return;
    refs.push({ identifier, href: normalizePath(href) });
  });
  return refs;
}

function itemHrefsFromManifest(manifestXml: string): { identifier: string; href: string }[] {
  const $ = loadXml(manifestXml);
  const refs: { identifier: string; href: string }[] = [];
  $('resource').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (!type.includes('imsqti_item')) return;
    const identifier = $(el).attr('identifier') || '';
    const href = $(el).attr('href') || '';
    if (href) refs.push({ identifier, href: normalizePath(href) });
  });
  return refs;
}

function assessmentHrefFromManifest(manifestXml: string): string | undefined {
  const $ = loadXml(manifestXml);
  const el = $('resource[type*="imsqti_test"]').first();
  const href = el.attr('href');
  return href ? normalizePath(href) : undefined;
}

function titleFromAssessment(assessmentXml: string | undefined): string {
  if (!assessmentXml) return 'Assessment';
  const $ = loadXml(assessmentXml);
  const root = $('qti-assessment-test, assessmentTest').first();
  return root.attr('title') || textContent($, root.get(0)) || 'Assessment';
}

function instructionsFromAssessment(assessmentXml: string | undefined): string[] {
  if (!assessmentXml) return [];
  const $ = loadXml(assessmentXml);
  const lines: string[] = [];
  $('qti-rubric-block, rubricBlock').each((_, el) => {
    const use = ($(el).attr('use') || '').toLowerCase();
    const view = ($(el).attr('view') || '').toLowerCase();
    if (use.includes('instruction') || view.includes('candidate')) {
      $(el)
        .find('p')
        .each((__, p) => {
          const t = textContent($, p);
          if (t) lines.push(t);
        });
      if (!lines.length) {
        const t = textContent($, el);
        if (t) lines.push(t);
      }
    }
  });
  return lines;
}

function authorFromFiles(files: Map<string, Uint8Array>): string | undefined {
  for (const [path, bytes] of files) {
    if (!/metadata/i.test(path) && !path.toLowerCase().endsWith('.xml')) continue;
    if (!/metadata|imsmanifest/i.test(path)) continue;
    const xml = decodeUtf8(bytes);
    if (!xml.includes('entity') && !xml.includes('<contribute')) continue;
    const $ = loadXml(xml);
    const publisher = $('contribute')
      .filter((_, el) => {
        const role = $(el).find('role value, value').first().text().toLowerCase();
        return role.includes('publisher') || role.includes('author') || role.includes('creator');
      })
      .first()
      .find('entity')
      .first()
      .text()
      .trim();
    if (publisher) return publisher;
  }
  return undefined;
}

function collectPackageImages(files: Map<string, Uint8Array>): Map<string, PaperAsset> {
  const assets = new Map<string, PaperAsset>();
  for (const [path, bytes] of files) {
    const ct = guessContentType(path);
    if (!ct.startsWith('image/')) continue;
    const key = normalizePath(path);
    assets.set(key, { path: key, bytes, contentType: ct });
  }
  return assets;
}

function collectImageRefs(items: PaperItem[]): string[] {
  const refs = new Set<string>();
  const addFromBlocks = (blocks: PaperContentBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'image' && block.assetPath) refs.add(block.assetPath);
    }
  };
  for (const item of items) {
    addFromBlocks(item.stimulus);
    if (item.interaction.kind === 'selectPoint' && item.interaction.imageAsset) {
      refs.add(item.interaction.imageAsset);
    }
  }
  return [...refs];
}

function decodeDataUrl(dataUrl: string): PaperAsset | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const data = match[3] || '';
  try {
    if (isBase64) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { path: dataUrl.slice(0, 64), bytes, contentType };
    }
    const decoded = decodeURIComponent(data);
    return { path: dataUrl.slice(0, 64), bytes: new TextEncoder().encode(decoded), contentType };
  } catch {
    return null;
  }
}

async function fetchRemoteImage(url: string): Promise<PaperAsset | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Image fetch failed (${res.status}): ${url}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const headerType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const contentType =
      headerType && headerType.startsWith('image/') ? headerType : guessContentType(url);
    if (!contentType.startsWith('image/') && bytes.length > 0) {
      // Some CDNs omit content-type; still try as jpeg/png from URL
      const guessed = guessContentType(url);
      return { path: url, bytes, contentType: guessed.startsWith('image/') ? guessed : 'image/jpeg' };
    }
    return { path: url, bytes, contentType };
  } catch (error) {
    console.warn(`Image fetch error: ${url}`, error);
    return null;
  }
}

/**
 * Attach package-local and remote images referenced by items onto the assets map.
 * - Relative paths: looked up in the ZIP/file map (already resolved against the item href).
 * - http(s) URLs: fetched (browser needs CORS; Node fetch works).
 * - data: URLs: decoded in-place.
 */
export async function hydrateImageAssets(
  paper: PaperAssessment,
  packageFiles?: Map<string, Uint8Array>
): Promise<void> {
  const refs = collectImageRefs(paper.items);
  const pending: Promise<void>[] = [];

  for (const ref of refs) {
    if (paper.assets.has(ref)) continue;

    if (ref.startsWith('data:')) {
      const asset = decodeDataUrl(ref);
      if (asset) paper.assets.set(ref, asset);
      continue;
    }

    if (isRemoteUrl(ref)) {
      pending.push(
        fetchRemoteImage(ref).then(asset => {
          if (asset) paper.assets.set(ref, asset);
        })
      );
      continue;
    }

    // Package-relative path
    if (packageFiles?.has(ref)) {
      const bytes = packageFiles.get(ref)!;
      paper.assets.set(ref, {
        path: ref,
        bytes,
        contentType: guessContentType(ref),
      });
      continue;
    }

    // Try basename fallback (some packages repeat the same filename)
    const base = ref.includes('/') ? ref.slice(ref.lastIndexOf('/') + 1) : ref;
    if (packageFiles) {
      for (const [path, bytes] of packageFiles) {
        if (path === base || path.endsWith(`/${base}`)) {
          const ct = guessContentType(path);
          if (ct.startsWith('image/')) {
            paper.assets.set(ref, { path: ref, bytes, contentType: ct });
            break;
          }
        }
      }
    }
  }

  await Promise.all(pending);
}

function buildPaper(
  files: Map<string, Uint8Array>,
  refs: { identifier: string; href: string }[],
  assessmentXml: string | undefined,
  assessmentHref: string | undefined
): PaperAssessment {
  const assets = collectPackageImages(files);
  const items: PaperItem[] = [];

  for (const ref of refs) {
    const itemBytes = files.get(ref.href);
    if (!itemBytes) {
      console.warn(`Missing item file: ${ref.href}`);
      continue;
    }
    const item = parseItemXml(decodeUtf8(itemBytes), assets, ref.href);
    if (ref.identifier) item.identifier = ref.identifier;
    if (item.interaction.kind === 'unsupported' && item.interaction.interactionType === 'none') {
      continue;
    }
    items.push(item);
  }

  return {
    title: titleFromAssessment(assessmentXml),
    identifier: assessmentHref,
    instructions: instructionsFromAssessment(assessmentXml),
    author: authorFromFiles(files),
    items,
    assets,
  };
}

/**
 * Load a QTI package (ZIP bytes / Blob / file path) into a PaperAssessment model.
 * Resolves package-relative images and fetches external http(s) image URLs.
 */
export async function loadPackage(source: PackageSource): Promise<PaperAssessment> {
  const files = await loadZipEntries(source);
  const manifestPath = findManifest(files);
  const manifestXml = decodeUtf8(files.get(manifestPath)!);

  const assessmentHref = assessmentHrefFromManifest(manifestXml);
  const assessmentXml =
    assessmentHref && files.has(assessmentHref) ? decodeUtf8(files.get(assessmentHref)!) : undefined;

  let refs = assessmentXml ? itemRefsFromAssessment(assessmentXml) : [];
  if (refs.length === 0) {
    refs = itemHrefsFromManifest(manifestXml);
  }

  const paper = buildPaper(files, refs, assessmentXml, assessmentHref);
  await hydrateImageAssets(paper, files);
  return paper;
}

/**
 * Load a package from an already-extracted folder map (path → bytes).
 * Also hydrates remote images (async).
 */
export async function loadPackageFromFiles(files: Map<string, Uint8Array>): Promise<PaperAssessment> {
  const normalized = new Map<string, Uint8Array>();
  for (const [k, v] of files) normalized.set(normalizePath(k), v);

  const manifestPath = findManifest(normalized);
  const manifestXml = decodeUtf8(normalized.get(manifestPath)!);
  const assessmentHref = assessmentHrefFromManifest(manifestXml);
  const assessmentXml =
    assessmentHref && normalized.has(assessmentHref)
      ? decodeUtf8(normalized.get(assessmentHref)!)
      : undefined;

  let refs = assessmentXml ? itemRefsFromAssessment(assessmentXml) : [];
  if (refs.length === 0) refs = itemHrefsFromManifest(manifestXml);

  const paper = buildPaper(normalized, refs, assessmentXml, assessmentHref);
  await hydrateImageAssets(paper, normalized);
  return paper;
}
