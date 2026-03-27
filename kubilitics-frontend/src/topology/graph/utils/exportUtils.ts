/**
 * File download utility — works in both web and Tauri desktop environments.
 */

/**
 * Download a Blob as a file. Uses Tauri save dialog when in desktop app,
 * falls back to anchor click for web.
 */
export async function downloadFile(blob: Blob, filename: string) {
  // Sanitize filename — remove colons and other characters illegal on Windows/macOS
  const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '-');

  // Check if running in Tauri desktop
  const w = typeof window !== 'undefined' ? window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown } : null;
  const isTauriEnv = !!(w?.__TAURI_INTERNALS__ ?? w?.__TAURI__);

  if (isTauriEnv) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const arrayBuffer = await blob.arrayBuffer();
      const data = Array.from(new Uint8Array(arrayBuffer));
      await invoke('save_file', { data, filename: safeFilename });
      return;
    } catch {
      // Fall through to web download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
