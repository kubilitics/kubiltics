/**
 * Cluster Pulse — 4 compact stat pills: Nodes | Pods | Warnings | CPU%
 * Uses overview API when available; falls back to useResourceCounts + events for direct K8s or when overview fails.
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Server, Activity, AlertTriangle, Cpu } from "lucide-react";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { getEvents } from "@/services/backendApiClient";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { cn } from "@/lib/utils";

const PILL_CONFIG = [
  { key: "nodes", label: "Nodes", href: "/nodes", icon: Server, color: "text-blue-600 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15" },
  { key: "pods", label: "Pods", href: "/pods", icon: Activity, color: "text-violet-600 bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/15" },
  { key: "warnings", label: "Warnings", href: "/events", icon: AlertTriangle, color: "text-amber-600 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15" },
  { key: "cpu", label: "CPU", href: "/workloads", icon: Cpu, color: "text-cyan-600 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/15" },
];

export const ClusterPulseRow = () => {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const clusterId = currentClusterId ?? undefined;
  const { isConnected } = useConnectionStatus();
  const { counts } = useResourceCounts();
  const overview = useClusterOverview(clusterId);

  const eventsQuery = useQuery({
    queryKey: ["backend", "events", clusterId, "pulse"],
    queryFn: () => getEvents(backendBaseUrl, clusterId!, { limit: 200 }),
    enabled: !!clusterId && isBackendConfigured,
    staleTime: 15000,
  });
  const k8sEvents = useK8sResourceList("events", "default", {
    enabled: isConnected && !isBackendConfigured,
    limit: 200,
  });

  const warningCount = useMemo(() => {
    if (isBackendConfigured && eventsQuery.data?.length) {
      return eventsQuery.data.filter((e) => (e as { type?: string }).type === "Warning").length;
    }
    const items = (k8sEvents.data?.items ?? []) as Array<{ type?: string }>;
    return items.filter((i) => i?.type === "Warning").length;
  }, [isBackendConfigured, eventsQuery.data, k8sEvents.data?.items]);

  const { nodes, pods, cpuDisplay } = useMemo(() => {
    if (overview.data && !overview.isError) {
      const u = overview.data.utilization;
      return {
        nodes: overview.data.counts.nodes,
        pods: overview.data.counts.pods,
        cpuDisplay: u ? `${u.cpu_percent}%` : "—",
      };
    }
    return {
      nodes: counts.nodes ?? 0,
      pods: counts.pods ?? 0,
      cpuDisplay: "—",
    };
  }, [overview.data, overview.isError, counts.nodes, counts.pods]);

  if (!isConnected) {
    return (
      <div className="flex flex-wrap gap-2">
        {PILL_CONFIG.map(({ key, label, icon: Icon }) => (
          <div key={key} className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium bg-muted/50 text-muted-foreground border-border/60")}>
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
            <span className="tabular-nums">—</span>
          </div>
        ))}
      </div>
    );
  }

  const values = [nodes, pods, warningCount, cpuDisplay];

  return (
    <div className="flex flex-wrap gap-2">
      {PILL_CONFIG.map(({ key, label, href, icon: Icon, color }, i) => (
        <Link key={key} to={href} className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors", color)}>
          <Icon className="w-3.5 h-3.5" />
          <span>{label}</span>
          <span className="tabular-nums font-bold">{values[i]}</span>
        </Link>
      ))}
    </div>
  );
};
