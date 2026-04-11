import { useState, useCallback, useRef, useMemo } from "react";
import {
  Search, Download, Maximize, ChevronDown, FileJson, FileImage, FileType, FileSpreadsheet,
  Filter, X, Layers, GitBranch, Check, Monitor, RefreshCw, Network,
  Box, Route, LayoutDashboard, Settings,
} from "lucide-react";
import { DEPTH_LABELS, type DepthLevel } from "./hooks/useTopologyData";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewModeSelect } from "./components/ViewModeSelect";
import type { ViewMode, TopologyResponse } from "./types/topology";
import {
  exportTopologyJSON,
  exportTopologyDrawIO,
  buildExportFilename,
  type ExportContext,
} from "./export/exportTopology";
import type { ExportFormat } from "./TopologyCanvas";
import { exportTopologyPDF } from "./export/exportPDF";
import { exportTopologyCSV } from "./export/exportCSV";
import type { SearchResult } from "./hooks/useTopologySearch";
import { K8sIcon } from "./icons/K8sIcon";
import { toast } from "sonner";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";

export interface TopologyToolbarProps {
  viewMode?: ViewMode;
  depth?: DepthLevel;
  totalUnfiltered?: number;
  namespace?: string;
  clusterName?: string;
  selectedNamespaces?: Set<string>;
  availableNamespaces?: string[];
  selectedKinds?: Set<string>;
  availableKinds?: string[];
  hiddenEdgeCategories?: Set<string>;
  availableEdgeCategories?: string[];
  topology?: TopologyResponse | null;
  searchQuery?: string;
  searchResults?: SearchResult[];
  exportRef?: React.MutableRefObject<((format: ExportFormat, filename: string) => void) | null>;
  getExportCtx?: () => ExportContext;
  onViewModeChange?: (mode: ViewMode) => void;
  onDepthChange?: (depth: DepthLevel) => void;
  onNamespaceChange?: (ns: string) => void;
  onNamespaceSelectionChange?: (selected: Set<string>) => void;
  onKindSelectionChange?: (selected: Set<string>) => void;
  onEdgeCategoryToggle?: (hidden: Set<string>) => void;
  onSearchChange?: (query: string) => void;
  onSearchSelect?: (nodeId: string) => void;
  onFitView?: () => void;
  onRefresh?: () => void;
  isFetching?: boolean;
  onTogglePresentationMode?: () => void;
}

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

