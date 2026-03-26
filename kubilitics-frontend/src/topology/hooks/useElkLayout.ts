import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { BaseNodeData } from "../nodes/BaseNode";
import type { LabeledEdgeData } from "../edges/LabeledEdge";
import type { TopologyResponse, ViewMode, TopologyNode } from "../types/topology";
import { getNodeDims } from "../constants/designTokens";

// ─── Layer Constraints ─────────────────────────────────────────────────────
// Map backend `layer` field (0-5) to ELK layer constraint properties.
// This helps ELK place nodes in the correct tier for architecture diagrams.

const LAYER_LABELS: Record<number, string> = {
  0: "Infrastructure",
  1: "Services",
  2: "Workloads",
  3: "Controllers",
  4: "Pods",
  5: "Nodes",
};

function getLayerConstraint(layer: number | undefined): Record<string, string> {
  if (layer == null) return {};
  // ELK uses integer layer IDs; lower = leftmost in LEFT-RIGHT direction
  return { "elk.layered.layerConstraint": String(layer) };
}

/**
 * useElkLayout — Topology layout engine.
 *
 * STRATEGY (smart algorithm selection):
 *
 * 1. HYBRID (default for medium graphs < 300 nodes):
 *    - Find connected components via BFS
 *    - Run ELK layered on each connected component (great for DAGs)
 *    - Arrange components + isolated nodes in a 2D grid
 *    → Best of both: proper edge routing for connected subgraphs,
 *      no vertical stacking of disconnected nodes
 *
 * 2. CATEGORY GRID (for large graphs 300+ or very sparse graphs):
 *    - Group nodes by K8s category (workload, networking, config, etc.)
 *    - Arrange categories left-to-right following K8s dependency flow
 *    - Grid layout within each category group
 *    → Instant layout, readable at any size
 *
 * 3. ELK FULL (for well-connected graphs with density > 0.8):
 *    - Full ELK layered as before
 *    → Only used when the graph is dense enough to benefit
 */

// ─── ELK Configuration ─────────────────────────────────────────────────────

const ELK_LAYERED_BASE: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "140",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.thoroughness": "20",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "80",
};

const ELK_OPTIONS: Record<ViewMode, Record<string, string>> = {
  namespace: { ...ELK_LAYERED_BASE },
  cluster:   { ...ELK_LAYERED_BASE, "elk.spacing.nodeNode": "70", "elk.layered.spacing.nodeNodeBetweenLayers": "160" },
  rbac:      { ...ELK_LAYERED_BASE, "elk.spacing.nodeNode": "70" },
  resource:  {
    ...ELK_LAYERED_BASE,
    // Resource topology: tighter layout centered around the focus resource.
    // Higher thoroughness for fewer edge crossings in smaller graphs.
    "elk.layered.thoroughness": "40",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "160",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    // Compact layout to avoid visual fragmentation
    "elk.layered.compaction.connectedComponents": "true",
    "elk.separateConnectedComponents": "false",
  },
};

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

// ─── K8s Category Order (left-to-right dependency flow) ─────────────────────
// This determines the horizontal positioning of category groups.
// Flow: Cluster → Workloads → Networking → Config → Storage → Security → Scaling

const CATEGORY_ORDER: Record<string, number> = {
  cluster:    0,
  scheduling: 1,
  compute:    2,
  workload:   2,
  networking: 3,
  config:     4,
  storage:    5,
  security:   6,
  rbac:       6,
  scaling:    7,
  custom:     8,
};

function categoryOrder(cat: string): number {
  return CATEGORY_ORDER[cat] ?? 8;
}

// ─── Connected Component Detection ─────────────────────────────────────────

interface ConnectedComponent {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

function findConnectedComponents(
  nodeIds: string[],
  edges: Array<{ id: string; source: string; target: string }>
): ConnectedComponent[] {
  const adj = new Map<string, Set<string>>();
  const edgeMap = new Map<string, Array<{ id: string; source: string; target: string }>>();

  for (const nid of nodeIds) {
    adj.set(nid, new Set());
  }
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
    if (!edgeMap.has(e.source)) edgeMap.set(e.source, []);
    if (!edgeMap.has(e.target)) edgeMap.set(e.target, []);
    edgeMap.get(e.source)!.push(e);
    edgeMap.get(e.target)!.push(e);
  }

  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];

  for (const nid of nodeIds) {
    if (visited.has(nid)) continue;

    const component: ConnectedComponent = { nodeIds: new Set(), edgeIds: new Set() };
    const queue = [nid];
    visited.add(nid);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.nodeIds.add(current);

      // Add edges for this node
      for (const e of edgeMap.get(current) ?? []) {
        component.edgeIds.add(e.id);
      }

      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components;
}

