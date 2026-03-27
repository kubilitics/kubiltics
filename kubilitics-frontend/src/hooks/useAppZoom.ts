/**
 * useAppZoom — Ctrl+Plus / Ctrl+Minus zoom for the desktop app.
 * Uses CSS zoom on document.body. Persists zoom level in localStorage.
 * Also supports Ctrl+0 to reset to 100%.
 */
import { useEffect, useCallback } from 'react';
import { isTauri } from '@/lib/tauri';

const ZOOM_KEY = 'kubilitics-app-zoom';
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;
const STEP = 0.1;

function getStoredZoom(): number {
  try {
    const stored = localStorage.getItem(ZOOM_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) return val;
    }
  } catch { /* ignore */ }
  return 1.0;
}

function applyZoom(level: number) {
  document.documentElement.style.setProperty('--app-zoom', String(level));
  (document.body.style as Record<string, string>).zoom = String(level);
  try { localStorage.setItem(ZOOM_KEY, String(level)); } catch { /* ignore */ }
}

export function useAppZoom() {
  // Apply stored zoom on mount
  useEffect(() => {
    if (!isTauri()) return;
    applyZoom(getStoredZoom());
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isTauri()) return;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd) return;

    let current = getStoredZoom();

    if (e.key === '=' || e.key === '+') {
      // Ctrl+Plus: zoom in
      e.preventDefault();
      current = Math.min(MAX_ZOOM, Math.round((current + STEP) * 10) / 10);
      applyZoom(current);
    } else if (e.key === '-' || e.key === '_') {
      // Ctrl+Minus: zoom out
      e.preventDefault();
      current = Math.max(MIN_ZOOM, Math.round((current - STEP) * 10) / 10);
      applyZoom(current);
    } else if (e.key === '0') {
      // Ctrl+0: reset zoom
      e.preventDefault();
      applyZoom(1.0);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
