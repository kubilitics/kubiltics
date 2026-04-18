/**
 * Backend config store: Kubilitics backend base URL, AI URLs, and current cluster ID.
 * Consolidated store for all backend-related URLs (previously split between settingsStore and backendConfigStore).
 * Used when frontend talks to Kubilitics backend (GET clusters, GET topology, etc.) and AI service.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_BACKEND_BASE_URL, isLocalHostname } from '@/lib/backendConstants';

/**
 * Build-time check: are we running inside a Tauri desktop build?
 *
 * __VITE_IS_TAURI_BUILD__ is a compile-time constant injected by vite.config.ts `define`.
 * It is `true` when TAURI_BUILD=true was set during the build (i.e. kubilitics-desktop).
 *
 * This is the ONLY reliable Tauri check for URL routing because:
 *  - isTauri() relies on __TAURI_INTERNALS__ being injected by WKWebView, which happens
 *    AFTER the first JS module evaluation. Any code at module init time (including store
 *    initialState, getEffectiveBackendBaseUrl called from component renders before mount)
 *    sees isTauri()=false and falls through to the dev proxy path, returning ''.
 *  - import.meta.env.DEV is true in Tauri dev builds and irrelevant in production builds.
 *
 * __VITE_IS_TAURI_BUILD__ is baked in at build time — always correct, zero timing race.
 */
function isTauriBuildTime(): boolean {
  try {
    return typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__ === true;
  } catch {
    return false;
  }
}

/** Runtime Tauri check — only valid AFTER first component mount. Do NOT use for initial URL routing. */
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return !!(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/** Default backend URL: desktop sidecar or local host (dev) so users never need to "set backend" like Lens/Headlamp. */
export function getDefaultBackendBaseUrl(): string {
  // Build-time: always correct for Tauri desktop
  if (isTauriBuildTime()) return DEFAULT_BACKEND_BASE_URL;
  // Runtime fallback (for non-Tauri builds or SSR)
  if (isTauri()) return DEFAULT_BACKEND_BASE_URL;
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    const url = String(import.meta.env.VITE_API_URL).trim();
    if (url) return url.replace(/\/+$/, ''); // strip trailing slashes
  }
  // In dev on localhost: use empty base URL so requests go to same origin and Vite proxy forwards to backend (avoids cross-origin WebSocket errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  // Production browser (no Tauri, no Dev, no explicit VITE_API_URL): use SAME-ORIGIN.
  // This is the in-cluster web deployment — nginx serves the dist and proxies /api/* to
  // the backend Service. Hardcoding http://localhost:8190 here used to break the browser
  // path because the user's browser cannot reach the in-cluster backend pod directly.
  return '';
}

/**
 * Effective backend URL for all API calls.
 *
 * Resolution order:
 *  1. Tauri build (build-time constant) → always http://localhost:8190  [TIMING-INDEPENDENT]
 *  2. Dev on localhost → '' (empty = same-origin, Vite proxy handles it)
 *  3. Stored URL (user-configured) → use as-is
 *  4. Default (getDefaultBackendBaseUrl) → http://localhost:8190 or ''
 */
export function getEffectiveBackendBaseUrl(stored: string): string {
  // PERMANENT FIX: build-time constant — no timing race, works on first render
  if (isTauriBuildTime()) return DEFAULT_BACKEND_BASE_URL;
  // In dev on localhost, always use same-origin so Vite proxy is used (avoids WebSocket connection errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  const trimmed = (stored || '').trim();
  if (trimmed) return trimmed.replace(/\/+$/, '');
  return getDefaultBackendBaseUrl();
}

export interface BackendConfigState {
  /** Base URL of Kubilitics backend (e.g. http://localhost:8190). Empty = backend not configured. */
  backendBaseUrl: string;
  /** Currently selected cluster ID for backend-scoped requests (e.g. topology, resources). */
  currentClusterId: string | null;
  /** Flag to prevent session restore after explicit logout. */
  logoutFlag: boolean;
}

interface BackendConfigStore extends BackendConfigState {
  setBackendBaseUrl: (url: string) => void;
  setCurrentClusterId: (clusterId: string | null) => void;
  /** Clear backend URL and cluster; call when switching to direct K8s or disconnecting. */
  clearBackend: () => void;
  /** Set logout flag to prevent session restore. */
  setLogoutFlag: (flag: boolean) => void;
  /** True when backend mode is configured (non-empty base URL). */
  isBackendConfigured: () => boolean;
}

// PERMANENT FIX: For Tauri desktop builds, seed backendBaseUrl with the correct URL at
// module init time using the build-time constant. __VITE_IS_TAURI_BUILD__ is always
// available — no runtime timing dependency. This ensures every hook's `enabled` flag is
// correct on the very first render, before SyncBackendUrl() mounts.
const initialBackendUrl = isTauriBuildTime() ? DEFAULT_BACKEND_BASE_URL : '';

const initialState: BackendConfigState = {
  backendBaseUrl: initialBackendUrl,
  currentClusterId: null,
  logoutFlag: false,
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

      clearBackend: () =>
        set({
          backendBaseUrl: getDefaultBackendBaseUrl(),
          currentClusterId: null,
          logoutFlag: true,
        }),

      setLogoutFlag: (flag) =>
        set({ logoutFlag: flag }),

      isBackendConfigured: () => {
        // Build-time constant: Tauri desktop always has the sidecar backend
        if (isTauriBuildTime()) return true;
        // Runtime fallback: check if __TAURI_INTERNALS__ has been injected by now
        if (isTauri()) return true;
        // Any browser context (dev or prod): empty URL means same-origin, which is
        // the correct answer for the in-cluster Helm install (nginx proxies /api/*
        // to the backend Service). Treat that as configured — without this, the
        // production browser thinks "no backend", never calls /api/v1/clusters,
        // and bounces every user to /connect even though the hub is running.
        if (typeof window !== 'undefined') return true;
        const url = getEffectiveBackendBaseUrl(get().backendBaseUrl);
        return typeof url === 'string' && url.length > 0;
      },
    }),
    {
      name: 'kubilitics-backend-config',
      // PERMANENT FIX: When rehydrating from localStorage, ensure Tauri builds always have
      // the correct backend URL — user cannot accidentally persist '' from a previous broken state.
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // For Tauri builds: always override backendBaseUrl to the correct sidecar URL.
        // This fixes cases where a previous broken run persisted '' into localStorage.
        if (isTauriBuildTime() && (!state.backendBaseUrl || state.backendBaseUrl === '')) {
          state.backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
        }

      },
    }
  )
);

// Helper functions for non-React usage
export const getCurrentBackendUrl = () => useBackendConfigStore.getState().backendBaseUrl;
