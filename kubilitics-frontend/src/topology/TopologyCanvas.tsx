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

import { toast } from "sonner";
import { nodeTypes } from "./nodes/nodeTypes";
import { edgeTypes } from "./edges/edgeTypes";
import { useElkLayout } from "./hooks/useElkLayout";
import { captureFullTopologyPNG, captureFullTopologySVG } from "./export/exportTopology";
import { ZOOM_THRESHOLDS, CANVAS, fitViewMinZoom, minimapNodeColor } from "./constants/designTokens";
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

/** Semantic zoom — uses centralized thresholds from designTokens */
function getNodeTypeForZoom(zoom: number): string {
  if (zoom < ZOOM_THRESHOLDS.minimal) return "minimal";
  if (zoom < ZOOM_THRESHOLDS.compact) return "compact";
  if (zoom > ZOOM_THRESHOLDS.expanded) return "expanded";
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
        reactFlow.fitView({
          padding: 0.06,
          duration: 350,
          maxZoom: 1.0,
          minZoom: fitViewMinZoom(nodeCount),
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
    reactFlow.fitView({ padding: 0.04, duration: 0, minZoom: 0.05 });

    // Wait for React to render all nodes (since onlyRenderVisibleElements is now off)
    const timer = setTimeout(async () => {
      try {
        if (pending.format === "png") {
          await captureFullTopologyPNG(pending.filename);
        } else {
          await captureFullTopologySVG(pending.filename);
        }
        toast.success(`${pending.format.toUpperCase()} exported successfully`);
      } catch (err) {
        console.error("Export capture failed:", err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Export failed: ${msg}`);
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
    const category = (n.data as any)?.category ?? "custom";
    const status = (n.data as any)?.status ?? "unknown";
    return minimapNodeColor(category, status);
  }, []);

  return (
    <div
      role="application"
      aria-roledescription="Kubernetes topology graph"
      aria-label={`Topology visualization with ${nodeCount} resources. Use mouse wheel to zoom, drag to pan.`}
      className="relative h-full w-full"
    >
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
        <Background variant={BackgroundVariant.Dots} gap={CANVAS.gridGap} size={CANVAS.gridSize} color={CANVAS.gridColor} />
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={0}
          maskColor="rgba(0, 0, 0, 0.06)"
          className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
          style={{ width: 180, height: 120 }}
          pannable
          zoomable
          aria-label="Minimap navigation"
        />
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          className="!bg-white !border !border-gray-200 !rounded-lg !shadow-md"
          aria-label="Zoom and fit controls"
        />
      </ReactFlow>

      {/* Live region for export status */}
      {isExporting && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-white/95 px-4 py-2 shadow-lg border border-gray-200 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Exporting topology...</span>
        </div>
      )}
    </div>
  );
}

export function TopologyCanvas(props: TopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <TopologyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
