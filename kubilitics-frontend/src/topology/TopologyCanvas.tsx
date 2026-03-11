import { useCallback, useState, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  BackgroundVariant,
  type Viewport,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes/nodeTypes";
import { edgeTypes } from "./edges/edgeTypes";
import { useElkLayout } from "./hooks/useElkLayout";
import type { TopologyResponse, ViewMode } from "./types/topology";

export interface TopologyCanvasProps {
  topology: TopologyResponse | null;
  selectedNodeId: string | null;
  highlightNodeIds?: string[];
  viewMode?: ViewMode;
  onSelectNode: (id: string | null) => void;
  fitViewRef?: React.MutableRefObject<(() => void) | null>;
}

/**
 * Semantic zoom: node display type based on zoom level.
 * Thresholds tuned so that after fitView, nodes show as readable cards
 * rather than tiny dots.
 *
 * <0.12 = minimal (dots only — extreme zoom-out for 700+ nodes)
 * 0.12-0.35 = compact (small cards with name + kind)
 * 0.35-1.5 = base (standard cards with status + metrics)
 * >1.5 = expanded (full detail cards)
 */
function getNodeTypeForZoom(zoom: number): string {
  if (zoom < 0.12) return "minimal";
  if (zoom < 0.35) return "compact";
  if (zoom > 1.5) return "expanded";
  return "base";
}

function TopologyCanvasInner({
  topology,
  selectedNodeId,
  highlightNodeIds = [],
  viewMode = "namespace",
  onSelectNode,
  fitViewRef,
}: TopologyCanvasProps) {
  const [currentZoom, setCurrentZoom] = useState(0.5);
  const nodeType = getNodeTypeForZoom(currentZoom);
  const { nodes: elkNodes, edges: elkEdges, isLayouting } =
    useElkLayout(topology, viewMode, nodeType);
  const [nodes, setNodes, onNodesChange] = useNodesState(elkNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elkEdges);
  const reactFlow = useReactFlow();

  const nodeCount = topology?.nodes?.length ?? 0;

  // Sync ELK layout output into React Flow state
  useEffect(() => {
    setNodes(elkNodes);
    setEdges(elkEdges);
  }, [elkNodes, elkEdges, setNodes, setEdges]);

  // Auto-fit after layout completes with smart zoom limits
  useEffect(() => {
    if (!isLayouting && elkNodes.length > 0) {
      const t = setTimeout(() => {
        // Limit how far fitView zooms out so nodes remain readable
        // For small graphs, don't zoom out past 0.5 (shows base nodes)
        // For medium graphs, don't zoom out past 0.2 (shows compact nodes)
        // For large graphs, allow 0.05 (minimal dots are expected)
        let maxZoom = 1.2;
        let minZoom = 0.4;
        if (nodeCount > 300) {
          minZoom = 0.05;
        } else if (nodeCount > 100) {
          minZoom = 0.15;
        } else if (nodeCount > 40) {
          minZoom = 0.25;
        }
        reactFlow.fitView({
          padding: 0.08,
          duration: 300,
          maxZoom,
          minZoom,
        });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [isLayouting, elkNodes.length, reactFlow, nodeCount]);

  // Expose fitView to parent
  useEffect(() => {
    if (fitViewRef) {
      fitViewRef.current = () =>
        reactFlow.fitView({ padding: 0.08, duration: 400 });
    }
  }, [reactFlow, fitViewRef]);

  // Apply highlight/selection styling
  const styledNodes = useMemo(() => {
    if (!selectedNodeId && highlightNodeIds.length === 0) return nodes;
    return nodes.map((n) => {
      const isHighlighted = highlightNodeIds.includes(n.id);
      const isSelected = n.id === selectedNodeId;
      if (!isHighlighted && !isSelected) return n;
      return {
        ...n,
        className: [
          isSelected ? "ring-2 ring-blue-500 ring-offset-2 rounded-lg" : "",
          isHighlighted ? "ring-2 ring-amber-400 ring-offset-1 rounded-lg" : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    });
  }, [nodes, selectedNodeId, highlightNodeIds]);

  // Edge visibility: hide labels at low zoom, hide all edges for very large graphs at extreme zoom-out
  const styledEdges = useMemo(() => {
    // Only hide edges for genuinely large graphs (500+) at extreme zoom-out
    if (nodeCount > 500 && currentZoom < 0.1) {
      return [];
    }
    // Hide edge labels below zoom 0.3 for performance
    if (currentZoom < 0.3) {
      return edges.map((e) => ({
        ...e,
        data: { ...e.data, hideLabel: true },
        style: {
          ...(e.style ?? {}),
          strokeWidth: currentZoom < 0.1 ? 0.5 : 1,
          opacity: currentZoom < 0.1 ? 0.3 : 0.6,
        },
      }));
    }
    return edges;
  }, [edges, currentZoom, nodeCount]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onSelectNode(node.id),
    [onSelectNode]
  );
  const onPaneClick = useCallback(() => onSelectNode(null), [onSelectNode]);

  const onMoveEnd = useCallback(
    (_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      setCurrentZoom(viewport.zoom);
    },
    []
  );

  // Category-based minimap colors
  const miniMapNodeColor = useCallback((n: Node) => {
    const category = (n.data as any)?.category;
    const status = (n.data as any)?.status;
    if (status === "error") return "#ef4444";
    if (status === "warning") return "#f59e0b";
    const catColors: Record<string, string> = {
      compute: "#3b82f6",
      networking: "#8b5cf6",
      config: "#f59e0b",
      storage: "#06b6d4",
      security: "#ec4899",
      scheduling: "#6b7280",
      scaling: "#22c55e",
      custom: "#94a3b8",
    };
    return catColors[category] ?? "#10b981";
  }, []);

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      onlyRenderVisibleElements
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onMoveEnd={onMoveEnd}
      maxZoom={4}
      minZoom={0.02}
      proOptions={{ hideAttribution: true }}
      className="!bg-[#f8f9fb]"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#d4d4d8"
      />
      <MiniMap
        nodeColor={miniMapNodeColor}
        nodeStrokeWidth={0}
        maskColor="rgba(0, 0, 0, 0.06)"
        className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
        style={{ width: 180, height: 120 }}
      />
      <Controls
        showZoom
        showFitView
        showInteractive={false}
        className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
      />
      {/* Zoom hint for large graphs at extreme zoom-out */}
      {nodeCount > 500 && currentZoom < 0.1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-gray-900/70 px-4 py-1.5 text-xs text-white backdrop-blur-sm">
          Zoom in to see connections
        </div>
      )}
    </ReactFlow>
  );
}

export function TopologyCanvas(props: TopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <TopologyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
