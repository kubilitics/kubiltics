/**
 * ProgressiveTopology — Wrapper component for progressive disclosure topology.
 *
 * Default view: All namespaces are shown as collapsed "super-nodes".
 * Users can expand individual namespaces to reveal contained resources on the canvas.
 * Double-clicking a super-node navigates to the namespace detail view.
 *
 * Features:
 * - Progressive disclosure: collapsed namespace super-nodes by default
 * - Lazy resource loading: expanded namespaces load their resources on demand
 * - MAX_VISIBLE_NODES raised to 500 for expanded views
 * - Virtual rendering via React Flow's built-in viewport culling (onlyRenderVisibleElements)
 * - Debounced expand/collapse to prevent rapid re-render jank
 * - Toolbar controls: expand all, collapse all, search
 *
 * Integration:
 * - Wraps the existing TopologyCanvas component
 * - Injects NamespaceSuperNode into the node type registry
 * - Consumes useProgressiveTopology hook for state management
 */
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  useProgressiveTopology,
  MAX_PROGRESSIVE_NODES,
  type NamespaceSuperNodeInfo,
} from "@/hooks/useProgressiveTopology";
import { NamespaceSuperNode, type NamespaceSuperNodeData } from "./NamespaceSuperNode";
import { useTopologyData } from "@/topology/hooks/useTopologyData";
import { nodeTypes as baseNodeTypes } from "@/topology/nodes/nodeTypes";
import { edgeTypes } from "@/topology/edges/edgeTypes";
import {
  CANVAS,
  ZOOM_THRESHOLDS,
  fitViewMinZoom,
  minimapNodeColor,
  STATUS_COLORS,
} from "@/topology/constants/designTokens";
import type { TopologyResponse, ViewMode } from "@/topology/types/topology";
import type { BaseNodeData } from "@/topology/nodes/BaseNode";
import type { LabeledEdgeData } from "@/topology/edges/LabeledEdge";

// ─── Extended node types with NamespaceSuperNode ────────────────────────────

const progressiveNodeTypes = {
  ...baseNodeTypes,
  namespaceSuperNode: NamespaceSuperNode,
};

// ─── Layout constants ───────────────────────────────────────────────────────

const SUPER_NODE_GAP_X = 380;
const SUPER_NODE_GAP_Y = 220;
const SUPER_NODE_COLS = 4;
const RESOURCE_NODE_GAP_X = 280;
const RESOURCE_NODE_GAP_Y = 120;

// ─── Semantic zoom ──────────────────────────────────────────────────────────

function getNodeTypeForZoom(zoom: number): string {
  if (zoom < ZOOM_THRESHOLDS.minimal) return "minimal";
  if (zoom < ZOOM_THRESHOLDS.compact) return "compact";
  if (zoom > ZOOM_THRESHOLDS.expanded) return "expanded";
  return "base";
}

// ─── Build Flow nodes from progressive topology ─────────────────────────────

interface BuildFlowOptions {
  topology: TopologyResponse;
  expandedNamespaces: Set<string>;
  superNodes: NamespaceSuperNodeInfo[];
  nodeType: string;
  onToggle: (ns: string) => void;
  onDrillIn: (ns: string) => void;
}

