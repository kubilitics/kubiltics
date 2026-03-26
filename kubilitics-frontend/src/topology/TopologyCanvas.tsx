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

import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { nodeTypes } from "./nodes/nodeTypes";
import { edgeTypes } from "./edges/edgeTypes";
import { useElkLayout } from "./hooks/useElkLayout";
import { captureFullTopologyPNG, captureFullTopologySVG, type ExportBounds } from "./export/exportTopology";
import { ZOOM_THRESHOLDS, CANVAS, EDGE_COLORS, fitViewMinZoom, minimapNodeColor } from "./constants/designTokens";
import { useTopologyStore } from "./store/topologyStore";
import type { TopologyResponse, ViewMode } from "./types/topology";

export type ExportFormat = "png" | "svg";

export interface TopologyCanvasProps {
  topology: TopologyResponse | null;
  selectedNodeId: string | null;
  highlightNodeIds?: string[];
  viewMode?: ViewMode;
  onSelectNode: (id: string | null) => void;
  /** Called when a user double-clicks a node to expand deeper */
  onNodeExpand?: (nodeId: string) => void;
  fitViewRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref that parent sets to trigger an export. Call with (format, filename). */
  exportRef?: React.MutableRefObject<((format: ExportFormat, filename: string) => void) | null>;
  /** Ref that parent sets to center on a specific node by id */
  centerOnNodeRef?: React.MutableRefObject<((nodeId: string) => void) | null>;
  /** Cluster name for export title */
  clusterName?: string;
  /** Namespace for export title */
  namespace?: string;
  /** Called when user clicks "Try simpler view" after layout timeout */
  onRequestSimplify?: () => void;
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
  onNodeExpand,
  fitViewRef,
  exportRef,
  centerOnNodeRef,
  clusterName,
  namespace,
  onRequestSimplify,
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

  // Layout timeout — 5 seconds max, then show "taking too long" state
  const [layoutTimedOut, setLayoutTimedOut] = useState(false);
  useEffect(() => {
    if (!isLayouting) {
      setLayoutTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLayoutTimedOut(true), 5_000);
    return () => clearTimeout(t);
  }, [isLayouting]);
  const [nodes, setNodes, onNodesChange] = useNodesState(elkNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elkEdges);
  const reactFlow = useReactFlow();

  const nodeCount = topology?.nodes?.length ?? 0;

  // Sync ELK layout output into React Flow state
  useEffect(() => {
    setNodes(elkNodes);
    setEdges(elkEdges);
  }, [elkNodes, elkEdges, setNodes, setEdges]);

