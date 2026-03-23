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
  base:     { width: 280, height: 120 },
  expanded: { width: 380, height: 190 },
};

export function getNodeDims(nodeType: string) {
  return NODE_DIMS[nodeType] ?? NODE_DIMS.base;
}

// ─── Canvas Constants ────────────────────────────────────────────────────────
// Used by: TopologyCanvas, exports, minimap

export const CANVAS = {
  background: "#f8f9fb",
  backgroundDark: "#0f172a",
  gridColor: "#d4d4d8",
  gridColorDark: "#1e293b",
  gridGap: 24,
  gridSize: 1,
  /** Ring color used around MinimalNode dots */
  ringColor: "#ffffff",
  ringColorDark: "#0f172a",
  /** Minimap mask */
  minimapMask: "rgb(248 249 251 / 0.7)",
  minimapMaskDark: "rgb(15 23 42 / 0.7)",
} as const;

/** Get theme-aware canvas colors */
export function getCanvasColors(isDark: boolean) {
  return {
    background: isDark ? CANVAS.backgroundDark : CANVAS.background,
    gridColor: isDark ? CANVAS.gridColorDark : CANVAS.gridColor,
    ringColor: isDark ? CANVAS.ringColorDark : CANVAS.ringColor,
    minimapMask: isDark ? CANVAS.minimapMaskDark : CANVAS.minimapMask,
  };
}

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
  if (nodeCount > 300) return 0.15;
  if (nodeCount > 150) return 0.25;
  if (nodeCount > 50)  return 0.35;
  if (nodeCount > 20)  return 0.45;
  return 0.55;
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

// ─── Edge Styles (per relationship category) ────────────────────────────────
// Used by: LabeledEdge — conveys relationship semantics visually

export type MarkerType = "arrow-filled" | "arrow-open" | "arrow-diamond" | "none";

export interface EdgeStyleConfig {
  strokeWidth: number;
  dashArray?: string;
  markerEnd: MarkerType;
  opacity: number;
}

export const EDGE_STYLES: Record<string, EdgeStyleConfig> = {
  ownership:      { strokeWidth: 2.0,               markerEnd: "arrow-filled",  opacity: 0.85 },
  networking:     { strokeWidth: 1.8,               markerEnd: "arrow-open",    opacity: 0.80 },
  configuration:  { strokeWidth: 1.2, dashArray: "6 4", markerEnd: "arrow-diamond", opacity: 0.70 },
  storage:        { strokeWidth: 1.5, dashArray: "4 2", markerEnd: "arrow-filled",  opacity: 0.75 },
  rbac:           { strokeWidth: 1.0, dashArray: "2 3", markerEnd: "arrow-open",    opacity: 0.65 },
  scheduling:     { strokeWidth: 1.0, dashArray: "8 4", markerEnd: "none",          opacity: 0.60 },
  scaling:        { strokeWidth: 1.5,               markerEnd: "arrow-filled",  opacity: 0.75 },
  policy:         { strokeWidth: 1.2, dashArray: "4 4", markerEnd: "arrow-open",    opacity: 0.70 },
  containment:    { strokeWidth: 1.0, dashArray: "3 3", markerEnd: "none",          opacity: 0.50 },
};

export function getEdgeStyle(relationshipCategory?: string): EdgeStyleConfig {
  return EDGE_STYLES[relationshipCategory ?? ""] ?? EDGE_STYLES.containment;
}

// ─── Tailwind Class Helpers ─────────────────────────────────────────────────
// Used by: BaseNode, ExpandedNode (for Tailwind bg-* and border-* classes)

/** Tailwind border class for category (light + dark) */
export function categoryBorderClass(category: string): string {
  const map: Record<string, string> = {
    compute:    "border-blue-200 dark:border-blue-800",
    workload:   "border-blue-200 dark:border-blue-800",
    networking: "border-purple-200 dark:border-purple-800",
    config:     "border-teal-200 dark:border-teal-800",
    configuration: "border-teal-200 dark:border-teal-800",
    storage:    "border-orange-200 dark:border-orange-800",
    security:   "border-rose-200 dark:border-rose-800",
    rbac:       "border-amber-200 dark:border-amber-800",
    scheduling: "border-slate-200 dark:border-slate-700",
    cluster:    "border-slate-200 dark:border-slate-700",
    scaling:    "border-green-200 dark:border-green-800",
    custom:     "border-indigo-200 dark:border-indigo-800",
  };
  return map[category] ?? "border-gray-200 dark:border-gray-700";
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
    healthy: { text: "Healthy", bg: "bg-emerald-50 dark:bg-emerald-950/30", textColor: "text-emerald-700 dark:text-emerald-400", dotClass: "bg-emerald-500" },
    warning: { text: "Warning", bg: "bg-amber-50 dark:bg-amber-950/30", textColor: "text-amber-700 dark:text-amber-400", dotClass: "bg-amber-500" },
    error:   { text: "Error",   bg: "bg-red-50 dark:bg-red-950/30",     textColor: "text-red-700 dark:text-red-400",     dotClass: "bg-red-500" },
    unknown: { text: "Unknown", bg: "bg-gray-50 dark:bg-slate-700",    textColor: "text-gray-500 dark:text-gray-400",    dotClass: "bg-gray-400" },
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

// ─── Node Card Shared Styles ────────────────────────────────────────────────
// Used by: BaseNode, CompactNode, ExpandedNode — ensures consistent card look

export const NODE_CARD = {
  /** Default shadow */
  shadow: "shadow-sm",
  /** Hover shadow */
  hoverShadow: "hover:shadow-md",
  /** Card rounding */
  rounding: "rounded-lg",
  /** Card background */
  bg: "bg-white dark:bg-slate-800",
  /** Body padding */
  bodyPadding: "px-3 py-2.5",
  /** Header padding */
  headerPadding: "px-3 py-1.5",
  /** Handle styles */
  handleClass: "!bg-gray-300 !border-white !border-2",
} as const;

// ─── Layer / Tier Configuration ────────────────────────────────────────────
// Used by: useElkLayout (layer constraints), LayerLabel nodes

export const LAYER_CONFIG: Record<number, { label: string; bgTint: string }> = {
  0: { label: "Infrastructure", bgTint: "#4755690a" },
  1: { label: "Services",       bgTint: "#7C3AED0a" },
  2: { label: "Workloads",      bgTint: "#2563EB0a" },
  3: { label: "Controllers",    bgTint: "#0D94880a" },
  4: { label: "Pods",           bgTint: "#2563EB06" },
  5: { label: "Nodes",          bgTint: "#4755690a" },
};

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
