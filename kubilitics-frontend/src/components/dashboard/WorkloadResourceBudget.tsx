/**
 * WorkloadResourceBudget — Contextual resource widget for the Workloads page.
 *
 * Shows per-workload-type resource allocation:
 * - Deployment, StatefulSet, DaemonSet, Job, CronJob, Standalone
 * - CPU + Memory requests/limits per type
 * - Right-sizing indicators (overprovisioned / tight / balanced)
 * - Summary footer with totals
 *
 * Replaces the generic ClusterEfficiencyCard that was duplicated from Dashboard.
 */
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Database,
  Activity,
  Clock,
  Timer,
  Box,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { useClusterStore } from "@/stores/clusterStore";
import { parseCpu, parseMemory, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getRightSizingStatus,
  type RightSizingStatus,
} from "@/lib/resourceIntelligence";

// ─── Constants ───────────────────────────────────────────────────────────────

interface WorkloadTypeData {
  kind: string;
  count: number;
  cpuRequests: number;  // millicores
  memRequests: number;  // bytes
  cpuLimits: number;    // millicores
  memLimits: number;    // bytes
}

const KIND_ICONS: Record<string, LucideIcon> = {
  Deployment: Layers,
  StatefulSet: Database,
  DaemonSet: Activity,
  Job: Clock,
  CronJob: Timer,
  Standalone: Box,
};

const KIND_COLORS: Record<string, string> = {
  Deployment: "#8B5CF6",   // violet
  StatefulSet: "#3B82F6",  // blue
  DaemonSet: "#10B981",    // emerald
  Job: "#F59E0B",          // amber
  CronJob: "#EF4444",      // red
  Standalone: "#6B7280",   // gray
};

const RIGHT_SIZING_STYLES: Record<
  RightSizingStatus,
  { dot: string; label: string; tooltip: string }
> = {
  overprovisioned: {
    dot: "bg-amber-500",
    label: "Over",
    tooltip: "Limits are 3x+ higher than requests. Consider reducing limits.",
  },
  tight: {
    dot: "bg-rose-500",
    label: "Tight",
    tooltip: "Limits barely exceed requests. Pods may get OOM-killed under load.",
  },
  balanced: {
    dot: "bg-emerald-500",
    label: "OK",
    tooltip: "Limits are appropriately sized relative to requests.",
  },
  "no-limits": {
    dot: "bg-slate-300",
    label: "No limits",
    tooltip: "No resource limits set. Pods can consume unbounded resources.",
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkloadResourceBudget() {
  const { activeCluster } = useClusterStore();

  const podsList = useK8sResourceList("pods", undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 30000,
  });

  // ── Aggregate pods by workload type ──
  const { workloadTypes, totals } = useMemo(() => {
    const typeMap: Record<string, WorkloadTypeData> = {};
    let totalPods = 0;
    let totalCpu = 0;
    let totalMem = 0;

    const pods = podsList.data?.items ?? [];
    for (const pod of pods) {
      const phase = (pod as unknown as Record<string, unknown>)?.status?.phase;
      if (phase === "Succeeded" || phase === "Failed") continue;

      const ownerRefs = (pod as unknown as Record<string, unknown>)?.metadata?.ownerReferences ?? [];
      let kind = "Standalone";
      if (ownerRefs.length > 0) {
        const ownerKind: string = (ownerRefs[0] as Record<string, unknown>).kind as string;
        // ReplicaSets are overwhelmingly owned by Deployments
        kind = ownerKind === "ReplicaSet" ? "Deployment" : ownerKind;
      }

      if (!typeMap[kind]) {
        typeMap[kind] = {
          kind,
          count: 0,
          cpuRequests: 0,
          memRequests: 0,
          cpuLimits: 0,
          memLimits: 0,
        };
      }
      typeMap[kind].count++;
      totalPods++;

      const containers = (pod as unknown as Record<string, unknown>)?.spec?.containers ?? [];
      for (const c of containers) {
        const requests = (c as Record<string, unknown>).resources?.requests ?? {};
        const limits = (c as Record<string, unknown>).resources?.limits ?? {};
        const cpuReq = parseCpu((requests.cpu as string) || "0");
        const memReq = parseMemory((requests.memory as string) || "0");
        typeMap[kind].cpuRequests += cpuReq;
        typeMap[kind].memRequests += memReq;
        typeMap[kind].cpuLimits += parseCpu(limits.cpu || "0");
        typeMap[kind].memLimits += parseMemory(limits.memory || "0");
        totalCpu += cpuReq;
        totalMem += memReq;
      }
    }

    const sorted = Object.values(typeMap).sort((a, b) => b.cpuRequests - a.cpuRequests);

    return {
      workloadTypes: sorted,
      totals: { pods: totalPods, cpu: totalCpu, mem: totalMem },
    };
  }, [podsList.data]);

  // Max CPU for proportional bar widths
  const maxCpu = workloadTypes.length > 0 ? workloadTypes[0].cpuRequests : 1;

  return (
    <Card
      className={cn(
        "h-full min-h-[28rem] border-none relative overflow-hidden flex flex-col group",
        "bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all duration-300"
      )}
    >
      {/* Gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500" />

      {/* Header */}
      <CardHeader className="pb-1 pt-5 px-6">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-blue-600">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div>
            <span>Resource Budget</span>
            <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
              By workload type
            </p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 px-6 pb-5 pt-3 flex flex-col">
        {/* ── Workload Type Rows ── */}
        <div className="flex-1 space-y-3">
          {workloadTypes.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic py-8">
              No active workloads
            </div>
          )}

          {workloadTypes.map((wt, i) => {
            const Icon = KIND_ICONS[wt.kind] ?? Box;
            const color = KIND_COLORS[wt.kind] ?? "#6B7280";
            const barWidth = maxCpu > 0 ? (wt.cpuRequests / maxCpu) * 100 : 0;
            const sizing = getRightSizingStatus(
              wt.cpuRequests,
              wt.cpuLimits,
              wt.memRequests,
              wt.memLimits
            );
            const sizingStyle = RIGHT_SIZING_STYLES[sizing];

            return (
              <motion.div
                key={wt.kind}
                className="rounded-lg border border-border/30 bg-muted/5 px-4 py-3 hover:bg-muted/10 transition-colors"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
              >
                {/* Row 1: Kind name + pod count + metrics */}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">{wt.kind}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {wt.count} pod{wt.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: CPU bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted/25 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidth}%` }}
                      transition={{ duration: 0.6, delay: 0.15 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>

                {/* Row 3: CPU + Memory + Right-sizing */}
                <div className="flex items-center justify-between mt-1.5 text-[10px] tabular-nums text-muted-foreground">
                  <span>
                    {(wt.cpuRequests / 1000).toFixed(1)} cores &middot;{" "}
                    {(wt.memRequests / (1024 ** 3)).toFixed(1)} GiB
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 cursor-help">
                        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", sizingStyle.dot)} />
                        <span className="font-medium">{sizingStyle.label}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[200px]">
                      <p className="text-xs">{sizingStyle.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Summary Footer ── */}
        {workloadTypes.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
              <span>
                Total: <span className="text-foreground font-semibold tabular-nums">{totals.pods}</span> pods
              </span>
              <span className="tabular-nums">
                <span className="text-foreground font-semibold">{(totals.cpu / 1000).toFixed(1)}</span> cores
                {" "}&middot;{" "}
                <span className="text-foreground font-semibold">{(totals.mem / (1024 ** 3)).toFixed(1)}</span> GiB
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
