import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { useClusterStore } from "@/stores/clusterStore";

import { TopologyToolbar } from "./TopologyToolbar";
import { TopologyCanvas } from "./TopologyCanvas";
import { TopologyDetailPanel } from "./TopologyDetailPanel";
import { TopologyBreadcrumbs } from "./TopologyBreadcrumbs";
import { TopologyLoadingSkeleton } from "./TopologyLoadingSkeleton";
import { TopologyErrorState, TopologyPartialErrorBanner, TopologyWsDisconnectBanner, TopologySimplifiedBanner } from "./TopologyErrorState";
import { TopologyEmptyState } from "./TopologyEmptyState";
import { HealthLegend } from "./overlays/HealthOverlay";
import {
  useTopologyKeyboard,
  TopologyShortcutsOverlay,
} from "./hooks/useTopologyKeyboard";
import { useTopologyData, DEPTH_LABELS, MAX_VISIBLE_NODES, type DepthLevel } from "./hooks/useTopologyData";
import { useTopologySearch } from "./hooks/useTopologySearch";
import { useTopologyWebSocket } from "./hooks/useTopologyWebSocket";
import { useTopologyStore } from "./store/topologyStore";
import { PresentationOverlay } from "./components/PresentationOverlay";
import { buildExportFilename } from "./export/exportTopology";
import type { ExportFormat } from "./TopologyCanvas";
import { TopologyWelcomeTips } from "./TopologyWelcomeTips";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./types/topology";

// ─── URL Search Params helpers ───────────────────────────────────────────────
// Namespace selection is persisted in URL as ?ns=default or ?ns=blue-green-demo,foo
// This ensures the browser back button restores the correct namespace.

function namespacesFromURL(searchParams: URLSearchParams): Set<string> {
  const raw = searchParams.get("ns");
  if (!raw) return new Set(["default"]);
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : new Set(["default"]);
}

function namespacesToURL(ns: Set<string>): string {
  return Array.from(ns).sort().join(",");
}

