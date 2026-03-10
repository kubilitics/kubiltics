import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Viewport,
  type Node,
  type Edge,
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
 * Determines the semantic zoom node type based on current zoom level.
 * <0.3 = minimal, 0.3-0.6 = compact, 0.6-1.5 = base, >1.5 = expanded
 */
function getNodeTypeForZoom(zoom: number): string {
  if (zoom < 0.3) return "minimal";
  if (zoom < 0.6) return "compact";
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
  const [currentZoom, setCurrentZoom] = useState(1);
  const nodeType = getNodeTypeForZoom(currentZoom);
  const { nodes: elkNodes, edges: elkEdges, isLayouting } =
    useElkLayout(topology, viewMode, nodeType);
  const [nodes, setNodes, onNodesChange] = useNodesState(elkNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elkEdges);
  const reactFlow = useReactFlow();

  // Sync ELK layout output into React Flow state
  useEffect(() => {
    setNodes(elkNodes);
    setEdges(elkEdges);
  }, [elkNodes, elkEdges, setNodes, setEdges]);

  // Expose fitView to parent
  useEffect(() => {
    if (fitViewRef) {
      fitViewRef.current = () => reactFlow.fitView({ padding: 0.1, duration: 300 });
    }
  }, [reactFlow, fitViewRef]);

  // Apply highlight/selection rings to nodes
  const styledNodes = useMemo(() => {
    if (!selectedNodeId && highlightNodeIds.length === 0) return nodes;
    return nodes.map((n) => {
      const isHighlighted = highlightNodeIds.includes(n.id);
      const isSelected = n.id === selectedNodeId;
      if (!isHighlighted && !isSelected) return n;
      return {
        ...n,
        className: [
          isSelected ? "ring-2 ring-primary ring-offset-2" : "",
          isHighlighted ? "ring-1 ring-amber-400" : "",
        ].filter(Boolean).join(" "),
      };
    });
  }, [nodes, selectedNodeId, highlightNodeIds]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );
  const onPaneClick = useCallback(() => onSelectNode(null), [onSelectNode]);

  const onMoveEnd = useCallback((_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setCurrentZoom(viewport.zoom);
  }, []);

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      onlyRenderVisibleElements
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onMoveEnd={onMoveEnd}
      maxZoom={4}
      minZoom={0.05}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <MiniMap
        nodeColor={(n) => {
          const status = (n.data as any)?.status;
          if (status === "error") return "#ef4444";
          if (status === "warning") return "#f59e0b";
          if (status === "healthy") return "#10b981";
          return "#9ca3af";
        }}
        maskColor="rgba(0, 0, 0, 0.08)"
      />
      <Controls showZoom showFitView showInteractive={false} />
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

