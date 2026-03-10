import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode, TopologyResponse, TopologyNode, TopologyEdge, TopologyGroup } from "../types/topology";

export interface BreadcrumbItem {
  label: string;
  viewMode: ViewMode;
  namespace?: string;
  resource?: string;
}

export interface NavigationEntry {
  viewMode: ViewMode;
  namespace?: string;
  resource?: string;
  selectedNodeId?: string;
}

export interface TopologyState {
  // Data
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
  metadata: TopologyResponse["metadata"] | null;

  // View
  viewMode: ViewMode;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focusResourceId: string | null;

  // Navigation
  breadcrumbs: BreadcrumbItem[];
  navigationStack: NavigationEntry[];

  // Filters
  namespaceFilter: string | null;
  kindFilter: string[];
  statusFilter: string[];
  searchQuery: string;

  // Overlays
  healthOverlay: boolean;
  costOverlay: boolean;
  trafficOverlay: boolean;
  securityOverlay: boolean;

  // Viewport
  zoom: number;
  position: { x: number; y: number };

  // Loading
  isLoading: boolean;
  error: string | null;
  warnings: string[];

  // WebSocket
  wsConnected: boolean;
  lastUpdateTime: string | null;

  // Actions
  setTopologyData: (response: TopologyResponse) => void;
  setViewMode: (mode: ViewMode, params?: { namespace?: string; resource?: string }) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  deselectAll: () => void;
  navigateToResource: (kind: string, ns: string, name: string) => void;
  navigateBack: () => void;
  addNode: (node: TopologyNode) => void;
  updateNode: (node: TopologyNode) => void;
  removeNode: (id: string) => void;
  setSearch: (query: string) => void;
  setNamespaceFilter: (ns: string | null) => void;
  setKindFilter: (kinds: string[]) => void;
  setStatusFilter: (statuses: string[]) => void;
  toggleOverlay: (name: "health" | "cost" | "traffic" | "security") => void;
  setZoom: (zoom: number) => void;
  setPosition: (pos: { x: number; y: number }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setWarnings: (warnings: string[]) => void;
  setWsConnected: (connected: boolean) => void;
  setLastUpdateTime: (time: string | null) => void;
}

function buildBreadcrumbs(
  viewMode: ViewMode,
  namespace?: string,
  resource?: string
): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [
    { label: "Cluster", viewMode: "cluster" },
  ];

  if (viewMode === "cluster") return crumbs;

  if (namespace) {
    crumbs.push({ label: namespace, viewMode: "namespace", namespace });
  }

  if (viewMode === "workload" && resource) {
    crumbs.push({ label: resource.split("/").pop() ?? resource, viewMode: "workload", namespace, resource });
  }

  if (viewMode === "resource" && resource) {
    const parts = resource.split("/");
    const name = parts.pop() ?? resource;
    const kind = parts[0] ?? "";
    crumbs.push({ label: `${kind}/${name}`, viewMode: "resource", namespace, resource });
  }

  if (viewMode === "rbac") {
    crumbs.push({ label: "RBAC", viewMode: "rbac", namespace });
  }

  return crumbs;
}

