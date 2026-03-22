/* eslint-disable react-refresh/only-export-components */
import type { TopologyNode } from "../types/topology";

/**
 * Formats cost for display on a node badge.
 */
export function formatCostBadge(node: TopologyNode): string | null {
  if (!node.cost?.monthlyCostUSD) return null;
  const cost = node.cost.monthlyCostUSD;
  if (cost < 1) return `$${cost.toFixed(2)}/mo`;
  if (cost < 100) return `$${cost.toFixed(1)}/mo`;
  return `$${Math.round(cost)}/mo`;
}

/**
 * CostBadge: Small overlay badge showing monthly cost on a node.
 */
export function CostBadge({
  node,
  visible,
}: {
  node: TopologyNode;
  visible: boolean;
}) {
  if (!visible || !node.cost?.monthlyCostUSD) return null;

  const label = formatCostBadge(node);
  if (!label) return null;

  return (
    <div className="absolute -right-1 -top-1 z-10 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800 shadow-sm dark:bg-emerald-900 dark:text-emerald-200">
      {label}
    </div>
  );
}

/**
 * CostLegend: Displays cost overlay legend.
 */
export function CostLegend({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-16 left-3 z-10 rounded-md border bg-background/90 p-2 text-[10px] shadow-sm backdrop-blur-sm">
      <div className="mb-1 font-medium">Estimated Cost</div>
      <div className="text-muted-foreground">
        Monthly cost estimates based on resource requests and cloud pricing.
      </div>
    </div>
  );
}
