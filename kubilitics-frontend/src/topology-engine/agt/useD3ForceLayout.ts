/**
 * useD3ForceLayout – Stable force simulation for Cosmos mode
 *
 * Runs d3.forceSimulation synchronously to completion (simulation.tick(300))
 * then sets positions ONCE. No per-tick re-renders = zero flickering.
 * Reheat runs async but throttled to 5fps max.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Node, Edge } from '@xyflow/react';

interface AGTNodeData {
  topologyNode: {
    id: string;
    kind: string;
    namespace: string;
    name: string;
    [key: string]: unknown;
  };
  selected?: boolean;
}

interface D3SimNode extends d3.SimulationNodeDatum {
  id: string;
  namespace: string;
  kind: string;
  width: number;
  height: number;
}

interface D3SimLink extends d3.SimulationLinkDatum<D3SimNode> {
  id: string;
}

interface ForceLayoutOptions {
  chargeStrength?: number;
  linkDistance?: number;
  linkStrength?: number;
  clusterStrength?: number;
  collisionPadding?: number;
  centerStrength?: number;
}

interface NamespaceCentroid {
  namespace: string;
  x: number;
  y: number;
  count: number;
}

interface ForceLayoutResult {
  nodes: Node<AGTNodeData>[];
  isSimulating: boolean;
  reheat: () => void;
  namespaceCentroids: NamespaceCentroid[];
}

const NODE_WIDTHS: Record<string, number> = {
  Pod: 170,
  Node: 210,
  Namespace: 220,
  Service: 188,
  Ingress: 188,
  NetworkPolicy: 188,
};
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;
const POD_HEIGHT = 38;

function getNodeDimensions(kind: string): { width: number; height: number } {
  const width = NODE_WIDTHS[kind] ?? DEFAULT_WIDTH;
  const height = kind === 'Pod' ? POD_HEIGHT : DEFAULT_HEIGHT;
  return { width, height };
}

function computeCentroids(d3Nodes: D3SimNode[]): NamespaceCentroid[] {
  const map = new Map<string, { x: number; y: number; count: number }>();
  for (const n of d3Nodes) {
    const ns = n.namespace || '';
    if (!ns) continue;
    const c = map.get(ns);
    if (c) { c.x += n.x!; c.y += n.y!; c.count++; }
    else map.set(ns, { x: n.x!, y: n.y!, count: 1 });
  }
  const result: NamespaceCentroid[] = [];
  for (const [ns, c] of map) {
    result.push({ namespace: ns, x: c.x / c.count, y: c.y / c.count, count: c.count });
  }
  return result;
}

function applyPositions(
  rfNodes: Node<AGTNodeData>[],
  d3Nodes: D3SimNode[],
): Node<AGTNodeData>[] {
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of d3Nodes) {
    positions.set(n.id, { x: n.x!, y: n.y! });
  }
  return rfNodes.map(n => {
    const pos = positions.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}

// Adaptive defaults based on node count — prevents clutter at scale
function adaptiveDefaults(nodeCount: number): Required<ForceLayoutOptions> {
  if (nodeCount <= 20) {
    return { chargeStrength: -500, linkDistance: 160, linkStrength: 0.35, clusterStrength: 0.12, collisionPadding: 30, centerStrength: 0.04 };
  }
  if (nodeCount <= 80) {
    return { chargeStrength: -350, linkDistance: 130, linkStrength: 0.3, clusterStrength: 0.2, collisionPadding: 25, centerStrength: 0.03 };
  }
  if (nodeCount <= 200) {
    return { chargeStrength: -250, linkDistance: 100, linkStrength: 0.25, clusterStrength: 0.3, collisionPadding: 18, centerStrength: 0.025 };
  }
  // 200+ nodes: tighter packing, stronger clustering
  return { chargeStrength: -180, linkDistance: 80, linkStrength: 0.2, clusterStrength: 0.4, collisionPadding: 12, centerStrength: 0.02 };
}

export function useD3ForceLayout(
  rfNodes: Node<AGTNodeData>[],
  rfEdges: Edge[],
  enabled: boolean,
  options: ForceLayoutOptions = {},
): ForceLayoutResult {
  const defaults = adaptiveDefaults(rfNodes.length);
  const {
    chargeStrength = defaults.chargeStrength,
    linkDistance = defaults.linkDistance,
    linkStrength = defaults.linkStrength,
    clusterStrength = defaults.clusterStrength,
    collisionPadding = defaults.collisionPadding,
    centerStrength = defaults.centerStrength,
  } = options;

  const simulationRef = useRef<d3.Simulation<D3SimNode, D3SimLink> | null>(null);
  const d3NodesRef = useRef<D3SimNode[]>([]);
  const [layoutNodes, setLayoutNodes] = useState<Node<AGTNodeData>[]>(rfNodes);
  const [isSimulating, setIsSimulating] = useState(false);
  const [namespaceCentroids, setNamespaceCentroids] = useState<NamespaceCentroid[]>([]);
  const rfNodesRef = useRef(rfNodes);
  rfNodesRef.current = rfNodes;

  // Run simulation synchronously on input change
  useEffect(() => {
    if (!enabled || rfNodes.length === 0) {
      if (simulationRef.current) { simulationRef.current.stop(); simulationRef.current = null; }
      setLayoutNodes(rfNodes);
      setIsSimulating(false);
      return;
    }

    setIsSimulating(true);

    // Preserve previous positions
    const prevPos = new Map<string, { x: number; y: number }>();
    for (const n of d3NodesRef.current) {
      if (n.x !== undefined && n.y !== undefined) prevPos.set(n.id, { x: n.x, y: n.y });
    }

    // Scale canvas area with node count to prevent cramming
    const scaleFactor = Math.max(1, Math.sqrt(rfNodes.length / 20));
    const W = Math.round(1400 * scaleFactor);
    const H = Math.round(900 * scaleFactor);

    const d3Nodes: D3SimNode[] = rfNodes.map(n => {
      const dims = getNodeDimensions(n.data.topologyNode.kind);
      const prev = prevPos.get(n.id);
      return {
        id: n.id,
        namespace: n.data.topologyNode.namespace || '',
        kind: n.data.topologyNode.kind,
        width: dims.width,
        height: dims.height,
        x: prev?.x ?? W / 2 + (Math.random() - 0.5) * 800,
        y: prev?.y ?? H / 2 + (Math.random() - 0.5) * 600,
      };
    });
    d3NodesRef.current = d3Nodes;

    const nodeIndex = new Map<string, D3SimNode>();
    for (const n of d3Nodes) nodeIndex.set(n.id, n);

    const d3Links: D3SimLink[] = rfEdges
      .filter(e => nodeIndex.has(e.source) && nodeIndex.has(e.target))
      .map(e => ({ id: e.id, source: e.source, target: e.target }));

    if (simulationRef.current) simulationRef.current.stop();

    // Namespace clustering force
    const clusterForce = (alpha: number) => {
      const centers = new Map<string, { x: number; y: number; count: number }>();
      for (const n of d3Nodes) {
        const ns = n.namespace || '__default__';
        const c = centers.get(ns);
        if (c) { c.x += n.x!; c.y += n.y!; c.count++; }
        else centers.set(ns, { x: n.x!, y: n.y!, count: 1 });
      }
      for (const c of centers.values()) { c.x /= c.count; c.y /= c.count; }
      for (const n of d3Nodes) {
        const ns = n.namespace || '__default__';
        const center = centers.get(ns);
        if (center && center.count > 1) {
          n.vx! += (center.x - n.x!) * alpha * clusterStrength;
          n.vy! += (center.y - n.y!) * alpha * clusterStrength;
        }
      }
    };

    const simulation = d3.forceSimulation<D3SimNode, D3SimLink>(d3Nodes)
      .force('link', d3.forceLink<D3SimNode, D3SimLink>(d3Links)
        .id(d => d.id).distance(linkDistance).strength(linkStrength))
      .force('charge', d3.forceManyBody<D3SimNode>()
        .strength(chargeStrength).distanceMax(Math.max(600, W * 0.5)))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide<D3SimNode>()
        .radius(d => Math.max(d.width, d.height) / 2 + collisionPadding).strength(0.95))
      .force('cluster', clusterForce)
      .force('x', d3.forceX(W / 2).strength(centerStrength))
      .force('y', d3.forceY(H / 2).strength(centerStrength))
      .stop(); // IMPORTANT: stop auto-ticking

    // Run simulation synchronously — NO per-tick re-renders
    // Scale ticks: small graphs settle fast, large graphs need more iterations
    const tickCount = rfNodes.length <= 50 ? 300 : rfNodes.length <= 200 ? 400 : 500;
    simulation.tick(tickCount);

    // Set positions ONCE
    setLayoutNodes(applyPositions(rfNodesRef.current, d3Nodes));
    setNamespaceCentroids(computeCentroids(d3Nodes));
    setIsSimulating(false);

    simulationRef.current = simulation;

    return () => { simulation.stop(); };
  }, [enabled, rfNodes.length, rfEdges.length, chargeStrength, linkDistance, linkStrength, clusterStrength, collisionPadding, centerStrength]);

  // Sync selected state without re-running simulation
  useEffect(() => {
    if (!enabled) return;
    setLayoutNodes(prev =>
      prev.map(n => {
        const source = rfNodesRef.current.find(rn => rn.id === n.id);
        if (source && source.data.selected !== n.data.selected) {
          return { ...n, data: { ...n.data, selected: source.data.selected } };
        }
        return n;
      }),
    );
  }, [enabled, rfNodes]);

  const reheat = useCallback(() => {
    const sim = simulationRef.current;
    const d3Nodes = d3NodesRef.current;
    if (!sim || d3Nodes.length === 0) return;

    setIsSimulating(true);

    // Re-run synchronously with fresh alpha
    sim.alpha(0.8);
    sim.tick(200);

    setLayoutNodes(applyPositions(rfNodesRef.current, d3Nodes));
    setNamespaceCentroids(computeCentroids(d3Nodes));
    setIsSimulating(false);
  }, []);

  return {
    nodes: enabled ? layoutNodes : rfNodes,
    isSimulating,
    reheat,
    namespaceCentroids,
  };
}
