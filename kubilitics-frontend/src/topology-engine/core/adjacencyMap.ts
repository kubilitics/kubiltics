/**
 * Adjacency Map – Fast O(1) neighbor lookups
 * Pre-computed adjacency for high-performance hover highlighting
 */
import type { TopologyEdge } from '../types/topology.types';

export class AdjacencyMap {
  private forward: Map<string, Set<string>> = new Map();  // source → targets
  private reverse: Map<string, Set<string>> = new Map();  // target → sources
  private edgeIndex: Map<string, Set<string>> = new Map(); // nodeId → edgeIds

  constructor(edges: TopologyEdge[]) {
    for (const edge of edges) {
      // Forward
      if (!this.forward.has(edge.source)) this.forward.set(edge.source, new Set());
      this.forward.get(edge.source)!.add(edge.target);

      // Reverse
      if (!this.reverse.has(edge.target)) this.reverse.set(edge.target, new Set());
      this.reverse.get(edge.target)!.add(edge.source);

      // Edge index
      if (!this.edgeIndex.has(edge.source)) this.edgeIndex.set(edge.source, new Set());
      this.edgeIndex.get(edge.source)!.add(edge.id);
      if (!this.edgeIndex.has(edge.target)) this.edgeIndex.set(edge.target, new Set());
      this.edgeIndex.get(edge.target)!.add(edge.id);
    }
  }

  /** Get immediate children (outgoing) */
  getChildren(nodeId: string): Set<string> {
    return this.forward.get(nodeId) || new Set();
  }

  /** Get immediate parents (incoming) */
  getParents(nodeId: string): Set<string> {
    return this.reverse.get(nodeId) || new Set();
  }

  /** Get full immediate neighborhood (parents + children + self) */
  getNeighborhood(nodeId: string): Set<string> {
    const result = new Set<string>([nodeId]);
    const children = this.forward.get(nodeId);
    const parents = this.reverse.get(nodeId);
    if (children) for (const c of children) result.add(c);
    if (parents) for (const p of parents) result.add(p);
    return result;
  }

  /** Get all edge IDs connected to a node */
  getEdgeIds(nodeId: string): Set<string> {
    return this.edgeIndex.get(nodeId) || new Set();
  }
}
