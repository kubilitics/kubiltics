/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import type { TopologyNode } from "../types/topology";
import { healthColors, healthStatusMap } from "../nodes/nodeConfig";

/**
 * Computes health overlay styles for a node.
 * Returns CSS properties for left border and background tint.
 */
export function getHealthOverlayStyles(
  node: TopologyNode,
  enabled: boolean
): React.CSSProperties {
  if (!enabled) return {};

  const healthKey = healthStatusMap[node.status] ?? "unknown";
  const color = healthColors[healthKey];

  return {
    borderLeftWidth: 4,
    borderLeftColor: color,
    borderLeftStyle: "solid",
  };
}

/**
 * Computes aggregate health for a group of nodes.
 */
export function computeGroupHealth(
  nodes: TopologyNode[]
): "healthy" | "warning" | "error" | "unknown" {
  if (nodes.length === 0) return "unknown";

  let hasError = false;
  let hasWarning = false;
  let healthyCount = 0;

  for (const node of nodes) {
    const h = healthStatusMap[node.status] ?? "unknown";
    if (h === "error") hasError = true;
    else if (h === "warning") hasWarning = true;
    else if (h === "healthy") healthyCount++;
  }

  if (hasError) return "error";
  if (hasWarning) return "warning";
  if (healthyCount > nodes.length * 0.9) return "healthy";
  return "warning";
}

/**
 * HealthLegend: Collapsible health color legend for the topology.
 * Collapsed by default to avoid blocking topology resources.
 * Positioned top-left to avoid overlap with bottom controls.
 */
export function HealthLegend({ visible }: { visible: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  // Collapsed state: small icon button
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title="Show health legend"
        className="absolute top-3 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-sm shadow-sm backdrop-blur-md transition-colors hover:bg-white dark:border-gray-700 dark:bg-gray-800/80 dark:hover:bg-gray-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
        >
          <path
            fillRule="evenodd"
            d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    );
  }

  // Expanded state: compact legend card
  return (
    <div className="absolute top-3 left-3 z-10 rounded-lg border border-gray-200 bg-white/80 p-2.5 text-xs shadow-sm backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/80">
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Health
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          title="Collapse legend"
          className="flex h-5 w-5 items-center justify-center rounded text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      <div className="space-y-1">
        <LegendItem color={healthColors.healthy} label="Healthy" />
        <LegendItem color={healthColors.warning} label="Warning" />
        <LegendItem color={healthColors.error} label="Error" />
        <LegendItem color={healthColors.unknown} label="Unknown" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="font-medium text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}
