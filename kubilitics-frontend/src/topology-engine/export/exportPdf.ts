/**
 * Export – PDF format
 * Converts PNG to PDF (browser-side)
 *
 * FIX DESKTOP-EXPORT: In Tauri, window.open() to a blank page won't work
 * for print-to-PDF. Instead, save the high-res PNG via the Tauri export
 * command and let the user use their OS print facilities. In browser mode,
 * fall back to the original print dialog approach.
 */
import type { Core } from 'cytoscape';
import { exportAsPNG } from './exportPng';
import { downloadFile } from '../utils/exportUtils';

export async function downloadPDF(cy: Core, filename?: string) {
  if (!filename) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    filename = `topology-${ts}.pdf`;
  }
  const pngData = exportAsPNG(cy, { scale: 3, bg: '#ffffff' });
  if (!pngData) return;

  // Check if running in Tauri desktop
  const w = typeof window !== 'undefined' ? window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown } : null;
  const isTauriEnv = !!(w?.__TAURI_INTERNALS__ ?? w?.__TAURI__);

  if (isTauriEnv) {
    // In Tauri: save as high-res PNG (print-to-PDF isn't available in webview)
    const response = await fetch(pngData);
    const blob = await response.blob();
    const pngFilename = filename.replace(/\.pdf$/i, '-print.png');
    await downloadFile(blob, pngFilename);
    return;
  }

  // Browser: open in new window for print-to-PDF
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Kubilitics Topology – ${filename}</title>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
            img { max-width: 100%; height: auto; }
            @media print { body { margin: 0; } img { width: 100%; } }
          </style>
        </head>
        <body>
          <img src="${pngData}" alt="Topology" />
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}