export function TopologyPage() {
  const clusterId = useBackendConfigStore((s) => s.currentClusterId) ?? null;
  const clusterName = useClusterStore((s) => s.activeCluster?.name) ?? null;
  const [searchParams, setSearchParams] = useSearchParams();

  // Store state
  const viewMode = useTopologyStore((s) => s.viewMode);
  const healthOverlay = useTopologyStore((s) => s.healthOverlay);
  const presentationMode = useTopologyStore((s) => s.presentationMode);
  const togglePresentationMode = useTopologyStore((s) => s.togglePresentationMode);
  const setViewModeStore = useTopologyStore((s) => s.setViewMode);
  const toggleOverlay = useTopologyStore((s) => s.toggleOverlay);
  const navigateBack = useTopologyStore((s) => s.navigateBack);
  const storeSetData = useTopologyStore((s) => s.setTopologyData);

  // ─── Namespace selection — React state as source of truth ───────────────────
  // Plain useState guarantees re-renders. URL is updated as a side effect.
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(
    () => namespacesFromURL(searchParams)
  );
  const [hasAutoSelectedNs, setHasAutoSelectedNs] = useState(false);

  // One-way sync: state → URL (so browser back/forward can restore namespaces)
  const namespacesKey = useMemo(
    () => namespacesToURL(selectedNamespaces),
    [selectedNamespaces]
  );
  useEffect(() => {
    const currentNs = searchParams.get("ns") ?? "";
    const targetNs = namespacesKey === "default" ? "" : namespacesKey;
    if (currentNs !== targetNs) {
      setSearchParams((prev) => {
        const updated = new URLSearchParams(prev);
        if (targetNs) {
          updated.set("ns", targetNs);
        } else {
          updated.delete("ns");
        }
        return updated;
      }, { replace: true });
    }
  }, [namespacesKey, searchParams, setSearchParams]);

  // Browser back/forward: sync URL → state
  useEffect(() => {
    const onPopState = () => {
      const fromURL = namespacesFromURL(new URLSearchParams(window.location.search));
      setSelectedNamespaces(fromURL);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Progressive disclosure depth — 0 = overview (~15 nodes), 3 = full graph
  const [depth, setDepth] = useState<DepthLevel>(0);

  // Kind filter — empty set means "all kinds visible"
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set());
  // Edge category filter — hidden categories (empty = all visible)
  const [hiddenEdgeCategories, setHiddenEdgeCategories] = useState<Set<string>>(new Set());

  const [resource, setResource] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [simplifiedBannerDismissed, setSimplifiedBannerDismissed] = useState(false);
  const fitViewRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);

  // GUARD: Never allow an empty namespace set in namespace-aware views.
  // Empty set = "All Namespaces" = 735 resources = system freeze.
  const handleNamespaceSelectionChange = useCallback((next: Set<string>) => {
    if (next.size === 0) {
      setSelectedNamespaces(new Set(["default"]));
    } else {
      setSelectedNamespaces(next);
    }
  }, [setSelectedNamespaces]);

  // Helper to build export context
  const getExportCtx = useCallback(() => ({
    viewMode,
    selectedNamespaces,
    clusterName: clusterName ?? undefined,
  }), [viewMode, selectedNamespaces, clusterName]);

  // Data fetching — pass selected namespaces for filtering
  const { topology, allNamespaces, allKinds, allEdgeCategories, isLoading, isFetching, isError, error, refetch, truncated, truncatedTotal, totalUnfiltered } = useTopologyData({
    clusterId,
    viewMode,
    depth,
    selectedNamespaces,
    selectedKinds,
    hiddenEdgeCategories,
    resource: viewMode === "resource" ? resource : undefined,
    enabled: !!clusterId,
  });

  // Auto-select "default" namespace on first data load.
  // If the cluster doesn't have a "default" namespace, pick the first user namespace.
  // Skip if URL already had a namespace set (user navigated back).
  useEffect(() => {
    if (hasAutoSelectedNs || allNamespaces.length === 0) return;
    setHasAutoSelectedNs(true);

    // If the URL already specified a namespace, respect it
    if (searchParams.has("ns")) return;

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
  }, [allNamespaces, hasAutoSelectedNs, searchParams, setSelectedNamespaces]);

  // Reset filters when cluster changes
  useEffect(() => {
    setSelectedNamespaces(new Set(["default"]));
    setDepth(0);
    setSelectedKinds(new Set());
    setHiddenEdgeCategories(new Set());
    setHasAutoSelectedNs(false);
    setSimplifiedBannerDismissed(false);
  }, [clusterId, setSelectedNamespaces]);

  // Reset simplified banner when depth changes
  useEffect(() => {
    setSimplifiedBannerDismissed(false);
  }, [depth]);

  // Sync to store when data arrives
  useEffect(() => {
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

  // Escape key for presentation mode — capture phase so it fires before React Flow
  // can stopPropagation(). React Flow intercepts Escape in bubble phase to deselect
  // nodes, which prevents the window-level listener in useTopologyKeyboard from firing.
  useEffect(() => {
    if (!presentationMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        togglePresentationMode();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [presentationMode, togglePresentationMode]);

  // Keyboard shortcuts — full PRD set
  useTopologyKeyboard({
    onFitView: useCallback(() => fitViewRef.current?.(), []),
    onFocusSearch: useCallback(() => {
      const input = document.querySelector<HTMLInputElement>('[data-topology-search]');
      input?.focus();
    }, []),
    onClearSelection: useCallback(() => {
      if (presentationMode) {
        togglePresentationMode();
      } else if (selectedNodeId) {
        setSelectedNodeId(null);
      } else {
        navigateBack();
      }
    }, [presentationMode, togglePresentationMode, selectedNodeId, navigateBack]),
    onViewMode: useCallback((n: number) => {
      const modes: ViewMode[] = ["namespace", "cluster", "rbac"];
      if (n >= 1 && n <= 3) setViewModeStore(modes[n - 1]);
    }, [setViewModeStore]),
    onToggleHealthOverlay: useCallback(() => toggleOverlay("health"), [toggleOverlay]),
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

  // Double-click a node → increase depth by 1 to reveal children
  const handleNodeExpand = useCallback(() => {
    setDepth((prev) => Math.min(prev + 1, 3) as DepthLevel);
  }, []);

  // "Try simpler view" / "Try Overview mode" — reset depth to 0
  const handleRequestSimplify = useCallback(() => {
    setDepth(0);
  }, []);

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
          onTryOverview={depth > 0 ? handleRequestSimplify : undefined}
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
        onNodeExpand={handleNodeExpand}
        onRequestSimplify={handleRequestSimplify}
        exportRef={exportRef}
        fitViewRef={fitViewRef}
        clusterName={clusterName ?? undefined}
        namespace={activeNamespace}
      />
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-slate-950">
      {/* Toolbar — hidden in presentation mode */}
      {!presentationMode && <TopologyToolbar
        viewMode={viewMode}
        depth={depth}
        totalUnfiltered={totalUnfiltered}
        clusterName={clusterName ?? undefined}
        selectedNamespaces={selectedNamespaces}
        availableNamespaces={allNamespaces}
        selectedKinds={selectedKinds}
        availableKinds={allKinds}
        hiddenEdgeCategories={hiddenEdgeCategories}
        availableEdgeCategories={allEdgeCategories}
        topology={topology}
        exportRef={exportRef}
        getExportCtx={getExportCtx}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onViewModeChange={handleViewModeChange}
        onDepthChange={setDepth}
        onNamespaceSelectionChange={handleNamespaceSelectionChange}
        onKindSelectionChange={setSelectedKinds}
        onEdgeCategoryToggle={setHiddenEdgeCategories}
        onSearchChange={setSearchQuery}
        onSearchSelect={handleSearchSelect}
        onFitView={handleFitView}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        onTogglePresentationMode={togglePresentationMode}
      />}

      {/* Breadcrumbs — hidden in presentation mode */}
      {!presentationMode && <TopologyBreadcrumbs
        viewMode={viewMode}
        namespace={activeNamespace}
        resource={viewMode === "resource" ? resource : null}
        onNavigate={handleViewModeChange}
        onClearNamespace={() => setSelectedNamespaces(new Set(["default"]))}
      />}

      {/* Failed resources warning banner */}
      {topology?.metadata?.failed_resources && topology.metadata.failed_resources.length > 0 && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-2 text-sm rounded-lg mx-4 mt-2",
          "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800",
          "text-amber-800 dark:text-amber-200"
        )}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            Partial topology — failed to fetch: {topology.metadata.failed_resources.join(', ')}
          </span>
        </div>
      )}

      {/* Partial error banner */}
      {warnings.length > 0 && (
        <TopologyPartialErrorBanner
          warnings={warnings}
          onDismiss={() => setWarnings([])}
          onRetry={() => refetch()}
        />
      )}

      {/* Truncation warning — shown when node count exceeds MAX_VISIBLE_NODES */}
      {truncated && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span>
            <strong>Showing {MAX_VISIBLE_NODES} of {truncatedTotal} resources.</strong>
            {" "}Select fewer namespaces for the complete view.
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
            onClick={() => setSelectedNamespaces(new Set(["default"]))}
          >
            Reset to default
          </button>
        </div>
      )}

      {/* Simplified view info banner — shown when depth < 3 and we have data */}
      {!simplifiedBannerDismissed && !truncated && depth < 3 && topology && totalUnfiltered > 0 && topology.nodes.length < totalUnfiltered && (
        <TopologySimplifiedBanner
          visibleCount={topology.nodes.length}
          totalCount={totalUnfiltered}
          depthLabel={DEPTH_LABELS[depth].label.toLowerCase()}
          onDismiss={() => setSimplifiedBannerDismissed(true)}
        />
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 flex-1">
          {renderContent()}
          <HealthLegend visible={healthOverlay && !!topology} />

          {/* Presentation overlay */}
          {presentationMode && topology && (
            <PresentationOverlay
              clusterName={clusterName ?? undefined}
              namespace={activeNamespace}
              nodeCount={topology.nodes.length}
              edgeCount={topology.edges.length}
              onExit={togglePresentationMode}
            />
          )}
        </div>

        {/* Detail panel — hidden in presentation mode */}
        {!presentationMode && (
          <TopologyDetailPanel
            selectedNodeId={selectedNodeId}
            topology={topology ?? null}
            clusterId={clusterId ?? undefined}
            onNavigateToResource={handleNavigateToResource}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
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
