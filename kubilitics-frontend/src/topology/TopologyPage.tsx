import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { useClusterStore } from "@/stores/clusterStore";

import { TopologyToolbar } from "./TopologyToolbar";
import { TopologyCanvas } from "./TopologyCanvas";
import { TopologyDetailPanel } from "./TopologyDetailPanel";
import { TopologyBreadcrumbs } from "./TopologyBreadcrumbs";
import { TopologyLoadingSkeleton } from "./TopologyLoadingSkeleton";
import { TopologyErrorState, TopologyPartialErrorBanner, TopologyWsDisconnectBanner } from "./TopologyErrorState";
import { TopologyEmptyState } from "./TopologyEmptyState";
import { HealthLegend } from "./overlays/HealthOverlay";
import {
  useTopologyKeyboard,
  TopologyShortcutsOverlay,
} from "./hooks/useTopologyKeyboard";
import { useTopologyData } from "./hooks/useTopologyData";
import { useTopologySearch } from "./hooks/useTopologySearch";
import { useTopologyWebSocket } from "./hooks/useTopologyWebSocket";
import { useTopologyStore } from "./store/topologyStore";
import { buildExportFilename } from "./export/exportTopology";
import type { ExportFormat } from "./TopologyCanvas";
import { TopologyWelcomeTips } from "./TopologyWelcomeTips";
import type { ViewMode } from "./types/topology";

