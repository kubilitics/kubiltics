import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";
import type { TopologyResponse, ViewMode } from "../types/topology";

/**
 * useElkLayout — Performant topology layout engine.
 *
 * Three-tier strategy based on node count:
 * - Small (<80 nodes): ELK layered (right direction, hierarchical)
 * - Medium (80-300): ELK layered via web worker (non-blocking)
 * - Large (>300): Fast JS namespace-grouped grid (instant, no ELK)
 *
 * The ELK stress algorithm is avoided entirely — it's O(n³) and freezes
 * the browser for 500+ nodes even in a web worker.
 */

// ─── ELK Configuration ─────────────────────────────────────────────────────

const ELK_OPTIONS: Record<ViewMode, Record<string, string>> = {
  cluster: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  namespace: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "45",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  workload: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "45",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "70",
  },
  resource: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  rbac: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "60",
  },
};

const NODE_DIMS = { width: 230, height: 100 };

// ─── Types ──────────────────────────────────────────────────────────────────

interface ElkNode {
  id: string;
  width: number;
  height: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: Array<{ id: string; sources: string[]; targets: string[] }>;
}

interface ElkLayoutResult {
  children?: Array<{
    id: string;
    x: number;
    y: number;
    children?: Array<{ id: string; x: number; y: number }>;
  }>;
}

// ─── Fast namespace-grouped grid layout (for >300 nodes) ────────────────────

function fastGridLayout(
  topology: TopologyResponse
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const gapX = 260;
  const gapY = 130;

  // Group by namespace
  const groups = new Map<string, string[]>();
  for (const n of topology.nodes) {
    const ns = n.namespace || "__cluster__";
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns)!.push(n.id);
  }

  // Sort namespaces by size (largest first for visual balance)
  const sortedNs = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  // Layout each namespace in a block, flowing left-to-right
  // Use a grid-of-grids: namespace blocks arranged in rows of ~4 blocks
  const maxBlockCols = 4;
  let blockX = 0;
  let blockY = 0;
  let maxBlockHeight = 0;
  let blockColIdx = 0;

  for (const [, nodeIds] of sortedNs) {
    // Layout nodes within this namespace in a local grid
    const cols = Math.max(3, Math.ceil(Math.sqrt(nodeIds.length)));

    nodeIds.forEach((id, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.set(id, {
        x: blockX + col * gapX,
        y: blockY + row * gapY,
      });
    });

    const rows = Math.ceil(nodeIds.length / cols);
    const blockW = cols * gapX + 120;
    const blockH = rows * gapY + 80;
    maxBlockHeight = Math.max(maxBlockHeight, blockH);

    blockColIdx++;
    if (blockColIdx >= maxBlockCols) {
      // Move to next row of blocks
      blockColIdx = 0;
      blockX = 0;
      blockY += maxBlockHeight + 100;
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
  const layoutGenRef = useRef(0); // prevent stale layout writes

  // Lazily load ELK (only for small/medium graphs — large skip ELK entirely)
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
    return () => {
      cancelled = true;
    };
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

      if (nodeCount > 300) {
        // ─── FAST PATH: namespace-grouped grid (instant, no ELK) ────────
        positions = fastGridLayout(topology);
      } else if (elkRef.current) {
        // ─── ELK PATH: layered algorithm ────────────────────────────────
        const elkOptions = ELK_OPTIONS[viewMode];

        // Build ELK graph with namespace grouping for medium graphs (50-300)
        const useGrouping =
          (viewMode === "namespace" || viewMode === "workload") &&
          nodeCount >= 30;

        let elkGraph: ElkGraph;

        if (useGrouping) {
          const nsByNamespace = new Map<string, typeof topology.nodes>();
          for (const n of topology.nodes) {
            const ns = n.namespace || "__cluster__";
            if (!nsByNamespace.has(ns)) nsByNamespace.set(ns, []);
            nsByNamespace.get(ns)!.push(n);
          }

          const children: ElkNode[] = [];
          for (const [ns, nsNodes] of nsByNamespace) {
            children.push({
              id: `__ns__${ns}`,
              width: 0,
              height: 0,
              children: nsNodes.map((n) => ({
                id: n.id,
                width: NODE_DIMS.width,
                height: NODE_DIMS.height,
              })),
              layoutOptions: {
                "elk.algorithm": "layered",
                "elk.direction": "RIGHT",
                "elk.spacing.nodeNode": "25",
                "elk.layered.spacing.nodeNodeBetweenLayers": "60",
                "elk.padding": "[top=40,left=20,bottom=20,right=20]",
              },
            });
          }

          elkGraph = {
            id: "root",
            layoutOptions: {
              ...elkOptions,
              "elk.randomSeed": "42",
              "elk.hierarchyHandling": "INCLUDE_CHILDREN",
            },
            children,
            edges: validEdges.map((e) => ({
              id: e.id,
              sources: [e.source],
              targets: [e.target],
            })),
          };
        } else {
          elkGraph = {
            id: "root",
            layoutOptions: { ...elkOptions, "elk.randomSeed": "42" },
            children: topology.nodes.map((n) => ({
              id: n.id,
              width: NODE_DIMS.width,
              height: NODE_DIMS.height,
            })),
            edges: validEdges.map((e) => ({
              id: e.id,
              sources: [e.source],
              targets: [e.target],
            })),
          };
        }

        const result: ElkLayoutResult = await elkRef.current.layout(elkGraph);
        positions = new Map();

        if (useGrouping) {
          for (const group of result.children ?? []) {
            const gx = group.x ?? 0;
            const gy = group.y ?? 0;
            for (const child of group.children ?? []) {
              positions.set(child.id, { x: gx + child.x, y: gy + child.y });
            }
          }
        } else {
          for (const child of result.children ?? []) {
            positions.set(child.id, { x: child.x, y: child.y });
          }
        }
      } else {
        // ─── FALLBACK: simple grid ──────────────────────────────────────
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
  }, [topology, viewMode, elkReady]);

  useEffect(() => {
    computeLayout();
  }, [computeLayout]);

  // Cheap derivation: apply current nodeType to positioned nodes (runs on zoom)
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
    [
      "healthy",
      "Running",
      "Ready",
      "Bound",
      "Available",
      "Completed",
      "Active",
    ].includes(status)
  )
    return "healthy";
  if (["Pending", "warning", "PartiallyAvailable"].includes(status))
    return "warning";
  if (
    ["Failed", "error", "NotReady", "Lost", "CrashLoopBackOff"].includes(
      status
    )
  )
    return "error";
  return "unknown";
}
