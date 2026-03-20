/**
 * Single source of truth for Kubilitics backend URL and port.
 * Aligns with: backend (config default 819), desktop sidecar (BACKEND_PORT 819).
 * Use these constants so port/URL changes happen in one place.
 */

/** Default port the Kubilitics backend listens on (desktop sidecar and standalone server). */
export const DEFAULT_BACKEND_PORT = Number(import.meta.env.VITE_BACKEND_PORT) || 819;

/** Default backend base URL when running on localhost (desktop or browser dev). */
export const DEFAULT_BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || `http://localhost:${DEFAULT_BACKEND_PORT}`;

/** Hostnames that are considered "local" for auto-defaulting backend URL (no Settings needed). */
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname?.toLowerCase() ?? '');
}
