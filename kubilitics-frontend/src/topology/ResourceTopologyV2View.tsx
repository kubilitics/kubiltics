/**
 * ResourceTopologyV2View — V2 resource-scoped topology using React Flow.
 *
 * Drop-in replacement for the old ResourceTopologyView when FEATURE_TOPOLOGY_V2 is on.
 * Uses the same useResourceTopology hook, transforms data via shared transformGraph,
 * and renders with the v2 React Flow canvas + detail panel.
 */
import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Network, Loader2, AlertCircle, RefreshCw, ZoomIn, ZoomOut, Maximize,
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
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();
  const activeClusterName = useClusterStore((s) => s.activeCluster?.name);
  const fitViewRef = useRef<(() => void) | null>(null);
  const exportCanvasRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode] = useState<ViewMode>("resource");
  const [presentationMode, setPresentationMode] = useState(false);
  const [depth, setDepth] = useState(3);

  const backendConfigured = isBackendConfigured();
  const hasClusterId = !!clusterId;
  const hasKind = !!kind;
  const hasName = !!name;
  const topologySupported = isResourceTopologySupported(kind ?? "");
  const { resourceTopologyKinds } = useCapabilities();
  const supportedKindsLabel = (
    resourceTopologyKinds?.length ? resourceTopologyKinds : RESOURCE_TOPOLOGY_SUPPORTED_KINDS
  ).join(", ");

  // Fetch resource-scoped topology (same hook as old component)
  const { graph, isLoading, isFetching, error, refetch } = useResourceTopology({
    kind,
    namespace,
    name,
    enabled: backendConfigured && hasClusterId && hasKind && hasName && topologySupported,
    depth,
  });

  // Transform engine graph to v2 format
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);
    response.metadata.mode = "resource";
    if (namespace) response.metadata.namespace = namespace;
    return response;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, namespace]);

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

  const handleExportSVG = useCallback(() => {
    const filename = buildExportFilename("svg", exportCtx);
    exportCanvasRef.current?.("svg", filename);
  }, [exportCtx]);

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
      className="relative w-full bg-white rounded-lg border border-gray-200 shadow-sm"
      style={{ height: presentationMode ? "100vh" : "calc(100vh - 18rem)", minHeight: "500px", ...(presentationMode ? { position: "fixed", inset: 0, zIndex: 50, borderRadius: 0 } : {}) }}
      data-topology-container
    >
      {/* Header Bar — hidden in presentation mode */}
      {!presentationMode && <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center">
              <Network className="h-4 w-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Resource Topology</h3>
            <span className="text-xs text-gray-500 bg-blue-50 px-2 py-0.5 rounded-full font-medium">v2</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
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
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          {/* Fit View */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitView}
            className="h-8 px-3 text-xs text-gray-600 hover:text-gray-900"
          >
            <Maximize className="h-3.5 w-3.5 mr-1.5" />
            Fit
          </Button>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 px-3 text-xs text-gray-600 hover:text-gray-900"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>

          <Separator orientation="vertical" className="h-6" />

          {/* Dependency Depth */}
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-[10px] font-medium text-gray-500 whitespace-nowrap">Depth</span>
            <input
              type="range"
              min={1}
              max={5}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-16 h-1 accent-blue-600"
              title={`Dependency depth: ${depth} hops`}
            />
            <span className="text-[11px] font-bold text-gray-700 w-3 text-center">{depth}</span>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Present */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPresentationMode(true)}
            className="h-8 px-3 text-xs text-gray-600 hover:text-gray-900"
          >
            <Monitor className="h-3.5 w-3.5 mr-1.5" />
            Present
          </Button>
        </div>
      </div>}

      {/* Canvas + Detail Panel */}
      <div className={presentationMode ? "flex h-full" : "flex h-[calc(100%-3.5rem)]"}>
        {/* React Flow Canvas */}
        <div className="relative flex-1 min-h-0">
          <TopologyCanvas
            topology={topology}
            selectedNodeId={selectedNodeId}
            highlightNodeIds={highlightNodeIds}
            viewMode={viewMode}
            onSelectNode={setSelectedNodeId}
            exportRef={exportCanvasRef}
            fitViewRef={fitViewRef}
            clusterName={activeClusterName ?? undefined}
            namespace={namespace ?? undefined}
          />

          {/* Resource Count Badge */}
          <div className="absolute bottom-4 right-4 z-50 bg-gray-100 border border-gray-200 rounded-md px-2.5 py-1">
            <span className="text-xs font-medium text-gray-700">
              {topology.nodes.length} Resources &middot; {topology.edges.length} Connections
            </span>
          </div>

          {/* Presentation mode exit button */}
          {presentationMode && (
            <button
              type="button"
              onClick={() => setPresentationMode(false)}
              className="absolute top-4 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/80 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white transition-colors"
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
            onNavigateToResource={handleNavigateToResource}
          />
        )}
      </div>
    </div>
  );
}
