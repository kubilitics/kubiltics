/**
 * Tests for src/services/api/events.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tauri', () => ({ isTauri: () => false }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ logout: vi.fn() }) },
}));
vi.mock('@/stores/clusterStore', () => ({
  useClusterStore: { getState: () => ({ activeCluster: null, kubeconfigContent: null }) },
}));

import { getEvents, getResourceEvents } from './events';
import { resetBackendCircuit, markBackendReady } from './client';

function mockFetch(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response);
}

beforeEach(() => {
  resetBackendCircuit();
  markBackendReady();
  vi.restoreAllMocks();
});

describe('getEvents', () => {
  it('returns array when backend returns an array', async () => {
    const events = [
      { type: 'Normal', reason: 'Scheduled', message: 'Pod scheduled', involvedObject: { kind: 'Pod', name: 'web-1', namespace: 'default' }, firstTimestamp: '2025-01-01T00:00:00Z', lastTimestamp: '2025-01-01T00:00:00Z', count: 1 },
      { type: 'Warning', reason: 'BackOff', message: 'Back-off restarting', involvedObject: { kind: 'Pod', name: 'web-2', namespace: 'default' }, firstTimestamp: '2025-01-01T00:00:00Z', lastTimestamp: '2025-01-01T00:00:00Z', count: 3 },
    ];
    mockFetch(events);

    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual(events);
    expect(result).toHaveLength(2);
  });

  it('returns items array when backend returns { items: [...] }', async () => {
    const events = [{ type: 'Normal', reason: 'Created', message: 'Created container', involvedObject: { kind: 'Pod', name: 'app-1', namespace: 'ns' }, firstTimestamp: '', lastTimestamp: '', count: 1 }];
    mockFetch({ items: events });

    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual(events);
  });

  it('passes namespace and limit query params', async () => {
    mockFetch([]);

    await getEvents('http://localhost:8190', 'cluster-1', { namespace: 'kube-system', limit: 50 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('namespace=kube-system');
    expect(calledUrl).toContain('limit=50');
  });

  it('handles empty response (no items key)', async () => {
    mockFetch({ items: [] });

    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual([]);
  });

  it('returns empty array when backend returns { items: undefined }', async () => {
    mockFetch({});

    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual([]);
  });

  it('encodes clusterId in the URL', async () => {
    mockFetch([]);

    await getEvents('http://localhost:8190', 'my cluster/special');

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('my%20cluster%2Fspecial');
  });
});

describe('getEvents — Phase 4 resilient envelope', () => {
  it('unwraps envelope with bare array under .data (all-namespaces branch)', async () => {
    const events = [{ type: 'Normal', reason: 'X', message: 'x', involvedObject: { kind: 'Pod', name: 'p', namespace: 'n' }, firstTimestamp: '', lastTimestamp: '', count: 1 }];
    mockFetch({ data: events, reachable: true, health_status: 'healthy' });

    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual(events);
  });

  it('unwraps envelope with {items, metadata} under .data (single-namespace branch)', async () => {
    const events = [{ type: 'Warning', reason: 'Y', message: 'y', involvedObject: { kind: 'Pod', name: 'p', namespace: 'n' }, firstTimestamp: '', lastTimestamp: '', count: 2 }];
    mockFetch({
      data: { items: events, metadata: { total: 1, continue: '' } },
      reachable: true,
      health_status: 'healthy',
    });

    const result = await getEvents('http://localhost:8190', 'cluster-1', { namespace: 'kube-system' });
    expect(result).toEqual(events);
  });

  it('returns empty array on unreachable envelope with no data', async () => {
    mockFetch({ reachable: false, error_message: 'down', health_status: 'unreachable' });
    const result = await getEvents('http://localhost:8190', 'cluster-1');
    expect(result).toEqual([]);
  });
});

describe('getResourceEvents', () => {
  it('passes kind, name, and namespace as query params', async () => {
    const events = [{ type: 'Normal', reason: 'Pulled', message: 'Pulled image', involvedObject: { kind: 'Pod', name: 'web-1', namespace: 'default' }, firstTimestamp: '', lastTimestamp: '', count: 1 }];
    mockFetch(events);

    const result = await getResourceEvents('http://localhost:8190', 'cluster-1', 'default', 'Pod', 'web-1');

    expect(result).toEqual(events);
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('namespace=default');
    expect(calledUrl).toContain('involvedObjectKind=Pod');
    expect(calledUrl).toContain('involvedObjectName=web-1');
    expect(calledUrl).toContain('limit=20');
  });

  it('uses custom limit when provided', async () => {
    mockFetch([]);

    await getResourceEvents('http://localhost:8190', 'cluster-1', 'ns', 'Deployment', 'app', 100);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=100');
  });

  it('handles { items: [...] } response shape', async () => {
    const events = [{ type: 'Warning', reason: 'FailedMount', message: 'Mount failed', involvedObject: { kind: 'Pod', name: 'db-0', namespace: 'prod' }, firstTimestamp: '', lastTimestamp: '', count: 2 }];
    mockFetch({ items: events });

    const result = await getResourceEvents('http://localhost:8190', 'cluster-1', 'prod', 'Pod', 'db-0');
    expect(result).toEqual(events);
  });

  it('returns empty array for empty response', async () => {
    mockFetch([]);

    const result = await getResourceEvents('http://localhost:8190', 'cluster-1', 'default', 'Pod', 'gone');
    expect(result).toEqual([]);
  });
});
