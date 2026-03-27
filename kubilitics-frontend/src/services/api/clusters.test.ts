/**
 * Tests for src/services/api/clusters.ts
 *
 * Covers: getClusters, getClusterSummary, getClusterOverview, getWorkloadsOverview,
 * getCapabilities, discoverClusters, addCluster, addClusterWithUpload,
 * reconnectCluster, deleteCluster, getClusterFeatureMetallb.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('@/lib/tauri', () => ({ isTauri: () => false }));
vi.mock('@/stores/clusterStore', () => ({
  useClusterStore: { getState: () => ({ activeCluster: null, kubeconfigContent: null }) },
}));

const mockBackendRequest = vi.fn();
const mockResetBackendCircuit = vi.fn();

vi.mock('./client', () => ({
  backendRequest: (...args: unknown[]) => mockBackendRequest(...args),
  BackendApiError: class BackendApiError extends Error {
    status: number;
    responseBody?: string;
    constructor(msg: string, status: number, body?: string) {
      super(msg);
      this.status = status;
      this.responseBody = body;
      this.name = 'BackendApiError';
    }
  },
  API_PREFIX: '/api/v1',
  isBackendCircuitOpen: () => false,
  isNetworkError: () => false,
  isCORSError: () => false,
  isBackendEverReady: () => true,
  markBackendUnavailable: vi.fn(),
  resetBackendCircuit: (...args: unknown[]) => mockResetBackendCircuit(...args),
}));

import {
  getClusters,
  getClusterSummary,
  getClusterOverview,
  getWorkloadsOverview,
  getCapabilities,
  discoverClusters,
  addCluster,
  addClusterWithUpload,
  reconnectCluster,
  deleteCluster,
  getClusterFeatureMetallb,
} from './clusters';

const BASE = 'http://localhost:8190';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================

describe('getClusters', () => {
  it('returns an array of clusters', async () => {
    const clusters = [
      { id: 'c1', name: 'cluster-1', context: 'ctx1' },
      { id: 'c2', name: 'cluster-2', context: 'ctx2' },
    ];
    mockBackendRequest.mockResolvedValue(clusters);

    const result = await getClusters(BASE);

    expect(result).toEqual(clusters);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters');
  });

  it('returns empty array when no clusters exist', async () => {
    mockBackendRequest.mockResolvedValue([]);
    const result = await getClusters(BASE);
    expect(result).toEqual([]);
  });

  it('propagates errors from backendRequest', async () => {
    mockBackendRequest.mockRejectedValue(new Error('Network error'));
    await expect(getClusters(BASE)).rejects.toThrow('Network error');
  });
});

describe('getClusterSummary', () => {
  const summary = {
    id: 'c1',
    name: 'cluster-1',
    node_count: 3,
    namespace_count: 10,
    pod_count: 42,
    deployment_count: 5,
    service_count: 8,
    health_status: 'healthy',
  };

  it('returns summary data for a cluster', async () => {
    mockBackendRequest.mockResolvedValue(summary);

    const result = await getClusterSummary(BASE, 'c1');

    expect(result).toEqual(summary);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/summary');
  });

  it('appends projectId query param when provided', async () => {
    mockBackendRequest.mockResolvedValue(summary);

    await getClusterSummary(BASE, 'c1', 'proj-1');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/c1/summary?projectId=proj-1'
    );
  });

  it('omits projectId query param when not provided', async () => {
    mockBackendRequest.mockResolvedValue(summary);

    await getClusterSummary(BASE, 'c1');

    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/summary');
  });

  it('encodes special characters in clusterId', async () => {
    mockBackendRequest.mockResolvedValue(summary);

    await getClusterSummary(BASE, 'cluster with spaces');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster%20with%20spaces/summary'
    );
  });
});

describe('getClusterOverview', () => {
  const overview = {
    health: { score: 95, grade: 'A', status: 'healthy' },
    counts: { nodes: 3, pods: 42, namespaces: 10, deployments: 5 },
    pod_status: { running: 38, pending: 2, failed: 1, succeeded: 1 },
    alerts: { warnings: 2, critical: 0, top_3: [] },
  };

  it('returns overview data for a cluster', async () => {
    mockBackendRequest.mockResolvedValue(overview);

    const result = await getClusterOverview(BASE, 'c1');

    expect(result).toEqual(overview);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/overview');
  });

  it('propagates errors', async () => {
    mockBackendRequest.mockRejectedValue(new Error('500'));
    await expect(getClusterOverview(BASE, 'c1')).rejects.toThrow('500');
  });
});

describe('getWorkloadsOverview', () => {
  it('calls correct endpoint and returns data', async () => {
    const workloads = { deployments: [], daemonsets: [] };
    mockBackendRequest.mockResolvedValue(workloads);

    const result = await getWorkloadsOverview(BASE, 'c1');

    expect(result).toEqual(workloads);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/workloads');
  });
});

describe('getCapabilities', () => {
  it('returns capabilities data', async () => {
    const caps = { resource_topology_kinds: ['Pod', 'Deployment'] };
    mockBackendRequest.mockResolvedValue(caps);

    const result = await getCapabilities(BASE);

    expect(result).toEqual(caps);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'capabilities');
  });
});

describe('discoverClusters', () => {
  it('returns discovered clusters', async () => {
    const clusters = [{ id: 'new-1', name: 'discovered', context: 'ctx' }];
    mockBackendRequest.mockResolvedValue(clusters);

    const result = await discoverClusters(BASE);

    expect(result).toEqual(clusters);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/discover');
  });
});

describe('addCluster', () => {
  it('sends POST with kubeconfig path and context', async () => {
    const cluster = { id: 'c1', name: 'new-cluster', context: 'my-ctx' };
    mockBackendRequest.mockResolvedValue(cluster);

    const result = await addCluster(BASE, '/home/.kube/config', 'my-ctx');

    expect(result).toEqual(cluster);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters', {
      method: 'POST',
      body: JSON.stringify({
        kubeconfig_path: '/home/.kube/config',
        context: 'my-ctx',
      }),
    });
  });

  it('sends undefined context when empty string', async () => {
    mockBackendRequest.mockResolvedValue({ id: 'c1' });

    await addCluster(BASE, '/path', '');

    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters', {
      method: 'POST',
      body: JSON.stringify({
        kubeconfig_path: '/path',
        context: undefined,
      }),
    });
  });
});

describe('addClusterWithUpload', () => {
  it('sends POST with base64 kubeconfig', async () => {
    const cluster = { id: 'c2', name: 'uploaded', context: 'ctx' };
    mockBackendRequest.mockResolvedValue(cluster);

    const result = await addClusterWithUpload(BASE, 'base64data', 'ctx');

    expect(result).toEqual(cluster);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters', {
      method: 'POST',
      body: JSON.stringify({
        kubeconfig_base64: 'base64data',
        context: 'ctx',
      }),
    });
  });
});

describe('reconnectCluster', () => {
  it('resets circuit breaker and sends POST', async () => {
    const cluster = { id: 'c1', name: 'cluster-1', status: 'connected' };
    mockBackendRequest.mockResolvedValue(cluster);

    const result = await reconnectCluster(BASE, 'c1');

    expect(mockResetBackendCircuit).toHaveBeenCalledWith('c1');
    expect(result).toEqual(cluster);
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/reconnect', {
      method: 'POST',
    });
  });
});

describe('deleteCluster', () => {
  it('sends DELETE request for the cluster', async () => {
    mockBackendRequest.mockResolvedValue(undefined);

    await deleteCluster(BASE, 'c1');

    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1', {
      method: 'DELETE',
    });
  });
});

describe('getClusterFeatureMetallb', () => {
  it('returns metallb feature status', async () => {
    mockBackendRequest.mockResolvedValue({ installed: true });

    const result = await getClusterFeatureMetallb(BASE, 'c1');

    expect(result).toEqual({ installed: true });
    expect(mockBackendRequest).toHaveBeenCalledWith(BASE, 'clusters/c1/features/metallb');
  });

  it('returns false when metallb is not installed', async () => {
    mockBackendRequest.mockResolvedValue({ installed: false });

    const result = await getClusterFeatureMetallb(BASE, 'c1');

    expect(result.installed).toBe(false);
  });
});