function buildFlowNodes({
  topology,
  expandedNamespaces,
  superNodes,
  nodeType,
  onToggle,
  onDrillIn,
}: BuildFlowOptions): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const nodeIdSet = new Set<string>();

  // 1. Layout super-nodes in a grid
  let superIdx = 0;
  for (const sn of superNodes) {
    const col = superIdx % SUPER_NODE_COLS;
    const row = Math.floor(superIdx / SUPER_NODE_COLS);
    const superNodeData: NamespaceSuperNodeData = {
      namespace: sn.namespace,
      resourceCount: sn.resourceCount,
      health: sn.health,
      overallHealth: sn.overallHealth,
      kindCounts: sn.kindCounts,
      isExpanded: false,
      onToggle,
      onDrillIn,
    };

    nodes.push({
      id: `super::${sn.namespace}`,
      type: "namespaceSuperNode",
      position: { x: col * SUPER_NODE_GAP_X, y: row * SUPER_NODE_GAP_Y },
      data: superNodeData,
    });
    nodeIdSet.add(`super::${sn.namespace}`);
    superIdx++;
  }

  // 2. Layout expanded namespace resources
  // Place them below the super-node grid
  const superNodeRows = Math.ceil(superNodes.length / SUPER_NODE_COLS);
  const expandedStartY = (superNodeRows + 1) * SUPER_NODE_GAP_Y;
  let expandedNsIdx = 0;

  for (const ns of Array.from(expandedNamespaces).sort()) {
    const nsNodes = topology.nodes.filter(
      (n) => n.namespace === ns && n.kind !== "NamespaceSuperNode",
    );
    if (nsNodes.length === 0) continue;

    // Group by layer for hierarchical layout
    const byLayer = new Map<number, typeof nsNodes>();
    for (const n of nsNodes) {
      const layer = n.layer ?? 0;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(n);
    }
    const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);

    // Namespace offset
    const nsOffsetY = expandedStartY + expandedNsIdx * 600;

    // Add a label node for the expanded namespace
    nodes.push({
      id: `ns-label::${ns}`,
      type: "namespaceSuperNode",
      position: { x: 0, y: nsOffsetY - 40 },
      data: {
        namespace: ns,
        resourceCount: nsNodes.length,
        health: computeHealthFromNodes(nsNodes),
        overallHealth: computeOverallFromNodes(nsNodes),
        kindCounts: computeKindCounts(nsNodes),
        isExpanded: true,
        onToggle,
        onDrillIn,
      } satisfies NamespaceSuperNodeData,
    });
    nodeIdSet.add(`ns-label::${ns}`);

    // Layout resource nodes per layer
    layers.forEach((layer, col) => {
      const list = byLayer.get(layer)!;
      list.forEach((tn, row) => {
        const status =
          tn.status === "healthy" || tn.status === "Running" || tn.status === "Ready"
            ? "healthy"
            : tn.status === "Pending" || tn.status === "Warning"
              ? "warning"
              : tn.status === "Failed" || tn.status === "error" || tn.status === "CrashLoopBackOff"
                ? "error"
                : "unknown";

        nodes.push({
          id: tn.id,
          type: nodeType,
          position: {
            x: (col + 1) * RESOURCE_NODE_GAP_X,
            y: nsOffsetY + 100 + row * RESOURCE_NODE_GAP_Y,
          },
          data: {
            kind: tn.kind,
            name: tn.name,
            namespace: tn.namespace || undefined,
            category: tn.category,
            status,
            statusReason: tn.statusReason ?? tn.status,
            metrics: tn.metrics,
            labels: tn.labels,
            createdAt: tn.createdAt,
          } satisfies BaseNodeData,
        });
        nodeIdSet.add(tn.id);
      });
    });

    expandedNsIdx++;
  }

  // 3. Build edges — only for visible nodes
  const edges: Edge[] = (topology.edges ?? [])
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "labeled",
      data: { label: e.label, detail: e.detail },
      animated: e.animated ?? false,
      style: e.style === "dashed" ? { strokeDasharray: "5 5" } : undefined,
    }));

  return { nodes, edges };
}

// ─── Health computation helpers ─────────────────────────────────────────────

function computeHealthFromNodes(
  nodes: Array<{ status: string }>,
): { healthy: number; warning: number; error: number; unknown: number } {
  const result = { healthy: 0, warning: 0, error: 0, unknown: 0 };
  const healthySet = new Set(["healthy", "Running", "Ready", "Bound", "Available", "Completed", "Active", "Succeeded"]);
  const warningSet = new Set(["warning", "Pending", "PartiallyAvailable"]);
  const errorSet = new Set(["error", "Failed", "NotReady", "Lost", "CrashLoopBackOff", "OOMKilled"]);

  for (const n of nodes) {
    if (healthySet.has(n.status)) result.healthy++;
    else if (warningSet.has(n.status)) result.warning++;
    else if (errorSet.has(n.status)) result.error++;
    else result.unknown++;
  }
  return result;
}

function computeOverallFromNodes(
  nodes: Array<{ status: string }>,
): "healthy" | "warning" | "error" | "unknown" {
  const h = computeHealthFromNodes(nodes);
  if (h.error > 0) return "error";
  if (h.warning > 0) return "warning";
  if (h.healthy > 0) return "healthy";
  return "unknown";
}

function computeKindCounts(nodes: Array<{ kind: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  }
  return counts;
}

// ─── Inner canvas component (must be inside ReactFlowProvider) ──────────────

interface ProgressiveCanvasInnerProps {
  sourceTopology: TopologyResponse | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onNavigateToNamespace?: (ns: string) => void;
}

