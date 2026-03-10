import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";
import type { TopologyResponse, ViewMode } from "../types/topology";

/**
 * ELK Layout Configuration per view mode.
 * ELK.js uses the Eclipse Layout Kernel for deterministic hierarchical layout.
 */
const ELK_OPTIONS: Record<ViewMode, Record<string, string>> = {
  cluster: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  },
  namespace: {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  },
  workload: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  },
  resource: {
    "elk.algorithm": "force",
    "elk.spacing.nodeNode": "80",
    "elk.force.iterations": "300",
  },
  rbac: {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  },
};

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  base: { width: 220, height: 90 },
  compact: { width: 160, height: 50 },
  expanded: { width: 280, height: 180 },
  minimal: { width: 30, height: 40 },
  group: { width: 300, height: 200 },
};

interface ElkNode {
  id: string;
  width: number;
  height: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkLayoutResult {
  children?: Array<{ id: string; x: number; y: number }>;
}

/**
 * useElkLayout: Computes ELK.js layout for topology nodes.
 * Falls back to simple grid layout if ELK is not available.
 * Uses a fixed seed for deterministic layout.
 *
 * IMPORTANT: Layout (positions) only recomputes when topology or viewMode changes.
 * nodeType (semantic zoom) only changes the `type` field on existing nodes —
 * no expensive re-layout. This keeps zoom smooth.
 */
export function useElkLayout(
  topology: TopologyResponse | null,
  viewMode: ViewMode = "namespace",
  nodeType: string = "base"
) {
  // Positions are computed once per topology/viewMode change using "base" dimensions.
  const [positionedNodes, setPositionedNodes] = useState<Array<{ id: string; x: number; y: number; data: BaseNodeData }>>([]);
  const [layoutEdges, setLayoutEdges] = useState<Edge<LabeledEdgeData>[]>([]);
  const [isLayouting, setIsLayouting] = useState(false);
  const elkRef = useRef<any>(null);

  // Lazily load ELK
  useEffect(() => {
    let cancelled = false;
    import("elkjs/lib/elk.bundled.js").then((mod) => {
      if (!cancelled) {
        elkRef.current = new mod.default();
      }
    }).catch(() => {
      // ELK not available, will use fallback
    });
    return () => { cancelled = true; };
  }, []);

  // Expensive layout — only runs when topology or viewMode changes, NOT on zoom
  const computeLayout = useCallback(async () => {
    if (!topology?.nodes?.length) {
      setPositionedNodes([]);
      setLayoutEdges([]);
      return;
    }

    setIsLayouting(true);
    const dims = NODE_DIMENSIONS.base; // Always layout with base dimensions for stability

    // Build ELK graph
    const elkGraph: ElkGraph = {
      id: "root",
      layoutOptions: {
        ...ELK_OPTIONS[viewMode],
        "elk.randomSeed": "42", // Deterministic layout
      },
      children: topology.nodes.map((n) => ({
        id: n.id,
        width: dims.width,
        height: dims.height,
      })),
      edges: topology.edges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    try {
      let positions: Map<string, { x: number; y: number }>;

      if (elkRef.current) {
        const result: ElkLayoutResult = await elkRef.current.layout(elkGraph);
        positions = new Map();
        for (const child of result.children ?? []) {
          positions.set(child.id, { x: child.x, y: child.y });
        }
      } else {
        positions = fallbackLayout(topology, dims);
      }

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

      const edges: Edge<LabeledEdgeData>[] = topology.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "labeled",
        animated: e.animated ?? false,
        data: { label: e.label, detail: e.detail },
      }));

      setPositionedNodes(positioned);
      setLayoutEdges(edges);
    } catch {
      const positions = fallbackLayout(topology, dims);
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
      setLayoutEdges(topology.edges.map((e) => ({
        id: e.id, source: e.source, target: e.target, type: "labeled",
        data: { label: e.label, detail: e.detail },
      })));
    } finally {
      setIsLayouting(false);
    }
  }, [topology, viewMode]); // NOTE: nodeType NOT in deps — zoom doesn't trigger re-layout

  useEffect(() => {
    computeLayout();
  }, [computeLayout]);

  // Cheap derivation: apply current nodeType to positioned nodes (runs on zoom change)
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

function fallbackLayout(
  topology: TopologyResponse,
  dims: { width: number; height: number }
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const byLayer = new Map<number, string[]>();
  for (const n of topology.nodes) {
    const layer = n.layer ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n.id);
  }
  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const gapX = dims.width + 60;
  const gapY = dims.height + 30;
  layers.forEach((layer, col) => {
    const ids = byLayer.get(layer)!;
    ids.forEach((id, row) => {
      positions.set(id, { x: col * gapX, y: row * gapY });
    });
  });
  return positions;
}

function mapStatus(status: string): "healthy" | "warning" | "error" | "unknown" {
  if (["healthy", "Running", "Ready", "Bound", "Available", "Completed", "Active"].includes(status))
    return "healthy";
  if (["Pending", "warning", "PartiallyAvailable"].includes(status)) return "warning";
  if (["Failed", "error", "NotReady", "Lost", "CrashLoopBackOff"].includes(status)) return "error";
  return "unknown";
}
