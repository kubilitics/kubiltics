import type { TopologyGraph } from '../types/topology.types';
import type { EngineRef } from '../types/engine.types';

export interface ExportOptions {
  /** Export format */
  format: 'svg' | 'png' | 'jpeg' | 'webp' | 'mp4' | 'gif' | 'webm' | 'gltf';

  /** Output resolution (for raster formats) */
  resolution?: {
    width: number;
    height: number;
  };

  /** Background color (default: transparent for PNG, white for JPEG) */
  backgroundColor?: string;

  /** Quality (0-1, for lossy formats like JPEG) */
  quality?: number;

  /** Include watermark */
  watermark?: {
    text: string;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    opacity?: number;
  };

  /** Video options (for mp4, gif, webm) */
  video?: {
    duration: number; // seconds
    fps: number;
    animationType: 'rotate' | 'zoom' | 'fly-through' | 'none';
  };
}

/**
 * Export topology as SVG
 *
 * SVG exports are high-quality, scalable, and editable
 */
export async function exportAsSVG(
  engineRef: React.RefObject<EngineRef>,
  options: ExportOptions = { format: 'svg' }
): Promise<string | null> {
  if (!engineRef.current) {
    console.error('Engine ref not available');
    return null;
  }

  try {
    const svgData = engineRef.current.exportAsSVG();
    if (!svgData) {
      throw new Error('Failed to generate SVG');
    }

    // Add watermark if requested
    let finalSVG = svgData;
    if (options.watermark) {
      finalSVG = addWatermarkToSVG(svgData, options.watermark);
    }

    return finalSVG;
  } catch (error) {
    console.error('SVG export failed:', error);
    return null;
  }
}

/**
 * Export topology as PNG
 *
 * PNG exports are high-quality raster images with transparency support
 */
export async function exportAsPNG(
  engineRef: React.RefObject<EngineRef>,
  options: ExportOptions
): Promise<Blob | null> {
  if (!engineRef.current) {
    console.error('Engine ref not available');
    return null;
  }

  try {
    const pngData = engineRef.current.exportAsPNG();
    if (!pngData) {
      throw new Error('Failed to generate PNG');
    }

    // Convert base64 to Blob
    const blob = await base64ToBlob(pngData, 'image/png');

    // Apply post-processing if needed
    if (options.watermark || options.resolution) {
      return await postProcessImage(blob, options);
    }

    return blob;
  } catch (error) {
    console.error('PNG export failed:', error);
    return null;
  }
}

/**
 * Export topology as high-resolution image (for executives)
 *
 * This creates a clean, professional export suitable for presentations
 */
export async function exportExecutiveMode(
  engineRef: React.RefObject<EngineRef>,
  graph: TopologyGraph,
  options: Partial<ExportOptions> = {}
): Promise<Blob | null> {
  const defaultOptions: ExportOptions = {
    format: 'png',
    resolution: { width: 3840, height: 2160 }, // 4K resolution
    backgroundColor: '#FFFFFF',
    quality: 1.0,
    watermark: {
      text: 'Kubilitics OS',
      position: 'bottom-right',
      opacity: 0.3,
    },
    ...options,
  };

  // Temporarily hide UI elements for clean export
  // This would be implemented in the actual engine component

  return await exportAsPNG(engineRef, defaultOptions);
}

/**
 * Export topology as video (MP4, GIF, or WebM)
 *
 * FIX P2-002: Video export requires MediaRecorder API or ffmpeg.wasm integration.
 * Not exposed in the UI export menu. Returns null with a descriptive error.
 */
export async function exportAsVideo(
  _engineRef: React.RefObject<EngineRef>,
  _graph: TopologyGraph,
  options: ExportOptions
): Promise<Blob | null> {
  if (!options.video) {
    throw new Error('Video options required for video export');
  }

  // Video export is not yet available — requires MediaRecorder or ffmpeg.wasm.
  // This function is retained for API completeness but is not wired to the UI.
  return null;
}

/**
 * Export topology as 3D model (GLTF)
 *
 * FIX P2-002: GLTF export requires three.js GLTFExporter integration.
 * Not exposed in the UI export menu. Returns null.
 */
export async function exportAsGLTF(
  _graph: TopologyGraph,
  _options: ExportOptions = { format: 'gltf' }
): Promise<Blob | null> {
  // GLTF export is not yet available — requires GLTFExporter from three.js.
  // This function is retained for API completeness but is not wired to the UI.
  return null;
}

