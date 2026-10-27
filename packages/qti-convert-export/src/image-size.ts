import type { PaperAsset } from './types.js';

export type ImageSize = { width: number; height: number };

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function pngSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + u16be(b, i + 2);
  }
  return undefined;
}

function gifSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 10 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return undefined;
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
}

function svgSize(b: Uint8Array): ImageSize | undefined {
  const head = new TextDecoder().decode(b.slice(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return undefined;
  const num = (attr: string) => {
    const m = new RegExp(`\\s${attr}="([\\d.]+)(px)?"`, 'i').exec(tag);
    return m ? parseFloat(m[1]) : undefined;
  };
  const width = num('width');
  const height = num('height');
  if (width && height) return { width, height };
  const vb = /viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/i.exec(tag);
  if (vb) return { width: parseFloat(vb[1]), height: parseFloat(vb[2]) };
  return undefined;
}

/** Intrinsic pixel size of PNG, JPEG, GIF and SVG images. */
export function imageSize(asset: PaperAsset): ImageSize | undefined {
  const b = asset.bytes;
  const size = pngSize(b) || jpegSize(b) || gifSize(b) || (asset.contentType.includes('svg') ? svgSize(b) : undefined);
  return size && size.width > 0 && size.height > 0 ? size : undefined;
}

/** Sniff the real format; packages sometimes ship a PNG named .jpg. */
export function rasterType(asset: PaperAsset): 'png' | 'jpg' | 'gif' | 'svg' | undefined {
  const b = asset.bytes;
  if (pngSize(b)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (gifSize(b)) return 'gif';
  if (asset.contentType.includes('svg')) return 'svg';
  return undefined;
}
