export const QTI_PKG_URL_PREFIX = '/__qti_pkg__';

export function getPackageCacheName(packageId: string): string {
  return `qti-pkg-${packageId}`;
}

export function normalizeZipPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

export function makePackageUrl(packageId: string, zipPath: string): string {
  const normalized = normalizeZipPath(zipPath);
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${QTI_PKG_URL_PREFIX}/${encodeURIComponent(packageId)}/${encoded}`;
}

function getMimeTypeFromFileName(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    pdf: 'application/pdf',
    json: 'application/json',
    xml: 'application/xml',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    html: 'text/html',
    txt: 'text/plain',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

export async function putTextFileInPackageCache(
  packageId: string,
  zipPath: string,
  content: string,
  contentType = 'application/xml',
): Promise<void> {
  const url = makePackageUrl(packageId, zipPath);
  const cache = await caches.open(getPackageCacheName(packageId));
  await cache.put(
    url,
    new Response(content, {
      headers: {
        'Content-Type': contentType,
      },
    }),
  );
}

export async function putBlobFileInPackageCache(
  packageId: string,
  zipPath: string,
  blob: Blob,
): Promise<void> {
  const url = makePackageUrl(packageId, zipPath);
  const cache = await caches.open(getPackageCacheName(packageId));
  const contentType = getMimeTypeFromFileName(zipPath);
  const typedBlob = blob.type ? blob : new Blob([blob], { type: contentType });
  await cache.put(
    url,
    new Response(typedBlob, {
      headers: {
        'Content-Type': typedBlob.type || contentType,
      },
    }),
  );
}

export async function deletePackageCache(packageId: string): Promise<boolean> {
  return await caches.delete(getPackageCacheName(packageId));
}

export async function ensurePackageServiceWorkerReady(
  scriptUrl = '/sw.js',
  scope = '/',
): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(scriptUrl, { scope });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
        setTimeout(done, 3000);
      });
    }
  } catch {
    // best effort
  }
}
