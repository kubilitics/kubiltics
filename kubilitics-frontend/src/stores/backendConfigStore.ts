/**
 * Backend config store: Kubilitics backend base URL, AI URLs, and current cluster ID.
 * Consolidated store for all backend-related URLs (previously split between settingsStore and backendConfigStore).
 * Used when frontend talks to Kubilitics backend (GET clusters, GET topology, etc.) and AI service.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_BACKEND_BASE_URL, DEFAULT_AI_BASE_URL, DEFAULT_AI_WS_URL, isLocalHostname } from '@/lib/backendConstants';

/** C4.5: When running inside Tauri desktop, default to sidecar (same port as backend). */
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return !!(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/** Default backend URL: desktop sidecar or local host (dev) so users never need to "set backend" like Lens/Headlamp. */
export function getDefaultBackendBaseUrl(): string {
  if (isTauri()) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    const url = String(import.meta.env.VITE_API_URL).trim();
    if (url) return url.replace(/\/+$/, ''); // strip trailing slashes
  }
  // In dev on localhost: use empty base URL so requests go to same origin and Vite proxy forwards to backend (avoids cross-origin WebSocket errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  // Browser on local host (production build): use explicit backend URL
  if (typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  return '';
}

/** Effective backend URL: in dev on localhost always use proxy (''); otherwise stored or default. */
export function getEffectiveBackendBaseUrl(stored: string): string {
  // In dev on localhost, always use same-origin so Vite proxy is used (avoids WebSocket connection errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  const trimmed = (stored || '').trim();
  if (trimmed) return trimmed.replace(/\/+$/, '');
  return getDefaultBackendBaseUrl();
}

export interface BackendConfigState {
  /** Base URL of Kubilitics backend (e.g. http://localhost:819). Empty = backend not configured. */
  backendBaseUrl: string;
  /** Currently selected cluster ID for backend-scoped requests (e.g. topology, resources). */
  currentClusterId: string | null;
  /** AI backend HTTP URL (e.g. http://localhost:8081). */
  aiBackendUrl: string;
  /** AI backend WebSocket URL (e.g. ws://localhost:8081/ws). */
  aiWsUrl: string;
}

interface BackendConfigStore extends BackendConfigState {
  setBackendBaseUrl: (url: string) => void;
  setCurrentClusterId: (clusterId: string | null) => void;
  setAiBackendUrl: (url: string) => void;
  setAiWsUrl: (url: string) => void;
  /** Clear backend URL and cluster; call when switching to direct K8s or disconnecting. */
  clearBackend: () => void;
  /** True when backend mode is configured (non-empty base URL). */
  isBackendConfigured: () => boolean;
}

// P0-B: Do NOT call getDefaultBackendBaseUrl() here. At module init in Tauri WebView,
// __TAURI_INTERNALS__ is not yet injected, so isTauri() is false and we'd set backendBaseUrl ''.
// URL is resolved lazily via getEffectiveBackendBaseUrl() / isBackendConfigured() at call time.
const initialState: BackendConfigState = {
  backendBaseUrl: '',
  currentClusterId: null,
  aiBackendUrl: DEFAULT_AI_BASE_URL,
  aiWsUrl: DEFAULT_AI_WS_URL,
};

export const useBackendConfigStore = create<BackendConfigStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setBackendBaseUrl: (url) =>
        set({
          backendBaseUrl: (url || '').trim().replace(/\/+$/, ''),
        }),

      setCurrentClusterId: (clusterId) =>
        set({ currentClusterId: clusterId ?? null }),

      setAiBackendUrl: (url) =>
        set({
          aiBackendUrl: (url || '').trim().replace(/\/+$/, ''),
        }),

      setAiWsUrl: (url) =>
        set({
          aiWsUrl: (url || '').trim(),
        }),

      clearBackend: () =>
        set({
          backendBaseUrl: getDefaultBackendBaseUrl(),
          currentClusterId: null,
          aiBackendUrl: DEFAULT_AI_BASE_URL,
          aiWsUrl: DEFAULT_AI_WS_URL,
        }),

      isBackendConfigured: () => {
        // P0-B: isTauri() must be called at invocation time (NOT at module init time).
        // At module init, __TAURI_INTERNALS__ is not yet injected into window, so a
        // module-level isTauri() call returns false, leaving backendBaseUrl empty and
        // causing all hooks to have enabled:false on cold start.
        // Calling isTauri() here (at request time) gets the correct runtime value.
        if (isTauri()) return true; // Desktop always has sidecar backend at port 819
        const url = getEffectiveBackendBaseUrl(get().backendBaseUrl);
        // In dev on localhost we use '' (proxy), which is valid
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
          return true;
        }
        return typeof url === 'string' && url.length > 0;
      },
    }),
    {
      name: 'kubilitics-backend-config',
      // Migration: copy AI URLs from old settingsStore if present
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        try {
          const oldSettings = localStorage.getItem('kubilitics-settings');
          if (oldSettings) {
            const parsed = JSON.parse(oldSettings);
            const settingsState = parsed?.state;

            // Only migrate if backendConfigStore doesn't have AI URLs yet (first migration)
            if (settingsState && state.aiBackendUrl === DEFAULT_AI_BASE_URL && state.aiWsUrl === DEFAULT_AI_WS_URL) {
              if (settingsState.aiBackendUrl) {
                state.aiBackendUrl = settingsState.aiBackendUrl;
              }
              if (settingsState.aiWsUrl) {
                state.aiWsUrl = settingsState.aiWsUrl;
              }

              // Clear old settingsStore after migration
              localStorage.removeItem('kubilitics-settings');
              console.log('[backendConfigStore] Migrated AI URLs from settingsStore');
            }
          }
        } catch (error) {
          console.warn('[backendConfigStore] Failed to migrate from settingsStore:', error);
        }
      },
    }
  )
);

// Helper functions for non-React usage
export const getCurrentBackendUrl = () => useBackendConfigStore.getState().backendBaseUrl;
export const getCurrentAiBackendUrl = () => useBackendConfigStore.getState().aiBackendUrl;
export const getCurrentAiWsUrl = () => useBackendConfigStore.getState().aiWsUrl;
