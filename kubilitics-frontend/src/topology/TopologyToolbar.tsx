import { useState, useCallback, useRef } from "react";
import { ViewModeSelect } from "./components/ViewModeSelect";
import type { ViewMode, TopologyResponse, TopologyNode } from "./types/topology";
import {
  exportTopologyJSON,
  exportTopologyPNG,
  exportTopologySVG,
  exportTopologyDrawIO,
} from "./export/exportTopology";
import { exportTopologyPDF } from "./export/exportPDF";
import type { SearchResult } from "./hooks/useTopologySearch";

export interface TopologyToolbarProps {
  viewMode?: ViewMode;
  namespace?: string;
  topology?: TopologyResponse | null;
  searchQuery?: string;
  searchResults?: SearchResult[];
  onViewModeChange?: (mode: ViewMode) => void;
  onNamespaceChange?: (ns: string) => void;
  onSearchChange?: (query: string) => void;
  onSearchSelect?: (nodeId: string) => void;
  onFitView?: () => void;
}

export function TopologyToolbar({
  viewMode = "namespace",
  topology,
  searchQuery = "",
  searchResults = [],
  onViewModeChange,
  onSearchChange,
  onSearchSelect,
  onFitView,
}: TopologyToolbarProps) {
  const [showExport, setShowExport] = useState(false);
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

  return (
    <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
      <div className="relative flex flex-1 items-center gap-2">
        {/* Search */}
        <div className="relative">
          <input
            ref={searchRef}
            data-topology-search
            className="h-8 w-72 rounded-md border px-2 text-xs placeholder:text-muted-foreground/60"
            placeholder="Search (kind:Pod ns:default label:app=nginx) — press /"
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
          />
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border bg-background shadow-lg">
              {searchResults.map((r) => (
                <button
                  key={r.node.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted"
                  onMouseDown={() => handleSearchSelect(r.node.id)}
                >
                  <span className="font-medium">{r.node.kind}</span>
                  <span className="truncate text-muted-foreground">{r.node.name}</span>
                  {r.node.namespace && <span className="text-[10px] text-muted-foreground/60">{r.node.namespace}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <ViewModeSelect value={viewMode} onChange={onViewModeChange} />
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-1 text-xs">
        {/* Metadata */}
        {topology && (
          <span className="mr-2 text-[10px] text-muted-foreground">
            {topology.metadata.resourceCount} resources | {topology.metadata.edgeCount} edges
            {topology.metadata.buildTimeMs > 0 && ` | ${topology.metadata.buildTimeMs}ms`}
          </span>
        )}

        {/* Fit View */}
        <button
          type="button"
          className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onFitView}
          title="Fit to view (F)"
        >
          Fit
        </button>

        {/* Export dropdown */}
        <div className="relative">
          <button
            type="button"
            className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setShowExport(!showExport)}
            disabled={!topology}
          >
            Export
          </button>
          {showExport && (
            <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border bg-background py-1 shadow-lg">
              <ExportButton label="JSON" onClick={() => { exportTopologyJSON(topology ?? null); setShowExport(false); }} />
              <ExportButton label="PNG" onClick={() => { exportTopologyPNG(); setShowExport(false); }} />
              <ExportButton label="SVG" onClick={() => { exportTopologySVG(); setShowExport(false); }} />
              <ExportButton label="Draw.io" onClick={() => { exportTopologyDrawIO(topology ?? null); setShowExport(false); }} />
              <ExportButton label="PDF" onClick={() => { exportTopologyPDF(topology?.metadata?.clusterId, viewMode); setShowExport(false); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
      onClick={onClick}
    >
      Export as {label}
    </button>
  );
}

