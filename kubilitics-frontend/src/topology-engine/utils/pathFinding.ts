import type { TopologyGraph, TopologyNode, TopologyEdge } from '../types/topology.types';

export interface PathNode {
  nodeId: string;
  edge?: TopologyEdge;
  depth: number;
}

export interface PathResult {
  paths: PathNode[][];
  shortestPath?: PathNode[];
  allNodes: Set<string>;
  allEdges: Set<string>;
}

/**
 * Find all paths between two nodes
 *
 * Uses BFS to find all possible paths from source to target
 *
 * @param graph - Topology graph
 * @param sourceId - Starting node ID
 * @param targetId - Destination node ID
 * @param maxDepth - Maximum path length (default: 5)
 * @returns All paths and metadata
 */
export function findAllPaths(
  graph: TopologyGraph,
  sourceId: string,
  targetId: string,
  maxDepth: number = 5
): PathResult {
  const paths: PathNode[][] = [];
  const allNodes = new Set<string>();
  const allEdges = new Set<string>();

  // DFS to find all paths
  function dfs(currentId: string, visited: Set<string>, path: PathNode[], depth: number) {
    if (depth > maxDepth) return;

    if (currentId === targetId) {
      // Found a path
      paths.push([...path]);
      path.forEach(node => allNodes.add(node.nodeId));
      return;
    }

    // Find outgoing edges
    const outgoingEdges = graph.edges.filter(e => e.source === currentId);

    for (const edge of outgoingEdges) {
      if (visited.has(edge.target)) continue; // Avoid cycles

      const newVisited = new Set(visited);
      newVisited.add(edge.target);

      const newPath = [...path, { nodeId: edge.target, edge, depth: depth + 1 }];

      dfs(edge.target, newVisited, newPath, depth + 1);
    }
  }

  // Start DFS
  dfs(sourceId, new Set([sourceId]), [{ nodeId: sourceId, depth: 0 }], 0);

  // Collect all edges in paths
  paths.forEach(path => {
    path.forEach(node => {
      if (node.edge) {
        allEdges.add(`${node.edge.source}-${node.edge.target}`);
      }
    });
  });

  // Find shortest path
  const shortestPath = paths.length > 0
    ? paths.reduce((shortest, current) => current.length < shortest.length ? current : shortest)
    : undefined;

  return { paths, shortestPath, allNodes, allEdges };
}

/**
 * Trace user journey from Ingress to Service to Pod
 *
 * This is a specialized path-finding function for tracing how
 * user requests flow through the system
 *
 * @param graph - Topology graph
 * @param ingressId - Ingress node ID (entry point)
 * @returns User journey path with annotations
 */
export function traceUserJourney(
  graph: TopologyGraph,
  ingressId: string
): PathResult & { annotations: Map<string, string> } {
  const annotations = new Map<string, string>();
  const allPaths: PathNode[][] = [];
  const allNodes = new Set<string>();
  const allEdges = new Set<string>();

  // BFS to follow routing relationships
  function bfs(startId: string, maxDepth: number = 5) {
    const queue: Array<{ nodeId: string; path: PathNode[]; depth: number }> = [
      { nodeId: startId, path: [{ nodeId: startId, depth: 0 }], depth: 0 }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) continue;
      if (visited.has(current.nodeId)) continue;

      visited.add(current.nodeId);
      allNodes.add(current.nodeId);

      const node = graph.nodes.find(n => n.id === current.nodeId);
      if (!node) continue;

      // Add annotation
      if (node.kind === 'Ingress') {
        annotations.set(node.id, '🌐 Entry Point: User traffic enters here');
      } else if (node.kind === 'Service') {
        annotations.set(node.id, '🔀 Load Balancer: Distributes traffic to pods');
      } else if (node.kind === 'Pod') {
        annotations.set(node.id, '📦 Compute: Application logic executes here');
      } else if (node.kind === 'Deployment') {
        annotations.set(node.id, '🎯 Controller: Manages pod replicas');
      }

      // Find relevant outgoing edges
      const relevantEdges = graph.edges.filter(e => {
        if (e.source !== current.nodeId) return false;

        // Follow specific relationship types for user journey
        const journeyRelationships = ['routes_to', 'selects', 'owns', 'scheduled_on'];
        return journeyRelationships.includes(e.relationshipType);
      });

      for (const edge of relevantEdges) {
        const newPath = [
          ...current.path,
          { nodeId: edge.target, edge, depth: current.depth + 1 }
        ];

        queue.push({
          nodeId: edge.target,
          path: newPath,
          depth: current.depth + 1,
        });

        allEdges.add(`${edge.source}-${edge.target}`);

        // If we reached a Pod, save the complete path
        const targetNode = graph.nodes.find(n => n.id === edge.target);
        if (targetNode?.kind === 'Pod') {
          allPaths.push(newPath);
        }
      }
    }
  }

  bfs(ingressId);

  // Find shortest user journey path
  const shortestPath = allPaths.length > 0
    ? allPaths.reduce((shortest, current) => current.length < shortest.length ? current : shortest)
    : undefined;

  return {
    paths: allPaths,
    shortestPath,
    allNodes,
    allEdges,
    annotations,
  };
}