/**
 * Download exported file
 *
 * FIX DESKTOP-EXPORT: In Tauri desktop, blob: URLs with the tauri://localhost
 * origin contain colons that break the <a download> mechanism. Instead, we
 * convert the blob to a Uint8Array and invoke the save_topology_export Tauri
 * command which writes to the app data exports directory and opens the file
 * in the system file manager. Falls back to the standard browser download
 * for non-Tauri (web/Helm) environments.
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
      const format = safeFilename.split('.').pop() ?? 'bin';
      const savedPath = await invoke<string>('save_topology_export', {
        data,
        filename: safeFilename,
        format,
      });
      // Open the exports folder in the system file manager so the user can see the file
      try {
        await invoke('reveal_in_file_manager', { filePath: savedPath });
      } catch {
        // Non-critical — file was saved successfully even if reveal fails
      }
      return;
    } catch (err) {
      // Fall through to browser download as a last resort
      if (import.meta.env?.DEV) console.warn('Tauri save_topology_export failed, falling back to browser download:', err);
    }
  }

  // Standard browser download via blob URL
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Download SVG string
 */
export async function downloadSVG(svgString: string, filename: string) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  await downloadFile(blob, filename);
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(blob: Blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

// Helper functions

/**
 * Convert base64 string to Blob
 */
async function base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
  const response = await fetch(`data:${mimeType};base64,${base64}`);
  return await response.blob();
}

/**
 * Add watermark to SVG
 */
function addWatermarkToSVG(
  svgString: string,
  watermark: NonNullable<ExportOptions['watermark']>
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement;

  // Get SVG dimensions
  const width = parseFloat(svg.getAttribute('width') || '800');
  const height = parseFloat(svg.getAttribute('height') || '600');

  // Calculate position
  const padding = 20;
  let x = padding;
  let y = padding;

  switch (watermark.position) {
    case 'top-right':
      x = width - padding;
      y = padding;
      break;
    case 'bottom-left':
      x = padding;
      y = height - padding;
      break;
    case 'bottom-right':
      x = width - padding;
      y = height - padding;
      break;
  }

  // Create text element
  const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', x.toString());
  text.setAttribute('y', y.toString());
  text.setAttribute('font-family', 'Arial, sans-serif');
  text.setAttribute('font-size', '14');
  text.setAttribute('fill', '#000000');
  text.setAttribute('opacity', (watermark.opacity ?? 0.5).toString());
  text.textContent = watermark.text;

  if (watermark.position.includes('right')) {
    text.setAttribute('text-anchor', 'end');
  }

  svg.appendChild(text);

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(svg);
}

/**
 * Post-process image (resize, watermark, etc.)
 */
async function postProcessImage(
  blob: Blob,
  options: ExportOptions
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Set canvas size
      const width = options.resolution?.width ?? img.width;
      const height = options.resolution?.height ?? img.height;
      canvas.width = width;
      canvas.height = height;

      // Fill background
      if (options.backgroundColor) {
        ctx.fillStyle = options.backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      // Draw image
      ctx.drawImage(img, 0, 0, width, height);

      // Add watermark
      if (options.watermark) {
        ctx.font = '16px Arial';
        ctx.fillStyle = `rgba(0, 0, 0, ${options.watermark.opacity ?? 0.5})`;

        const text = options.watermark.text;
        const metrics = ctx.measureText(text);
        const padding = 20;

        let x = padding;
        let y = padding;

        switch (options.watermark.position) {
          case 'top-right':
            x = width - metrics.width - padding;
            y = padding;
            break;
          case 'bottom-left':
            x = padding;
            y = height - padding;
            break;
          case 'bottom-right':
            x = width - metrics.width - padding;
            y = height - padding;
            break;
        }

        ctx.fillText(text, x, y);
      }

      // Convert to blob
      canvas.toBlob(
        (resultBlob) => {
          if (resultBlob) {
            resolve(resultBlob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        `image/${options.format}`,
        options.quality ?? 1.0
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Get suggested filename based on graph and format
 */
export function getSuggestedFilename(
  graph: TopologyGraph,
  format: string
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const nodeCount = graph.nodes.length;
  return `topology-${nodeCount}-nodes-${timestamp}.${format}`;
}
