/**
 * Export – PNG format
 * High DPI export with configurable background
 */
import type { Core } from 'cytoscape';
import { EXPORT_BG } from '../renderer/styles';
import { downloadFile } from '../utils/exportUtils';

export function exportAsPNG(cy: Core, options?: { bg?: string; scale?: number }): string | undefined {
  const { bg = EXPORT_BG, scale = 2 } = options || {};
  try {
    return cy.png({ full: true, scale, bg });
  } catch {
    return undefined;
  }
}

// FIX DESKTOP-EXPORT: Use shared Tauri-aware downloadFile instead of inline data-URL link
export async function downloadPNG(cy: Core, filename = 'topology.png', options?: { bg?: string; scale?: number }) {
  const data = exportAsPNG(cy, options);
  if (!data) return;
  // data is a data URL (data:image/png;base64,...) — convert to blob
  const response = await fetch(data);
  const blob = await response.blob();
  await downloadFile(blob, filename);
}
