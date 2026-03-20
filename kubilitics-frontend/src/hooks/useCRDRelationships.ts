/**
 * useCRDRelationships — Hook that detects CRD-to-core-resource relationships
 * and returns additional topology edges.
 *
 * Uses CRDRelationshipMatcher to analyze ownerReferences and field references
 * from CRD instances, producing edges for the topology graph.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { TopologyNode, TopologyEdge } from '@/topology/types/topology';
import {
  CRDRelationshipMatcher,
  type CRDInstance,
  type DetectedRelationship,
} from '@/lib/crdRelationshipMatcher';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CRDRelationshipResult {
  /** Additional edges detected from CRD relationships */
  edges: TopologyEdge[];
  /** Raw detected relationships (for inspection/debugging) */
  relationships: DetectedRelationship[];
  /** Whether the detection is still loading */
  isLoading: boolean;
  /** Error if fetching CRD instances failed */
  error: Error | null;
}

// ─── API ────────────────────────────────────────────────────────────────────

const API_PREFIX = '/api/v1';

async function fetchCRDInstances(
  baseUrl: string,
  clusterId: string,
  namespace?: string,
): Promise<CRDInstance[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);

  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/crd-instances?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return []; // CRDs not available
    throw new Error(`Failed to fetch CRD instances: ${res.status}`);
  }
  const data = await res.json();
  return data.items ?? data ?? [];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCRDRelationships(
  clusterId: string | undefined,
  coreNodes: TopologyNode[],
  options?: {
    namespace?: string;
    enabled?: boolean;
  },
): CRDRelationshipResult {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const enabled = !!(
    isConfigured() &&
    clusterId &&
    coreNodes.length > 0 &&
    (options?.enabled !== false)
  );

  // Fetch CRD instances from the backend
  const query = useQuery({
    queryKey: ['crd-instances-all', clusterId ?? '', options?.namespace ?? ''],
    queryFn: () => fetchCRDInstances(baseUrl, clusterId!, options?.namespace),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Run the matcher whenever coreNodes or CRD instances change
  const { edges, relationships } = useMemo(() => {
    const instances = query.data ?? [];
    if (instances.length === 0 || coreNodes.length === 0) {
      return { edges: [] as TopologyEdge[], relationships: [] as DetectedRelationship[] };
    }

    const matcher = new CRDRelationshipMatcher(coreNodes);
    const detected = matcher.detectRelationships(instances);
    const topologyEdges = matcher.toTopologyEdges(detected);

    return { edges: topologyEdges, relationships: detected };
  }, [query.data, coreNodes]);

  return {
    edges,
    relationships,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
