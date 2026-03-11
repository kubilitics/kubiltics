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

// ─── Edge / Relationship Colors ─────────────────────────────────────────────
// Used by: LabeledEdge, AnimatedEdge, Draw.io export

export const EDGE_COLORS: Record<string, string> = {
  ownership:      "#3b82f6",    // blue
  networking:     "#8b5cf6",    // purple
  configuration:  "#f59e0b",    // amber
  storage:        "#06b6d4",    // cyan
  rbac:           "#ec4899",    // pink
  scheduling:     "#6b7280",    // gray
  scaling:        "#22c55e",    // green
  policy:         "#f97316",    // orange
  containment:    "#94a3b8",    // slate
} as const;

export function getEdgeColor(relationshipCategory?: string): string {
  return EDGE_COLORS[relationshipCategory ?? ""] ?? EDGE_COLORS.containment;
}

// ─── Tailwind Class Helpers ─────────────────────────────────────────────────
// Used by: BaseNode, ExpandedNode (for Tailwind bg-* and border-* classes)

/** Tailwind border class for category */
export function categoryBorderClass(category: string): string {
  const map: Record<string, string> = {
    compute:    "border-blue-200",
    workload:   "border-blue-200",
    networking: "border-purple-200",
    config:     "border-teal-200",
    configuration: "border-teal-200",
    storage:    "border-orange-200",
    security:   "border-rose-200",
    rbac:       "border-amber-200",
    scheduling: "border-slate-200",
    cluster:    "border-slate-200",
    scaling:    "border-green-200",
    custom:     "border-indigo-200",
  };
  return map[category] ?? "border-gray-200";
}

/** Tailwind bg class for category header */
export function categoryHeaderClass(category: string): string {
  const map: Record<string, string> = {
    compute:    "bg-blue-600",
    workload:   "bg-blue-600",
    networking: "bg-purple-600",
    config:     "bg-teal-600",
    configuration: "bg-teal-600",
    storage:    "bg-orange-600",
    security:   "bg-rose-600",
    rbac:       "bg-amber-600",
    scheduling: "bg-slate-600",
    cluster:    "bg-slate-600",
    scaling:    "bg-green-600",
    custom:     "bg-indigo-600",
  };
  return map[category] ?? "bg-gray-600";
}

// ─── Status Badge Config ────────────────────────────────────────────────────
// Used by: BaseNode, ExpandedNode

export function getStatusBadge(status: string): { text: string; bg: string; textColor: string; dotClass: string } {
  const key = mapStatusKey(status);
  const map: Record<StatusKey, { text: string; bg: string; textColor: string; dotClass: string }> = {
    healthy: { text: "Healthy", bg: "bg-emerald-50", textColor: "text-emerald-700", dotClass: "bg-emerald-500" },
    warning: { text: "Warning", bg: "bg-amber-50", textColor: "text-amber-700", dotClass: "bg-amber-500" },
    error:   { text: "Error",   bg: "bg-red-50",     textColor: "text-red-700",     dotClass: "bg-red-500" },
    unknown: { text: "Unknown", bg: "bg-gray-50",    textColor: "text-gray-500",    dotClass: "bg-gray-400" },
  };
  return map[key];
}

// ─── Minimap Colors ──────────────────────────────────────────────────────────
// Used by: TopologyCanvas minimap — matches actual node header colors

export function minimapNodeColor(category: string, status: string): string {
  if (mapStatusKey(status) === "error") return STATUS_COLORS.error;
  if (mapStatusKey(status) === "warning") return STATUS_COLORS.warning;
  return getCategoryColor(category).accent;
}

// ─── Accessibility Constants ────────────────────────────────────────────────
// Used by: all interactive topology components

export const A11Y = {
  /** Focus ring class for keyboard navigation */
  focusRing: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
  /** Focus ring for dark backgrounds */
  focusRingLight: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2",
  /** Minimum touch target size (px) */
  minTouchTarget: 44,
  /** Transition for interactive elements */
  transition: "transition-all duration-150 ease-in-out",
} as const;
