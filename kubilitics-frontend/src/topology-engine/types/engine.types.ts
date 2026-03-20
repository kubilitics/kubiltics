import type { OverlayType } from './overlay.types';

/**
 * Renderer engine types supported by Kubilitics Topology
 */
export type RendererEngine = 'cytoscape' | 'three' | 'hybrid' | 'd3';

/**
 * Engine configuration options
 */
export interface EngineConfig {
  /** Type of rendering engine */
  type: RendererEngine;

  /** Canvas width in pixels */
  width?: number;

  /** Canvas height in pixels */
  height?: number;

  /** Enable physics-based node positioning */
  enablePhysics?: boolean;

  /** Enable glow effects on selected nodes */
  enableGlow?: boolean;

  /** Target frames per second */
  targetFPS?: number;

  /** Enable animations */
  animate?: boolean;
}

/**
 * Engine reference interface - provides methods to control the rendering engine
 * All engines (Cytoscape, Three.js, D3, Hybrid) must implement this interface
 */
export interface EngineRef {
  /** Zoom in by one level */
  zoomIn: () => void;

  /** Zoom out by one level */
  zoomOut: () => void;

  /** Fit entire graph to screen */
  fitToScreen: () => void;

  /** Reset view to initial state */
  resetView: () => void;

  /** Export current view as SVG */
  exportAsSVG: () => string | undefined;

  /** Export current view as PNG */
  exportAsPNG: () => string | undefined;

  /** Recalculate and apply layout */
  relayout: () => void;

  /** Get total number of nodes */
  getNodeCount: () => number;

  /** Get total number of edges */
  getEdgeCount: () => number;

  /** Enable/disable a specific overlay */
  setOverlay: (overlayType: OverlayType, enabled: boolean) => void;

  /** Select a node by ID */
  selectNode?: (nodeId: string) => void;

  /** Clear all selections */
  clearSelection?: () => void;
}

/**
 * Engine state for tracking current rendering state
 */
export interface EngineState {
  /** Current engine type */
  engine: RendererEngine;

  /** Is the engine currently loading? */
  loading: boolean;

  /** Current zoom level (1.0 = 100%) */
  zoom: number;

  /** Pan position */
  pan: { x: number; y: number };

  /** Selected node IDs */
  selectedNodes: Set<string>;

  /** Is graph currently being laid out? */
  isLayouting: boolean;
}