// ─── Category-grouped Grid Layout ───────────────────────────────────────────
// Groups nodes by K8s category and arranges them in a logical left-to-right
// flow that mirrors the Kubernetes resource dependency chain.

function categoryGridLayout(
  topology: TopologyResponse
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodeW = 300;
  const nodeH = 150;
  const groupGapX = 160; // horizontal gap between category columns
  const groupGapY = 80;  // vertical gap between rows within a group

  // Group nodes by category
  const groups = new Map<string, TopologyNode[]>();
  for (const n of topology.nodes) {
    const cat = n.category || "custom";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(n);
  }

  // Sort categories by the K8s dependency flow order
  const sortedCategories = Array.from(groups.entries())
    .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]));

  // Arrange category groups as columns flowing left to right
  // Within each column, arrange nodes in a wider grid for better aspect ratio
  let columnX = 0;

  for (const [, nodes] of sortedCategories) {
    // Use wider sub-columns to prevent tall vertical stacking.
    // Target: roughly square aspect ratio per category block.
    const subCols = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(nodes.length * 1.5))));

    nodes.forEach((n, idx) => {
      const subCol = idx % subCols;
      const row = Math.floor(idx / subCols);
      positions.set(n.id, {
        x: columnX + subCol * nodeW,
        y: row * nodeH,
      });
    });

    const colWidth = subCols * nodeW;
    columnX += colWidth + groupGapX;
  }

  return positions;
}

// ─── Focus-Node Anchoring ────────────────────────────────────────────────────

/** Shift all positions so focusNodeId sits at (0,0) — makes it the visual center */
function anchorOnFocusNode(
  positions: Map<string, { x: number; y: number }>,
  focusNodeId: string | undefined,
  nodeWidth: number,
  nodeHeight: number
): void {
  if (!focusNodeId || !positions.has(focusNodeId)) return;
  const fp = positions.get(focusNodeId)!;
  const offsetX = fp.x + nodeWidth / 2;
  const offsetY = fp.y + nodeHeight / 2;
  for (const [id, pos] of positions) {
    positions.set(id, { x: pos.x - offsetX, y: pos.y - offsetY });
  }
}

// ─── Hybrid Layout: ELK for components, grid for arrangement ────────────────
// This is the main layout strategy. It combines:
// 1. ELK layered for connected subgraphs (proper edge routing)
// 2. Grid arrangement for positioning the components + isolated nodes
//
// This prevents the "vertical strip" problem where ELK stacks all
// disconnected nodes in a single 30,000px tall column.
//
// focusNodeId: if provided, the layout is shifted so this node is at (0,0),
// making it the visual anchor/center of the topology.

