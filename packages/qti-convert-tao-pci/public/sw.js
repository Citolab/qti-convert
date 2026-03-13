// Service worker that serves uploaded QTI package resources from CacheStorage.
//
// URLs are virtualized under:
//   /__qti_pkg__/<packageId>/<path inside zip>
//
// Each package is stored in its own cache:
//   qti-pkg-<packageId>
//
// This lets requirejs, images, stylesheets, and module_resolution.* be fetched as if they were on a server.
const PKG_PREFIX = "/__qti_pkg__/";
const cacheIndexByName = new Map();

function getPathnameKey(urlString) {
  try {
    return new URL(urlString).pathname;
  } catch {
    return null;
  }
}

function buildCanonicalUrl(requestUrl, packageId) {
  const url = new URL(requestUrl);
  const rest = url.pathname.slice(PKG_PREFIX.length);
  const withoutPkgId = rest.slice(packageId.length + 1); // "<packageId>/..."

  // Handle accidental double-prefix like:
  // /__qti_pkg__/<id>/__qti_pkg__/<id>/items/...
  const doublePrefix = `__qti_pkg__/${packageId}/`;
  let pathInPkg = withoutPkgId;
  if (pathInPkg.startsWith(doublePrefix)) {
    pathInPkg = pathInPkg.slice(doublePrefix.length);
  }
  pathInPkg = pathInPkg.replace(/^\/+/, "");

  url.pathname = `${PKG_PREFIX}${packageId}/${pathInPkg}`;
  return url.toString();
}

async function getCacheIndex(cacheName) {
  if (cacheIndexByName.has(cacheName)) return cacheIndexByName.get(cacheName);
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const byPathLower = new Map();
  const byFileLower = new Map();
  for (const req of keys) {
    const pathname = getPathnameKey(req.url);
    if (!pathname) continue;
    const pathLower = pathname.toLowerCase();
    if (!byPathLower.has(pathLower)) byPathLower.set(pathLower, req.url);
    const fileLower = pathname.split("/").pop()?.toLowerCase() || "";
    if (fileLower) {
      const arr = byFileLower.get(fileLower) || [];
      arr.push(req.url);
      byFileLower.set(fileLower, arr);
    }
  }
  const idx = { byPathLower, byFileLower };
  cacheIndexByName.set(cacheName, idx);
  return idx;
}

self.addEventListener("install", (event) => {
  // Take over as soon as possible; package caches are managed by the app.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PKG_PREFIX)) return;

  event.respondWith(
    (async () => {
      const rest = url.pathname.slice(PKG_PREFIX.length);
      const [packageId] = rest.split("/", 1);
      const cacheName = `qti-pkg-${packageId}`;

      const cache = await caches.open(cacheName);

      const canonicalUrl = buildCanonicalUrl(request.url, packageId);

      // 1) Exact match (ignore query string).
      let cached = await cache.match(canonicalUrl, {
        ignoreSearch: true,
        ignoreMethod: true,
        ignoreVary: true,
      });
      if (cached) {
        if (request.method === "HEAD") {
          const headers = new Headers(cached.headers);
          // Ensure a sane content-length for HEAD (body is empty).
          headers.set("content-length", "0");
          return new Response(null, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
        return cached;
      }

      // 2) Case-insensitive pathname match (common in zips).
      const idx = await getCacheIndex(cacheName);
      const canonicalPathname = getPathnameKey(canonicalUrl);
      const lower = canonicalPathname?.toLowerCase() || "";
      const matchedUrl = lower ? idx.byPathLower.get(lower) : null;
      if (matchedUrl) {
        cached = await cache.match(matchedUrl, {
          ignoreSearch: true,
          ignoreMethod: true,
          ignoreVary: true,
        });
        if (cached) return cached;
      }

      // 3) Fallback by filename if unique (helps with case/different folder layouts).
      const filenameLower =
        (canonicalPathname || "").split("/").pop()?.toLowerCase() || "";
      const candidates = filenameLower ? idx.byFileLower.get(filenameLower) : null;
      if (candidates && candidates.length === 1) {
        cached = await cache.match(candidates[0], {
          ignoreSearch: true,
          ignoreMethod: true,
          ignoreVary: true,
        });
        if (cached) return cached;
      }

      // Not found in package cache.
      return new Response("Not found", { status: 404 });
    })(),
  );
});
