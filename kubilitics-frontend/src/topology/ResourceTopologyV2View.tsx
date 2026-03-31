/**
 * ResourceTopologyV2View — V2 resource-scoped topology using React Flow.
 *
 * Drop-in replacement for the old ResourceTopologyView when FEATURE_TOPOLOGY_V2 is on.
 * Uses the same useResourceTopology hook, transforms data via shared transformGraph,
 * and renders with the v2 React Flow canvas + detail panel.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Network, Loader2, AlertCircle, RefreshCw, Maximize, Crosshair,
  FileJson, FileImage, Layers, ExternalLink, ChevronDown, Map as MapIcon, Monitor, X, GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { useResourceTopology } from "@/hooks/useResourceTopology";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { useClusterStore } from "@/stores/clusterStore";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { useCapabilities } from "@/hooks/useCapabilities";
import {
  isResourceTopologySupported,
  RESOURCE_TOPOLOGY_SUPPORTED_KINDS,
} from "@/utils/resourceKindMapper";

import { TopologyCanvas } from "./TopologyCanvas";
import { TopologyDetailPanel } from "./TopologyDetailPanel";
import { transformGraph } from "./utils/transformGraph";
import {
  exportTopologyJSON,
  buildExportFilename,
  type ExportContext,
} from "./export/exportTopology";
import type { ExportFormat } from "./TopologyCanvas";
import type { TopologyResponse, ViewMode } from "./types/topology";
import { exportTopologyCSV } from "./export/exportCSV";

export interface ResourceTopologyV2ViewProps {
  kind: string;
  namespace?: string | null;
  name?: string | null;
  sourceResourceType?: string;
  sourceResourceName?: string;
}

export function ResourceTopologyV2View({
  kind,
  namespace,
  name,
}: ResourceTopologyV2ViewProps) {
  const navigate = useNavigate();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const clusterId = useActiveClusterId();
  const activeClusterName = useClusterStore((s) => s.activeCluster?.name);
  const fitViewRef = useRef<(() => void) | null>(null);
  const exportCanvasRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);
  const centerOnNodeRef = useRef<((nodeId: string) => void) | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode] = useState<ViewMode>("resource");
  const [presentationMode, setPresentationMode] = useState(false);
  const [viewLevel, setViewLevel] = useState<'direct' | 'extended' | 'full'>('direct');
  const [expandedFullScreen, setExpandedFullScreen] = useState(false);

  // ESC key closes full-screen expand
  useEffect(() => {
    if (!expandedFullScreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedFullScreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedFullScreen]);

  const backendConfigured = isBackendConfigured;
  const hasClusterId = !!clusterId;
  const hasKind = !!kind;
  const hasName = !!name;
  const topologySupported = isResourceTopologySupported(kind ?? "");
  const { resourceTopologyKinds } = useCapabilities();
  const supportedKindsLabel = (
    resourceTopologyKinds?.length ? resourceTopologyKinds : RESOURCE_TOPOLOGY_SUPPORTED_KINDS
  ).join(", ");

  const canFetch = backendConfigured && hasClusterId && hasKind && hasName && topologySupported;

  // Single fetch — depth changes based on viewLevel
  const depth = viewLevel === 'direct' ? 1 : viewLevel === 'extended' ? 2 : 3;
  const { graph, isLoading, isFetching, error, refetch } = useResourceTopology({
    kind,
    namespace,
    name,
    enabled: canFetch,
    depth,
  });

  // Transform engine graph to v2 format
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);
    response.metadata.mode = "resource";
    if (namespace) response.metadata.namespace = namespace;
    const focusId = response.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace)
    )?.id;
    if (focusId) response.metadata.focusResource = focusId;
    return response;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, namespace, kind, name]);

  // Highlight the focused resource node
  const highlightNodeIds = useMemo(() => {
    if (!kind || !name || !topology) return [];
    // Try to find the current resource in the graph
    const currentId = topology.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace)
    )?.id;
    return currentId ? [currentId] : [];
  }, [topology, kind, name, namespace]);

  // Navigation from detail panel
  const handleNavigateToResource = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleFitView = useCallback(() => {
    fitViewRef.current?.();
  }, []);

  // Center on the focus resource node
  const handleCenterOnFocus = useCallback(() => {
    if (!highlightNodeIds.length) return;
    centerOnNodeRef.current?.(highlightNodeIds[0]);
  }, [highlightNodeIds]);

  // Exports
  const exportCtx: ExportContext = useMemo(() => ({
    viewMode: "resource" as const,
    selectedNamespaces: namespace ? new Set([namespace]) : new Set<string>(),
    clusterName: activeClusterName ?? undefined,
    resourceName: name ?? undefined,
    resourceKind: kind ?? undefined,
  }), [namespace, activeClusterName, name, kind]);

  const handleExportJSON = useCallback(() => {
    if (!topology) return;
    exportTopologyJSON(topology, exportCtx);
    toast.success("JSON exported");
  }, [topology, exportCtx]);

  const handleExportPNG = useCallback(() => {
    const filename = buildExportFilename("png", exportCtx);
    exportCanvasRef.current?.("png", filename);
  }, [exportCtx]);

  const handleExportCSV = useCallback(async () => {
    if (!topology || !clusterId) return;
    const { getEffectiveBackendBaseUrl, useBackendConfigStore } = await import('@/stores/backendConfigStore');
    const baseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    await exportTopologyCSV(topology, baseUrl, clusterId, exportCtx);
  }, [topology, clusterId, exportCtx]);

  const handleExportSVG = useCallback(() => {
    const filename = buildExportFilename("svg", exportCtx);
    exportCanvasRef.current?.("svg", filename);
  }, [exportCtx]);

  // Double-click a node: step up one view level
  const handleNodeExpand = useCallback((_nodeId: string) => {
    setViewLevel((prev) => (prev === 'direct' ? 'extended' : prev));
  }, []);

  // --- Conditional renders (all hooks called above) ---

  if (!backendConfigured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-2">Connect to Kubilitics backend to view topology</p>
        <p className="text-sm text-muted-foreground">Go to Settings to configure the backend connection</p>
      </div>
    );
  }

  if (!hasClusterId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select a cluster to view topology</p>
      </div>
    );
  }

  if (!topologySupported) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground font-medium mb-2">Topology is not available for this resource type</p>
        <p className="text-sm text-muted-foreground mb-2">
          Resource-scoped topology is supported for: {supportedKindsLabel}.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate("/topology")}>
          <MapIcon className="h-3.5 w-3.5 mr-1.5" />
          View full cluster topology
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">Loading topology...</p>
      </div>
    );
  }

  if (error) {
    const msg = error.message || String(error);
    const isNotFound = msg.toLowerCase().includes("not found") || msg.includes("404");
    const isTimeout = msg.toLowerCase().includes("timeout");
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">
          {isNotFound ? "Resource not found" : isTimeout ? "Topology build timed out" : "Failed to load topology"}
        </p>
        <p className="text-sm text-muted-foreground mb-4">{msg}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Retry
        </Button>
      </div>
    );
  }

  if (!topology || topology.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-2 font-medium">No connections found</p>
        <p className="text-sm text-muted-foreground max-w-md">
          This resource isn&apos;t connected to other resources in this namespace.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm"
      style={{ height: presentationMode ? "100vh" : "calc(100vh - 18rem)", minHeight: "500px", ...(presentationMode ? { position: "fixed", inset: 0, zIndex: 200, borderRadius: 0 } : {}) }}
      data-topology-container
    >
      {/* Header Bar — hidden in presentation mode */}
      {!presentationMode && <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-t-lg">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
              <Network className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Resource Topology</h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40"
            onClick={() => navigate("/topology")}
          >
            <MapIcon className="h-3.5 w-3.5 mr-1" />
            Full Cluster Topology
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5">
                <FileImage className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportPNG}>
                <FileImage className="h-3.5 w-3.5 mr-2" /> PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportSVG}>
                <FileImage className="h-3.5 w-3.5 mr-2" /> SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileJson className="h-3.5 w-3.5 mr-2" /> CSV (with resource details)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          {/* Toolbar icons — compact, tooltip-only */}
          <Button variant="ghost" size="sm" onClick={handleFitView} className="h-8 w-8 p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="Fit to view">
            <Maximize className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCenterOnFocus} className="h-8 w-8 p-0 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40" title={`Center on ${name}`}>
            <Crosshair className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpandedFullScreen(true)} className="h-8 w-8 p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="Expand full screen">
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 w-8 p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>

          <Separator orientation="vertical" className="h-6" />

          {/* View Level */}
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {(['direct', 'extended', 'full'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setViewLevel(level)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    viewLevel === level
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {level === 'direct' ? 'Direct' : level === 'extended' ? 'Extended' : 'Full'}
                </button>
              ))}
            </div>
          </div>

          <Separator orientation="vertical" className="h-6" />

          <Button variant="ghost" size="sm" onClick={() => setPresentationMode(true)} className="h-8 w-8 p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="Presentation mode">
            <Monitor className="h-4 w-4" />
          </Button>
        </div>
      </div>}

      {/* Canvas + Detail Panel */}
      <div className={presentationMode ? "flex h-full" : "flex h-[calc(100%-3.5rem)]"}>
        {/* React Flow Canvas */}
        <div className="relative flex-1 min-h-0">
          <TopologyCanvas
            key={expandedFullScreen ? 'normal-while-fullscreen' : 'normal'}
            topology={topology}
            selectedNodeId={selectedNodeId}
            highlightNodeIds={highlightNodeIds}
            viewMode={viewMode}
            onSelectNode={setSelectedNodeId}
            onNodeExpand={handleNodeExpand}
            exportRef={expandedFullScreen ? undefined : exportCanvasRef}
            fitViewRef={expandedFullScreen ? undefined : fitViewRef}
            centerOnNodeRef={expandedFullScreen ? undefined : centerOnNodeRef}
            clusterName={activeClusterName ?? undefined}
            namespace={namespace ?? undefined}
          />

          {/* Resource Count Badge */}
          <div className="absolute bottom-4 right-4 z-50 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md px-2.5 py-1">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {topology.nodes.length} Resources &middot; {topology.edges.length} Connections
            </span>
          </div>

          {/* Presentation mode exit button */}
          {presentationMode && (
            <button
              type="button"
              onClick={() => setPresentationMode(false)}
              className="absolute top-4 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-white/20 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 shadow-md hover:bg-white dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Exit
            </button>
          )}
        </div>

        {/* Detail Panel — hidden in presentation mode */}
        {!presentationMode && (
          <TopologyDetailPanel
            selectedNodeId={selectedNodeId}
            topology={topology}
            clusterId={clusterId ?? undefined}
            onNavigateToResource={handleNavigateToResource}
          />
        )}
      </div>

      {/* Full-screen expand — triggered by Expand button, works for any mode */}
      {expandedFullScreen && createPortal(
        <div className="fixed inset-0 pt-20 z-[200] flex flex-col bg-white dark:bg-slate-950">
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Layers className="h-4 w-4 text-blue-600" />
              {name} ({kind}) — {viewLevel === 'direct' ? 'Direct' : viewLevel === 'extended' ? 'Extended' : 'Full'}
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                    <FileImage className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[300]">
                  <DropdownMenuItem onClick={handleExportPNG}>
                    <FileImage className="h-3.5 w-3.5 mr-2" /> PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportSVG}>
                    <FileImage className="h-3.5 w-3.5 mr-2" /> SVG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportJSON}>
                    <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" onClick={handleFitView} className="h-7 px-2 text-xs">
                <Maximize className="h-3.5 w-3.5 mr-1" /> Fit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExpandedFullScreen(false)} className="h-7 px-2 text-xs">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 relative min-h-0">
            <TopologyCanvas
              topology={topology}
              selectedNodeId={selectedNodeId}
              highlightNodeIds={highlightNodeIds}
              viewMode={viewMode}
              onSelectNode={setSelectedNodeId}
              fitViewRef={fitViewRef}
              exportRef={exportCanvasRef}
              centerOnNodeRef={centerOnNodeRef}
              clusterName={activeClusterName ?? undefined}
              namespace={namespace ?? undefined}
            />
            {topology && (
              <div className="absolute bottom-4 right-4 z-50 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md px-2.5 py-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {topology.nodes.length} Resources &middot; {topology.edges.length} Connections
                </span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
