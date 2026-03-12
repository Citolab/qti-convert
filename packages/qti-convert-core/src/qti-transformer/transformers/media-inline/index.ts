import * as cheerio from 'cheerio';
import { qtiReferenceAttributes } from '../../qti-transform';

export const mediaInlineAsync = async ($: cheerio.CheerioAPI, getFile: (file: string) => Promise<ArrayBuffer>) => {
  // get all media files and convert them to base64
  const attributes = qtiReferenceAttributes;
  for (const attribute of attributes) {
    const nodes = $(`[${attribute}]`).toArray();

    for (const node of nodes) {
      const srcValue = $(node).attr(attribute);
      if (srcValue) {
        // Skip if it's already a data URL
        if (srcValue.startsWith('data:')) continue;

        const arrayBuffer = await getFile(srcValue);
        if (arrayBuffer) {
          try {
            // Get file as array buffer
            const ext = srcValue.split('.').pop()?.toLowerCase() || '';
            const mimeType = getMimeType(ext);
            if (!mimeType) {
              // skip unsupported media types
              continue;
            }
            // Convert to base64
            const base64Data = arrayBufferToBase64(arrayBuffer);
            // Create data URL
            const dataUrl = `data:${mimeType};base64,${base64Data}`;

            // Replace the attribute value
            $(node).attr(attribute, dataUrl);
          } catch (e) {
            console.error(`Error processing media file ${srcValue}:`, e);
          }
        }
      }
    }
  }

  // Serialize the modified XML back to string
  return $.html();
};

/**
 * Returns the MIME type based on file extension
 */
function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    pdf: 'application/pdf'
  };

  return mimeTypes[extension];
}

/**
 * Converts ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;

  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}
