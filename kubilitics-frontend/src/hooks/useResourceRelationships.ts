/**
 * useResourceRelationships — Fetches 1-hop relationship data for a resource.
 *
 * Calls GET /api/v1/clusters/{clusterId}/topology/resource/{kind}/{ns}/{name}
 * and extracts incoming + outgoing neighbors from the topology graph.
 *
 * Supports lazy loading: pass `enabled: false` and flip to `true` when the tab
 * becomes visible to avoid unnecessary API calls on page load.
 */
import { useQuery } from '@tanstack/react-query';
import { getResourceTopology } from '@/services/backendApiClient';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import type { TopologyGraph } from '@/topology/graph';

// ─── Public types ───────────────────────────────────────────────────────────

export interface RelationshipNeighbor {
  kind: string;
  name: string;
  namespace: string;
  /** Human-readable relationship label, e.g. "owns", "selects", "mounts" */
  type: string;
  /** Category of the relationship for edge coloring */
  category: string;
  /** Health status of the neighbor node */
  status: string;
}

export interface ResourceRelationships {
  /** Neighbors that point TO this resource (this resource is the target) */
  incoming: RelationshipNeighbor[];
  /** Neighbors that this resource points TO (this resource is the source) */
  outgoing: RelationshipNeighbor[];
  /** The center resource's category (for color coding) */
  centerCategory: string;
  /** The center resource's status */
  centerStatus: string;
}

export interface UseResourceRelationshipsOptions {
  kind: string;
  name: string;
  namespace?: string;
  /** Set to false to defer fetching until the tab is visible */
  enabled?: boolean;
}

export interface UseResourceRelationshipsResult {
  data: ResourceRelationships | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a node lookup id matching topology-engine format: Kind/ns/name or Kind/name */
function buildNodeId(kind: string, namespace: string, name: string): string {
  if (!namespace) return `${kind}/${name}`;
  return `${kind}/${namespace}/${name}`;
}

/**
 * Extract 1-hop incoming and outgoing neighbors from a topology graph
 * centered on the given nodeId.
 */
function extractRelationships(
  graph: TopologyGraph,
  kind: string,
  namespace: string,
  name: string,
): ResourceRelationships {
  const centerNodeId = buildNodeId(kind, namespace, name);

  // Build a fast node lookup
  const nodeMap = new Map<string, { kind: string; name: string; namespace: string; status: string; category: string }>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, {
      kind: n.kind,
      name: n.name,
      namespace: n.namespace ?? '',
      status: (n as Record<string, unknown>).status as string ?? (n.computed?.health ?? 'unknown'),
      category: (n as Record<string, unknown>).category as string ?? 'workload',
    });
  }

  const center = nodeMap.get(centerNodeId);

  const incoming: RelationshipNeighbor[] = [];
  const outgoing: RelationshipNeighbor[] = [];

  for (const edge of graph.edges) {
    // The topology-engine TopologyEdge has relationshipType and label fields.
    // We also handle any extra fields the backend may attach via a loose cast.
    const relType = edge.relationshipType ?? edge.label ?? 'related';
    const relCategory = (edge as Record<string, unknown>).relationshipCategory as string ?? 'containment';

    if (edge.source === centerNodeId) {
      const target = nodeMap.get(edge.target);
      if (target) {
        outgoing.push({
          kind: target.kind,
          name: target.name,
          namespace: target.namespace,
          type: relType,
          category: relCategory,
          status: target.status,
        });
      }
    } else if (edge.target === centerNodeId) {
      const source = nodeMap.get(edge.source);
      if (source) {
        incoming.push({
          kind: source.kind,
          name: source.name,
          namespace: source.namespace,
          type: relType,
          category: relCategory,
          status: source.status,
        });
      }
    }
  }

  return {
    incoming,
    outgoing,
    centerCategory: center?.category ?? 'workload',
    centerStatus: center?.status ?? 'unknown',
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useResourceRelationships({
  kind,
  name,
  namespace = '',
  enabled = true,
}: UseResourceRelationshipsOptions): UseResourceRelationshipsResult {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const normalizedKind = normalizeKindForTopology(kind);

  const queryEnabled =
    enabled &&
    !!clusterId &&
    isBackendConfigured() &&
    !!normalizedKind &&
    !!name;

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<ResourceRelationships, Error>({
    queryKey: ['resource-relationships', clusterId, normalizedKind, namespace, name],
    queryFn: async () => {
      if (!clusterId) throw new Error('Cluster not selected');
      if (!name) throw new Error('Resource name is required');

      // Depth=1 for 1-hop neighbors only
      const graph = await getResourceTopology(
        effectiveBaseUrl,
        clusterId,
        normalizedKind,
        namespace,
        name,
        1,
      );

      if (!graph || !Array.isArray(graph.nodes)) {
        throw new Error('Invalid topology response');
      }

      return extractRelationships(graph, normalizedKind, namespace, name);
    },
    enabled: queryEnabled,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 1000,
  });

  return {
    data,
    isLoading,
    error: error || null,
    refetch: () => { refetch(); },
  };
}