async function hybridLayout(
  topology: TopologyResponse,
  elkInstance: unknown,
  viewMode: ViewMode,
  validEdges: Array<{ id: string; source: string; target: string; label: string; detail?: string; relationshipCategory?: string; healthy?: boolean }>,
  focusNodeId?: string
): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>();
  const dims = getNodeDims("base");
  const elkOptions = ELK_OPTIONS[viewMode];

  // Build node lookup for layer constraints
  const nodeLayerMap = new Map<string, number>();
  for (const n of topology.nodes) {
    if (n.layer != null) nodeLayerMap.set(n.id, n.layer);
  }

  // Find connected components
  const nodeIds = topology.nodes.map((n) => n.id);
  const components = findConnectedComponents(nodeIds, validEdges);

  // Separate: connected components (2+ nodes) vs isolated nodes
  const connectedComponents = components.filter((c) => c.nodeIds.size >= 2);
  const isolatedNodeIds = new Set<string>();
  for (const c of components) {
    if (c.nodeIds.size === 1) {
      for (const nid of c.nodeIds) isolatedNodeIds.add(nid);
    }
  }

  // Layout each connected component with ELK
  const componentBounds: Array<{
    positions: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
  }> = [];

  for (const comp of connectedComponents) {
    const compNodeIds = Array.from(comp.nodeIds);
    const compEdges = validEdges.filter((e) => comp.edgeIds.has(e.id));

    const elkGraph: ElkGraph = {
      id: `comp-${compNodeIds[0]}`,
      layoutOptions: {
        ...elkOptions,
        "elk.randomSeed": "42",
      },
      children: compNodeIds.map((nid) => ({
        id: nid,
        width: dims.width,
        height: dims.height,
        layoutOptions: getLayerConstraint(nodeLayerMap.get(nid)),
      })),
      edges: compEdges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    try {
      const result: ElkLayoutResult = await elkInstance.layout(elkGraph);
      const compPositions = new Map<string, { x: number; y: number }>();
      let maxX = 0, maxY = 0;

      for (const child of result.children ?? []) {
        compPositions.set(child.id, { x: child.x, y: child.y });
        maxX = Math.max(maxX, child.x + dims.width);
        maxY = Math.max(maxY, child.y + dims.height);
      }

      componentBounds.push({
        positions: compPositions,
        width: maxX,
        height: maxY,
      });
    } catch {
      // Fallback: grid the component
      const compPositions = new Map<string, { x: number; y: number }>();
      const cols = Math.max(2, Math.ceil(Math.sqrt(compNodeIds.length)));
      compNodeIds.forEach((nid, idx) => {
        compPositions.set(nid, {
          x: (idx % cols) * 300,
          y: Math.floor(idx / cols) * 150,
        });
      });
      componentBounds.push({
        positions: compPositions,
        width: cols * 300,
        height: Math.ceil(compNodeIds.length / cols) * 150,
      });
    }
  }

  // Sort components by size (largest first) for better visual hierarchy
  componentBounds.sort((a, b) => b.positions.size - a.positions.size);

  // Arrange components in a 2D grid
  // Use a shelf-packing approach: fill rows left to right, wrap when too wide
  const MAX_ROW_WIDTH = Math.max(3000, Math.sqrt(topology.nodes.length) * 400);
  const COMPONENT_GAP = 120;

  let currentX = 0;
  let currentY = 0;
  let rowMaxHeight = 0;

  for (const comp of componentBounds) {
    // Wrap to next row if this component would exceed max width
    if (currentX > 0 && currentX + comp.width > MAX_ROW_WIDTH) {
      currentX = 0;
      currentY += rowMaxHeight + COMPONENT_GAP;
      rowMaxHeight = 0;
    }

    // Place all nodes of this component with the offset
    for (const [nid, pos] of comp.positions) {
      positions.set(nid, {
        x: currentX + pos.x,
        y: currentY + pos.y,
      });
    }

    currentX += comp.width + COMPONENT_GAP;
    rowMaxHeight = Math.max(rowMaxHeight, comp.height);
  }

  // Place isolated nodes below the connected components in a category-grouped grid
  if (isolatedNodeIds.size > 0) {
    const isolatedY = componentBounds.length > 0
      ? currentY + rowMaxHeight + COMPONENT_GAP * 2
      : 0;  // No connected components — start at top

    // Group isolated nodes by category for logical arrangement
    const nodeMap = new Map<string, TopologyNode>();
    for (const n of topology.nodes) nodeMap.set(n.id, n);

    const catGroups = new Map<string, string[]>();
    for (const nid of isolatedNodeIds) {
      const cat = nodeMap.get(nid)?.category || "custom";
      if (!catGroups.has(cat)) catGroups.set(cat, []);
      catGroups.get(cat)!.push(nid);
    }

    // Sort categories by K8s dependency order
    const sortedCats = Array.from(catGroups.entries())
      .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]));

    // Use a wider grid with more columns for better aspect ratio.
    // Target: fill horizontally first to avoid tall vertical layouts.
    const totalIsolated = isolatedNodeIds.size;
    const targetCols = Math.max(4, Math.min(12, Math.ceil(Math.sqrt(totalIsolated * 2))));
    const isoX = 0;
    let isoY = isolatedY;

    for (const [, nids] of sortedCats) {
      // Each category gets a proportional share of the target column count
      const cols = Math.max(2, Math.min(targetCols, Math.ceil(Math.sqrt(nids.length * 2.5))));
      nids.forEach((nid, idx) => {
        positions.set(nid, {
          x: isoX + (idx % cols) * 300,
          y: isoY + Math.floor(idx / cols) * 150,
        });
      });
      // Stack categories vertically within the same column block
      const rows = Math.ceil(nids.length / cols);
      isoY += rows * 150 + 60;
    }
  }

  // Shift the entire layout so the focus node sits at the visual center (0,0).
  anchorOnFocusNode(positions, focusNodeId, dims.width, dims.height);

  return positions;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useElkLayout(
  topology: TopologyResponse | null,
  viewMode: ViewMode = "namespace",
  nodeType: string = "base"
) {
  // IMPORTANT: Layout computation always uses "base" dimensions so that:
  // 1. Switching semantic zoom (compact/base/expanded) never triggers re-layout
  // 2. Export mode (which locks nodeType to "base") never triggers re-layout
  // 3. Node spacing is always computed for the largest card size (base)
  // The `nodeType` parameter only controls visual rendering via the useMemo below.
  const [positionedNodes, setPositionedNodes] = useState<
    Array<{ id: string; x: number; y: number; data: BaseNodeData }>
  >([]);
  const [layoutEdges, setLayoutEdges] = useState<Edge<LabeledEdgeData>[]>([]);
  const [isLayouting, setIsLayouting] = useState(false);
  const [elkReady, setElkReady] = useState(false);
  const elkRef = useRef<unknown>(null);
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

    // Compute graph density to choose algorithm
    const density = validEdges.length / Math.max(1, nodeCount);

    // Focus node for resource-scoped topology (anchor at center)
    const focusNodeId = viewMode === "resource"
      ? topology.metadata?.focusResource
      : undefined;

    try {
      let positions: Map<string, { x: number; y: number }>;

      if (nodeCount > 300) {
        // ─── LARGE GRAPH: category-grouped grid ─────────────────────────
        // ELK is too slow and produces poor results for large sparse graphs.
        // Category grid gives instant, readable layouts.
        positions = categoryGridLayout(topology);
      } else if (elkRef.current && density >= 2.0) {
        // ─── DENSE GRAPH: Full ELK layered ──────────────────────────────
        // Only use full ELK when the graph is truly well-connected
        // (avg 2+ edges per node). Below this, many nodes are isolated
        // and ELK stacks them vertically in a single layer.
        // density ~1.0 just means ~1 edge/node which still has many isolates.
        const elkOptions = ELK_OPTIONS[viewMode];
        const dims = getNodeDims("base");
        const elkGraph: ElkGraph = {
          id: "root",
          layoutOptions: {
            ...elkOptions,
            "elk.randomSeed": "42",
            // Hint for better aspect ratio on medium-large graphs
            "elk.aspectRatio": String(Math.max(1.2, Math.min(2.5, nodeCount / 20))),
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
        // Anchor focus node at center for resource topology
        anchorOnFocusNode(positions, focusNodeId, dims.width, dims.height);
      } else if (elkRef.current) {
        // ─── HYBRID: ELK per component + grid arrangement ──────────────
        // This is the sweet spot: use ELK for connected subgraphs (proper
        // edge routing), but arrange components in a 2D grid instead of
        // letting ELK stack them vertically.
        positions = await hybridLayout(topology, elkRef.current, viewMode, validEdges, focusNodeId);
      } else {
        // ─── FALLBACK: category grid ────────────────────────────────────
        positions = categoryGridLayout(topology);
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
        data: {
          label: e.label,
          detail: e.detail,
          relationshipCategory: e.relationshipCategory,
          relationshipType: e.relationshipType,
          healthy: e.healthy,
        },
      }));

      setPositionedNodes(positioned);
      setLayoutEdges(edges);
    } catch (err) {
      console.warn("[useElkLayout] Layout failed, using category grid:", err);
      if (gen !== layoutGenRef.current) return;

      const positions = categoryGridLayout(topology);
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
        topology.edges
          .filter((e) => new Set(topology.nodes.map((n) => n.id)).has(e.source) &&
                         new Set(topology.nodes.map((n) => n.id)).has(e.target))
          .map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: "labeled",
            data: {
              label: e.label,
              detail: e.detail,
              relationshipCategory: e.relationshipCategory,
              relationshipType: e.relationshipType,
              healthy: e.healthy,
            },
          }))
      );
    } finally {
      if (gen === layoutGenRef.current) setIsLayouting(false);
    }
  // NOTE: nodeType intentionally excluded — layout always uses "base" dims.
  // nodeType only affects the visual rendering (useMemo below), not layout positions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, viewMode, elkReady]);

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
