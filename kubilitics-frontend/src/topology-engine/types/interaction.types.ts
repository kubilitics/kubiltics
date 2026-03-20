import type { ReactNode } from 'react';

/**
 * Interaction modes for topology visualization
 */
export type InteractionMode =
  | 'idle'           // No active interaction
  | 'hovering'       // Mouse hovering over node/edge
  | 'selecting'      // Selecting nodes
  | 'dragging'       // Dragging nodes
  | 'path-tracing'   // Tracing user journey path
  | 'blast-radius';  // Computing blast radius

/**
 * Context menu action item
 */
export interface ContextMenuAction {
  /** Unique action ID */
  id: string;

  /** Display label */
  label: string;

  /** Icon to display (optional) */
  icon?: ReactNode;

  /** Action function to execute */
  action: (nodeId: string) => Promise<void> | void;

  /** Is this action enabled? */
  enabled?: boolean | ((nodeId: string) => boolean);

  /** Is this action dangerous (e.g., delete)? */
  danger?: boolean;

  /** Keyboard shortcut (optional) */
  shortcut?: string;

  /** Divider before this action */
  divider?: boolean;
}

/**
 * Context menu state
 */
export interface ContextMenuState {
  /** Is menu visible? */
  visible: boolean;

  /** Node ID for which menu is shown */
  nodeId?: string;

  /** Position of menu */
  position: { x: number; y: number };

  /** Available actions */
  actions: ContextMenuAction[];
}

/**
 * Blast radius computation result
 */
export interface BlastRadiusResult {
  /** IDs of affected nodes */
  affectedNodes: Set<string>;

  /** IDs of affected edges */
  affectedEdges: Set<string>;

  /** Severity score for each affected node (0-100) */
  severity: Map<string, number>;

  /** Total impact score (0-100) */
  totalImpact: number;

  /** Estimated number of users impacted */
  estimatedUsers?: number;

  /** Suggested mitigation steps */
  suggestions?: string[];

  /** Edge keys (e.g. "sourceId-targetId") that are alternative/safe paths (style green) */
  alternativePathEdges?: Set<string>;
}

/**
 * User journey path state
 */
export interface UserJourneyState {
  /** Is journey tracing active? */
  active: boolean;

  /** Path of node IDs */
  path: string[];

  /** Total latency along path (ms) */
  totalLatency?: number;

  /** Success rate along path (0-100) */
  successRate?: number;

  /** Cost per request along path */
  costPerRequest?: number;
}

/**
 * Highlighting context for multi-level highlighting
 */
export interface HighlightContext {
  /** Current interaction state */
  state: InteractionMode;

  /** Hovered node ID */
  hoveredNodeId: string | null;

  /** Selected node ID(s) */
  selectedNodeIds: Set<string>;

  /** Highlighted node IDs (based on current state) */
  highlightedNodeIds: Set<string>;

  /** Highlighted edge IDs */
  highlightedEdgeIds: Set<string>;

  /** Faded/dimmed node IDs */
  fadedNodeIds: Set<string>;

  /** Faded/dimmed edge IDs */
  fadedEdgeIds: Set<string>;
}

/**
 * Node position for dragging
 */
export interface NodePosition {
  /** Node ID */
  id: string;

  /** X coordinate */
  x: number;

  /** Y coordinate */
  y: number;

  /** Is position locked? */
  locked?: boolean;
}

/**
 * Drag state
 */
export interface DragState {
  /** Is dragging active? */
  active: boolean;

  /** Node being dragged */
  nodeId?: string;

  /** Starting position */
  startPosition?: { x: number; y: number };

  /** Current position */
  currentPosition?: { x: number; y: number };

  /** Should snap to grid? */
  snapToGrid?: boolean;
}