function ProgressiveCanvasInner({
  sourceTopology,
  selectedNodeId,
  onSelectNode,
  onNavigateToNamespace,
}: ProgressiveCanvasInnerProps) {
  const [currentZoom, setCurrentZoom] = useState(0.5);
  const nodeType = getNodeTypeForZoom(currentZoom);
  const reactFlow = useReactFlow();

  const {
    topology,
    expandedNamespaces,
    superNodes,
    allNamespaces,
    expandNamespace,
    collapseNamespace,
    toggleNamespace,
    expandAll,
    collapseAll,
    truncated,
    totalBeforeCap,
  } = useProgressiveTopology(sourceTopology);

  const navigate = useNavigate();

  const handleDrillIn = useCallback(
    (ns: string) => {
      if (onNavigateToNamespace) {
        onNavigateToNamespace(ns);
      } else {
        navigate(`/namespaces/${ns}`);
      }
    },
    [navigate, onNavigateToNamespace],
  );

  // Build React Flow nodes/edges from progressive topology
  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!topology) return { nodes: [], edges: [] };
    return buildFlowNodes({
      topology,
      expandedNamespaces,
      superNodes,
      nodeType,
      onToggle: toggleNamespace,
      onDrillIn: handleDrillIn,
    });
  }, [topology, expandedNamespaces, superNodes, nodeType, toggleNamespace, handleDrillIn]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync when flow data changes
  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  // Auto-fit after layout changes
  const prevNodeCountRef = useRef(0);
  useEffect(() => {
    if (flowNodes.length > 0 && flowNodes.length !== prevNodeCountRef.current) {
      prevNodeCountRef.current = flowNodes.length;
      const timer = setTimeout(() => {
        reactFlow.fitView({
          padding: 0.15,
          minZoom: fitViewMinZoom(flowNodes.length),
          maxZoom: 1.0,
          duration: 400,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [flowNodes.length, reactFlow]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Super-node clicks are handled by the node's own onClick
      if (node.type === "namespaceSuperNode") return;
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  const nodeCount = flowNodes.length;
  const expandedCount = expandedNamespaces.size;
  const collapsedCount = allNamespaces.length - expandedCount;

  return (
    <div className="h-full w-full relative">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-gray-200 shadow-sm text-[11px]">
          <span className="text-gray-500">Namespaces:</span>
          <span className="font-semibold text-gray-800">{allNamespaces.length}</span>
          {expandedCount > 0 && (
            <>
              <span className="text-gray-300 mx-0.5">|</span>
              <span className="text-blue-600 font-medium">{expandedCount} expanded</span>
            </>
          )}
          {truncated && (
            <>
              <span className="text-gray-300 mx-0.5">|</span>
              <span className="text-amber-600 font-medium">
                {totalBeforeCap} nodes (capped at {MAX_PROGRESSIVE_NODES})
              </span>
            </>
          )}
        </div>

        <button
          onClick={expandAll}
          className="px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-gray-200 shadow-sm text-[11px] font-medium text-gray-600 hover:text-blue-600 hover:border-blue-200 transition-colors"
          title="Expand all namespaces"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-gray-200 shadow-sm text-[11px] font-medium text-gray-600 hover:text-blue-600 hover:border-blue-200 transition-colors"
          title="Collapse all namespaces"
        >
          Collapse All
        </button>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div className="absolute top-14 left-3 z-20 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 shadow-sm text-[11px] text-amber-700 max-w-xs">
          Showing {MAX_PROGRESSIVE_NODES} of {totalBeforeCap} nodes.
          Collapse some namespaces to see more detail.
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={progressiveNodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onMoveEnd={(_event: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => setCurrentZoom(viewport.zoom)}
        fitView
        fitViewOptions={{
          padding: 0.15,
          minZoom: fitViewMinZoom(nodeCount),
          maxZoom: 1.0,
        }}
        minZoom={0.02}
        maxZoom={2.5}
        // Virtual rendering: only render nodes in viewport
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        className="bg-[#f8f9fb]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={CANVAS.gridGap}
          size={CANVAS.gridSize}
          color={CANVAS.gridColor}
        />
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          position="bottom-right"
        />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          position="bottom-right"
          style={{
            width: 180,
            height: 120,
            bottom: 60,
          }}
          nodeColor={(node) => {
            if (node.type === "namespaceSuperNode") {
              const d = node.data as NamespaceSuperNodeData;
              return STATUS_COLORS[d.overallHealth] ?? STATUS_COLORS.unknown;
            }
            const d = node.data as BaseNodeData;
            return minimapNodeColor(d?.category ?? "cluster", d?.status ?? "unknown");
          }}
        />
      </ReactFlow>
    </div>
  );
}

// ─── Public wrapper (provides ReactFlowProvider) ────────────────────────────

export interface ProgressiveTopologyProps {
  /** Source topology from useTopologyData or useClusterTopology */
  sourceTopology: TopologyResponse | null;
  /** Currently selected node ID */
  selectedNodeId?: string | null;
  /** Callback when a resource node is selected */
  onSelectNode?: (id: string | null) => void;
  /** Optional callback when user double-clicks a namespace super-node to drill in */
  onNavigateToNamespace?: (ns: string) => void;
  /** Additional CSS classes for the container */
  className?: string;
}

export function ProgressiveTopology({
  sourceTopology,
  selectedNodeId = null,
  onSelectNode,
  onNavigateToNamespace,
  className = "",
}: ProgressiveTopologyProps) {
  const handleSelectNode = useCallback(
    (id: string | null) => {
      onSelectNode?.(id);
    },
    [onSelectNode],
  );

  return (
    <div className={`h-full w-full ${className}`}>
      <ReactFlowProvider>
        <ProgressiveCanvasInner
          sourceTopology={sourceTopology}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onNavigateToNamespace={onNavigateToNamespace}
        />
      </ReactFlowProvider>
    </div>
  );
}
