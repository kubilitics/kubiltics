/**
 * ─── TOPOLOGY DESIGN TOKENS ──────────────────────────────────────────────────
 *
 * SINGLE SOURCE OF TRUTH for all topology visual constants.
 * Every node, edge, export, and overlay references this file.
 * Never hard-code colors, dimensions, or spacing elsewhere.
 */

// ─── Category Colors ─────────────────────────────────────────────────────────
// Used by: BaseNode, CompactNode, MinimalNode, edges, exports, minimap

export const CATEGORY_COLORS: Record<string, {
  accent: string;       // Primary accent (headers, left borders, minimap)
  bg: string;           // Light background fill
  border: string;       // Border color for cards
  text: string;         // Text color for labels on the accent
}> = {
  compute:    { accent: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", text: "#FFFFFF" },
  workload:   { accent: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", text: "#FFFFFF" },
  networking: { accent: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", text: "#FFFFFF" },
  config:     { accent: "#0D9488", bg: "#F0FDFA", border: "#99F6E4", text: "#FFFFFF" },
  storage:    { accent: "#EA580C", bg: "#FFF7ED", border: "#FED7AA", text: "#FFFFFF" },
  security:   { accent: "#DB2777", bg: "#FDF2F8", border: "#FBCFE8", text: "#FFFFFF" },
  rbac:       { accent: "#D97706", bg: "#FFFBEB", border: "#FDE68A", text: "#FFFFFF" },
  scheduling: { accent: "#475569", bg: "#F8FAFC", border: "#CBD5E1", text: "#FFFFFF" },
  cluster:    { accent: "#475569", bg: "#F8FAFC", border: "#CBD5E1", text: "#FFFFFF" },
  scaling:    { accent: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0", text: "#FFFFFF" },
  custom:     { accent: "#6366F1", bg: "#EEF2FF", border: "#C7D2FE", text: "#FFFFFF" },
};

export function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom;
}

// ─── Status Colors ───────────────────────────────────────────────────────────
// Used by: all nodes, detail panel, legend, health overlay

export const STATUS_COLORS = {
  healthy: "#16A34A",
  warning: "#EAB308",
  error:   "#DC2626",
  unknown: "#9CA3AF",
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

/** Map any K8s status string to one of our 4 status keys */
export function mapStatusKey(status: string): StatusKey {
  const healthyStatuses = ["healthy", "Running", "Ready", "Bound", "Available", "Completed", "Active", "Succeeded"];
  const warningStatuses = ["warning", "Pending", "PartiallyAvailable"];
  const errorStatuses   = ["error", "Failed", "NotReady", "Lost", "CrashLoopBackOff", "OOMKilled"];

  if (healthyStatuses.includes(status)) return "healthy";
  if (warningStatuses.includes(status)) return "warning";
  if (errorStatuses.includes(status))   return "error";
  return "unknown";
}

/** Get a Tailwind bg class for status dot */
export function statusDotClass(status: string): string {
  const key = mapStatusKey(status);
  const map: Record<StatusKey, string> = {
    healthy: "bg-emerald-500",
    warning: "bg-amber-500",
    error:   "bg-red-500",
    unknown: "bg-gray-400",
  };
  return map[key];
}

// ─── Node Dimensions ─────────────────────────────────────────────────────────
// Used by: useElkLayout, export padding, grid layout

export const NODE_DIMS: Record<string, { width: number; height: number }> = {
  minimal:  { width: 80,  height: 60  },
  compact:  { width: 200, height: 50  },
  base:     { width: 260, height: 110 },
  expanded: { width: 360, height: 180 },
};

export function getNodeDims(nodeType: string) {
  return NODE_DIMS[nodeType] ?? NODE_DIMS.base;
}

// ─── Canvas Constants ────────────────────────────────────────────────────────
// Used by: TopologyCanvas, exports, minimap

export const CANVAS = {
  background: "#f8f9fb",
  gridColor: "#d4d4d8",
  gridGap: 24,
  gridSize: 1,
} as const;

// ─── Semantic Zoom Thresholds ────────────────────────────────────────────────
// Used by: TopologyCanvas.getNodeTypeForZoom

export const ZOOM_THRESHOLDS = {
  minimal: 0.08,    // below this: minimal dots
  compact: 0.30,    // below this: compact cards
  expanded: 1.5,    // above this: expanded detail
  // between compact and expanded: base cards
} as const;

// ─── FitView Zoom Floors ─────────────────────────────────────────────────────
// Used by: TopologyCanvas auto-fit

export function fitViewMinZoom(nodeCount: number): number {
  if (nodeCount > 300) return 0.12;
  if (nodeCount > 150) return 0.20;
  if (nodeCount > 50)  return 0.25;
  return 0.35;
}

// ─── Export Constants ────────────────────────────────────────────────────────
// Used by: exportTopology.ts, exportPDF.ts

export const EXPORT = {
  /** Padding scales with content: min 60px, max 120px, 3% of content dimension */
  dynamicPadding(contentWidth: number, contentHeight: number): number {
    const maxDim = Math.max(contentWidth, contentHeight);
    return Math.max(60, Math.min(120, Math.round(maxDim * 0.03)));
  },
  /** Max canvas pixel dimension (browser limit) */
  maxCanvasPixels: 16000,
  /** Default pixel ratio for scale-1 capture */
  pngPixelRatio: 2,
  /** Timeout for export operation (ms) */
  timeoutMs: 15000,
  /** Background color for exports */
  backgroundColor: CANVAS.background,
} as const;

// ─── Minimap Colors ──────────────────────────────────────────────────────────
// Used by: TopologyCanvas minimap — matches actual node header colors

export function minimapNodeColor(category: string, status: string): string {
  if (mapStatusKey(status) === "error") return STATUS_COLORS.error;
  if (mapStatusKey(status) === "warning") return STATUS_COLORS.warning;
  return getCategoryColor(category).accent;
}
