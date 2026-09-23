// Minimal POSIX path helpers for package-relative paths, usable in both Node and the browser.

export const isRelativeUrl = (url: string) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url.trim());

export const normalizePath = (path: string) => {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
};

export const dirname = (path: string) => {
  const index = path.replace(/\\/g, '/').lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
};

export const joinPath = (base: string, relative: string) => (base ? normalizePath(`${base}/${relative}`) : relative);

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg'
};

export const mimeTypeFromPath = (path: string) =>
  MIME_TYPES[path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
