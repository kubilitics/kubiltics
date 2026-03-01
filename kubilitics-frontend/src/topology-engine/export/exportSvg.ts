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
export async function downloadSVG(cy: Core, filename = 'topology.svg') {
  const svgData = exportAsSVG(cy);
  if (!svgData) return;
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  await downloadFile(blob, filename);
}