export const useTopologyStore = create<TopologyState>()(
  persist(
    (set, get) => ({
      // Initial state
      nodes: [],
      edges: [],
      groups: [],
      metadata: null,
      viewMode: "namespace",
      selectedNodeId: null,
      selectedEdgeId: null,
      focusResourceId: null,
      breadcrumbs: [{ label: "Cluster", viewMode: "cluster" }],
      navigationStack: [],
      namespaceFilter: null,
      kindFilter: [],
      statusFilter: [],
      searchQuery: "",
      healthOverlay: true,
      costOverlay: false,
      trafficOverlay: false,
      securityOverlay: false,
      zoom: 1,
      position: { x: 0, y: 0 },
      isLoading: false,
      error: null,
      warnings: [],
      wsConnected: false,
      lastUpdateTime: null,

      // Actions
      setTopologyData: (response) =>
        set({
          nodes: response.nodes,
          edges: response.edges,
          groups: response.groups,
          metadata: response.metadata,
          isLoading: false,
          error: null,
        }),

      setViewMode: (mode, params) => {
        const state = get();
        // Push current state to navigation stack
        const entry: NavigationEntry = {
          viewMode: state.viewMode,
          namespace: state.namespaceFilter ?? undefined,
          resource: state.focusResourceId ?? undefined,
          selectedNodeId: state.selectedNodeId ?? undefined,
        };
        set({
          viewMode: mode,
          namespaceFilter: params?.namespace ?? state.namespaceFilter,
          focusResourceId: params?.resource ?? null,
          selectedNodeId: null,
          selectedEdgeId: null,
          navigationStack: [...state.navigationStack, entry],
          breadcrumbs: buildBreadcrumbs(mode, params?.namespace ?? state.namespaceFilter ?? undefined, params?.resource),
        });
      },

      selectNode: (id) =>
        set({ selectedNodeId: id, selectedEdgeId: null }),

      selectEdge: (id) =>
        set({ selectedEdgeId: id, selectedNodeId: null }),

      deselectAll: () =>
        set({ selectedNodeId: null, selectedEdgeId: null }),

      navigateToResource: (kind, ns, name) => {
        const resourceId = ns ? `${kind}/${ns}/${name}` : `${kind}/${name}`;
        const state = get();
        const entry: NavigationEntry = {
          viewMode: state.viewMode,
          namespace: state.namespaceFilter ?? undefined,
          resource: state.focusResourceId ?? undefined,
          selectedNodeId: state.selectedNodeId ?? undefined,
        };
        set({
          viewMode: "resource",
          focusResourceId: resourceId,
          selectedNodeId: resourceId,
          selectedEdgeId: null,
          namespaceFilter: ns || state.namespaceFilter,
          navigationStack: [...state.navigationStack, entry],
          breadcrumbs: buildBreadcrumbs("resource", ns || state.namespaceFilter ?? undefined, resourceId),
        });
      },

      navigateBack: () => {
        const { navigationStack } = get();
        if (navigationStack.length === 0) return;
        const prev = navigationStack[navigationStack.length - 1];
        set({
          viewMode: prev.viewMode,
          namespaceFilter: prev.namespace ?? null,
          focusResourceId: prev.resource ?? null,
          selectedNodeId: prev.selectedNodeId ?? null,
          selectedEdgeId: null,
          navigationStack: navigationStack.slice(0, -1),
          breadcrumbs: buildBreadcrumbs(prev.viewMode, prev.namespace, prev.resource),
        });
      },

      addNode: (node) =>
        set((s) => ({ nodes: [...s.nodes, node] })),

      updateNode: (node) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === node.id ? node : n)),
        })),

      removeNode: (id) =>
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        })),

      setSearch: (query) => set({ searchQuery: query }),
      setNamespaceFilter: (ns) => set({ namespaceFilter: ns }),
      setKindFilter: (kinds) => set({ kindFilter: kinds }),
      setStatusFilter: (statuses) => set({ statusFilter: statuses }),

      toggleOverlay: (name) =>
        set((s) => ({
          [`${name}Overlay`]: !s[`${name}Overlay` as keyof TopologyState],
        } as Partial<TopologyState>)),

      setZoom: (zoom) => set({ zoom }),
      setPosition: (position) => set({ position }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setWarnings: (warnings) => set({ warnings }),
      setWsConnected: (wsConnected) => set({ wsConnected }),
      setLastUpdateTime: (lastUpdateTime) => set({ lastUpdateTime }),
    }),
    {
      name: "topology-store",
      partialize: (state) => ({
        viewMode: state.viewMode,
        healthOverlay: state.healthOverlay,
        costOverlay: state.costOverlay,
        trafficOverlay: state.trafficOverlay,
        securityOverlay: state.securityOverlay,
      }),
    }
  )
);

// Derived state selectors
export const selectDimmedNodeIds = (state: TopologyState): Set<string> => {
  if (!state.selectedNodeId) return new Set();
  const connectedIds = new Set<string>();
  connectedIds.add(state.selectedNodeId);
  for (const edge of state.edges) {
    if (edge.source === state.selectedNodeId) connectedIds.add(edge.target);
    if (edge.target === state.selectedNodeId) connectedIds.add(edge.source);
  }
  return new Set(state.nodes.filter((n) => !connectedIds.has(n.id)).map((n) => n.id));
};

export const selectVisibleNodes = (state: TopologyState): TopologyNode[] => {
  let nodes = state.nodes;
  if (state.kindFilter.length > 0) {
    nodes = nodes.filter((n) => state.kindFilter.includes(n.kind));
  }
  if (state.statusFilter.length > 0) {
    nodes = nodes.filter((n) => state.statusFilter.includes(n.status));
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    nodes = nodes.filter((n) =>
      n.name.toLowerCase().includes(q) ||
      n.kind.toLowerCase().includes(q) ||
      n.namespace.toLowerCase().includes(q)
    );
  }
  return nodes;
};

export const selectConnectionCount = (state: TopologyState): number => {
  if (!state.selectedNodeId) return 0;
  return state.edges.filter(
    (e) => e.source === state.selectedNodeId || e.target === state.selectedNodeId
  ).length;
};
