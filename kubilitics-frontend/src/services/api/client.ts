/**
 * Shared fetch wrapper, circuit breaker, and request infrastructure.
 * All domain API modules import backendRequest/backendRequestText from here.
 */
import { useAuthStore } from '@/stores/authStore';
import { useClusterStore } from '@/stores/clusterStore';
import { isTauri } from '@/lib/tauri';

export const API_PREFIX = '/api/v1';

/** D1.2: Header required for destructive actions (delete resource, apply). */
export const CONFIRM_DESTRUCTIVE_HEADER = 'X-Confirm-Destructive';

// ── Circuit Breaker ───────────────────────────────────────────────────────────

/**
 * Tauri startup grace period — suppress circuit breaker until backend has been
 * healthy at least once. During cold start the Go sidecar needs 2-5s to boot;
 * opening the circuit on those early failures causes a fleeting "Connection paused"
 * banner that appears at the top and immediately disappears — terrible UX.
 *
 * Once backendEverReady flips to true the circuit works normally.
 */
let backendEverReady = !isTauri(); // browser mode: no grace period needed

/** Call this when the backend first becomes healthy (e.g. health check passes). */
export function markBackendReady(): void {
  backendEverReady = true;
}

/** Expose backendEverReady for health check (getHealth needs it). */
export function isBackendEverReady(): boolean {
  return backendEverReady;
}

/** Circuit breaker cooldown: how long to pause requests after a network failure.
 * Shorter cooldowns improve recovery responsiveness — the old 60s/30s values meant
 * users stared at an error banner for up to a minute even for brief network blips.
 * 15s/10s gives the backend enough breathing room while keeping recovery snappy. */
const BACKEND_DOWN_COOLDOWN_MS_BROWSER = 15_000;
const BACKEND_DOWN_COOLDOWN_MS_TAURI = 10_000;

function getBackendDownCooldownMs(): number {
  return isTauri() ? BACKEND_DOWN_COOLDOWN_MS_TAURI : BACKEND_DOWN_COOLDOWN_MS_BROWSER;
}

/** Global circuit: backend server itself is unreachable (affects all clusters). */
let backendUnavailableUntil = 0;

/**
 * Per-cluster circuit: individual cluster network failures only block that cluster.
 * Key: clusterId, Value: timestamp when circuit closes.
 * This prevents one unhealthy cluster from blocking the entire dashboard.
 */
const clusterCircuitMap = new Map<string, number>();

export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && (e.message === 'Failed to fetch' || e.message?.includes('NetworkError'))) return true;
  return false;
}

/** Check if error is CORS-related. CORS errors should NOT open circuit breaker. */
export function isCORSError(e: unknown): boolean {
  if (e instanceof TypeError) {
    const msg = e.message.toLowerCase();
    return msg.includes('cors') || msg.includes('access control') || msg.includes('cross-origin');
  }
  return false;
}

