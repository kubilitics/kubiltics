/**
 * Tests for src/services/api/client.ts
 *
 * Covers: backendRequest, BackendApiError, circuit breaker logic,
 * getHealth, helper functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock isTauri to always return false (browser mode)
vi.mock('@/lib/tauri', () => ({ isTauri: () => false }));

// Mock stores used inside backendRequest
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ logout: vi.fn() }) },
}));
vi.mock('@/stores/clusterStore', () => ({
  useClusterStore: { getState: () => ({ activeCluster: null, kubeconfigContent: null }) },
}));

import {
  backendRequest,
  backendRequestText,
  getHealth,
  BackendApiError,
  API_PREFIX,
  isNetworkError,
  isCORSError,
  extractClusterIdFromPath,
  markBackendUnavailable,
  isBackendCircuitOpen,
  resetBackendCircuit,
  markBackendReady,
  isBackendEverReady,
  getBackendCircuitCloseTime,
} from './client';

// ---------- helpers ----------

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const headersObj = new Headers(headers);
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response);
}

// ---------- setup ----------

beforeEach(() => {
  resetBackendCircuit();         // clear global + per-cluster circuits
  markBackendReady();            // ensure backendEverReady=true (browser default)
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Helper unit tests
// ============================================================================

describe('isNetworkError', () => {
  it('returns true for "Failed to fetch" TypeError', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('returns true for "NetworkError" TypeError', () => {
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource'))).toBe(true);
  });
  it('returns false for a regular Error', () => {
    expect(isNetworkError(new Error('something'))).toBe(false);
  });
  it('returns false for a non-network TypeError', () => {
    expect(isNetworkError(new TypeError('Cannot read properties'))).toBe(false);
  });
});

describe('isCORSError', () => {
  it('detects cors keyword', () => {
    expect(isCORSError(new TypeError('CORS request did not succeed'))).toBe(true);
  });
  it('detects access control keyword', () => {
    expect(isCORSError(new TypeError('access control check failed'))).toBe(true);
  });
  it('detects cross-origin keyword', () => {
    expect(isCORSError(new TypeError('cross-origin request blocked'))).toBe(true);
  });
  it('returns false for non-CORS TypeError', () => {
    expect(isCORSError(new TypeError('Failed to fetch'))).toBe(false);
  });
  it('returns false for non-TypeError', () => {
    expect(isCORSError(new Error('cors'))).toBe(false);
  });
});

describe('extractClusterIdFromPath', () => {
  it('extracts cluster ID from path', () => {
    expect(extractClusterIdFromPath('clusters/my-cluster/pods')).toBe('my-cluster');
  });
  it('decodes URL-encoded cluster ID', () => {
    expect(extractClusterIdFromPath('clusters/my%20cluster/pods')).toBe('my cluster');
  });
  it('returns null for non-cluster path', () => {
    expect(extractClusterIdFromPath('health')).toBeNull();
  });
});

// ============================================================================
// Circuit breaker tests
// ============================================================================

describe('circuit breaker', () => {
  it('starts closed', () => {
    expect(isBackendCircuitOpen()).toBe(false);
  });

  it('opens after markBackendUnavailable (global)', () => {
    markBackendUnavailable();
    expect(isBackendCircuitOpen()).toBe(true);
  });

  it('opens per-cluster without affecting global', () => {
    markBackendUnavailable('cluster-a');
    expect(isBackendCircuitOpen('cluster-a')).toBe(true);
    expect(isBackendCircuitOpen('cluster-b')).toBe(false);
    expect(isBackendCircuitOpen()).toBe(false);
  });

  it('closes after cooldown expires', () => {
    vi.useFakeTimers();
    markBackendUnavailable();
    expect(isBackendCircuitOpen()).toBe(true);
    // Advance past the browser cooldown (15s)
    vi.advanceTimersByTime(16_000);
    expect(isBackendCircuitOpen()).toBe(false);
  });

  it('closes per-cluster after cooldown', () => {
    vi.useFakeTimers();
    markBackendUnavailable('cluster-x');
    expect(isBackendCircuitOpen('cluster-x')).toBe(true);
    vi.advanceTimersByTime(16_000);
    expect(isBackendCircuitOpen('cluster-x')).toBe(false);
  });

  it('resetBackendCircuit clears global and all clusters', () => {
    markBackendUnavailable();
    markBackendUnavailable('cluster-a');
    resetBackendCircuit();
    expect(isBackendCircuitOpen()).toBe(false);
    expect(isBackendCircuitOpen('cluster-a')).toBe(false);
  });

  it('resetBackendCircuit with clusterId clears only that cluster', () => {
    markBackendUnavailable('cluster-a');
    markBackendUnavailable('cluster-b');
    resetBackendCircuit('cluster-a');
    expect(isBackendCircuitOpen('cluster-a')).toBe(false);
    expect(isBackendCircuitOpen('cluster-b')).toBe(true);
  });

  it('getBackendCircuitCloseTime returns 0 when closed', () => {
    expect(getBackendCircuitCloseTime()).toBe(0);
  });

  it('getBackendCircuitCloseTime returns future timestamp when open', () => {
    markBackendUnavailable();
    expect(getBackendCircuitCloseTime()).toBeGreaterThan(Date.now());
  });
});

// ============================================================================
// backendRequest tests
// ============================================================================

describe('backendRequest', () => {
  it('returns parsed JSON on success', async () => {
    const data = { items: [1, 2, 3] };
    globalThis.fetch = mockFetchResponse(data);

    const result = await backendRequest<typeof data>('http://localhost:8190', 'clusters');
    expect(result).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    // Verify URL construction
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe(`http://localhost:8190${API_PREFIX}/clusters`);
  });

  it('normalizes trailing slash on baseUrl', async () => {
    globalThis.fetch = mockFetchResponse({ ok: true });
    await backendRequest('http://localhost:8190/', 'health');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe(`http://localhost:8190${API_PREFIX}/health`);
  });

  it('strips leading slash from path', async () => {
    globalThis.fetch = mockFetchResponse({ ok: true });
    await backendRequest('http://localhost:8190', '/clusters');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe(`http://localhost:8190${API_PREFIX}/clusters`);
  });

  it('returns undefined for empty body', async () => {
    globalThis.fetch = mockFetchResponse('');
    const result = await backendRequest('http://localhost:8190', 'clusters');
    expect(result).toBeUndefined();
  });

  it('throws BackendApiError on HTTP error', async () => {
    globalThis.fetch = mockFetchResponse('Not Found', 404, { 'X-Request-ID': 'req-123' });

    await expect(
      backendRequest('http://localhost:8190', 'clusters/bad/pods')
    ).rejects.toThrow(BackendApiError);

    try {
      await backendRequest('http://localhost:8190', 'clusters/bad2/pods');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BackendApiError);
      expect(e.status).toBe(404);
      expect(e.body).toBe('Not Found');
      expect(e.requestId).toBe('req-123');
    }
  });

  it('throws BackendApiError for invalid JSON', async () => {
    globalThis.fetch = mockFetchResponse('not json {{{');

    // The mock returns ok:true since status defaults to 200,
    // but the body is not valid JSON
    const headersObj = new Headers();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headersObj,
      text: () => Promise.resolve('not json {{{'),
    });

    await expect(
      backendRequest('http://localhost:8190', 'clusters')
    ).rejects.toThrow(BackendApiError);
  });

  it('throws immediately when circuit is open', async () => {
    markBackendUnavailable();
    globalThis.fetch = vi.fn();

    await expect(
      backendRequest('http://localhost:8190', 'clusters')
    ).rejects.toThrow(BackendApiError);

    // fetch should NOT have been called
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws immediately for per-cluster circuit open', async () => {
    markBackendUnavailable('cluster-a');
    globalThis.fetch = vi.fn();

    await expect(
      backendRequest('http://localhost:8190', 'clusters/cluster-a/pods')
    ).rejects.toThrow(/cluster-a.*temporarily unavailable/i);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('opens circuit on network error (Failed to fetch)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      backendRequest('http://localhost:8190', 'clusters')
    ).rejects.toThrow(TypeError);

    // Circuit should now be open
    expect(isBackendCircuitOpen()).toBe(true);
  });

  it('does NOT open circuit on CORS error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('CORS request did not succeed'));

    await expect(
      backendRequest('http://localhost:8190', 'clusters')
    ).rejects.toThrow(TypeError);

    // Circuit should remain closed
    expect(isBackendCircuitOpen()).toBe(false);
  });

  it('does NOT open circuit on HTTP 4xx/5xx errors', async () => {
    globalThis.fetch = mockFetchResponse('Server Error', 500);

    await expect(
      backendRequest('http://localhost:8190', 'clusters')
    ).rejects.toThrow(BackendApiError);

    // Circuit remains closed — only network errors open it
    expect(isBackendCircuitOpen()).toBe(false);
  });
});

// ============================================================================
// backendRequestText tests
// ============================================================================

describe('backendRequestText', () => {
  it('returns raw text on success', async () => {
    const yaml = 'apiVersion: v1\nkind: ConfigMap';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(yaml),
    });

    const result = await backendRequestText('http://localhost:8190', 'clusters/c1/yaml');
    expect(result).toBe(yaml);
  });

  it('throws BackendApiError on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'X-Request-ID': 'req-456' }),
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(
      backendRequestText('http://localhost:8190', 'clusters/c1/yaml')
    ).rejects.toThrow(BackendApiError);
  });

  it('throws immediately when circuit is open', async () => {
    markBackendUnavailable();
    globalThis.fetch = vi.fn();

    await expect(
      backendRequestText('http://localhost:8190', 'clusters/c1/yaml')
    ).rejects.toThrow(BackendApiError);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getHealth tests
// ============================================================================

describe('getHealth', () => {
  it('returns health status on success', async () => {
    const health = { status: 'ok', service: 'kubilitics', version: '1.0.0' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify(health)),
    });

    const result = await getHealth('http://localhost:8190');
    expect(result).toEqual(health);

    // Verify URL — getHealth uses /health, NOT /api/v1/health
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('http://localhost:8190/health');
  });

  it('throws BackendApiError on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: () => Promise.resolve('Service Unavailable'),
    });

    await expect(getHealth('http://localhost:8190')).rejects.toThrow(BackendApiError);
  });

  it('throws BackendApiError for invalid JSON in health response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('<html>Not JSON</html>'),
    });

    await expect(getHealth('http://localhost:8190')).rejects.toThrow(/Invalid JSON from \/health/);
  });

  it('throws when circuit is open and backendEverReady', async () => {
    markBackendReady();
    markBackendUnavailable();
    globalThis.fetch = vi.fn();

    await expect(getHealth('http://localhost:8190')).rejects.toThrow(BackendApiError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns undefined for empty body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    });

    const result = await getHealth('http://localhost:8190');
    expect(result).toBeUndefined();
  });

  it('opens circuit on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getHealth('http://localhost:8190')).rejects.toThrow(TypeError);
    expect(isBackendCircuitOpen()).toBe(true);
  });
});

// ============================================================================
// BackendApiError tests
// ============================================================================

describe('BackendApiError', () => {
  it('has correct name and properties', () => {
    const err = new BackendApiError('test message', 500, 'body text', 'req-789');
    expect(err.name).toBe('BackendApiError');
    expect(err.message).toBe('test message');
    expect(err.status).toBe(500);
    expect(err.body).toBe('body text');
    expect(err.requestId).toBe('req-789');
    expect(err).toBeInstanceOf(Error);
  });

  it('works without optional parameters', () => {
    const err = new BackendApiError('msg', 404);
    expect(err.body).toBeUndefined();
    expect(err.requestId).toBeUndefined();
  });
});
