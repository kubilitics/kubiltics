import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";
import type { TopologyResponse, ViewMode } from "../types/topology";
import { getNodeDims } from "../constants/designTokens";

/**
 * useElkLayout — Topology layout engine.
 *
 * Strategy:
 * - Up to 500 nodes: FLAT ELK layered (RIGHT direction, proper edge routing)
 * - 500+ nodes: Fast JS grid (instant, grouped by namespace)
 *
 * Key insight: FLAT layout (no compound grouping) gives proper edge routing
 * and horizontal spread. Compound grouping is only useful when showing
 * multiple namespaces and you want visual namespace boundaries — but it
 * breaks edge visibility and produces narrow vertical layouts.
 */

// ─── ELK Configuration ─────────────────────────────────────────────────────

const ELK_OPTIONS: Record<ViewMode, Record<string, string>> = {
  cluster: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "140",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "100",
  },
  namespace: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "45",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "100",
  },
  workload: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "45",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  resource: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "140",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "100",
  },
  rbac: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
};

// NODE_DIMS are now dynamic — imported from designTokens via getNodeDims(nodeType)

// ─── Types ──────────────────────────────────────────────────────────────────

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ id: string; sources: string[]; targets: string[] }>;
}

interface ElkLayoutResult {
  children?: Array<{ id: string; x: number; y: number }>;
}

// ─── Fast grid layout (for >500 nodes) ──────────────────────────────────────