/** Extract clusterId from a request path like "clusters/{id}/..." or return null for non-cluster paths. */
export function extractClusterIdFromPath(path: string): string | null {
  const match = path.match(/^clusters\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Mark backend unavailable. If clusterId is provided, only that cluster's circuit opens.
 * If clusterId is null (non-cluster request failed), the global circuit opens.
 */
export function markBackendUnavailable(clusterId?: string | null): void {
  const cooldown = Date.now() + getBackendDownCooldownMs();
  if (clusterId) {
    clusterCircuitMap.set(clusterId, cooldown);
  } else {
    backendUnavailableUntil = cooldown;
  }
}

/** True if we're in cooldown and should skip backend requests (avoids proxy log spam). */
export function isBackendCircuitOpen(clusterId?: string | null): boolean {
  // Global circuit always checked
  if (Date.now() < backendUnavailableUntil) return true;
  // Per-cluster circuit
  if (clusterId) {
    const until = clusterCircuitMap.get(clusterId);
    if (until && Date.now() < until) return true;
    // Auto-clean expired entries
    if (until && Date.now() >= until) clusterCircuitMap.delete(clusterId);
  }
  return false;
}

/** Get the timestamp (ms since epoch) when the circuit will close, or 0 if already closed. */
export function getBackendCircuitCloseTime(clusterId?: string | null): number {
  const globalUntil = backendUnavailableUntil > Date.now() ? backendUnavailableUntil : 0;
  if (clusterId) {
    const clusterUntil = clusterCircuitMap.get(clusterId) ?? 0;
    return Math.max(globalUntil, clusterUntil > Date.now() ? clusterUntil : 0);
  }
  return globalUntil;
}

/** Reset circuit so the next Retry can attempt the backend immediately (user-initiated recovery). */
export function resetBackendCircuit(clusterId?: string | null): void {
  if (clusterId) {
    clusterCircuitMap.delete(clusterId);
  } else {
    backendUnavailableUntil = 0;
    clusterCircuitMap.clear();
  }
}

/**
 * Circuit breaker applies to all backendRequest() and getHealth() calls: topology, metrics, cluster lists,
 * shell completions, kcli/exec, etc. When open, those calls throw immediately (no request sent).
 * Shell/KCLI WebSocket connections use URLs from getKubectlShellStreamUrl/getKCLIShellStreamUrl and connect
 * via new WebSocket() — they are not gated by the circuit; they fail at connection time if backend is down.
 */

// ── Error Types ───────────────────────────────────────────────────────────────

/** C2.3: Error transparency — status and requestId for support. */
export class BackendApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
    /** X-Request-ID from response header when present (for support correlation). */
    public requestId?: string
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

// ── Request Functions ─────────────────────────────────────────────────────────

/**
 * Low-level request against the backend.
 * Path is relative to API root, e.g. "clusters" -> /api/v1/clusters.
 *
 * Desktop mode (Tauri): Sends kubeconfig with each request via X-Kubeconfig header (Headlamp/Lens model).
 * Web mode: Uses JWT token authentication.
 */
export async function backendRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const clusterId = extractClusterIdFromPath(path);

  // Check global circuit first, then per-cluster circuit
  if (isBackendCircuitOpen(clusterId)) {
    throw new BackendApiError(
      clusterId
        ? `Cluster ${clusterId} temporarily unavailable. Try again in a moment.`
        : isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open). Check backend URL in Settings or try again later.',
      0,
      undefined
    );
  }

  // Ensure no trailing slash
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = `${normalizedBase}${API_PREFIX}/${normalizedPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };

  // Desktop mode (Tauri): Send kubeconfig with each request (Headlamp/Lens model)
  if (isTauri()) {
    const { activeCluster, kubeconfigContent } = useClusterStore.getState();

    if (kubeconfigContent) {
      headers['X-Kubeconfig'] = btoa(kubeconfigContent);
    } else if (activeCluster?.kubeconfig) {
      headers['X-Kubeconfig'] = btoa(activeCluster.kubeconfig);
    }
  }
  // Web mode: No login — no Authorization header. When auth_mode=required, re-add token injection.

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (e) {
    // BA-3: Circuit breaker ONLY opens on network-level errors (ECONNREFUSED, Failed to fetch, timeout).
    // CORS errors are configuration issues, not backend unavailability - don't open circuit.
    // HTTP 4xx (404, 401, 403) and 5xx responses must NOT open the circuit — these are application-level
    // errors (wrong cluster ID, auth failure, server error) not backend unavailability. Opening the circuit
    // on 404 would lock out the user for 60 seconds just because they navigated to a non-existent resource.
    // IMPORTANT: markBackendUnavailable() is ONLY called here in the network catch block, never in the
    // !response.ok path below. Any refactor that moves markBackendUnavailable() to the error path would break this.
    // Per-cluster circuit: if this was a cluster-specific request, only block that cluster.
    if (isNetworkError(e) && !isCORSError(e) && backendEverReady) {
      markBackendUnavailable(clusterId);
    }
    throw e;
  }

  const requestId = response.headers.get('X-Request-ID') ?? undefined;
  const body = await response.text();
  if (!response.ok) {
    // BA-3: HTTP 4xx/5xx responses do NOT open the circuit breaker — these are application errors,
    // not backend unavailability. Only network-level errors (in catch block above) open the circuit.
    if (response.status === 401) {
      if (isTauri()) {
        console.error('Kubeconfig authentication failed - kubeconfig may be invalid or expired');
      } else {
        useAuthStore.getState().logout();
      }
      // P2-6: Use event so App can navigate via React Router; window.location.href breaks MemoryRouter (Tauri).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-logout'));
      }
    }

    // Handle rate limiting (429) with silent automatic retry.
    // The backend exempts loopback (127.0.0.1/::1) from rate limiting in
    // desktop mode, so 429 only fires when the backend is under real load.
    // Either way, silently wait and retry — a toast for a transient backpressure
    // signal creates constant noise for the user and is not actionable.
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
      // Cap wait to 10 s to keep the UI responsive; default 1 s if no header.
      const waitMs = retryAfterSeconds
        ? Math.min(retryAfterSeconds * 1000, 10_000)
        : 1_000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      // Retry once silently.
      return backendRequest<T>(baseUrl, path, init);
    }

    throw new BackendApiError(
      `Backend API error: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body,
      requestId
    );
  }

  if (!body || body.trim() === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new BackendApiError(
      `Invalid JSON response: ${body.slice(0, 200)}`,
      response.status,
      body,
      requestId
    );
  }
}

