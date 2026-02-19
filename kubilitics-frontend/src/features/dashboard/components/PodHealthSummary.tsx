/**
 * Pod Health Summary — compact visual of pod status + resource utilization.
 * Replaces Cluster pulse. Answers "Are my pods healthy? How much capacity is used?"
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { cn } from "@/lib/utils";

export const PodHealthSummary = () => {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? undefined;
  const { isConnected } = useConnectionStatus();
  const overview = useClusterOverview(clusterId);
  const podsList = useK8sResourceList("pods", undefined, {
    enabled: isConnected,
    limit: 5000,
  });

  const { running, pending, failed, succeeded, total } = useMemo(() => {
    if (overview.data?.pod_status && !overview.isError) {
      const ps = overview.data.pod_status;
      const t = ps.running + ps.pending + ps.failed + ps.succeeded;
      return { running: ps.running, pending: ps.pending, failed: ps.failed, succeeded: ps.succeeded, total: t };
    }
    const items = (podsList.data?.items ?? []) as Array<{ status?: { phase?: string } }>;
    let r = 0, p = 0, f = 0, s = 0;
    for (const pod of items) {
      const phase = (pod?.status?.phase ?? "Unknown").toLowerCase();
      if (phase === "running") r++;
      else if (phase === "pending") p++;
      else if (phase === "failed" || phase === "unknown") f++;
      else if (phase === "succeeded") s++;
    }
    return { running: r, pending: p, failed: f, succeeded: s, total: r + p + f + s };
  }, [overview.data?.pod_status, overview.isError, podsList.data?.items]);

  const utilization = overview.data?.utilization;
  const hasUtilization = utilization != null;

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">No cluster connected</p>
      </div>
    );
  }

  const segments = [
    { count: running, label: "Running", color: "bg-emerald-500", pct: total > 0 ? (running / total) * 100 : 0 },
    { count: pending, label: "Pending", color: "bg-amber-500", pct: total > 0 ? (pending / total) * 100 : 0 },
    { count: failed, label: "Failed", color: "bg-rose-500", pct: total > 0 ? (failed / total) * 100 : 0 },
    { count: succeeded, label: "Succeeded", color: "bg-slate-400", pct: total > 0 ? (succeeded / total) * 100 : 0 },
  ].filter((s) => s.count > 0);

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-4">
      {/* Pod status stacked bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Pod status</span>
          <Link to="/pods" className="text-xs font-medium text-primary hover:underline">
            View pods
          </Link>
        </div>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No pods</p>
        ) : (
          <>
            <div className="h-2 w-full rounded-full overflow-hidden flex bg-muted/50">
              {segments.map((s, i) => (
                <div
                  key={i}
                  className={cn("h-full transition-all", s.color)}
                  style={{ width: `${Math.max(s.pct, 1)}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              {segments.map((s, i) => (
                <span key={i}>
                  <span className={cn("inline-block w-2 h-2 rounded-full mr-1 align-middle", s.color)} />
                  {s.label}: {s.count}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Resource utilization when available */}
      {hasUtilization && (
        <div className="pt-3 border-t border-border/40">
          <div className="text-sm font-medium text-foreground mb-2">Cluster utilization</div>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-muted-foreground">CPU</span>
                <span className="font-medium tabular-nums">{utilization!.cpu_percent}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    utilization!.cpu_percent > 80 ? "bg-rose-500" : utilization!.cpu_percent > 60 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${Math.min(utilization!.cpu_percent, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-muted-foreground">Memory</span>
                <span className="font-medium tabular-nums">{utilization!.memory_percent}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    utilization!.memory_percent > 80 ? "bg-rose-500" : utilization!.memory_percent > 60 ? "bg-amber-500" : "bg-blue-500"
                  )}
                  style={{ width: `${Math.min(utilization!.memory_percent, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
