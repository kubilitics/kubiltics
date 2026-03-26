/**
 * Topology Engine – Public API
 * Everything topology-related, portable and self-contained.
 */

// ─── Types ────────────────────────────────────────────────────
export type {
  KubernetesKind,
  ResourceStatus,
  HealthStatus,
  AbstractionLevel,
  AbstractionLevelConfig,
  RelationshipType,
  TopologyNode,
  TopologyEdge,
  GraphWarning,
  TopologyGraph,
  TopologyFilters,
  ExportFormat,
  HeatMapMode,
  TopologyViewState,
  HighlightState,
  HighlightContext,
  ExportOptions,
  TopologyCanvasRef,
} from './types/topology.types';

export { ABSTRACTION_LEVELS } from './types/topology.types';

// ─── Core ─────────────────────────────────────────────────────
export { GraphModel } from './core/graphModel';
export { applyAbstraction, getRecommendedAbstraction, type FilterOptions } from './core/abstractionEngine';
export { getConnectedComponent, getUpstreamChain, getDownstreamChain } from './core/graphTraversal';
export { AdjacencyMap } from './core/adjacencyMap';

// ─── Renderer ─────────────────────────────────────────────────
export { TopologyCanvas, type TopologyCanvasProps } from './renderer/TopologyCanvas';
export { applyELKLayout, getCytoscapeELKLayout, useELKLayout } from './renderer/useELKLayout';
export {
  NODE_COLORS, NODE_ICONS,
  getNodeColor, getNodeDataAttributes, getHealthColor, getHeatmapColor,
  getStylesheet, CANVAS_BG, CANVAS_BG_DARK, EXPORT_BG,
} from './renderer/styles';

// ─── Interaction ──────────────────────────────────────────────
export { useHighlightEngine } from './interaction/useHighlightEngine';
export { useSelectionEngine } from './interaction/useSelectionEngine';
export { createStateMachine } from './interaction/stateMachine';

// ─── Overlays ──────────────────────────────────────────────────
export { useHealthOverlay } from './overlays/HealthOverlay';
export { useCostOverlay } from './overlays/CostOverlay';
export { usePerformanceOverlay } from './overlays/PerformanceOverlay';
export { useSecurityOverlay } from './overlays/SecurityOverlay';
export { useDependencyOverlay } from './overlays/DependencyOverlay';
export { useTrafficOverlay } from './overlays/TrafficOverlay';
export type { OverlayType, OverlayData } from './types/overlay.types';
export { OVERLAY_LABELS } from './types/overlay.types';

// ─── Export ───────────────────────────────────────────────────
export { exportAsSVG, downloadSVG } from './export/exportSvg';
export { exportAsPNG, downloadPNG } from './export/exportPng';
export { downloadPDF } from './export/exportPdf';
export { exportAsJSON, downloadJSON } from './export/exportJson';
export { exportAsCSV, exportAsNodesCSV, exportAsEdgesCSV, downloadCSV, downloadCSVSummary } from './export/exportCsv';
export { generatePosterMetadata, applyPosterLayout } from './export/posterLayout';

// ─── Utils ────────────────────────────────────────────────────
export { toCytoscapeNodeData, KIND_LABELS, getKindColor } from './utils/nodeHelpers';
export { toCytoscapeEdgeData, RELATIONSHIP_CONFIG } from './utils/edgeHelpers';
export { adaptTopologyGraph, validateTopologyGraph } from './utils/topologyAdapter';
export { computeBlastRadius, getBlastRadiusSummary } from './utils/blastRadiusCompute';
export type { BlastRadiusOptions } from './utils/blastRadiusCompute';
export type { BlastRadiusResult } from './types/interaction.types';
export { generateTestGraph } from './utils/testGraphGenerator';

// Path finding and journey tracing
export {
  findAllPaths,
  traceUserJourney,
  findCriticalPath,
  findNodesAtDistance,
  findShortestPath,
  getPathSummary,
} from './utils/pathFinding';
export type { PathNode, PathResult } from './utils/pathFinding';

// Enhanced export utilities
export {
  exportAsSVG as exportTopologyAsSVG,
  exportAsPNG as exportTopologyAsPNG,
  exportExecutiveMode,
  exportAsVideo,
  exportAsGLTF,
  downloadFile,
  copyToClipboard,
  getSuggestedFilename,
} from './utils/exportUtils';
export type { ExportOptions as TopologyExportOptions } from './utils/exportUtils';

// ─── Hooks ────────────────────────────────────────────────────
export { useTopologyEngine } from './hooks/useTopologyEngine';
export { useInsightOverlay } from './hooks/useInsightOverlay';
export type { RendererEngine, EngineRef, EngineState } from './types/engine.types';

// ─── UI Components ────────────────────────────────────────────
export { TopologyNodePanel } from './components/TopologyNodePanel';
export type { TopologyNodePanelProps } from './components/TopologyNodePanel';

// ─── Overlay Color Utilities ──────────────────────────────────
export { getHealthColor as getHealthOverlayColor, getHealthLabel } from './overlays/HealthOverlay';
export { getCostColor, getCostLabel } from './overlays/CostOverlay';
export { getSecurityColor, getSecurityLabel } from './overlays/SecurityOverlay';
export { getPerformanceColor, getPerformanceLabel } from './overlays/PerformanceOverlay';
export { getDependencyColor, getDependencyLabel, getUpstreamChain as getOverlayUpstreamChain, getDownstreamChain as getOverlayDownstreamChain } from './overlays/DependencyOverlay';
export { getTrafficColor, getTrafficLabel, getEdgeAnimationSpeed, getEdgeThickness, getParticleCount } from './overlays/TrafficOverlay';

// ─── Constants ────────────────────────────────────────────────
export { OVERLAY_COLOR_SCHEMES } from './types/overlay.types';
