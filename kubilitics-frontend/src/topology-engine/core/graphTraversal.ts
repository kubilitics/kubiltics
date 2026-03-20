/**
 * Graph Traversal – BFS/DFS for connected component discovery
 * Used for resource-specific topology (full connected subgraph)
 */
import { GraphModel } from './graphModel';
import type { TopologyNode, TopologyEdge } from '../types/topology.types';

/**
 * Get the full connected component containing the given node
 * Traverses both upstream (parents) and downstream (children)
 */
export function getConnectedComponent(
  model: GraphModel,
  startNodeId: string,
  maxDepth = 20
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const visitedNodes = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visitedNodes.has(id) || depth > maxDepth) continue;
    visitedNodes.add(id);

    // Traverse parents
    const parents = model.getParents(id);
    for (const p of parents) {
      if (!visitedNodes.has(p.id)) {
        queue.push({ id: p.id, depth: depth + 1 });
      }
    }

    // Traverse children
    const children = model.getChildren(id);
    for (const c of children) {
      if (!visitedNodes.has(c.id)) {
        queue.push({ id: c.id, depth: depth + 1 });
      }
    }
  }

  const nodes = Array.from(visitedNodes)
    .map(id => model.getNode(id))
    .filter((n): n is TopologyNode => n !== undefined);

  const edges = model.edges.filter(
    e => visitedNodes.has(e.source) && visitedNodes.has(e.target)
  );

  return { nodes, edges };
}

/**
 * Get upstream dependency chain (all ancestors)
 */
export function getUpstreamChain(
  model: GraphModel,
  startNodeId: string,
  maxDepth = 15
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);
    for (const p of model.getParents(id)) {
      if (!visited.has(p.id)) queue.push({ id: p.id, depth: depth + 1 });
    }
  }
  return visited;
}

/**
 * Get downstream dependent chain (all descendants)
 */
export function getDownstreamChain(
  model: GraphModel,
  startNodeId: string,
  maxDepth = 15
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);
    for (const c of model.getChildren(id)) {
      if (!visited.has(c.id)) queue.push({ id: c.id, depth: depth + 1 });
    }
  }
  return visited;
}
