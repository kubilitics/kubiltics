/**
 * Unit tests for Kubilitics backend API client (mock fetch).
 * Per TASKS A3.1: unit test with MSW or mock fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getClusters,
  getTopology,
  getHealth,
  getKCLITUIState,
  BackendApiError,
  createBackendApiClient,
  isBackendCircuitOpen,
  resetBackendCircuit,
} from './backendApiClient';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';

const BASE = DEFAULT_BACKEND_BASE_URL;

describe('backendApiClient', () => {
  beforeEach(() => {
    resetBackendCircuit();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getClusters', () => {
    it('calls GET /api/v1/clusters with base URL', async () => {
      const clusters = [
        { id: 'c1', name: 'prod', context: 'prod', status: 'connected' },
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(clusters), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await getClusters(BASE);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters`,
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(result).toEqual(clusters);
    });

    it('strips trailing slash from base URL', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response('[]', { status: 200 })
      );

      await getClusters(`${BASE}/`);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters`,
        expect.any(Object)
      );
    });

    it('throws BackendApiError on non-ok response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      const promise = getClusters(BASE);
      await expect(promise).rejects.toThrow(BackendApiError);
      await expect(promise).rejects.toMatchObject({
        status: 404,
        body: 'Not Found',
      });
    });

    it('does NOT open circuit breaker on 404 (BA-3 / test gaps)', async () => {
      resetBackendCircuit();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      await expect(getClusters(BASE)).rejects.toThrow(BackendApiError);
      expect(isBackendCircuitOpen()).toBe(false);
    });
  });

  describe('getTopology', () => {
    it('calls GET /api/v1/clusters/{clusterId}/topology', async () => {
      const graph = {
        schemaVersion: '1.0',
        nodes: [],
        edges: [],
        metadata: {
          clusterId: 'c1',
          generatedAt: new Date().toISOString(),
          layoutSeed: 's1',
          isComplete: true,
          warnings: [],
        },
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(graph), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await getTopology(BASE, 'c1');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters/c1/topology`,
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(result).toEqual(graph);
    });

    it('appends namespace query when provided', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: '1.0',
            nodes: [],
            edges: [],
            metadata: { clusterId: 'c1', generatedAt: '', layoutSeed: '', isComplete: true, warnings: [] },
          }),
          { status: 200 }
        )
      );

      await getTopology(BASE, 'c1', { namespace: 'default' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters/c1/topology?namespace=default`,
        expect.any(Object)
      );
    });
  });

  describe('getHealth', () => {
    it('calls GET /health', async () => {
      const health = { status: 'healthy', service: 'kubilitics-backend' };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(health), { status: 200 })
      );

      const result = await getHealth(BASE);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/health`,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toEqual(health);
    });
  });

  describe('getKCLITUIState', () => {
    it('calls GET /api/v1/clusters/{clusterId}/kcli/tui/state', async () => {
      const state = {
        clusterId: 'c1',
        clusterName: 'prod',
        context: 'prod-us-east-1',
        namespace: 'default',
        kcliAvailable: true,
        kcliShellModeAllowed: true,
        aiEnabled: true,
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(state), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await getKCLITUIState(BASE, 'c1');
      expect(result).toEqual(state);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters/c1/kcli/tui/state`,
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  describe('createBackendApiClient', () => {
    it('returns bound getClusters and getTopology', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(new Response('[]', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              schemaVersion: '1.0',
              nodes: [],
              edges: [],
              metadata: { clusterId: 'c1', generatedAt: '', layoutSeed: '', isComplete: true, warnings: [] },
            }),
            { status: 200 }
          )
        );

      const client = createBackendApiClient(BASE);
      await client.getClusters();
      await client.getTopology('c1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters`,
        expect.any(Object)
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters/c1/topology`,
        expect.any(Object)
      );
    });

    it('returns bound getKCLITUIState', async () => {
      const state = {
        clusterId: 'c1',
        clusterName: 'prod',
        context: 'prod-us-east-1',
        namespace: 'default',
        kcliAvailable: true,
        kcliShellModeAllowed: true,
        aiEnabled: false,
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify(state), { status: 200 })
      );

      const client = createBackendApiClient(BASE);
      const result = await client.getKCLITUIState('c1');
      expect(result).toEqual(state);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/v1/clusters/c1/kcli/tui/state`,
        expect.any(Object)
      );
    });
  });
});
