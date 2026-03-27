/**
 * Topology graph core — types, models, traversal, and adapters.
 * Extracted from the legacy topology-engine (cytoscape-based).
 * These utilities are renderer-agnostic and used by both the main
 * xyflow topology and the resource-scoped topology views.
 */

// Types
export type {
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  KubernetesKind,
  HealthStatus,
  RelationshipType,
  AbstractionLevel,
} from './types/topology.types';
export { ABSTRACTION_LEVELS } from './types/topology.types';

// Core graph model
export { GraphModel } from './core/graphModel';
export { AdjacencyMap } from './core/adjacencyMap';
export { getConnectedComponent, getUpstreamChain, getDownstreamChain } from './core/graphTraversal';

// Adapters
export { adaptTopologyGraph, validateTopologyGraph } from './utils/topologyAdapter';

// Export utilities
export { downloadFile } from './utils/exportUtils';
