import React, { useCallback, useState, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { CytoscapeCanvas } from './engines/cytoscape/CytoscapeCanvas';
import { Scene3D } from './engines/three/Scene3D';
import type { TopologyGraph, HeatMapMode } from './types/topology.types';
import type { EngineRef } from './types/engine.types';
import type { OverlayType, OverlayData } from './types/overlay.types';
import type { BlastRadiusResult } from './types/interaction.types';
import { useHealthOverlay } from './overlays/HealthOverlay';
import { useCostOverlay } from './overlays/CostOverlay';
import { useSecurityOverlay } from './overlays/SecurityOverlay';
import { usePerformanceOverlay } from './overlays/PerformanceOverlay';
import { useDependencyOverlay } from './overlays/DependencyOverlay';
import { useTrafficOverlay } from './overlays/TrafficOverlay';
import { computeBlastRadius } from './utils/blastRadiusCompute';
import {
  Layers, Download, Eye, X, Box, ZoomIn, ZoomOut, Maximize2, RotateCcw
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { downloadJSON } from './export/exportJson';
import { downloadCSVSummary } from './export/exportCsv';

/* ── TopologyErrorBoundary: catches rendering crashes in Cytoscape/Three.js ── */
interface TopologyErrorBoundaryProps {
  engine: string;
  onSwitchEngine?: () => void;
  onRetry?: () => void;
  children: ReactNode;
}
interface TopologyErrorBoundaryState { hasError: boolean; error: Error | null; }

class TopologyErrorBoundary extends Component<TopologyErrorBoundaryProps, TopologyErrorBoundaryState> {
  constructor(props: TopologyErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): TopologyErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Topology ${this.props.engine} engine crashed:`, error, errorInfo.componentStack);
  }
  handleRetry = () => { this.setState({ hasError: false, error: null }); this.props.onRetry?.(); };
  handleSwitch = () => { this.setState({ hasError: false, error: null }); this.props.onSwitchEngine?.(); };
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-50">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <X className="h-6 w-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Topology rendering failed</h3>
          <p className="text-sm text-muted-foreground mb-1 max-w-sm">{this.state.error?.message || 'An unexpected error occurred while rendering the topology graph.'}</p>
          <p className="text-xs text-muted-foreground/60 mb-4">Engine: {this.props.engine === 'cytoscape' ? 'Cytoscape 2D' : 'Three.js 3D'}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={this.handleRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />Try Again
            </Button>
            {this.props.onSwitchEngine && (
              <Button variant="outline" size="sm" onClick={this.handleSwitch}>
                <Box className="mr-2 h-4 w-4" />Switch to {this.props.engine === 'cytoscape' ? '3D' : '2D'}
              </Button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type Engine = 'cytoscape' | '3d';

export interface TopologyViewerProps {
  /** Topology graph data */
  graph: TopologyGraph;

  /** Initial rendering engine */
  initialEngine?: Engine;

  /** Callback when a node is selected */
  onNodeSelect?: (nodeId: string | null) => void;

  /** Heatmap mode (same as Cytoscape Layout tab) */
  heatMapMode?: HeatMapMode;

  /** Traffic flow animation on edges (same as Cytoscape Layout tab) */
  trafficFlowEnabled?: boolean;

  /** Enable controls UI */
  showControls?: boolean;
  /** Custom className */
  className?: string;
}

/**
 * TopologyViewer - Full Topology Engine (FTE)
 *
 * World-class features:
 * - Dual-engine architecture: Cytoscape 2D + Three.js 3D
 * - Hover highlighting: immediate parent + child nodes (BILLION DOLLAR USP)
 * - 6 insight overlays: health, cost, security, performance, dependency, traffic
 * - Professional export: SVG, PNG, PDF, JSON, CSV
 * - Minimal, non-blocking UI with compact floating controls
 */
export const TopologyViewer: React.FC<TopologyViewerProps> = ({
  graph,
  initialEngine = 'cytoscape',
  onNodeSelect,
  heatMapMode = 'none',
  trafficFlowEnabled = false,
  showControls = true,
  className = '',
}) => {
  const engineRef = useRef<EngineRef>(null);

  // State
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType | null>(null);
  const [blastRadiusResult, setBlastRadiusResult] = useState<BlastRadiusResult | null>(null);

  // Compute all overlay data
  const healthOverlay = useHealthOverlay(graph);
  const costOverlay = useCostOverlay(graph);
  const securityOverlay = useSecurityOverlay(graph);
  const performanceOverlay = usePerformanceOverlay(graph);
  const dependencyOverlay = useDependencyOverlay(graph);
  const trafficOverlay = useTrafficOverlay(graph);

  // Build overlayData map
  const overlayData = new Map<OverlayType, OverlayData>([
    ['health', healthOverlay],
    ['cost', costOverlay],
    ['security', securityOverlay],
    ['performance', performanceOverlay],
    ['dependency', dependencyOverlay],
    ['traffic', trafficOverlay],
  ]);

  // Build enabled overlays set (only active overlay)
  const enabledOverlays = new Set<OverlayType>(activeOverlay ? [activeOverlay] : []);

  // Node selection handler
  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (!nodeId) setBlastRadiusResult(null);
    onNodeSelect?.(nodeId);
  }, [onNodeSelect]);

  const handleContextMenuAction = useCallback(
    (actionId: string, nodeId: string) => {
      if (actionId === 'compute-blast-radius') {
        const result = computeBlastRadius(graph, nodeId);
        setBlastRadiusResult(result);
      }
    },
    [graph]
  );

  // Scene3D expects string, not string | null, so wrap it
  const handleScene3DSelect = useCallback((nodeId: string) => {
    handleNodeSelect(nodeId || null);
  }, [handleNodeSelect]);

  // Export handlers — FIX DESKTOP-EXPORT: use shared downloadFile which is Tauri-aware
  // (blob: URLs with tauri://localhost origin contain colons that break <a download>)
  const handleExportSVG = useCallback(async () => {
    if (!engineRef.current?.exportAsSVG) return;
    const svgData = engineRef.current.exportAsSVG();
    if (svgData) {
      const { downloadFile: dlFile } = await import('./utils/exportUtils');
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      await dlFile(blob, `topology-${new Date().toISOString().slice(0, 10)}.svg`);
    }
  }, []);

  const handleExportPNG = useCallback(async () => {
    if (!engineRef.current?.exportAsPNG) return;
    const pngData = engineRef.current.exportAsPNG();
    if (pngData) {
      // pngData is a data URL — convert to blob for Tauri-aware download
      const response = await fetch(pngData);
      const blob = await response.blob();
      const { downloadFile: dlFile } = await import('./utils/exportUtils');
      await dlFile(blob, `topology-${new Date().toISOString().slice(0, 10)}.png`);
    }
  }, []);

  const handleExportJSON = useCallback(() => {
    downloadJSON(graph, `topology-${new Date().toISOString().slice(0, 10)}.json`); // Task 6.3: YYYY-MM-DD
  }, [graph]);

  const handleExportCSV = useCallback(() => {
    downloadCSVSummary(graph); // Task 6.4: two files topology-nodes-YYYY-MM-DD.csv, topology-edges-YYYY-MM-DD.csv
  }, [graph]);

  return (
    <div className={`relative w-full h-full bg-slate-50 ${className}`}>
      {/* Compact floating toolbar (top-left, z-50) */}
      {showControls && (
        <div className="absolute top-3 left-3 z-50 flex items-center gap-2">
          {/* Overlays dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeOverlay ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 shadow-md backdrop-blur-sm bg-background/95"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="text-xs">
                  {activeOverlay ? activeOverlay.charAt(0).toUpperCase() + activeOverlay.slice(1) : 'Overlays'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => setActiveOverlay(null)}>
                <X className="h-3.5 w-3.5 mr-2" />
                None
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('health')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Health
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('cost')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Cost
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('security')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Security
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('performance')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Performance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('dependency')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Dependency
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('traffic')}>
                <Eye className="h-3.5 w-3.5 mr-2" />
                Traffic
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Engine toggle */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 shadow-md backdrop-blur-sm bg-background/95"
            onClick={() => setEngine(engine === 'cytoscape' ? '3d' : 'cytoscape')}
          >
            <Box className="h-3.5 w-3.5" />
            <span className="text-xs">{engine === 'cytoscape' ? '2D' : '3D'}</span>
          </Button>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 shadow-md backdrop-blur-sm bg-background/95"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="text-xs">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-32">
              <DropdownMenuItem onClick={handleExportSVG}>
                SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPNG}>
                PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportCSV}>
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Cost overlay estimated disclaimer */}
      {activeOverlay === 'cost' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-amber-50/95 border border-amber-200/60 shadow-md backdrop-blur-sm flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-200/60 px-1.5 py-0.5 rounded">Estimated</span>
          <span className="text-xs text-amber-700/80">Cost scores are approximations based on resource usage. Integrate OpenCost for accurate data.</span>
        </div>
      )}

      {/* Task 7.3: Zoom controls (top-right) */}
      {showControls && (
        <div className="absolute top-3 right-3 z-50 flex flex-col gap-1 p-1 bg-background/95 border rounded-lg shadow-lg">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => engineRef.current?.zoomIn?.()}
            title="Zoom In (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => engineRef.current?.zoomOut?.()}
            title="Zoom Out (-)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => engineRef.current?.fitToScreen?.()}
            title="Fit to screen (F)"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => engineRef.current?.resetView?.()}
            title="Reset view (R)"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Task 7.2: Blast radius panel */}
      {blastRadiusResult && graph && (
        <div className="absolute bottom-20 left-6 right-6 max-w-md bg-background/95 border-2 border-slate-700 rounded-xl shadow-2xl p-4 z-30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-slate-900">
              {blastRadiusResult.affectedNodes.size} resources affected (
              {graph.nodes.length > 0
                ? Math.round((blastRadiusResult.affectedNodes.size / graph.nodes.length) * 100)
                : 0}
              % of cluster)
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setBlastRadiusResult(null)}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {blastRadiusResult.suggestions && blastRadiusResult.suggestions.length > 0 && (
            <div className="text-xs text-slate-600 space-y-1">
              <div className="font-semibold">Suggestions:</div>
              <ul className="list-disc list-inside">
                {blastRadiusResult.suggestions.slice(0, 3).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Topology rendering canvas — wrapped in error boundary */}
      <div className="w-full h-full">
        <TopologyErrorBoundary
          engine={engine}
          onSwitchEngine={() => setEngine(engine === 'cytoscape' ? '3d' : 'cytoscape')}
          onRetry={() => {/* state reset triggers re-render */}}
        >
          {engine === 'cytoscape' ? (
            <CytoscapeCanvas
              ref={engineRef}
              graph={graph}
              selectedNodeId={selectedNodeId}
              onNodeSelect={handleNodeSelect}
              enabledOverlays={enabledOverlays}
              overlayData={overlayData}
              blastRadiusResult={blastRadiusResult}
              onContextMenuAction={handleContextMenuAction}
              onClearBlastRadius={() => setBlastRadiusResult(null)}
              heatMapMode={heatMapMode}
              trafficFlowEnabled={trafficFlowEnabled}
            />
          ) : (
            <Scene3D
              ref={engineRef}
              graph={graph}
              selectedNodeId={selectedNodeId ?? undefined}
              onNodeSelect={handleScene3DSelect}
              overlayType={activeOverlay ?? undefined}
            />
          )}
        </TopologyErrorBoundary>
      </div>
    </div>
  );
};

export default TopologyViewer;
