/**
 * Tests for src/services/api/topology.ts
 *
 * Covers: getTopology, getResourceTopology, getTopologyV2, getTopologyExportDrawio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBackendRequest = vi.fn();

vi.mock('./client', () => ({
  backendRequest: (...args: unknown[]) => mockBackendRequest(...args),
}));

const mockAdaptTopologyGraph = vi.fn();
const mockValidateTopologyGraph = vi.fn();

vi.mock('@/topology/graph', () => ({
  adaptTopologyGraph: (...args: unknown[]) => mockAdaptTopologyGraph(...args),
  validateTopologyGraph: (...args: unknown[]) => mockValidateTopologyGraph(...args),
}));

import {
  getTopology,
  getResourceTopology,
  getTopologyV2,
  getTopologyExportDrawio,
} from './topology';

const BASE = 'http://localhost:8190';
const CLUSTER = 'cluster-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateTopologyGraph.mockReturnValue({ valid: true, errors: [] });
});

// ============================================================================

describe('getTopology', () => {
  const rawGraph = { nodes: [{ id: '1' }], edges: [{ source: '1', target: '2' }] };
  const transformedGraph = { nodes: [{ id: '1', label: 'Pod' }], edges: [{ source: '1', target: '2' }] };

  it('returns transformed topology graph with nodes and edges', async () => {
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    const result = await getTopology(BASE, CLUSTER);

    expect(result).toEqual(transformedGraph);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology'
    );
    expect(mockAdaptTopologyGraph).toHaveBeenCalledWith(rawGraph);
    expect(mockValidateTopologyGraph).toHaveBeenCalledWith(transformedGraph);
  });

  it('passes namespace parameter', async () => {
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getTopology(BASE, CLUSTER, { namespace: 'kube-system' });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology?namespace=kube-system'
    );
  });

  it('passes resource_types parameters', async () => {
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getTopology(BASE, CLUSTER, { resource_types: ['Pod', 'Service'] });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('resource_types=Pod')
    );
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('resource_types=Service')
    );
  });

  it('passes depth parameter', async () => {
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getTopology(BASE, CLUSTER, { depth: 2 });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology?depth=2'
    );
  });

  it('does not add query string when no params provided', async () => {
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getTopology(BASE, CLUSTER);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology'
    );
  });

  it('throws when response is empty', async () => {
    mockBackendRequest.mockResolvedValue(null);

    await expect(getTopology(BASE, CLUSTER)).rejects.toThrow('Empty response from topology API');
  });

  it('throws when response is undefined', async () => {
    mockBackendRequest.mockResolvedValue(undefined);

    await expect(getTopology(BASE, CLUSTER)).rejects.toThrow('Empty response from topology API');
  });

  it('logs validation errors but still returns result', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockBackendRequest.mockResolvedValue(rawGraph);
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);
    mockValidateTopologyGraph.mockReturnValue({ valid: false, errors: ['orphan edge'] });

    const result = await getTopology(BASE, CLUSTER);

    expect(result).toEqual(transformedGraph);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Topology graph validation failed:',
      ['orphan edge']
    );
    consoleSpy.mockRestore();
  });

  it('propagates backend errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockBackendRequest.mockRejectedValue(new Error('Backend down'));

    await expect(getTopology(BASE, CLUSTER)).rejects.toThrow('Backend down');
    consoleSpy.mockRestore();
  });
});

describe('getResourceTopology', () => {
  const transformedGraph = { nodes: [{ id: 'pod-1' }], edges: [] };

  it('returns resource-scoped topology with kind/namespace/name', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [], edges: [] });
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    const result = await getResourceTopology(BASE, CLUSTER, 'Pod', 'default', 'my-pod');

    expect(result).toEqual(transformedGraph);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/resource/Pod/default/my-pod?depth=3'
    );
  });

  it('uses "-" sentinel for cluster-scoped resources', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [] });
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getResourceTopology(BASE, CLUSTER, 'Node', '', 'node-1');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/resource/Node/-/node-1?depth=3'
    );
  });

  it('uses custom depth', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [] });
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getResourceTopology(BASE, CLUSTER, 'Deployment', 'prod', 'web', 5);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/resource/Deployment/prod/web?depth=5'
    );
  });

  it('omits depth param when depth is 0', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [] });
    mockAdaptTopologyGraph.mockReturnValue(transformedGraph);

    await getResourceTopology(BASE, CLUSTER, 'Pod', 'default', 'p1', 0);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/resource/Pod/default/p1'
    );
  });

  it('throws on empty response', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockBackendRequest.mockResolvedValue(null);

    await expect(
      getResourceTopology(BASE, CLUSTER, 'Pod', 'default', 'missing')
    ).rejects.toThrow('Empty response from topology API');
    consoleSpy.mockRestore();
  });
});

describe('getTopologyV2', () => {
  it('calls cluster topology endpoint with no params', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [], edges: [] });

    await getTopologyV2(BASE, CLUSTER);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/cluster'
    );
  });

  it('passes mode and namespace params', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [] });

    await getTopologyV2(BASE, CLUSTER, { mode: 'namespace', namespace: 'prod' });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('mode=namespace')
    );
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('namespace=prod')
    );
  });

  it('passes depth param', async () => {
    mockBackendRequest.mockResolvedValue({ nodes: [] });

    await getTopologyV2(BASE, CLUSTER, { depth: 4 });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('depth=4')
    );
  });
});

describe('getTopologyExportDrawio', () => {
  it('returns URL for draw.io export', async () => {
    mockBackendRequest.mockResolvedValue({ url: 'https://drawio.example.com/edit' });

    const result = await getTopologyExportDrawio(BASE, CLUSTER);

    expect(result.url).toBe('https://drawio.example.com/edit');
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/export/drawio'
    );
  });

  it('passes format param', async () => {
    mockBackendRequest.mockResolvedValue({ url: 'https://example.com', mermaid: 'graph TD' });

    const result = await getTopologyExportDrawio(BASE, CLUSTER, { format: 'mermaid' });

    expect(result.mermaid).toBe('graph TD');
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/topology/export/drawio?format=mermaid'
    );
  });

  it('throws on invalid response (no URL)', async () => {
    mockBackendRequest.mockResolvedValue({});

    await expect(getTopologyExportDrawio(BASE, CLUSTER)).rejects.toThrow(
      'Invalid draw.io export response'
    );
  });

  it('throws on null response', async () => {
    mockBackendRequest.mockResolvedValue(null);

    await expect(getTopologyExportDrawio(BASE, CLUSTER)).rejects.toThrow();
  });
});
