/**
 * Abstraction Engine – Applies abstraction levels to the graph
 * Filters nodes/edges based on L0-L3 visibility rules
 */
import type {
  TopologyGraph, TopologyNode, TopologyEdge,
  AbstractionLevel, KubernetesKind, HealthStatus, RelationshipType,
} from '../types/topology.types';
import { ABSTRACTION_LEVELS } from '../types/topology.types';

export interface FilterOptions {
  abstractionLevel: AbstractionLevel;
  selectedKinds: Set<KubernetesKind>;
  selectedRelationships: Set<RelationshipType>;
  selectedHealth: Set<HealthStatus | 'pending'>;
  searchQuery: string;
  namespace?: string;
}

export interface FilteredGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  visibleNodeIds: Set<string>;
}

/**
 * Apply abstraction, resource, health, and search filters to a graph
 */
export function applyAbstraction(graph: TopologyGraph, options: FilterOptions): FilteredGraph {
  const {
    abstractionLevel,
    selectedKinds,
    selectedRelationships,
    selectedHealth,
    searchQuery,
    namespace,
  } = options;

  const hiddenKinds = ABSTRACTION_LEVELS[abstractionLevel].hiddenKinds;
  const searchLower = searchQuery.toLowerCase();
  const visibleNodeIds = new Set<string>();
  const filteredNodes: TopologyNode[] = [];

  let skippedByAbstraction = 0;
  let skippedByKind = 0;
  let skippedByHealth = 0;
  let skippedByNamespace = 0;
  let skippedBySearch = 0;

  for (const node of graph.nodes) {
    // Abstraction level filter
    if (hiddenKinds.has(node.kind)) {
      skippedByAbstraction++;
      continue;
    }

    // Resource kind filter
    if (!selectedKinds.has(node.kind)) {
      skippedByKind++;
      continue;
    }

    // Health filter
    if (selectedHealth.size > 0 && !selectedHealth.has(node.computed?.health)) {
      skippedByHealth++;
      continue;
    }

    // Namespace filter
    if (namespace && namespace !== 'all' && node.namespace && node.namespace !== namespace) {
      skippedByNamespace++;
      continue;
    }

    // Search filter
    if (searchQuery) {
      const match =
        node.name.toLowerCase().includes(searchLower) ||
        node.kind.toLowerCase().includes(searchLower) ||
        (node.namespace || '').toLowerCase().includes(searchLower);
      if (!match) {
        skippedBySearch++;
        continue;
      }
    }

    visibleNodeIds.add(node.id);
    filteredNodes.push(node);
  }

  // Filter edges: both endpoints visible + relationship type selected
  const filteredEdges: TopologyEdge[] = [];
  let skippedEdgesByVisibility = 0;
  let skippedEdgesByRelationship = 0;

  for (const edge of graph.edges) {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      skippedEdgesByVisibility++;
      continue;
    }
    if (!selectedRelationships.has(edge.relationshipType)) {
      skippedEdgesByRelationship++;
      continue;
    }
    filteredEdges.push(edge);
  }

  // Warn when every node is filtered out (usually a misconfigured filter)
  if (graph.nodes.length > 0 && filteredNodes.length === 0) {
    console.warn(
      `[applyAbstraction] All ${graph.nodes.length} nodes filtered out` +
      ` (abstraction=${skippedByAbstraction}, kind=${skippedByKind}, health=${skippedByHealth}` +
      `, namespace=${skippedByNamespace}, search=${skippedBySearch})`,
    );
  }

  return { nodes: filteredNodes, edges: filteredEdges, visibleNodeIds };
}

/**
 * Check if graph is large enough to auto-switch abstraction
 */
export function getRecommendedAbstraction(nodeCount: number): AbstractionLevel {
  if (nodeCount > 500) return 'L0';
  if (nodeCount > 200) return 'L1';
  if (nodeCount > 50) return 'L2';
  return 'L3';
}
