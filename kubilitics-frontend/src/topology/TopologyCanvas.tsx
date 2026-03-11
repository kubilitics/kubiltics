import { useCallback, useState, useEffect, useMemo, useRef } from "react";
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
import { captureFullTopologyPNG, captureFullTopologySVG } from "./export/exportTopology";
import type { TopologyResponse, ViewMode } from "./types/topology";

export type ExportFormat = "png" | "svg";

export interface TopologyCanvasProps {
  topology: TopologyResponse | null;
  selectedNodeId: string | null;
  highlightNodeIds?: string[];
  viewMode?: ViewMode;
  onSelectNode: (id: string | null) => void;
  fitViewRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref that parent sets to trigger an export. Call with (format, filename). */
  exportRef?: React.MutableRefObject<((format: ExportFormat, filename: string) => void) | null>;
}

/**
 * Semantic zoom thresholds — tuned so fitView always shows readable nodes.
 * <0.08 = minimal (dots — only for 700+ all-cluster overview)
 * 0.08-0.30 = compact (small cards: name + kind)
 * 0.30-1.5 = base (standard cards: status, metrics)
 * >1.5 = expanded (full detail)
 */
function getNodeTypeForZoom(zoom: number): string {
  if (zoom < 0.08) return "minimal";
  if (zoom < 0.30) return "compact";
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
  exportRef,
}: TopologyCanvasProps) {
  const [currentZoom, setCurrentZoom] = useState(0.5);

  // Export state: when exporting, disable onlyRenderVisibleElements and lock node type
  const [isExporting, setIsExporting] = useState(false);
  const exportPendingRef = useRef<{ format: ExportFormat; filename: string } | null>(null);

  // CRITICAL: During export, lock nodeType to "base" so semantic zoom doesn't
  // switch to "compact" when fitView zooms out. This prevents the exported image
  // from showing tiny compact cards instead of the full colorful base cards.
  const nodeType = isExporting ? "base" : getNodeTypeForZoom(currentZoom);

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

  // Auto-fit after layout — with smart zoom floor so nodes are readable
  useEffect(() => {
    if (!isLayouting && elkNodes.length > 0) {
      const t = setTimeout(() => {
        let minZoom = 0.35;
        if (nodeCount > 300) minZoom = 0.12;
        else if (nodeCount > 150) minZoom = 0.2;
        else if (nodeCount > 50) minZoom = 0.25;

        reactFlow.fitView({
          padding: 0.06,
          duration: 350,
          maxZoom: 1.0,
          minZoom,
        });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isLayouting, elkNodes.length, reactFlow, nodeCount]);

  // Expose fitView to parent toolbar "Fit" button
  useEffect(() => {
    if (fitViewRef) {
      fitViewRef.current = () =>
        reactFlow.fitView({ padding: 0.06, duration: 400 });
    }
  }, [reactFlow, fitViewRef]);

  // ── Export flow ─────────────────────────────────────────────────────────────
  // Step 1: Parent calls exportRef → sets isExporting=true (renders ALL nodes)
  // Step 2: useEffect detects isExporting → fitView → wait → capture → restore
  useEffect(() => {
    if (exportRef) {
      exportRef.current = (format: ExportFormat, filename: string) => {
        exportPendingRef.current = { format, filename };
        setIsExporting(true);
      };
    }
  }, [exportRef]);

  // When isExporting becomes true, all nodes render (onlyRenderVisibleElements=false).
  // We fitView, wait for render, capture, then restore.
  useEffect(() => {
    if (!isExporting || !exportPendingRef.current) return;

    const pending = exportPendingRef.current;

    // Save current viewport to restore after export
    const savedViewport = reactFlow.getViewport();

    // FitView so ALL nodes are visible within the container
    // Use minZoom 0.05 to keep nodes at a reasonable readable size
    reactFlow.fitView({ padding: 0.04, duration: 0, minZoom: 0.05 });

    // Wait for React to render all nodes (since onlyRenderVisibleElements is now off)
    // 500ms ensures even large topologies have time to paint
    const timer = setTimeout(async () => {
      try {
        if (pending.format === "png") {
          await captureFullTopologyPNG(pending.filename);
        } else {
          await captureFullTopologySVG(pending.filename);
        }
      } catch (err) {
        console.error("Export capture failed:", err);
      } finally {
        // Restore previous viewport position/zoom
        reactFlow.setViewport(savedViewport, { duration: 0 });
        exportPendingRef.current = null;
        setIsExporting(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [isExporting, reactFlow]);

  // Selection/highlight styling
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
        ].filter(Boolean).join(" "),
      };
    });
  }, [nodes, selectedNodeId, highlightNodeIds]);

  // Edge styling — ALWAYS show edges, just hide labels at low zoom
  const styledEdges = useMemo(() => {
    if (currentZoom < 0.25 && !isExporting) {
      return edges.map((e) => ({
        ...e,
        data: { ...e.data, hideLabel: true },
        style: {
          ...(e.style ?? {}),
          strokeWidth: currentZoom < 0.1 ? 0.5 : 1,
          opacity: currentZoom < 0.1 ? 0.35 : 0.55,
        },
      }));
    }
    return edges;
  }, [edges, currentZoom, isExporting]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onSelectNode(node.id),
    [onSelectNode]
  );
  const onPaneClick = useCallback(() => onSelectNode(null), [onSelectNode]);
  // Freeze zoom updates during export so fitView doesn't trigger semantic zoom changes
  const onMoveEnd = useCallback(
    (_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (!exportPendingRef.current) {
        setCurrentZoom(viewport.zoom);
      }
    },
    []
  );

  const miniMapNodeColor = useCallback((n: Node) => {
    const category = (n.data as any)?.category;
    const status = (n.data as any)?.status;
    if (status === "error") return "#ef4444";
    if (status === "warning") return "#f59e0b";
    const catColors: Record<string, string> = {
      compute: "#3b82f6", networking: "#8b5cf6", config: "#f59e0b",
      storage: "#06b6d4", security: "#ec4899", scheduling: "#6b7280",
      scaling: "#22c55e", custom: "#94a3b8",
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
      fitViewOptions={{ padding: 0.06 }}
      onlyRenderVisibleElements={!isExporting}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onMoveEnd={onMoveEnd}
      maxZoom={4}
      minZoom={0.01}
      proOptions={{ hideAttribution: true }}
      className="!bg-[#f8f9fb]"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d4d4d8" />
      <MiniMap
        nodeColor={miniMapNodeColor}
        nodeStrokeWidth={0}
        maskColor="rgba(0, 0, 0, 0.06)"
        className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
        style={{ width: 180, height: 120 }}
        pannable
        zoomable
      />
      <Controls
        showZoom
        showFitView
        showInteractive={false}
        className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
      />
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
