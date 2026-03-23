import { useState, useCallback, useRef, useMemo } from "react";
import {
  Search, Download, Maximize, ChevronDown, FileJson, FileImage, FileType, Pen,
  Filter, X, Layers, GitBranch, Check, Monitor,
} from "lucide-react";
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
import type { SearchResult } from "./hooks/useTopologySearch";
import { K8sIcon } from "./icons/K8sIcon";
import { useTopologyStore } from "./store/topologyStore";

export interface TopologyToolbarProps {
  viewMode?: ViewMode;
  namespace?: string;
  clusterName?: string;
  selectedNamespaces?: Set<string>;
  availableNamespaces?: string[];
  topology?: TopologyResponse | null;
  searchQuery?: string;
  searchResults?: SearchResult[];
  exportRef?: React.MutableRefObject<((format: ExportFormat, filename: string) => void) | null>;
  getExportCtx?: () => ExportContext;
  onViewModeChange?: (mode: ViewMode) => void;
  onNamespaceChange?: (ns: string) => void;
  onNamespaceSelectionChange?: (selected: Set<string>) => void;
  onSearchChange?: (query: string) => void;
  onSearchSelect?: (nodeId: string) => void;
  onFitView?: () => void;
  onTogglePresentationMode?: () => void;
}

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

export function TopologyToolbar({
  viewMode = "namespace",
  clusterName,
  selectedNamespaces = new Set(),
  availableNamespaces = [],
  topology,
  searchQuery = "",
  searchResults = [],
  onViewModeChange,
  onNamespaceSelectionChange,
  onSearchChange,
  onSearchSelect,
  onFitView,
  onTogglePresentationMode,
  exportRef,
  getExportCtx,
}: TopologyToolbarProps) {
  const exportIncludeTitle = useTopologyStore((s) => s.exportIncludeTitle);
  const exportIncludeLegend = useTopologyStore((s) => s.exportIncludeLegend);
  const toggleExportTitle = useTopologyStore((s) => s.toggleExportTitle);
  const toggleExportLegend = useTopologyStore((s) => s.toggleExportLegend);
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

  const nsLabel = selectedNamespaces.size === 1
    ? Array.from(selectedNamespaces)[0]
    : `${selectedNamespaces.size} namespaces`;

  const hasNamespaceFilter = selectedNamespaces.size > 0;

  return (
    <div className="border-b border-gray-200/80 bg-gradient-to-r from-white via-gray-50/30 to-white">
      {/* Main toolbar row */}
      <div className="flex items-center gap-3 px-4 py-2.5">

        {/* ── View Mode Selector ── */}
        <ViewModeSelect value={viewMode} onChange={onViewModeChange} />

        {/* Separator + Namespace Filter — only for namespace-aware views */}
        {(viewMode === "namespace" || viewMode === "workload" || viewMode === "resource") && (<>
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />

        {/* ── Namespace Filter ── */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 border ${
                hasNamespaceFilter
                  ? "bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 border-indigo-200 ring-1 ring-indigo-100 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm"
              }`}
            >
              <Filter className={`h-3.5 w-3.5 ${hasNamespaceFilter ? "text-indigo-500" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-500"}`} />
              <span className="max-w-[140px] truncate">{nsLabel}</span>
              <ChevronDown className={`h-3 w-3 transition-colors ${hasNamespaceFilter ? "text-indigo-400" : "text-gray-600 dark:text-gray-400"}`} />
              {hasNamespaceFilter && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] text-white font-bold shadow-sm">
                  {selectedNamespaces.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0 rounded-xl shadow-xl border-gray-200" sideOffset={6}>
            <div className="p-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white rounded-t-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-md bg-indigo-100">
                    <Filter className="h-3.5 w-3.5 text-indigo-600" />
                  </div>
                  <p className="text-xs font-bold text-gray-700">Namespace Filter</p>
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
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-600"
                  }`}
                  onClick={() => onNamespaceSelectionChange?.(new Set(["default"]))}
                >
                  Default
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white text-gray-600 border-gray-200 hover:border-emerald-200 hover:text-emerald-600"
                  onClick={() => onNamespaceSelectionChange?.(new Set(userNamespaces))}
                >
                  User Only
                </button>
                <button
                  type="button"
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold transition-all border bg-white text-gray-600 border-gray-200 hover:border-orange-200 hover:text-orange-600"
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
                            ? "bg-indigo-50/80 border border-indigo-100"
                            : "hover:bg-gray-50 border border-transparent"
                        }`}>
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isChecked ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white"}`}>
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`text-sm font-medium ${isChecked ? "text-indigo-700" : "text-gray-700"}`}>{ns}</span>
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
                            ? "bg-indigo-50/80 border border-indigo-100"
                            : "hover:bg-gray-50 border border-transparent"
                        }`}>
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${isChecked ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white"}`}>
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`text-sm font-medium ${isChecked ? "text-indigo-700" : "text-gray-500"}`}>{ns}</span>
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
              <span key={ns} className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-50 to-blue-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-200 shadow-sm">
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

        {/* Separator */}
        <div className="h-7 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />

        {/* ── Search ── */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600 dark:text-gray-400" />
          <input
            ref={searchRef}
            data-topology-search
            aria-label="Search topology resources"
            className="h-8 w-full rounded-lg border border-gray-200 bg-white dark:bg-slate-800 pl-9 pr-8 text-sm placeholder:text-gray-400 focus:border-indigo-300 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
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
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-indigo-50 transition-colors"
                  onMouseDown={() => handleSearchSelect(r.node.id)}
                >
                  <K8sIcon kind={r.node.kind} size={18} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 truncate">{r.node.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 font-semibold shrink-0">
                        {r.node.kind}
                      </span>
                    </div>
                    {r.node.namespace && (
                      <div className="text-xs text-gray-400 truncate mt-0.5">{r.node.namespace}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Stats ── */}
        {topology && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-50 to-cyan-50 px-3 py-1.5 border border-blue-100 shadow-sm">
              <Layers className="h-3 w-3 text-blue-500" />
              <span className="text-xs font-bold text-blue-700 tabular-nums">{topology.metadata.resourceCount}</span>
              <span className="text-[10px] text-blue-500 font-medium">resources</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-50 to-violet-50 px-3 py-1.5 border border-purple-100 shadow-sm">
              <GitBranch className="h-3 w-3 text-purple-500" />
              <span className="text-xs font-bold text-purple-700 tabular-nums">{topology.metadata.edgeCount}</span>
              <span className="text-[10px] text-purple-500 font-medium">edges</span>
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
            <DropdownMenuContent align="end" className="w-52 p-1 rounded-xl shadow-xl">
              {(() => {
                const ctx = getExportCtx?.() ?? { viewMode, selectedNamespaces, clusterName };
                const triggerExport = (format: ExportFormat) => {
                  const filename = buildExportFilename(format, ctx);
                  exportRef?.current?.(format, filename);
                };
                return (
                  <>
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
                    <DropdownMenuItem className="rounded-lg gap-2.5 py-2" onClick={() => exportTopologyDrawIO(topology ?? null, ctx)}>
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-blue-50">
                        <Pen className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">Draw.io</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">Editable diagram</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Export Settings</div>
                      <label className="flex items-center gap-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={exportIncludeTitle} onChange={toggleExportTitle} className="rounded border-gray-300 text-blue-600 h-3.5 w-3.5" />
                        <span className="text-[11px] text-gray-600 dark:text-gray-400">Include title</span>
                      </label>
                      <label className="flex items-center gap-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={exportIncludeLegend} onChange={toggleExportLegend} className="rounded border-gray-300 text-blue-600 h-3.5 w-3.5" />
                        <span className="text-[11px] text-gray-600 dark:text-gray-400">Include legend</span>
                      </label>
                    </div>
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
