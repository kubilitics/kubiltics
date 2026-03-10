import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";
import type { TopologyResponse, ViewMode } from "../types/topology";

/**
 * ELK Layout Configuration per view mode.
 *
 * Two tiers:
 * - Small graphs (<200 nodes): `layered` with RIGHT direction for clean hierarchy
 * - Large graphs (>=200 nodes): `stress` for better 2D spread (avoids thin vertical strip)
 */

const ELK_SMALL: Record<ViewMode, Record<string, string>> = {
  cluster: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "140",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  namespace: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  workload: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  resource: {
    "elk.algorithm": "force",
    "elk.spacing.nodeNode": "100",
    "elk.force.iterations": "300",
  },
  rbac: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "60",
  },
};

const ELK_LARGE: Record<ViewMode, Record<string, string>> = {
  cluster: {
    "elk.algorithm": "stress",
    "elk.stress.desiredEdgeLength": "220",
    "elk.spacing.nodeNode": "80",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "100",
  },
  namespace: {
    "elk.algorithm": "stress",
    "elk.stress.desiredEdgeLength": "200",
    "elk.spacing.nodeNode": "60",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "100",
  },
  workload: {
    "elk.algorithm": "stress",
    "elk.stress.desiredEdgeLength": "200",
    "elk.spacing.nodeNode": "60",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
  resource: {
    "elk.algorithm": "force",
    "elk.spacing.nodeNode": "140",
    "elk.force.iterations": "400",
  },
  rbac: {
    "elk.algorithm": "stress",
    "elk.stress.desiredEdgeLength": "180",
    "elk.spacing.nodeNode": "60",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "80",
  },
};

function getElkOptions(viewMode: ViewMode, nodeCount: number): Record<string, string> {
  return nodeCount >= 200 ? ELK_LARGE[viewMode] : ELK_SMALL[viewMode];
}

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  base: { width: 230, height: 100 },
  compact: { width: 180, height: 55 },
  expanded: { width: 300, height: 200 },
  minimal: { width: 40, height: 50 },
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
  children?: Array<{ id: string; x: number; y: number; children?: Array<{ id: string; x: number; y: number }> }>;
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
    const nodeCount = topology.nodes.length;
    const dims = NODE_DIMENSIONS.base;
    const elkOptions = getElkOptions(viewMode, nodeCount);

    // Build namespace groups for namespace/workload view with compound layout
    const useGrouping = (viewMode === "namespace" || viewMode === "workload") && nodeCount >= 20 && nodeCount < 500;
    let elkGraph: ElkGraph;

    if (useGrouping) {
      // Group nodes by namespace for compound ELK layout
      const nsByNamespace = new Map<string, typeof topology.nodes>();
      for (const n of topology.nodes) {
        const ns = n.namespace || "__cluster__";
        if (!nsByNamespace.has(ns)) nsByNamespace.set(ns, []);
        nsByNamespace.get(ns)!.push(n);
      }

      const children: ElkNode[] = [];
      const nodeToGroup = new Map<string, string>();

      for (const [ns, nsNodes] of nsByNamespace) {
        const groupId = `__ns__${ns}`;
        const group: ElkNode = {
          id: groupId,
          width: 0,
          height: 0,
          children: nsNodes.map((n) => {
            nodeToGroup.set(n.id, groupId);
            return { id: n.id, width: dims.width, height: dims.height };
          }),
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.spacing.nodeNode": "30",
            "elk.layered.spacing.nodeNodeBetweenLayers": "80",
            "elk.padding": "[top=40,left=20,bottom=20,right=20]",
          },
        };
        children.push(group);
      }

      // Only include edges where both ends are in the graph
      const nodeIds = new Set(topology.nodes.map((n) => n.id));
      const validEdges = topology.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

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
      // Flat layout for small graphs or very large graphs (grouping too expensive)
      const nodeIds = new Set(topology.nodes.map((n) => n.id));
      const validEdges = topology.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      elkGraph = {
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
    }

    try {
      let positions: Map<string, { x: number; y: number }>;

      if (elkRef.current) {
        const result: ElkLayoutResult = await elkRef.current.layout(elkGraph);
        positions = new Map();

        if (useGrouping) {
          // Extract positions from compound layout (groups → children)
          for (const group of result.children ?? []) {
            const groupX = group.x ?? 0;
            const groupY = group.y ?? 0;
            for (const child of group.children ?? []) {
              positions.set(child.id, { x: groupX + child.x, y: groupY + child.y });
            }
          }
        } else {
          for (const child of result.children ?? []) {
            positions.set(child.id, { x: child.x, y: child.y });
          }
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

/**
 * Fallback grid layout when ELK.js is not available.
 * Groups by layer for decent visual structure.
 */
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
  const gapX = dims.width + 80;
  const gapY = dims.height + 40;
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