  // Auto-fit after layout — first fit all, then center on focus node if one exists
  useEffect(() => {
    if (!isLayouting && elkNodes.length > 0) {
      const t = setTimeout(() => {
        // First fit everything so the graph is visible
        reactFlow.fitView({
          padding: 0.06,
          duration: 350,
          maxZoom: 1.0,
          minZoom: fitViewMinZoom(nodeCount),
        });
        // Then center on the focus/highlighted node if present
        if (highlightNodeIds.length > 0) {
          const focusId = highlightNodeIds[0];
          setTimeout(() => {
            const node = reactFlow.getNode(focusId);
            if (node) {
              const w = node.measured?.width ?? node.width ?? 260;
              const h = node.measured?.height ?? node.height ?? 110;
              reactFlow.setCenter(
                node.position.x + w / 2,
                node.position.y + h / 2,
                { zoom: Math.max(0.5, reactFlow.getViewport().zoom), duration: 400 }
              );
            }
          }, 400);
        }
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isLayouting, elkNodes.length, reactFlow, nodeCount, highlightNodeIds]);

  // Expose fitView to parent toolbar "Fit" button
  useEffect(() => {
    if (fitViewRef) {
      fitViewRef.current = () =>
        reactFlow.fitView({ padding: 0.08, duration: 400, minZoom: fitViewMinZoom(nodeCount) });
    }
  }, [reactFlow, fitViewRef]);

  // Expose centerOnNode to parent — zooms + pans to center a specific node
  useEffect(() => {
    if (centerOnNodeRef) {
      centerOnNodeRef.current = (nodeId: string) => {
        const node = reactFlow.getNode(nodeId);
        if (!node) return;
        const w = node.measured?.width ?? node.width ?? 260;
        const h = node.measured?.height ?? node.height ?? 110;
        const x = node.position.x + w / 2;
        const y = node.position.y + h / 2;
        reactFlow.setCenter(x, y, { zoom: 0.8, duration: 500 });
      };
    }
  }, [reactFlow, centerOnNodeRef]);

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
  // We compute bounds from React Flow state (always accurate), fitView, wait for
  // DOM nodes to actually render, then capture.
  useEffect(() => {
    if (!isExporting || !exportPendingRef.current) return;

    const pending = exportPendingRef.current;
    let cancelled = false;

    // Save current viewport to restore after export
    const savedViewport = reactFlow.getViewport();

    // Compute bounds from React Flow's internal node data — always accurate,
    // no DOM parsing needed. This works even if nodes haven't rendered to DOM yet.
    const rfNodes = reactFlow.getNodes();
    const bounds: ExportBounds | null = rfNodes.length > 0 ? (() => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of rfNodes) {
        const w = n.measured?.width ?? n.width ?? 260;
        const h = n.measured?.height ?? n.height ?? 110;
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
      }
      return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    })() : null;

    // FitView so ALL nodes are visible within the container
    reactFlow.fitView({ padding: 0.04, duration: 0, minZoom: 0.05 });

    // Wait for DOM to actually render all nodes. Instead of a fixed timeout,
    // poll until the expected number of node DOM elements matches.
    const expectedCount = rfNodes.length;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // 40 × 100ms = 4 seconds max wait

    function waitForRender() {
      if (cancelled) return;

      const viewport = document.querySelector(".react-flow__viewport");
      const renderedCount = viewport?.querySelectorAll(".react-flow__node").length ?? 0;
      attempts++;

      // Proceed when: enough nodes rendered OR max attempts reached
      // "Enough" = at least 90% of expected (some may be hidden by React Flow)
      const threshold = Math.max(1, Math.floor(expectedCount * 0.9));
      if (renderedCount >= threshold || attempts >= MAX_ATTEMPTS) {
        // One final rAF to let the browser paint
        requestAnimationFrame(() => {
          if (cancelled) return;
          doCapture();
        });
      } else {
        setTimeout(waitForRender, 100);
      }
    }

    async function doCapture() {
      try {
        if (pending.format === "png") {
          await captureFullTopologyPNG(pending.filename, bounds ?? undefined);
        } else {
          await captureFullTopologySVG(pending.filename, bounds ?? undefined);
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
    }

    // Start the wait-for-render loop
    // Initial delay of 200ms to let React commit the onlyRenderVisibleElements change
    setTimeout(() => {
      if (!cancelled) waitForRender();
    }, 200);

    return () => { cancelled = true; };
  }, [isExporting, reactFlow]);

  // Health chain — nodes connected to error nodes via ownership edges get a warning tint.
  // This propagates visibility: "this Deployment is unhealthy → its RS and Pods are in the error chain"
  const errorChainNodeIds = useMemo(() => {
    const errorNodes = nodes.filter((n) => {
      const status = (n.data as Record<string, unknown>)?.status;
      return status === "error";
    });
    if (errorNodes.length === 0) return new Set<string>();
    const chain = new Set<string>();
    for (const en of errorNodes) {
      chain.add(en.id);
      // Walk ownership edges from error nodes
      for (const edge of edges) {
        const cat = (edge.data as Record<string, unknown>)?.relationshipCategory;
        if (cat === "ownership" || !cat) {
          if (edge.source === en.id) chain.add(edge.target);
          if (edge.target === en.id) chain.add(edge.source);
        }
      }
    }
    return chain;
  }, [nodes, edges]);

  // Focus dimming — dims unconnected nodes when a node is selected.
  // Uses the selectedNodeId PROP (not store) so it works in both
  // TopologyPage (store-driven) and ResourceTopologyV2View (local state).
  const focusDimming = useTopologyStore((s) => s.focusDimming);

  const dimmedNodeIds = useMemo(() => {
    if (!focusDimming || !selectedNodeId) return null;
    const connectedIds = new Set<string>();
    connectedIds.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.source === selectedNodeId) connectedIds.add(edge.target);
      if (edge.target === selectedNodeId) connectedIds.add(edge.source);
    }
    return connectedIds;
  }, [focusDimming, selectedNodeId, edges]);

  // Selection/highlight/dimming/health-chain styling
  const styledNodes = useMemo(() => {
    const hasDimming = dimmedNodeIds != null;
    const hasErrorChain = errorChainNodeIds.size > 0;
    if (!selectedNodeId && highlightNodeIds.length === 0 && !hasDimming && !hasErrorChain) return nodes;
    return nodes.map((n) => {
      const isHighlighted = highlightNodeIds.includes(n.id);
      const isSelected = n.id === selectedNodeId;
      const isDimmed = hasDimming && !dimmedNodeIds.has(n.id);
      const isInErrorChain = hasErrorChain && errorChainNodeIds.has(n.id) && !isSelected;
      if (!isHighlighted && !isSelected && !isDimmed && !isInErrorChain) return n;
      return {
        ...n,
        className: [
          isSelected ? "ring-2 ring-blue-500 ring-offset-2 rounded-lg" : "",
          // Central/focus node: prominent ring + scale so it's always visible
          isHighlighted && !isSelected
            ? "ring-[3px] ring-blue-500 ring-offset-2 rounded-lg shadow-[0_0_16px_rgba(59,130,246,0.5)] scale-[1.03]"
            : "",
          isInErrorChain ? "ring-1 ring-red-400/60 rounded-lg" : "",
        ].filter(Boolean).join(" "),
        style: {
          ...n.style,
          // Central node gets a z-index boost so it sits on top
          ...(isHighlighted && !isSelected ? { zIndex: 100 } : {}),
          ...(isDimmed ? { opacity: 0.2, filter: "saturate(0.3)", transition: "opacity 0.15s, filter 0.15s" } : { transition: "opacity 0.15s, filter 0.15s" }),
        },
      };
    });
  }, [nodes, selectedNodeId, highlightNodeIds, dimmedNodeIds, errorChainNodeIds]);

  // Traffic-related relationship types — highlighted in traffic view mode
  const TRAFFIC_EDGE_TYPES = new Set([
    "selector", "endpoint_target", "ingress_backend", "endpoints",
  ]);

  // Edge styling — ALWAYS show edges, just hide labels at low zoom
  const styledEdges = useMemo(() => {
    // Traffic view mode: emphasize traffic edges, dim the rest
    if (viewMode === "traffic") {
      return edges.map((e) => {
        const relType = (e.data as Record<string, unknown>)?.relationshipType as string | undefined;
        const isTrafficEdge = relType ? TRAFFIC_EDGE_TYPES.has(relType) : false;
        return {
          ...e,
          animated: isTrafficEdge ? true : (e.animated ?? false),
          style: {
            ...(e.style ?? {}),
            strokeWidth: isTrafficEdge ? 2.5 : 1,
            opacity: isTrafficEdge ? 1 : 0.25,
          },
        };
      });
    }
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
  }, [edges, currentZoom, isExporting, viewMode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onSelectNode(node.id),
    [onSelectNode]
  );
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => onNodeExpand?.(node.id),
    [onNodeExpand]
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
    const category = (n.data as unknown as Record<string, unknown>)?.category ?? "custom";
    const status = (n.data as unknown as Record<string, unknown>)?.status ?? "unknown";
    return minimapNodeColor(category as string, status as string);
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
        fitViewOptions={{ padding: 0.08, minZoom: fitViewMinZoom(nodeCount) }}
        onlyRenderVisibleElements={!isExporting}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        maxZoom={4}
        minZoom={0.01}
        proOptions={{ hideAttribution: true }}
        className="!bg-[#f8f9fb] dark:!bg-slate-950"
      >
        {/* SVG marker definitions for edge arrowheads — must be in DOM for url(#id) references */}
        <svg style={{ position: "absolute", width: 0, height: 0, overflow: "visible" }}>
          <defs>
            {Object.entries(EDGE_COLORS).map(([category, color]) => (
              <g key={category}>
                {/* Filled triangle arrowhead */}
                <marker id={`arrow-filled-${category}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                </marker>
                {/* Open triangle arrowhead */}
                <marker id={`arrow-open-${category}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke={color} strokeWidth={1.5} />
                </marker>
                {/* Diamond arrowhead */}
                <marker id={`arrow-diamond-${category}`} viewBox="0 0 12 12" refX="12" refY="6" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
                  <path d="M 0 6 L 6 0 L 12 6 L 6 12 z" fill={color} />
                </marker>
              </g>
            ))}
          </defs>
        </svg>
        <Background variant={BackgroundVariant.Dots} gap={CANVAS.gridGap} size={CANVAS.gridSize} className="!text-gray-300 dark:!text-slate-800" />
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={0}
          maskColor="rgba(0, 0, 0, 0.06)"
          className="!bg-white dark:!bg-slate-900 !border !border-gray-200 dark:!border-slate-700 !rounded-lg !shadow-md"
          style={{ width: 180, height: 120 }}
          pannable
          zoomable
          aria-label="Minimap navigation"
        />
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          className="!bg-white dark:!bg-slate-800 !border !border-gray-200 dark:!border-slate-700 !rounded-lg !shadow-md [&>button]:dark:!bg-slate-800 [&>button]:dark:!border-slate-700 [&>button]:dark:!fill-gray-300 [&>button:hover]:dark:!bg-slate-700"
          aria-label="Zoom and fit controls"
        />
      </ReactFlow>

      {/* Layout progress overlay */}
      {isLayouting && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-10"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white/95 dark:bg-slate-900/95 px-6 py-4 shadow-lg border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {layoutTimedOut ? "Layout taking too long..." : "Laying out topology..."}
              </span>
            </div>
            {layoutTimedOut && onRequestSimplify && (
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                onClick={onRequestSimplify}
              >
                Try simpler view
              </button>
            )}
          </div>
        </div>
      )}

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