export function TopologyPage() {
  const clusterId = useBackendConfigStore((s) => s.currentClusterId) ?? null;
  const clusterName = useClusterStore((s) => s.activeCluster?.name) ?? null;

  // Store state
  const viewMode = useTopologyStore((s) => s.viewMode);
  const healthOverlay = useTopologyStore((s) => s.healthOverlay);
  const setViewModeStore = useTopologyStore((s) => s.setViewMode);
  const toggleOverlay = useTopologyStore((s) => s.toggleOverlay);
  const navigateBack = useTopologyStore((s) => s.navigateBack);
  const storeSetData = useTopologyStore((s) => s.setTopologyData);

  // Default to "default" namespace (like kubectl) to avoid loading ALL namespaces at once
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set(["default"]));
  const [hasAutoSelectedNs, setHasAutoSelectedNs] = useState(false);
  const [resource, setResource] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fitViewRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);

  // GUARD: Never allow an empty namespace set in namespace-aware views.
  // Empty set = "All Namespaces" = 735 resources = system freeze.
  // When the user deselects the last namespace (e.g. to switch to a different one),
  // keep "default" as fallback so the UI stays responsive.
  const handleNamespaceSelectionChange = useCallback((next: Set<string>) => {
    if (next.size === 0) {
      setSelectedNamespaces(new Set(["default"]));
    } else {
      setSelectedNamespaces(next);
    }
  }, []);

  // Helper to build export context
  const getExportCtx = useCallback(() => ({
    viewMode,
    selectedNamespaces,
    clusterName: clusterName ?? undefined,
  }), [viewMode, selectedNamespaces, clusterName]);

  // Data fetching — pass selected namespaces for filtering
  const { topology, allNamespaces, isLoading, isError, error, refetch } = useTopologyData({
    clusterId,
    viewMode,
    selectedNamespaces,
    resource: viewMode === "resource" ? resource : undefined,
    enabled: !!clusterId,
  });

  // Auto-select "default" namespace on first data load.
  // If the cluster doesn't have a "default" namespace, pick the first user namespace.
  useEffect(() => {
    if (hasAutoSelectedNs || allNamespaces.length === 0) return;
    setHasAutoSelectedNs(true);

    if (allNamespaces.includes("default")) {
      // "default" exists — keep the initial selection
      return;
    }
    // No "default" namespace — pick the first non-system namespace
    const firstUserNs = allNamespaces.find(
      (ns) => !ns.startsWith("kube-")
    );
    if (firstUserNs) {
      setSelectedNamespaces(new Set([firstUserNs]));
    }
  }, [allNamespaces, hasAutoSelectedNs]);

  // Reset namespace selection when cluster changes
  useEffect(() => {
    setSelectedNamespaces(new Set(["default"]));
    setHasAutoSelectedNs(false);
  }, [clusterId]);

  // Sync to store when data arrives
  useMemo(() => {
    if (topology) storeSetData(topology);
  }, [topology, storeSetData]);

  // Search
  const { query: searchQuery, setQuery: setSearchQuery, results: searchResults } =
    useTopologySearch(topology?.nodes);

  // WebSocket for real-time updates
  const { connected: wsConnected } = useTopologyWebSocket({
    clusterId,
    enabled: !!clusterId && !!topology,
    onNodeUpdated: useCallback((node) => {
      useTopologyStore.getState().updateNode(node);
    }, []),
    onNodeAdded: useCallback((node) => {
      useTopologyStore.getState().addNode(node);
    }, []),
    onNodeRemoved: useCallback((id) => {
      useTopologyStore.getState().removeNode(id);
    }, []),
  });

  // Keyboard shortcuts — full PRD set
  useTopologyKeyboard({
    onFitView: useCallback(() => fitViewRef.current?.(), []),
    onFocusSearch: useCallback(() => {
      const input = document.querySelector<HTMLInputElement>('[data-topology-search]');
      input?.focus();
    }, []),
    onClearSelection: useCallback(() => {
      if (selectedNodeId) {
        setSelectedNodeId(null);
      } else {
        navigateBack();
      }
    }, [selectedNodeId, navigateBack]),
    onViewMode: useCallback((n: number) => {
      const modes: ViewMode[] = ["cluster", "namespace", "workload", "resource", "rbac"];
      if (n >= 1 && n <= 5) setViewModeStore(modes[n - 1]);
    }, [setViewModeStore]),
    onToggleHealthOverlay: useCallback(() => toggleOverlay("health"), [toggleOverlay]),
    onToggleCostOverlay: useCallback(() => toggleOverlay("cost"), [toggleOverlay]),
    onScreenshot: useCallback(() => {
      const filename = buildExportFilename("png", getExportCtx());
      exportRef.current?.("png", filename);
    }, [getExportCtx]),
    onShowHelp: useCallback(() => setShowHelp((v) => !v), []),
    onNavigateBack: useCallback(() => navigateBack(), [navigateBack]),
  });

  // Navigate to resource (from detail panel or search)
  const handleNavigateToResource = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (viewMode === "resource") {
      setResource(nodeId);
    }
  }, [viewMode]);

  const handleSearchSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSearchQuery("");
  }, [setSearchQuery]);

  const handleFitView = useCallback(() => {
    fitViewRef.current?.();
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewModeStore(mode);
    setSelectedNodeId(null);
  }, [setViewModeStore]);

  // Highlight node IDs from search
  const highlightNodeIds = useMemo(
    () => searchResults.map((r) => r.node.id),
    [searchResults]
  );

  // Breadcrumb namespace display
  const activeNamespace = selectedNamespaces.size === 1
    ? Array.from(selectedNamespaces)[0]
    : null;

  // Render main content area
  const renderContent = () => {
    if (isError && !topology) {
      return (
        <TopologyErrorState
          error={error?.message ?? "Failed to load topology"}
          onRetry={() => refetch()}
        />
      );
    }

    if (isLoading && !topology) {
      return <TopologyLoadingSkeleton viewMode={viewMode} />;
    }

    if (!clusterId) {
      return <TopologyEmptyState type="no-cluster" />;
    }

    if (!topology || topology.nodes.length === 0) {
      return (
        <TopologyEmptyState
          type={selectedNamespaces.size > 0 ? "empty-namespace" : "empty-cluster"}
          clusterId={clusterId}
          namespace={activeNamespace ?? undefined}
        />
      );
    }

    if (searchQuery && searchResults.length === 0) {
      return (
        <TopologyEmptyState
          type="no-search-results"
          searchQuery={searchQuery}
        />
      );
    }

    return (
      <TopologyCanvas
        topology={topology}
        selectedNodeId={selectedNodeId}
        highlightNodeIds={highlightNodeIds}
        viewMode={viewMode}
        onSelectNode={setSelectedNodeId}
        exportRef={exportRef}
        fitViewRef={fitViewRef}
      />
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Toolbar */}
      <TopologyToolbar
        viewMode={viewMode}
        clusterName={clusterName ?? undefined}
        selectedNamespaces={selectedNamespaces}
        availableNamespaces={allNamespaces}
        topology={topology}
        exportRef={exportRef}
        getExportCtx={getExportCtx}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onViewModeChange={handleViewModeChange}
        onNamespaceSelectionChange={handleNamespaceSelectionChange}
        onSearchChange={setSearchQuery}
        onSearchSelect={handleSearchSelect}
        onFitView={handleFitView}
      />

      {/* Breadcrumbs — clickable for back-navigation */}
      <TopologyBreadcrumbs
        viewMode={viewMode}
        namespace={activeNamespace}
        resource={viewMode === "resource" ? resource : null}
        onNavigate={handleViewModeChange}
        onClearNamespace={() => setSelectedNamespaces(new Set(["default"]))}
      />

      {/* Partial error banner */}
      {warnings.length > 0 && (
        <TopologyPartialErrorBanner
          warnings={warnings}
          onDismiss={() => setWarnings([])}
          onRetry={() => refetch()}
        />
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 flex-1">
          {renderContent()}
          <HealthLegend visible={healthOverlay && !!topology} />
        </div>

        {/* Detail panel */}
        <TopologyDetailPanel
          selectedNodeId={selectedNodeId}
          topology={topology ?? null}
          onNavigateToResource={handleNavigateToResource}
        />
      </div>

      {/* WebSocket disconnect banner */}
      {!wsConnected && topology && <TopologyWsDisconnectBanner />}

      {/* Keyboard shortcuts modal */}
      <TopologyShortcutsOverlay
        visible={showHelp}
        onClose={() => setShowHelp(false)}
      />

      {/* First-time welcome tips */}
      <TopologyWelcomeTips />
    </div>
  );
}
