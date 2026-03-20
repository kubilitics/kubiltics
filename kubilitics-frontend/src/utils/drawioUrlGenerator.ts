/**
 * Generate draw.io URLs from diagram content
 * Uses same compression as draw.io MCP: encodeURIComponent -> deflateRaw -> base64
 */
import pako from 'pako';

const DRAWIO_BASE_URL = 'https://app.diagrams.net/';

function compressData(data: string): string {
  if (!data || data.length === 0) return data;
  const encoded = encodeURIComponent(data);
  const compressed = pako.deflateRaw(encoded);
  let binary = '';
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return btoa(binary);
}

export type DrawioContentType = 'xml' | 'csv' | 'mermaid';

export interface DrawioUrlOptions {
  lightbox?: boolean;
  border?: number;
  dark?: boolean;
}

/**
 * Generate a draw.io URL that opens the editor with the given content
 */
export function generateDrawioUrl(
  data: string,
  type: DrawioContentType,
  options: DrawioUrlOptions = {}
): string {
  const { lightbox = false, border = 10, dark = false } = options;
  const compressedData = compressData(data);

  const createObj = {
    type,
    compressed: true,
    data: compressedData,
  };

  const params = new URLSearchParams();
  if (lightbox) {
    params.set('lightbox', '1');
    params.set('edit', '_blank');
  } else {
    params.set('grid', '0');
    params.set('pv', '0');
  }
  params.set('border', border.toString());
  params.set('edit', '_blank');
  if (dark) params.set('dark', '1');

  const createHash = '#create=' + encodeURIComponent(JSON.stringify(createObj));
  const paramsStr = params.toString();
  return DRAWIO_BASE_URL + (paramsStr ? '?' + paramsStr : '') + createHash;
}
