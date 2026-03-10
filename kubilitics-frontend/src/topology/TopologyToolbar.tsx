import { useState, useCallback, useRef, useMemo } from "react";
import {
  Search, Download, Maximize, ChevronDown, FileJson, FileImage, FileType, Pen,
  Filter, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewModeSelect } from "./components/ViewModeSelect";
import type { ViewMode, TopologyResponse } from "./types/topology";
import {
  exportTopologyJSON,
  exportTopologyPNG,
  exportTopologySVG,
  exportTopologyDrawIO,
} from "./export/exportTopology";
import { exportTopologyPDF } from "./export/exportPDF";
import type { SearchResult } from "./hooks/useTopologySearch";
import { categoryIcon } from "./nodes/nodeUtils";

export interface TopologyToolbarProps {
  viewMode?: ViewMode;
  namespace?: string;
  selectedNamespaces?: Set<string>;
  availableNamespaces?: string[];
  topology?: TopologyResponse | null;
  searchQuery?: string;
  searchResults?: SearchResult[];
  onViewModeChange?: (mode: ViewMode) => void;
  onNamespaceChange?: (ns: string) => void;
  onNamespaceSelectionChange?: (selected: Set<string>) => void;
  onSearchChange?: (query: string) => void;
  onSearchSelect?: (nodeId: string) => void;
  onFitView?: () => void;
}

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

export function TopologyToolbar({
  viewMode = "namespace",
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
}: TopologyToolbarProps) {
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
    if (next.has(ns)) next.delete(ns);
    else next.add(ns);
    onNamespaceSelectionChange?.(next);
  }, [selectedNamespaces, onNamespaceSelectionChange]);

  const nsLabel = selectedNamespaces.size === 0
    ? "All Namespaces"
    : selectedNamespaces.size === 1
      ? Array.from(selectedNamespaces)[0]
      : `${selectedNamespaces.size} namespaces`;

  return (
    <div className="border-b border-gray-200 bg-white">
      {/* Main toolbar row */}
      <div className="flex items-center gap-2 px-4 py-2">
        {/* View Mode Selector */}
        <ViewModeSelect value={viewMode} onChange={onViewModeChange} />

        {/* Divider */}
        <div className="h-6 w-px bg-gray-200" />

        {/* Namespace Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium border-gray-200"
            >
              <Filter className="h-3.5 w-3.5 text-gray-500" />
              <span className="max-w-[140px] truncate">{nsLabel}</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
              {selectedNamespaces.size > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white font-bold">
                  {selectedNamespaces.size}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0" sideOffset={4}>
            <div className="p-2 border-b border-gray-100 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace Filter</p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onNamespaceSelectionChange?.(new Set())}>
                  All
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onNamespaceSelectionChange?.(new Set(userNamespaces))}>
                  User Only
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onNamespaceSelectionChange?.(new Set(systemNamespaces))}>
                  System Only
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[240px]">
              <div className="p-2 space-y-3">
                {userNamespaces.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">User Namespaces</p>
                    <div className="space-y-0.5">
                      {userNamespaces.map((ns) => (
                        <label key={ns} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors">
                          <Checkbox checked={selectedNamespaces.has(ns)} onCheckedChange={() => toggleNamespace(ns)} />
                          <span className="text-sm text-gray-700">{ns}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {systemNamespaces.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">System Namespaces</p>
                    <div className="space-y-0.5">
                      {systemNamespaces.map((ns) => (
                        <label key={ns} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors">
                          <Checkbox checked={selectedNamespaces.has(ns)} onCheckedChange={() => toggleNamespace(ns)} />
                          <span className="text-sm text-gray-500">{ns}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Selected namespace chips */}
        {selectedNamespaces.size > 0 && selectedNamespaces.size <= 3 && (
          <div className="flex items-center gap-1">
            {Array.from(selectedNamespaces).map((ns) => (
              <span key={ns} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                {ns}
                <button type="button" className="hover:bg-blue-100 rounded-full p-0.5" onClick={() => toggleNamespace(ns)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="h-6 w-px bg-gray-200" />

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            data-topology-search
            className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50/50 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
            placeholder="Search resources... (/)"
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
          />
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
              <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                {searchResults.length} results
              </div>
              {searchResults.map((r) => (
                <button
                  key={r.node.id}
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                  onMouseDown={() => handleSearchSelect(r.node.id)}
                >
                  <span className="text-base shrink-0">{categoryIcon(r.node.category)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{r.node.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium shrink-0">
                        {r.node.kind}
                      </span>
                    </div>
                    {r.node.namespace && (
                      <div className="text-xs text-gray-400 truncate">{r.node.namespace}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats Badges */}
        {topology && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 border border-blue-100">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span className="text-xs font-semibold text-blue-700">{topology.metadata.resourceCount}</span>
              <span className="text-[10px] text-blue-500">resources</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 border border-purple-100">
              <div className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span className="text-xs font-semibold text-purple-700">{topology.metadata.edgeCount}</span>
              <span className="text-[10px] text-purple-500">edges</span>
            </div>
          </div>
        )}

        {/* Fit View */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-gray-200"
          onClick={onFitView}
          title="Fit to view (F)"
        >
          <Maximize className="h-3.5 w-3.5" />
          Fit
        </Button>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-gray-200" disabled={!topology}>
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => exportTopologyJSON(topology ?? null)}>
              <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportTopologyPNG()}>
              <FileImage className="h-3.5 w-3.5 mr-2" /> PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportTopologySVG()}>
              <FileImage className="h-3.5 w-3.5 mr-2" /> SVG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportTopologyDrawIO(topology ?? null)}>
              <Pen className="h-3.5 w-3.5 mr-2" /> Draw.io
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportTopologyPDF(topology?.metadata?.clusterId, viewMode)}>
              <FileType className="h-3.5 w-3.5 mr-2" /> PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
