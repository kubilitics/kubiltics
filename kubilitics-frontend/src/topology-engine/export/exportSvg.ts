/**
 * Export – SVG format
 * Uses Cytoscape's built-in SVG export with poster-mode layout
 */
import type { Core } from 'cytoscape';
import { downloadFile } from '../utils/exportUtils';

export function exportAsSVG(cy: Core): string | undefined {
  try {
    return (cy as any).svg({ full: true, scale: 2 });
  } catch {
    return undefined;
  }
}

// FIX DESKTOP-EXPORT: Use shared Tauri-aware downloadFile instead of inline blob URL logic
export async function downloadSVG(cy: Core, filename?: string) {
  const svgData = exportAsSVG(cy);
  if (!svgData) return;
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await downloadFile(blob, filename ?? `topology-${ts}.svg`);
}