function fastGridLayout(
  topology: TopologyResponse
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const gapX = 280;
  const gapY = 140;

  // Group by namespace
  const groups = new Map<string, string[]>();
  for (const n of topology.nodes) {
    const ns = n.namespace || "__cluster__";
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns)!.push(n.id);
  }

  const sortedNs = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  // Layout namespace blocks in rows of ~3
  const maxBlockCols = 3;
  let blockX = 0;
  let blockY = 0;
  let maxBlockHeight = 0;
  let blockColIdx = 0;

  for (const [, nodeIds] of sortedNs) {
    const cols = Math.max(4, Math.ceil(Math.sqrt(nodeIds.length * 1.5)));

    nodeIds.forEach((id, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.set(id, {
        x: blockX + col * gapX,
        y: blockY + row * gapY,
      });
    });

    const rows = Math.ceil(nodeIds.length / cols);
    const blockW = cols * gapX + 150;
    const blockH = rows * gapY + 100;
    maxBlockHeight = Math.max(maxBlockHeight, blockH);

    blockColIdx++;
    if (blockColIdx >= maxBlockCols) {
      blockColIdx = 0;
      blockX = 0;
      blockY += maxBlockHeight + 120;
      maxBlockHeight = 0;
    } else {
      blockX += blockW;
    }
  }

  return positions;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useElkLayout(
  topology: TopologyResponse | null,
  viewMode: ViewMode = "namespace",
  nodeType: string = "base"
) {
  const [positionedNodes, setPositionedNodes] = useState<
    Array<{ id: string; x: number; y: number; data: BaseNodeData }>
  >([]);
  const [layoutEdges, setLayoutEdges] = useState<Edge<LabeledEdgeData>[]>([]);
  const [isLayouting, setIsLayouting] = useState(false);
  const [elkReady, setElkReady] = useState(false);
  const elkRef = useRef<any>(null);
  const layoutGenRef = useRef(0);

  // Lazily load ELK
  useEffect(() => {
    let cancelled = false;
    import("elkjs/lib/elk.bundled.js")
      .then((mod) => {
        if (!cancelled) {
          elkRef.current = new mod.default();
          setElkReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setElkReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Main layout computation
  const computeLayout = useCallback(async () => {
    if (!topology?.nodes?.length) {
      setPositionedNodes([]);
      setLayoutEdges([]);
      return;
    }

    const gen = ++layoutGenRef.current;
    setIsLayouting(true);

    const nodeCount = topology.nodes.length;
    const nodeIds = new Set(topology.nodes.map((n) => n.id));
    const validEdges = topology.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    try {
      let positions: Map<string, { x: number; y: number }>;

      if (nodeCount > 500) {
        // ─── FAST PATH: grid layout (instant, no ELK) ───────────────────
        positions = fastGridLayout(topology);
      } else if (elkRef.current) {
        // ─── ELK PATH: FLAT layered layout ──────────────────────────────
        // Always use flat layout (no compound groups) — this gives proper
        // edge routing and horizontal spread. The layered algorithm uses
        // edges to determine layer assignment, so connected nodes end up
        // in adjacent layers flowing left-to-right.
        const elkOptions = ELK_OPTIONS[viewMode];

        const dims = getNodeDims(nodeType);
        const elkGraph: ElkGraph = {
          id: "root",
          layoutOptions: {
            ...elkOptions,
            "elk.randomSeed": "42",
          },
          children: topology.nodes.map((n) => ({
            id: n.id,
            width: dims.width,
            height: dims.height,
          })),
          edges: validEdges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
          })),
        };

        const result: ElkLayoutResult = await elkRef.current.layout(elkGraph);
        positions = new Map();
        for (const child of result.children ?? []) {
          positions.set(child.id, { x: child.x, y: child.y });
        }
      } else {
        // ─── FALLBACK: grid layout ──────────────────────────────────────
        positions = fastGridLayout(topology);
      }

      // Stale check
      if (gen !== layoutGenRef.current) return;

      const positioned = topology.nodes.map((tn) => {
        const pos = positions.get(tn.id) ?? { x: 0, y: 0 };
        return {
          id: tn.id,
          x: pos.x,
          y: pos.y,
          data: {
            kind: tn.kind,
            name: tn.name,
            namespace: tn.namespace || undefined,
            category: tn.category,
            status: mapStatus(tn.status),
            statusReason: tn.statusReason ?? tn.status,
            metrics: tn.metrics,
            labels: tn.labels,
            createdAt: tn.createdAt,
          } as BaseNodeData,
        };
      });

      const edges: Edge<LabeledEdgeData>[] = validEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "labeled",
        animated: e.animated ?? false,
        data: { label: e.label, detail: e.detail },
      }));

      setPositionedNodes(positioned);
      setLayoutEdges(edges);
    } catch (err) {
      console.warn("[useElkLayout] Layout failed, using fast grid:", err);
      if (gen !== layoutGenRef.current) return;

      const positions = fastGridLayout(topology);
      const positioned = topology.nodes.map((tn) => {
        const pos = positions.get(tn.id) ?? { x: 0, y: 0 };
        return {
          id: tn.id,
          x: pos.x,
          y: pos.y,
          data: {
            kind: tn.kind,
            name: tn.name,
            namespace: tn.namespace || undefined,
            category: tn.category,
            status: mapStatus(tn.status),
            statusReason: tn.statusReason ?? tn.status,
          } as BaseNodeData,
        };
      });
      setPositionedNodes(positioned);
      setLayoutEdges(
        validEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "labeled",
          data: { label: e.label, detail: e.detail },
        }))
      );
    } finally {
      if (gen === layoutGenRef.current) setIsLayouting(false);
    }
  }, [topology, viewMode, nodeType, elkReady]);

  useEffect(() => {
    computeLayout();
  }, [computeLayout]);

  // Apply nodeType (semantic zoom) without re-layout
  const nodes: Node<BaseNodeData>[] = useMemo(
    () =>
      positionedNodes.map((pn) => ({
        id: pn.id,
        type: nodeType,
        position: { x: pn.x, y: pn.y },
        data: pn.data,
      })),
    [positionedNodes, nodeType]
  );

  return { nodes, edges: layoutEdges, isLayouting };
}

function mapStatus(
  status: string
): "healthy" | "warning" | "error" | "unknown" {
  if (
    ["healthy", "Running", "Ready", "Bound", "Available", "Completed", "Active"].includes(status)
  )
    return "healthy";
  if (["Pending", "warning", "PartiallyAvailable"].includes(status))
    return "warning";
  if (["Failed", "error", "NotReady", "Lost", "CrashLoopBackOff"].includes(status))
    return "error";
  return "unknown";
}
