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
    // Cap scale so canvas stays within browser limits (~32767px max dimension)
    const bb = cy.elements().boundingBox();
    const maxDim = Math.max(bb.w, bb.h);
    const maxCanvasPx = 30000;
    const safeScale = maxDim > 0 ? Math.min(scale, maxCanvasPx / maxDim) : scale;
    const effectiveScale = Math.max(1, safeScale);
    return cy.png({ full: true, scale: effectiveScale, bg });
  } catch {
    return undefined;
  }
}

// FIX DESKTOP-EXPORT: Use shared Tauri-aware downloadFile instead of inline data-URL link
export async function downloadPNG(cy: Core, filename?: string, options?: { bg?: string; scale?: number }) {
  const data = exportAsPNG(cy, options);
  if (!data) return;
  // data is a data URL (data:image/png;base64,...) — convert to blob
  const response = await fetch(data);
  const blob = await response.blob();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await downloadFile(blob, filename ?? `topology-${ts}.png`);
}