/**
 * Like backendRequest but returns raw text instead of parsing JSON.
 * Used for endpoints that return non-JSON content (e.g. YAML, plain text).
 * Shares all the same infrastructure: circuit breaker, Tauri X-Kubeconfig
 * header, rate-limit retry, and auth-logout on 401.
 */
export async function backendRequestText(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<string> {
  const clusterId = extractClusterIdFromPath(path);

  if (isBackendCircuitOpen(clusterId)) {
    throw new BackendApiError(
      clusterId
        ? `Cluster ${clusterId} temporarily unavailable. Try again in a moment.`
        : isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open). Check backend URL in Settings or try again later.',
      0,
      undefined
    );
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = `${normalizedBase}${API_PREFIX}/${normalizedPath}`;

  const headers: Record<string, string> = {
    Accept: 'text/yaml, text/plain, */*',
    ...((init?.headers as Record<string, string>) || {}),
  };

  if (isTauri()) {
    const { activeCluster, kubeconfigContent } = useClusterStore.getState();

    if (kubeconfigContent) {
      headers['X-Kubeconfig'] = btoa(kubeconfigContent);
    } else if (activeCluster?.kubeconfig) {
      headers['X-Kubeconfig'] = btoa(activeCluster.kubeconfig);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (e) {
    if (isNetworkError(e) && !isCORSError(e) && backendEverReady) {
      markBackendUnavailable(clusterId);
    }
    throw e;
  }

  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      if (isTauri()) {
        console.error('Kubeconfig authentication failed - kubeconfig may be invalid or expired');
      } else {
        useAuthStore.getState().logout();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-logout'));
      }
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
      const waitMs = retryAfterSeconds
        ? Math.min(retryAfterSeconds * 1000, 10_000)
        : 1_000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return backendRequestText(baseUrl, path, init);
    }

    const requestId = response.headers.get('X-Request-ID') ?? undefined;
    throw new BackendApiError(
      `Backend API error: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body,
      requestId
    );
  }

  return body;
}

/**
 * GET /api/v1/../health => /health — backend health check (at API base, not under /api/v1).
 */
export async function getHealth(
  baseUrl: string
): Promise<{ status: string; service?: string; version?: string }> {
  // During Tauri startup grace period, always allow health checks through
  // so the first success can mark the backend as ready.
  if (backendEverReady && isBackendCircuitOpen()) {
    throw new BackendApiError(
      isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open). Check backend URL in Settings or try again later.',
      0,
      undefined
    );
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBase}/health`;
  let response: Response;
  try {
    // BA-4: 5s timeout prevents hanging if backend accepts connection but doesn't respond (e.g. DB migration blocking).
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    // Don't open circuit on CORS errors - these are config issues, not backend down
    // During Tauri startup, suppress circuit opening until backend has been healthy once
    if (isNetworkError(e) && !isCORSError(e) && backendEverReady) {
      markBackendUnavailable();
    }
    throw e;
  }
  const body = await response.text();
  if (!response.ok) {
    throw new BackendApiError(
      `Health check failed: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body
    );
  }
  // Backend responded successfully — mark as having been ready at least once
  // so the circuit breaker starts working normally from here on.
  if (!backendEverReady) markBackendReady();

  if (!body?.trim()) return undefined as { status: string };
  try {
    return JSON.parse(body) as { status: string; service?: string; version?: string };
  } catch {
    const preview = body?.trim() ? body.slice(0, 100) : '(empty)';
    throw new BackendApiError(
      `Invalid JSON from /health (backend may have returned HTML or wrong URL). Body: ${preview}${(body?.length ?? 0) > 100 ? '...' : ''}`,
      response.status,
      body
    );
  }
}
