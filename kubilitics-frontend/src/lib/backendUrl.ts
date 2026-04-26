/**
 * Backend URL helpers — single source of truth for every fetch / WebSocket /
 * EventSource call to the Kubilitics backend.
 *
 * WHY:
 *  Before this module the frontend was a hybrid: half the calls used
 *  `fetch('/api/...')` (relying on Vite's dev proxy), half used
 *  `fetch(\`${baseUrl}/api/...\`)` reading from backendConfigStore. The Vite
 *  proxy was hardcoded to port 8190; if the desktop sidecar fell back to a
 *  different port (port 8190 squatted) every relative-URL fetch ECONNREFUSED.
 *
 *  Option B (this file) makes the URL fully runtime-resolved so the port
 *  never matters. Every callsite goes through `apiUrl(path)` /
 *  `wsUrl(path)` / `eventSourceUrl(path)`. Vite proxy is dropped. The
 *  desktop sidecar can move to a free port and the frontend follows along
 *  via `invoke('get_backend_url')` (see App.tsx#SyncBackendUrl).
 *
 * Resolution order (mirrors backendConfigStore.getEffectiveBackendBaseUrl):
 *   1. Tauri desktop build → http://localhost:<sidecar-port>
 *   2. Local dev (vite, hostname=localhost/127.0.0.1) → http://localhost:8190
 *   3. User-configured store URL (Settings → Backend) → use as-is
 *   4. In-cluster web (production browser, same-origin) → '' so paths stay
 *      relative and nginx in front of the SPA proxies /api/* to the backend
 *      Service.
 */

import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

/** Strip a trailing slash from a base URL so we can concat cleanly. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Ensure a path starts with exactly one leading slash. */
function ensureLeadingSlash(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

/** Backend base URL for direct fetch calls (non-hook context). */
export function getBackendBase(): string {
  const stored = useBackendConfigStore.getState().backendBaseUrl;
  return getEffectiveBackendBaseUrl(stored);
}

/**
 * Resolve an HTTP path to an absolute URL the frontend can fetch.
 *
 * Examples:
 *   apiUrl('/api/v1/clusters')                  → 'http://localhost:8190/api/v1/clusters'  (Tauri / dev)
 *   apiUrl('/api/v1/clusters')                  → '/api/v1/clusters'                       (in-cluster web)
 *   apiUrl('api/v1/clusters')                   → same as above; leading slash is normalised
 *
 * `path` may contain a query string. Pass already-encoded path; we don't
 * sanitise — callers should use URLSearchParams or encodeURIComponent.
 */
export function apiUrl(path: string): string {
  const base = trimTrailingSlash(getBackendBase());
  return `${base}${ensureLeadingSlash(path)}`;
}

/**
 * Resolve a WebSocket path to an absolute ws:// or wss:// URL.
 *
 * - Tauri / dev → ws://localhost:8190/ws/...
 * - In-cluster web (https) → wss://<same-origin>/ws/...
 * - In-cluster web (http) → ws://<same-origin>/ws/...
 *
 * Same `path` rules as `apiUrl`.
 */
export function wsUrl(path: string): string {
  const base = trimTrailingSlash(getBackendBase());
  const fullPath = ensureLeadingSlash(path);

  if (base) {
    // Convert http:// → ws://, https:// → wss://
    const wsBase = base.replace(/^http(s?):\/\//, 'ws$1://');
    return `${wsBase}${fullPath}`;
  }

  // Same-origin: use the page's own protocol/host
  if (typeof window === 'undefined') return fullPath;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${fullPath}`;
}

/**
 * Resolve an EventSource (SSE) path. EventSource is HTTP, so this is just
 * `apiUrl` — exposed under its own name so the intent is obvious at the
 * callsite and so we can swap the implementation later (e.g. add auth
 * headers via a polyfill) without touching every caller.
 */
export function eventSourceUrl(path: string): string {
  return apiUrl(path);
}