export function TopologyToolbar({
  viewMode = "namespace",
  depth = 0,
  totalUnfiltered = 0,
  clusterName,
  selectedNamespaces = new Set(),
  availableNamespaces = [],
  selectedKinds = new Set(),
  availableKinds = [],
  hiddenEdgeCategories = new Set(),
  availableEdgeCategories = [],
  topology,
  searchQuery = "",
  searchResults = [],
  onViewModeChange,
  onDepthChange,
  onNamespaceSelectionChange,
  onKindSelectionChange,
  onEdgeCategoryToggle,
  onSearchChange,
  onSearchSelect,
  onFitView,
  onRefresh,
  isFetching,
  onTogglePresentationMode,
  exportRef,
  getExportCtx,
}: TopologyToolbarProps) {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const clusterId = useActiveClusterId();
  const [isExportingArch, setIsExportingArch] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
    setShowSearchResults(true);
  }, [onSearchChange]);

  const handleSearchSelect = useCallback((nodeId: string) => {
    onSearchSelect?.(nodeId);
    setShowSearchResults(false);
  }, [onSearchSelect]);

  // Namespace grouping
  const userNamespaces = useMemo(
    () => availableNamespaces.filter((ns) => !SYSTEM_NAMESPACES.has(ns) && !ns.startsWith("kube-")).sort(),
    [availableNamespaces]
  );
  const systemNamespaces = useMemo(
    () => availableNamespaces.filter((ns) => SYSTEM_NAMESPACES.has(ns) || ns.startsWith("kube-")).sort(),
    [availableNamespaces]
  );

  const toggleNamespace = useCallback((ns: string) => {
    const next = new Set(selectedNamespaces);
    if (next.has(ns)) {
      next.delete(ns);
    } else {
      next.add(ns);
    }
    // Parent handler (TopologyPage) guards against empty set → falls back to "default"
    onNamespaceSelectionChange?.(next);
  }, [selectedNamespaces, onNamespaceSelectionChange]);

  const toggleKind = useCallback((kind: string) => {
    const next = new Set(selectedKinds);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onKindSelectionChange?.(next);
  }, [selectedKinds, onKindSelectionChange]);

  const toggleEdgeCategory = useCallback((cat: string) => {
    const next = new Set(hiddenEdgeCategories);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    onEdgeCategoryToggle?.(next);
  }, [hiddenEdgeCategories, onEdgeCategoryToggle]);

  const nsLabel = selectedNamespaces.size === 1
    ? Array.from(selectedNamespaces)[0]
    : `${selectedNamespaces.size} namespaces`;

  const hasNamespaceFilter = selectedNamespaces.size > 0;
  const hasKindFilter = selectedKinds.size > 0;
  const kindLabel = selectedKinds.size === 0
    ? "All kinds"
    : selectedKinds.size === 1
      ? Array.from(selectedKinds)[0]
      : `${selectedKinds.size} kinds`;
  const hasEdgeFilter = hiddenEdgeCategories.size > 0;
  const edgeLabel = hiddenEdgeCategories.size === 0
    ? "All edges"
    : `${availableEdgeCategories.length - hiddenEdgeCategories.size}/${availableEdgeCategories.length} categories`;

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-card shadow-sm">
      {/* Main toolbar row — wraps to two lines when space is tight */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">

        {/* ── View Mode Selector ── */}
        <ViewModeSelect value={viewMode} onChange={onViewModeChange} />

        {/* ── Depth Selector (progressive disclosure) ── */}
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 dark:via-slate-600 to-transparent" />
        <div className="flex items-center rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          {([0, 1, 2, 3] as DepthLevel[]).map((d) => {
            const isActive = depth === d;
            const Icon = d === 0 ? LayoutDashboard : d === 1 ? Box : d === 2 ? Settings : Network;
            return (
              <button
                key={d}
                type="button"
                title={`${DEPTH_LABELS[d].label} — ${DEPTH_LABELS[d].description}`}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                  isActive
                    ? "bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-inner"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
                } ${d > 0 ? "border-l border-gray-200 dark:border-slate-700" : ""}`}
                onClick={() => onDepthChange?.(d)}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden lg:inline">{DEPTH_LABELS[d].label}</span>
                <span className="lg:hidden">L{d}</span>
              </button>
            );
          })}
        </div>

        {/* Separator + Namespace Filter — only for namespace-aware views */}
        {viewMode === "namespace" && (<>
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 dark:via-slate-600 to-transparent" />

        {/* ── Namespace Filter ── */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 border ${
                hasNamespaceFilter
                  ? "bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-100 dark:ring-indigo-800 shadow-sm"
                  : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm"
              }`}
            >
              <Filter className={`h-3.5 w-3.5 ${hasNamespaceFilter ? "text-indigo-500" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-500"}`} />
              <span className="max-w-[200px] truncate" title={nsLabel}>{nsLabel}</span>
              <ChevronDown className={`h-3 w-3 transition-colors ${hasNamespaceFilter ? "text-indigo-400" : "text-gray-600 dark:text-gray-400"}`} />
              {hasNamespaceFilter && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] text-white font-bold shadow-sm">
                  {selectedNamespaces.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0 rounded-xl shadow-xl border-gray-200 dark:border-slate-700 dark:bg-slate-900" sideOffset={6}>
            <div className="p-3 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-gray-50 dark:from-slate-800 to-white dark:to-slate-900 rounded-t-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-md bg-indigo-100 dark:bg-indigo-900/50">
                    <Filter className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Namespace Filter</p>
                </div>
                {selectedNamespaces.size > 1 && (
                  <button
                    type="button"
                    className="text-[10px] text-indigo-600 font-medium hover:underline"
                    onClick={() => onNamespaceSelectionChange?.(new Set(["default"]))}
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={`flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border ${
                    selectedNamespaces.size === 1 && selectedNamespaces.has("default")
                      ? "bg-indigo-500 text-white border-indigo-500 shadow-sm"
                      : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400"
                  }`}
                  onClick={() => onNamespaceSelectionChange?.(new Set(["default"]))}
                >
                  Default
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400"
                  onClick={() => onNamespaceSelectionChange?.(new Set(userNamespaces))}
                >
                  User Only
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-orange-200 dark:hover:border-orange-700 hover:text-orange-600 dark:hover:text-orange-400"
                  onClick={() => onNamespaceSelectionChange?.(new Set(systemNamespaces))}
                >
                  System Only
                </button>
              </div>
            </div>
            <ScrollArea className="h-[240px]">
              <div className="p-2 space-y-3">
                {userNamespaces.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-2 mb-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">User Namespaces</p>
                    </div>
                    <div className="space-y-0.5">
                      {userNamespaces.map((ns) => {
                        const isChecked = selectedNamespaces.has(ns);
                        return (
                        <div key={ns} role="button" tabIndex={0} onClick={() => toggleNamespace(ns)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNamespace(ns); } }} className={`flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all ${
                          isChecked
                            ? "bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800 border border-transparent"
                        }`}>
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isChecked ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800"}`}>
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`text-sm font-medium ${isChecked ? "text-indigo-700 dark:text-indigo-300" : "text-gray-700 dark:text-gray-300"}`}>{ns}</span>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {systemNamespaces.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-2 mb-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                      <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">System Namespaces</p>
                    </div>
                    <div className="space-y-0.5">
                      {systemNamespaces.map((ns) => {
                        const isChecked = selectedNamespaces.has(ns);
                        return (
                        <div key={ns} role="button" tabIndex={0} onClick={() => toggleNamespace(ns)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNamespace(ns); } }} className={`flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all ${
                          isChecked
                            ? "bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800 border border-transparent"
                        }`}>
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isChecked ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800"}`}>
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`text-sm font-medium ${isChecked ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400"}`}>{ns}</span>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Selected namespace chips */}
        {selectedNamespaces.size > 0 && selectedNamespaces.size <= 3 && (
          <div className="flex items-center gap-1.5">
            {Array.from(selectedNamespaces).map((ns) => (
              <span key={ns} className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/40 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-sm">
                <Layers className="h-3 w-3 text-indigo-400" />
                {ns}
                <button type="button" className="ml-0.5 hover:bg-indigo-100 rounded-full p-0.5 transition-colors" onClick={() => toggleNamespace(ns)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        </>)}

        {/* ── Kind Filter ── */}
        {availableKinds.length > 0 && (<>
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 dark:via-slate-600 to-transparent" />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 border ${
                hasKindFilter
                  ? "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 ring-1 ring-emerald-100 dark:ring-emerald-800 shadow-sm"
                  : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm"
              }`}
            >
              <Box className={`h-3.5 w-3.5 ${hasKindFilter ? "text-emerald-500" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-500"}`} />
              <span className="max-w-[200px] truncate" title={kindLabel}>{kindLabel}</span>
              <ChevronDown className={`h-3 w-3 transition-colors ${hasKindFilter ? "text-emerald-400" : "text-gray-600 dark:text-gray-400"}`} />
              {hasKindFilter && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] text-white font-bold shadow-sm">
                  {selectedKinds.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0 rounded-xl shadow-xl border-gray-200 dark:border-slate-700 dark:bg-slate-900" sideOffset={6}>
            <div className="p-3 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-gray-50 dark:from-slate-800 to-white dark:to-slate-900 rounded-t-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-md bg-emerald-100 dark:bg-emerald-900/50">
                    <Box className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Kind Filter</p>
                </div>
                {hasKindFilter && (
                  <button
                    type="button"
                    className="text-[10px] text-emerald-600 font-medium hover:underline"
                    onClick={() => onKindSelectionChange?.(new Set())}
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={`flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border ${
                    !hasKindFilter
                      ? "bg-emerald-500 text-white border-emerald-500 shadow-sm"
                      : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400"
                  }`}
                  onClick={() => onKindSelectionChange?.(new Set())}
                >
                  All
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400"
                  onClick={() => onKindSelectionChange?.(new Set(["Pod", "Deployment", "ReplicaSet", "Service"]))}
                >
                  Workloads
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400"
                  onClick={() => onKindSelectionChange?.(new Set(["ConfigMap", "Secret"]))}
                >
                  Config
                </button>
              </div>
            </div>
            <ScrollArea className="h-[280px]">
              <div className="p-2 space-y-0.5">
                {availableKinds.map((kind) => {
                  const isChecked = !hasKindFilter || selectedKinds.has(kind);
                  return (
                    <div key={kind} role="button" tabIndex={0} onClick={() => {
                      if (!hasKindFilter) {
                        // Switching from "all visible" to "only this kind unchecked" — select all except this one
                        const allExcept = new Set(availableKinds.filter((k) => k !== kind));
                        onKindSelectionChange?.(allExcept);
                      } else {
                        toggleKind(kind);
                      }
                    }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!hasKindFilter) { const allExcept = new Set(availableKinds.filter((k) => k !== kind)); onKindSelectionChange?.(allExcept); } else { toggleKind(kind); } } }} className={`flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all ${
                      isChecked
                        ? "bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800"
                        : "hover:bg-gray-50 dark:hover:bg-slate-800 border border-transparent"
                    }`}>
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isChecked ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800"}`}>
                        {isChecked && <Check className="h-3 w-3" />}
                      </div>
                      <K8sIcon kind={kind} size={16} className="shrink-0" />
                      <span className={`text-sm font-medium ${isChecked ? "text-emerald-700 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}`}>{kind}</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        </>)}

        {/* ── Edge Type Filter ── */}
        {availableEdgeCategories.length > 0 && (<>
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 dark:via-slate-600 to-transparent" />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 border ${
                hasEdgeFilter
                  ? "bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 ring-1 ring-purple-100 dark:ring-purple-800 shadow-sm"
                  : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm"
              }`}
            >
              <Route className={`h-3.5 w-3.5 ${hasEdgeFilter ? "text-purple-500" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-500"}`} />
              <span className="max-w-[200px] truncate" title={edgeLabel}>{edgeLabel}</span>
              <ChevronDown className={`h-3 w-3 transition-colors ${hasEdgeFilter ? "text-purple-400" : "text-gray-600 dark:text-gray-400"}`} />
              {hasEdgeFilter && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-purple-500 px-1 text-[10px] text-white font-bold shadow-sm">
                  {hiddenEdgeCategories.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0 rounded-xl shadow-xl border-gray-200 dark:border-slate-700 dark:bg-slate-900" sideOffset={6}>
            <div className="p-3 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-gray-50 dark:from-slate-800 to-white dark:to-slate-900 rounded-t-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-md bg-purple-100 dark:bg-purple-900/50">
                    <Route className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200">Edge Relationships</p>
                </div>
                {hasEdgeFilter && (
                  <button
                    type="button"
                    className="text-[10px] text-purple-600 font-medium hover:underline"
                    onClick={() => onEdgeCategoryToggle?.(new Set())}
                  >
                    Show all
                  </button>
                )}
              </div>
            </div>
            <ScrollArea className="h-[240px]">
              <div className="p-2 space-y-0.5">
                {availableEdgeCategories.map((cat) => {
                  const isVisible = !hiddenEdgeCategories.has(cat);
                  return (
                    <div key={cat} role="button" tabIndex={0} onClick={() => toggleEdgeCategory(cat)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEdgeCategory(cat); } }} className={`flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all ${
                      isVisible
                        ? "bg-purple-50/80 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-800"
                        : "hover:bg-gray-50 dark:hover:bg-slate-800 border border-transparent"
                    }`}>
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isVisible ? "border-purple-600 bg-purple-600 text-white" : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800"}`}>
                        {isVisible && <Check className="h-3 w-3" />}
                      </div>
                      <span className={`text-sm font-medium capitalize ${isVisible ? "text-purple-700 dark:text-purple-300" : "text-gray-500 dark:text-gray-400"}`}>{cat}</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        </>)}

        {/* Separator */}
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 dark:via-slate-600 to-transparent" />

        {/* ── Search ── */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600 dark:text-gray-400" />
          <input
            ref={searchRef}
            data-topology-search
            aria-label="Search topology resources"
            className="h-8 w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-8 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-indigo-300 dark:focus:border-indigo-600 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 transition-all shadow-sm"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center rounded border border-gray-200 bg-gray-100 dark:bg-gray-700 px-1.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">
            /
          </kbd>
          {/* Search syntax help — shows when focused with empty query */}
          {showSearchResults && searchResults.length === 0 && !searchQuery && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-gray-200 bg-white dark:bg-slate-800 shadow-2xl p-3">
              <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Search syntax</div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-[10px] text-gray-600 dark:text-gray-400 border border-gray-200">nginx</kbd>
                  <span className="text-gray-600 dark:text-gray-400">Search by name</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-[10px] text-gray-600 dark:text-gray-400 border border-gray-200">kind:Pod</kbd>
                  <span className="text-gray-600 dark:text-gray-400">Filter by resource type</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-[10px] text-gray-600 dark:text-gray-400 border border-gray-200">ns:default</kbd>
                  <span className="text-gray-600 dark:text-gray-400">Filter by namespace</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-[10px] text-gray-600 dark:text-gray-400 border border-gray-200">status:error</kbd>
                  <span className="text-gray-600 dark:text-gray-400">Filter by health status</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono text-[10px] text-gray-600 dark:text-gray-400 border border-gray-200">label:app=web</kbd>
                  <span className="text-gray-600 dark:text-gray-400">Filter by label</span>
                </div>
              </div>
            </div>
          )}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1.5 max-h-72 w-96 overflow-y-auto rounded-xl border border-gray-200 bg-white dark:bg-slate-800 shadow-2xl">
              <div className="sticky top-0 px-3 py-2 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-slate-800 bg-opacity-95 dark:bg-opacity-95 backdrop-blur-sm rounded-t-xl">
                {searchResults.length} results
              </div>
              {searchResults.map((r) => (
                <button
                  key={r.node.id}
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                  onMouseDown={() => handleSearchSelect(r.node.id)}
                >
                  <K8sIcon kind={r.node.kind} size={18} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{r.node.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 font-semibold shrink-0">
                        {r.node.kind}
                      </span>
                    </div>
                    {r.node.namespace && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{r.node.namespace}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Stats + Actions — stay together, wrap as group ── */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
        {topology && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/40 dark:to-cyan-950/40 px-3 py-1.5 border border-blue-100 dark:border-blue-800 shadow-sm">
              <Layers className="h-3 w-3 text-blue-500" />
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 tabular-nums">{topology.metadata.resourceCount}</span>
              {depth < 3 && totalUnfiltered > 0 ? (
                <span className="text-[10px] text-blue-500 dark:text-blue-400 font-medium">of {totalUnfiltered}</span>
              ) : null}
              <span className="text-[10px] text-blue-500 dark:text-blue-400 font-medium">resources</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40 px-3 py-1.5 border border-purple-100 dark:border-purple-800 shadow-sm">
              <GitBranch className="h-3 w-3 text-purple-500" />
              <span className="text-xs font-bold text-purple-700 dark:text-purple-300 tabular-nums">{topology.metadata.edgeCount}</span>
              <span className="text-[10px] text-purple-500 dark:text-purple-400 font-medium">edges</span>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex items-center gap-1.5">
          {/* Fit View */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
            onClick={onFitView}
            title="Fit to view (F)"
          >
            <Maximize className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Fit</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-50"
            onClick={onRefresh}
            disabled={isFetching}
            title="Refresh topology data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isFetching ? "Refreshing..." : "Refresh"}</span>
          </button>

          {/* Present */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
            onClick={onTogglePresentationMode}
            title="Presentation mode (P)"
          >
            <Monitor className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Present</span>
          </button>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-40"
                disabled={!topology}
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-3 w-3 text-gray-600 dark:text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1 rounded-xl shadow-xl max-h-[70vh] overflow-y-auto">
              {(() => {
                const ctx = getExportCtx?.() ?? { viewMode, selectedNamespaces, clusterName };
                const triggerExport = (format: ExportFormat) => {
                  const filename = buildExportFilename(format, ctx);
                  exportRef?.current?.(format, filename);
                };
                return (
                  <>
                    {/* Architecture Diagram — premium feature, shown first */}
                    <DropdownMenuItem
                      className="rounded-lg gap-2.5 py-2"
                      disabled={isExportingArch}
                      onClick={async () => {
                        if (!clusterId) return;
                        setIsExportingArch(true);
                        toast.info("Generating architecture diagram with official K8s icons...", { duration: 15000 });
                        try {
                          const ns = selectedNamespaces?.size ? Array.from(selectedNamespaces)[0] : "";
                          const url = `${effectiveBaseUrl}/api/v1/clusters/${encodeURIComponent(clusterId)}/topology/export?format=architecture${ns ? `&namespace=${encodeURIComponent(ns)}` : ""}`;
                          const res = await fetch(url, { method: "POST" });
                          if (!res.ok) {
                            const text = await res.text();
                            throw new Error(text || res.statusText);
                          }
                          const blob = await res.blob();
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `architecture-${clusterName || "cluster"}-${ns || "all"}.png`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                          toast.success("Architecture diagram exported!");
                        } catch (err: unknown) {
                          const msg = err instanceof Error ? err.message : "Export failed";
                          toast.error(msg);
                        } finally {
                          setIsExportingArch(false);
                        }
                      }}
                    >
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-indigo-50">
                        <Network className={`h-3.5 w-3.5 text-indigo-600 ${isExportingArch ? "animate-spin" : ""}`} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">{isExportingArch ? "Generating..." : "Architecture Diagram"}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Professional K8s icons (KubeDiagrams)</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => triggerExport("png")}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-emerald-50">
                        <FileImage className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">PNG</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Full topology image</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => triggerExport("svg")}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-violet-50">
                        <FileImage className="h-3.5 w-3.5 text-violet-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">SVG</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Scalable vector</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => exportTopologyPDF(clusterName, viewMode, selectedNamespaces)}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-red-50">
                        <FileType className="h-3.5 w-3.5 text-red-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">PDF</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Print-ready document</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => exportTopologyJSON(topology ?? null, ctx)}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-amber-50">
                        <FileJson className="h-3.5 w-3.5 text-amber-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">JSON</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Raw topology data</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => exportTopologyCSV(topology ?? null, effectiveBaseUrl, clusterId ?? '', ctx)}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-teal-50">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-teal-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">CSV</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Enriched data with resource details (NFS paths, capacity, etc.)</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="rounded-lg gap-2.5 py-2"
                      onClick={() => exportTopologyDrawIO(topology ?? null, ctx)}
                    >
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-orange-50 dark:bg-orange-900/30">
                        <FileType className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">Draw.io</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Editable architecture diagram</div>
                      </div>
                    </DropdownMenuItem>
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>
      </div>
    </div>
  );
}
