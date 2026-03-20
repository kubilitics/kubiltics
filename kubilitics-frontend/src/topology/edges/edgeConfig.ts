/**
 * Edge styles by relationship category.
 * 8 distinct visual styles with light + dark mode support.
 */

export interface EdgeStyle {
  color: { light: string; dark: string };
  style: "solid" | "dashed" | "dotted";
  width: number;
  arrow: "filled-triangle" | "open-triangle" | "diamond" | "circle" | "double-triangle";
  dashArray?: string;
}

export const edgeStyles: Record<string, EdgeStyle> = {
  ownership: {
    color: { light: "#1E40AF", dark: "#60A5FA" },
    style: "solid",
    width: 2,
    arrow: "filled-triangle",
  },
  selection: {
    color: { light: "#6D28D9", dark: "#A78BFA" },
    style: "dashed",
    width: 2,
    arrow: "open-triangle",
    dashArray: "8 4",
  },
  mount: {
    color: { light: "#0F766E", dark: "#5EEAD4" },
    style: "dotted",
    width: 1.5,
    arrow: "diamond",
    dashArray: "3 3",
  },
  routing: {
    color: { light: "#7C3AED", dark: "#8B5CF6" },
    style: "solid",
    width: 2.5,
    arrow: "filled-triangle",
  },
  rbac: {
    color: { light: "#B45309", dark: "#FCD34D" },
    style: "dashed",
    width: 1.5,
    arrow: "open-triangle",
    dashArray: "8 4",
  },
  scheduling: {
    color: { light: "#475569", dark: "#94A3B8" },
    style: "dotted",
    width: 1,
    arrow: "circle",
    dashArray: "3 3",
  },
  scaling: {
    color: { light: "#15803D", dark: "#86EFAC" },
    style: "dashed",
    width: 1.5,
    arrow: "double-triangle",
    dashArray: "8 4",
  },
  policy: {
    color: { light: "#B91C1C", dark: "#FCA5A5" },
    style: "dashed",
    width: 1.5,
    arrow: "open-triangle",
    dashArray: "8 4",
  },
};

/**
 * Map relationship category string to edge style key.
 */
export function getEdgeStyle(category: string): EdgeStyle {
  return edgeStyles[category] ?? edgeStyles.scheduling;
}

/**
 * Get the color for an edge based on category and health.
 * Unhealthy edges always render in red.
 */
export function getEdgeColor(
  category: string,
  healthy: boolean,
  isDark: boolean
): string {
  if (!healthy) return "#DC2626";
  const style = getEdgeStyle(category);
  return isDark ? style.color.dark : style.color.light;
}
