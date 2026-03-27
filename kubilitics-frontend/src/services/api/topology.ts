/**
 * Topology endpoints (getTopology, getResourceTopology, getTopologyV2, getTopologyExportDrawio).
 */
import { adaptTopologyGraph, validateTopologyGraph } from '@/topology-engine';
import { backendRequest } from './client';
import type { TopologyGraph } from './types';

/**
 * GET /api/v1/clusters/{clusterId}/topology — get topology graph.
 * Optional query: namespace, resource_types, depth.
 */
export async function getTopology(
  baseUrl: string,
  clusterId: string,
  params?: { namespace?: string; resource_types?: string[]; depth?: number }
): Promise<TopologyGraph> {
  const search = new URLSearchParams();
  if (params?.namespace) search.set('namespace', params.namespace);
  if (params?.resource_types?.length)
    params.resource_types.forEach((t) => search.append('resource_types', t));
  if (params?.depth !== undefined && params.depth >= 0) search.set('depth', String(params.depth));
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/topology${query ? `?${query}` : ''}`;

  try {
    const result = await backendRequest<unknown>(baseUrl, path);

    if (!result) {
      throw new Error('Empty response from topology API');
    }

    // Transform backend format to frontend format
    const transformedGraph = adaptTopologyGraph(result);

    // Validate transformed graph
    const validation = validateTopologyGraph(transformedGraph);
    if (!validation.valid) {
      console.error('Topology graph validation failed:', validation.errors);
    }

    return transformedGraph;
  } catch (error) {
    console.error('Error fetching topology:', {
      baseUrl,
      clusterId,
      params,
      error,
    });
    throw error;
  }
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name} — resource-scoped topology.
 * For cluster-scoped resources (Node, PV, StorageClass) use namespace '-' or '_'.
 */
export async function getResourceTopology(
  baseUrl: string,
  clusterId: string,
  kind: string,
  namespace: string,
  name: string,
  depth = 3
): Promise<TopologyGraph> {
  const ns = namespace === '' ? '-' : namespace;
  const depthParam = depth > 0 ? `?depth=${depth}` : '';
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/resource/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}${depthParam}`;

  try {
    const result = await backendRequest<unknown>(baseUrl, path);
    if (!result) throw new Error('Empty response from topology API');

    const transformedGraph = adaptTopologyGraph(result);

    const validation = validateTopologyGraph(transformedGraph);
    if (!validation.valid) {
      console.error('[getResourceTopology] Graph validation errors:', validation.errors);
    }

    return transformedGraph;
  } catch (error) {
    console.error('[getResourceTopology] Failed:', { kind, namespace: ns, name, error });
    throw error;
  }
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/cluster — cluster topology API.
 * Query: mode, namespace, resource, depth, includeMetrics, includeHealth, includeCost.
 */
export async function getTopologyV2(
  baseUrl: string,
  clusterId: string,
  params?: { mode?: string; namespace?: string; resource?: string; depth?: number }
): Promise<import('@/topology/types/topology').TopologyResponse> {
  const search = new URLSearchParams();
  if (params?.mode) search.set('mode', params.mode);
  if (params?.namespace) search.set('namespace', params.namespace);
  if (params?.resource) search.set('resource', params.resource);
  if (params?.depth != null) search.set('depth', String(params.depth));
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/cluster${query ? `?${query}` : ''}`;
  return backendRequest(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/export/drawio
 * Returns { url: string, mermaid?: string } for opening topology in draw.io.
 */
export async function getTopologyExportDrawio(
  baseUrl: string,
  clusterId: string,
  params?: { format?: 'mermaid' | 'xml' }
): Promise<{ url: string; mermaid?: string }> {
  const search = new URLSearchParams();
  if (params?.format) search.set('format', params.format);
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/export/drawio${query ? `?${query}` : ''}`;
  const result = await backendRequest<{ url: string; mermaid?: string }>(baseUrl, path);
  if (!result?.url) throw new Error('Invalid draw.io export response');
  return result;
}
