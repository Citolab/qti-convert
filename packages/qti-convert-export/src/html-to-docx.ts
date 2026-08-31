import {
  ImageRun,
  Paragraph,
  TextRun,
  type IRunOptions,
  type FileChild,
} from 'docx';
import type { AnyNode } from 'domhandler';
import { decodeHtmlEntities, loadXml } from './xml-utils.js';
import type { PaperAsset, PaperContentBlock } from './types.js';

function runsFromHtml(html: string): TextRun[] {
  const $ = loadXml(`<root>${html}</root>`);
  const runs: TextRun[] = [];

  const walk = (nodes: AnyNode[], opts: IRunOptions = {}) => {
    for (const node of nodes) {
      if ((node as { type?: string }).type === 'text') {
        const text = decodeHtmlEntities($(node).text().replace(/\s+/g, ' '));
        if (text) runs.push(new TextRun({ ...opts, text }));
        continue;
      }
      const el = node as { tagName?: string; name?: string; type?: string };
      if (el.type !== 'tag' && !el.tagName && !el.name) continue;
      const name = (el.tagName || el.name || '').toLowerCase();
      if (name === 'br') {
        runs.push(new TextRun({ break: 1 }));
        continue;
      }
      if (name === 'strong' || name === 'b') {
        walk($(node).contents().toArray(), { ...opts, bold: true });
        continue;
      }
      if (name === 'em' || name === 'i') {
        walk($(node).contents().toArray(), { ...opts, italics: true });
        continue;
      }
      if (name === 'u') {
        walk($(node).contents().toArray(), { ...opts, underline: {} });
        continue;
      }
      if (name === 'img') continue;
      walk($(node).contents().toArray(), opts);
    }
  };

  walk($('root').contents().toArray());
  if (runs.length === 0) {
    const plain = decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (plain) runs.push(new TextRun(plain));
  }
  return runs;
}

function imageRun(asset: PaperAsset, width?: number, height?: number): ImageRun | null {
  const type = asset.contentType.includes('png')
    ? 'png'
    : asset.contentType.includes('gif')
      ? 'gif'
      : 'jpg';
  const w = Math.min(width || 320, 480);
  const h = height ? Math.min(height, 360) : Math.round(w * 0.75);
  try {
    return new ImageRun({
      type,
      data: asset.bytes,
      transformation: { width: w, height: h },
      altText: { title: asset.path, description: asset.path, name: asset.path },
    });
  } catch {
    return null;
  }
}

export function blocksToParagraphs(
  blocks: PaperContentBlock[],
  assets: Map<string, PaperAsset>
): FileChild[] {
  const out: FileChild[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const runs = runsFromHtml(block.html);
      if (runs.length) {
        out.push(new Paragraph({ spacing: { after: 120 }, children: runs }));
      }
    } else if (block.type === 'image') {
      const asset = assets.get(block.assetPath);
      if (!asset) {
        out.push(
          new Paragraph({
            children: [new TextRun({ text: `[afbeelding: ${block.assetPath}]`, italics: true, color: '666666' })],
          })
        );
        continue;
      }
      const img = imageRun(asset, block.width, block.height);
      if (img) {
        out.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [img] }));
      }
    }
  }
  return out;
}

export function plainFromHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}
