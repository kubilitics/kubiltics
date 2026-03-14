/**
 * resourceIntelligence — Shared computation logic for cluster resource
 * efficiency analysis, recommendations, and overprovisioning detection.
 *
 * Used by:
 * - ClusterResourceIntelligence (Dashboard)
 * - WorkloadResourceBudget (Workloads page)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EfficiencyLabel {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export type RecommendationSeverity = "info" | "warning" | "critical";
export type RecommendationIcon =
  | "TrendingDown"
  | "TrendingUp"
  | "AlertTriangle"
  | "Lightbulb"
  | "ShieldAlert";

export interface Recommendation {
  severity: RecommendationSeverity;
  message: string;
  icon: RecommendationIcon;
}

export interface RecommendationMetrics {
  cpuActualPercent: number;
  cpuRequestedPercent: number;
  memActualPercent: number;
  memRequestedPercent: number;
  metricsAvailable: boolean;
  overprovisionedNamespaces?: Array<{ name: string; ratio: number }>;
}

// ─── Efficiency Label ────────────────────────────────────────────────────────

/**
 * Map a 0-100 efficiency score to a human-readable tier with colors.
 */
export function getEfficiencyLabel(score: number): EfficiencyLabel {
  if (score < 10)
    return {
      label: "Idle / Wasteful",
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      borderColor: "border-amber-300",
    };
  if (score < 30)
    return {
      label: "Underutilized",
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
      borderColor: "border-yellow-300",
    };
  if (score < 70)
    return {
      label: "Healthy Balance",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-300",
    };
  if (score < 90)
    return {
      label: "High Load",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      borderColor: "border-blue-300",
    };
  return {
    label: "Overcommitted",
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-300",
  };
}

// ─── Gauge Color ─────────────────────────────────────────────────────────────

/**
 * SVG stroke/fill color for the radial gauge based on efficiency score.
 */
export function getGaugeColor(score: number): string {
  if (score < 10) return "#F59E0B"; // amber
  if (score < 30) return "#EAB308"; // yellow
  if (score < 70) return "#10B981"; // emerald
  if (score < 90) return "#3B82F6"; // blue
  return "#EF4444"; // red
}

// ─── Overprovisioning ────────────────────────────────────────────────────────

/**
 * Calculate the overprovisioning ratio as a percentage.
 * Returns 0 when actual >= requested (no overprovisioning).
 */
export function calculateOverprovisioningRatio(
  requestedPercent: number,
  actualPercent: number
): number {
  if (requestedPercent <= 0 || actualPercent >= requestedPercent) return 0;
  return Math.round(requestedPercent - actualPercent);
}

// ─── Smart Recommendations ──────────────────────────────────────────────────

/**
 * Generate algorithmic insights based on resource metrics.
 * Returns at most 3 recommendations, prioritized by severity.
 */
export function generateRecommendations(
  metrics: RecommendationMetrics
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (metrics.metricsAvailable) {
    // CPU overprovisioning
    const cpuGap =
      metrics.cpuRequestedPercent - metrics.cpuActualPercent;
    if (cpuGap > 30) {
      recs.push({
        severity: "warning",
        message: `CPU is ${Math.round(cpuGap)}% overprovisioned. Requests far exceed actual usage.`,
        icon: "TrendingDown",
      });
    }

    // Memory overprovisioning
    const memGap =
      metrics.memRequestedPercent - metrics.memActualPercent;
    if (memGap > 30) {
      recs.push({
        severity: "warning",
        message: `Memory is ${Math.round(memGap)}% overprovisioned. Consider right-sizing pods.`,
        icon: "TrendingDown",
      });
    }

    // High actual CPU utilization
    if (metrics.cpuActualPercent > 80) {
      recs.push({
        severity: "critical",
        message:
          "CPU utilization is high. Scale up or optimize workloads before saturation.",
        icon: "TrendingUp",
      });
    }

    // Cluster largely idle
    if (
      metrics.cpuActualPercent < 10 &&
      metrics.memActualPercent < 10
    ) {
      recs.push({
        severity: "info",
        message:
          "Cluster is largely idle. Consider consolidating workloads or scaling down.",
        icon: "TrendingDown",
      });
    }
  }

  // Memory pressure (works even without actual metrics)
  if (
    metrics.memActualPercent > 85 ||
    metrics.memRequestedPercent > 90
  ) {
    recs.push({
      severity: "critical",
      message:
        "Memory pressure detected. Consider scaling nodes or reducing workloads.",
      icon: "AlertTriangle",
    });
  }

  // Namespace overprovisioning
  const overNs = (metrics.overprovisionedNamespaces ?? []).filter(
    (ns) => ns.ratio > 50
  );
  if (overNs.length > 0) {
    recs.push({
      severity: "info",
      message: `${overNs.length} namespace${overNs.length > 1 ? "s" : ""} overprovisioned by >50%. Top: ${overNs[0].name}`,
      icon: "Lightbulb",
    });
  }

  // Prioritize by severity, return max 3
  const order: Record<RecommendationSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3);
}

// ─── Right-Sizing ────────────────────────────────────────────────────────────

export type RightSizingStatus =
  | "overprovisioned"
  | "tight"
  | "balanced"
  | "no-limits";

/**
 * Evaluate whether a workload type's limits are appropriately sized
 * relative to its requests.
 */
export function getRightSizingStatus(
  cpuRequests: number,
  cpuLimits: number,
  memRequests: number,
  memLimits: number
): RightSizingStatus {
  if (cpuLimits === 0 && memLimits === 0) return "no-limits";

  const cpuRatio = cpuRequests > 0 ? cpuLimits / cpuRequests : 0;
  const memRatio = memRequests > 0 ? memLimits / memRequests : 0;
  const avgRatio = (cpuRatio + memRatio) / 2;

  if (avgRatio > 3) return "overprovisioned";
  if (avgRatio > 0 && avgRatio < 1.1) return "tight";
  return "balanced";
}
