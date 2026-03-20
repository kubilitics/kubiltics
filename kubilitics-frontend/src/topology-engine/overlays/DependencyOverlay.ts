import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface DependencyMetrics {
  upstreamCount?: number;
  downstreamCount?: number;
  criticalityScore?: number;
  singlePointOfFailure?: boolean;
}

/**
 * Dependency Overlay Hook
 *
 * Computes dependency criticality scores based on:
 * - Number of upstream dependencies (incoming edges)
 * - Number of downstream dependents (outgoing edges)
 * - Relationship types and confidence scores
 * - Single points of failure detection
 *
 * Score mapping:
 * - 0-20: Low criticality (blue) - few dependencies
 * - 21-50: Moderate criticality (green) - normal dependencies
 * - 51-80: High criticality (orange) - many dependencies
 * - 81-100: Critical (red) - single point of failure
 */
export function useDependencyOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Dependency Overlay Computation');
    const nodeValues = new Map<string, number>();
    const edgeValues = new Map<string, number>();

    // Calculate dependency metrics for each node
    graph.nodes.forEach(node => {
      const upstreamEdges = graph.edges.filter(e => e.target === node.id);
      const downstreamEdges = graph.edges.filter(e => e.source === node.id);

      const upstreamCount = upstreamEdges.length;
      const downstreamCount = downstreamEdges.length;

      // Calculate criticality score
      let criticalityScore = 0;

      // Factor 1: Downstream dependent count (more dependents = more critical)
      criticalityScore += Math.min(50, downstreamCount * 5);

      // Factor 2: Upstream dependency count (more dependencies = less stable)
      criticalityScore += Math.min(30, upstreamCount * 3);

      // Factor 3: Relationship confidence and type
      const avgConfidence = upstreamEdges.length > 0
        ? upstreamEdges.reduce((sum, edge) => sum + (edge.metadata?.confidence ?? 0.5), 0) / upstreamEdges.length
        : 0;

      criticalityScore += avgConfidence * 20;

      // Factor 4: Single point of failure detection
      const isSPOF = detectSinglePointOfFailure(graph, node.id);
      if (isSPOF) {
        criticalityScore = 100; // Maximum criticality
      }

      nodeValues.set(node.id, Math.min(100, criticalityScore));
    });

    // Calculate edge criticality scores
    graph.edges.forEach(edge => {
      const edgeCriticality = calculateEdgeCriticality(edge, graph);
      edgeValues.set(`${edge.source}-${edge.target}`, edgeCriticality);
    });

    // Calculate aggregate metrics
    const criticalNodes = Array.from(nodeValues.values()).filter(v => v > 80).length;
    const spofCount = graph.nodes.filter(node => detectSinglePointOfFailure(graph, node.id)).length;

    if (import.meta.env?.DEV) console.timeEnd('Dependency Overlay Computation');
    return {
      type: 'dependency' as const,
      nodeValues,
      edgeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
        criticalNodes,
        singlePointsOfFailure: spofCount,
      },
    };
  }, [graph.nodes, graph.edges]);

  return overlayData;
}

/**
 * Detect if a node is a single point of failure
 *
 * A node is considered a SPOF if:
 * 1. It has many downstream dependents (>5)
 * 2. Those dependents have no alternative paths
 */
function detectSinglePointOfFailure(graph: TopologyGraph, nodeId: string): boolean {
  const downstreamEdges = graph.edges.filter(e => e.source === nodeId);

  // Must have significant downstream impact
  if (downstreamEdges.length < 5) return false;

  // Check if dependents have alternative paths
  for (const edge of downstreamEdges) {
    const alternativePaths = graph.edges.filter(
      e => e.target === edge.target && e.source !== nodeId && e.relationshipType === edge.relationshipType
    );

    // If any dependent has an alternative path, not a complete SPOF
    if (alternativePaths.length > 0) {
      return false;
    }
  }

  return true; // No alternatives found for any dependent
}

/**
 * Calculate edge criticality based on relationship type and confidence
 */
function calculateEdgeCriticality(edge: any, graph: TopologyGraph): number {
  // Relationship type weights (higher = more critical)
  const relationshipWeights: Record<string, number> = {
    'owns': 100,
    'selects': 90,
    'scheduled_on': 80,
    'mounts': 70,
    'routes_to': 65,
    'bound_to': 60,
    'consumes': 50,
    'allows': 40,
    'binds': 35,
    'uses': 30,
  };

  const baseWeight = relationshipWeights[edge.relationshipType] ?? 20;
  const confidence = edge.metadata?.confidence ?? 0.5;

  // Criticality = base weight * confidence
  return Math.min(100, baseWeight * confidence);
}

/**
 * Get color for dependency score
 */
export function getDependencyColor(score: number): string {
  if (score < 20) return '#2196F3'; // Blue - low criticality
  if (score < 50) return '#4CAF50'; // Green - moderate
  if (score < 80) return '#FF9800'; // Orange - high criticality
  return '#E53935'; // Red - critical/SPOF
}

/**
 * Get dependency label from score
 */
export function getDependencyLabel(score: number): string {
  if (score < 20) return 'Low Criticality';
  if (score < 50) return 'Moderate';
  if (score < 80) return 'High Criticality';
  return 'Critical (SPOF)';
}

/**
 * Find all upstream dependencies for a node
 */
export function getUpstreamChain(graph: TopologyGraph, nodeId: string, maxDepth: number = 5): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= maxDepth || visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);

    // Find upstream nodes (nodes that point to current)
    const upstreamEdges = graph.edges.filter(e => e.target === current.id);

    upstreamEdges.forEach(edge => {
      if (!visited.has(edge.source)) {
        queue.push({ id: edge.source, depth: current.depth + 1 });
      }
    });
  }

  visited.delete(nodeId); // Remove the starting node
  return visited;
}

/**
 * Find all downstream dependents for a node
 */
export function getDownstreamChain(graph: TopologyGraph, nodeId: string, maxDepth: number = 5): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= maxDepth || visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);

    // Find downstream nodes (nodes that current points to)
    const downstreamEdges = graph.edges.filter(e => e.source === current.id);

    downstreamEdges.forEach(edge => {
      if (!visited.has(edge.target)) {
        queue.push({ id: edge.target, depth: current.depth + 1 });
      }
    });
  }

  visited.delete(nodeId); // Remove the starting node
  return visited;
}