/**
 * Find critical path (longest path from source to any leaf)
 *
 * Useful for identifying the deepest dependency chain
 */
export function findCriticalPath(
  graph: TopologyGraph,
  sourceId: string
): PathNode[] {
  let longestPath: PathNode[] = [];

  function dfs(currentId: string, visited: Set<string>, path: PathNode[], depth: number) {
    // Update longest path if current is longer
    if (path.length > longestPath.length) {
      longestPath = [...path];
    }

    // Find outgoing edges
    const outgoingEdges = graph.edges.filter(e => e.source === currentId);

    // If no outgoing edges, this is a leaf
    if (outgoingEdges.length === 0) {
      return;
    }

    for (const edge of outgoingEdges) {
      if (visited.has(edge.target)) continue;

      const newVisited = new Set(visited);
      newVisited.add(edge.target);

      const newPath = [...path, { nodeId: edge.target, edge, depth: depth + 1 }];

      dfs(edge.target, newVisited, newPath, depth + 1);
    }
  }

  dfs(sourceId, new Set([sourceId]), [{ nodeId: sourceId, depth: 0 }], 0);

  return longestPath;
}

/**
 * Find all nodes at a specific distance from source
 *
 * @param graph - Topology graph
 * @param sourceId - Starting node ID
 * @param distance - Target distance (number of hops)
 * @returns Set of node IDs at the specified distance
 */
export function findNodesAtDistance(
  graph: TopologyGraph,
  sourceId: string,
  distance: number
): Set<string> {
  const nodesAtDistance = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: sourceId, depth: 0 }];
  const visited = new Set<string>([sourceId]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth === distance) {
      nodesAtDistance.add(current.nodeId);
      continue; // Don't traverse further
    }

    if (current.depth > distance) {
      break; // BFS ensures we won't find any more at target distance
    }

    // Find neighbors
    const outgoingEdges = graph.edges.filter(e => e.source === current.nodeId);

    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ nodeId: edge.target, depth: current.depth + 1 });
      }
    }
  }

  return nodesAtDistance;
}

/**
 * Find shortest path using Dijkstra's algorithm
 *
 * Edge weights based on relationship confidence (lower confidence = higher cost)
 */
export function findShortestPath(
  graph: TopologyGraph,
  sourceId: string,
  targetId: string
): PathNode[] | null {
  const distances = new Map<string, number>();
  const previous = new Map<string, { nodeId: string; edge: TopologyEdge }>();
  const unvisited = new Set(graph.nodes.map(n => n.id));

  // Initialize distances
  graph.nodes.forEach(node => {
    distances.set(node.id, node.id === sourceId ? 0 : Infinity);
  });

  while (unvisited.size > 0) {
    // Find unvisited node with smallest distance
    let currentId: string | null = null;
    let minDistance = Infinity;

    unvisited.forEach(nodeId => {
      const dist = distances.get(nodeId) ?? Infinity;
      if (dist < minDistance) {
        minDistance = dist;
        currentId = nodeId;
      }
    });

    if (currentId === null || minDistance === Infinity) {
      break; // No path found
    }

    if (currentId === targetId) {
      break; // Reached target
    }

    unvisited.delete(currentId);

    // Update neighbors
    const outgoingEdges = graph.edges.filter(e => e.source === currentId);

    for (const edge of outgoingEdges) {
      if (!unvisited.has(edge.target)) continue;

      // Edge weight: inverse of confidence (lower confidence = higher cost)
      const confidence = edge.metadata?.confidence ?? 0.5;
      const edgeWeight = 1 / confidence;

      const currentDistance = distances.get(currentId!) ?? Infinity;
      const newDistance = currentDistance + edgeWeight;
      const existingDistance = distances.get(edge.target) ?? Infinity;

      if (newDistance < existingDistance) {
        distances.set(edge.target, newDistance);
        previous.set(edge.target, { nodeId: currentId!, edge });
      }
    }
  }

  // Reconstruct path
  if (!previous.has(targetId)) {
    return null; // No path found
  }

  const path: PathNode[] = [];
  let currentId: string | undefined = targetId;
  let depth = 0;

  while (currentId !== undefined) {
    const prev = previous.get(currentId);

    if (prev) {
      path.unshift({ nodeId: currentId, edge: prev.edge, depth });
      currentId = prev.nodeId;
      depth++;
    } else {
      // Reached source
      path.unshift({ nodeId: currentId, depth });
      break;
    }
  }

  return path;
}

/**
 * Get path summary statistics
 */
export function getPathSummary(path: PathNode[], graph: TopologyGraph): string {
  if (path.length === 0) return 'Empty path';

  const nodeKinds = path.map(p => {
    const node = graph.nodes.find(n => n.id === p.nodeId);
    return node?.kind ?? 'Unknown';
  });

  const pathDescription = nodeKinds.join(' → ');
  const hopCount = path.length - 1;

  return `${pathDescription} (${hopCount} hops)`;
}
