/**
 * TASK-092: Recent Events — last 10 Warning events cluster-wide, table, clickable.
 * Uses backend events when configured; otherwise K8s events from default namespace.
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
  StopCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { getEvents, type BackendEvent } from "@/services/backendApiClient";
import { getDetailPath } from "@/utils/resourceKindMapper";

const ROUTE_BY_KIND: Record<string, string> = {
  Pod: "pods",
  Deployment: "deployments",
  ReplicaSet: "replicasets",
  Node: "nodes",
  Service: "services",
  ReplicationController: "replicationcontrollers",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Job: "jobs",
  CronJob: "cronjobs",
};

function formatEventTime(iso: string): string {
  if (!iso) return "–";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const min = Math.floor(diffMs / 60000);
    const h = Math.floor(min / 60);
    const d_ = Math.floor(h / 24);
    if (d_ > 0) return `${d_}d ago`;
    if (h > 0) return `${h}h ago`;
    if (min > 0) return `${min}m ago`;
    return "just now";
  } catch {
    return iso;
  }
}

function iconForEvent(type: string, reason: string) {
  if (type === "Warning") return { icon: AlertTriangle, color: "text-amber-600 bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400" };
  if (type === "Error") return { icon: StopCircle, color: "text-rose-600 bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400" };
  const r = (reason || "").toLowerCase();
  if (r.includes("pull") || r.includes("back")) return { icon: StopCircle, color: "text-slate-600 bg-slate-100 dark:bg-slate-900/20 dark:text-slate-400" };
  return { icon: type === "Normal" ? CheckCircle2 : Info, color: "text-blue-600 bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400" };
}

interface NormalizedEvent {
  id: string;
  type: string;
  reason: string;
  message: string;
  resourceKind: string;
  resourceName: string;
  namespace: string;
  lastTimestamp: string;
  link: string;
}

function backendToNormalized(e: BackendEvent): NormalizedEvent {
  const kind = e.resource_kind || "Pod";
  const ns = e.namespace || e.event_namespace || "default";
  const name = e.resource_name || "";
  const route = ROUTE_BY_KIND[kind];
  const path = route && name ? (getDetailPath(kind, name, ns) ?? `/events?namespace=${ns}`) : `/events?namespace=${ns}`;
  return {
    id: e.id,
    type: e.type || "Normal",
    reason: e.reason || "",
    message: e.message || "",
    resourceKind: kind,
    resourceName: name,
    namespace: ns,
    lastTimestamp: e.last_timestamp || e.first_timestamp || "",
    link: path,
  };
}

function k8sToNormalized(item: {
  metadata?: { uid?: string };
  type?: string;
  reason?: string;
  message?: string;
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  lastTimestamp?: string;
  firstTimestamp?: string;
}): NormalizedEvent {
  const kind = item.involvedObject?.kind || "Pod";
  const ns = item.involvedObject?.namespace || "default";
  const name = item.involvedObject?.name || "";
  const route = ROUTE_BY_KIND[kind];
  const path = route && name ? (getDetailPath(kind, name, ns) ?? `/events?namespace=${ns}`) : `/events?namespace=${ns}`;
  return {
    id: item.metadata?.uid || `${item.lastTimestamp}-${name}-${item.reason}`,
    type: item.type || "Normal",
    reason: item.reason || "",
    message: item.message || "",
    resourceKind: kind,
    resourceName: name,
    namespace: ns,
    lastTimestamp: item.lastTimestamp || item.firstTimestamp || "",
    link: path,
  };
}

export const RecentEventsWidget = () => {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const backendQuery = useQuery({
    queryKey: ["backend", "events", currentClusterId, "dashboard-recent"],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { limit: 100 }),
    enabled: !!currentClusterId && isBackendConfigured(),
    staleTime: 15000,
  });

  const k8sEvents = useK8sResourceList("events", "default", {
    enabled: !!activeCluster && !isBackendConfigured(),
    limit: 100,
  });

  const warningEvents = useMemo((): NormalizedEvent[] => {
    let all: NormalizedEvent[] = [];
    if (isBackendConfigured() && backendQuery.data?.length) {
      all = backendQuery.data.map((e) => backendToNormalized(e));
    } else {
      const items = (k8sEvents.data?.items ?? []) as Parameters<typeof k8sToNormalized>[0][];
      all = items.map((i) => k8sToNormalized(i));
    }
    const warnings = all.filter((e) => e.type === "Warning");
    const sorted = [...warnings].sort(
      (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
    );
    return sorted.slice(0, 10);
  }, [isBackendConfigured, backendQuery.data, k8sEvents.data?.items]);

  const isLoading =
    (isBackendConfigured() && backendQuery.isLoading) ||
    (!isBackendConfigured() && k8sEvents.isLoading);

  return (
    <Card className="min-h-[20rem] flex flex-col border-none glass-panel overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-blue-500" />
      <CardHeader className="flex flex-row items-center justify-between pb-2 shrink-0">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">Recent Warning Events</CardTitle>
          <CardDescription>Last 10 warnings cluster-wide</CardDescription>
        </div>
        <Button variant="ghost" size="sm" className="text-xs text-primary hover:text-primary/80 h-8" asChild>
          <Link to="/events">View all <ChevronRight className="w-3 h-3 ml-1" /></Link>
        </Button>
      </CardHeader>

      <CardContent className="pt-4 flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : warningEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500/60 mb-2" />
            <p className="text-sm font-medium text-foreground">No warnings</p>
            <p className="text-xs text-muted-foreground mt-1">No Warning events in the last 100 events</p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link to="/events">View all events</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {warningEvents.map((ev) => {
              const { icon: Icon, color } = iconForEvent(ev.type, ev.reason);
              return (
                <Link
                  key={ev.id}
                  to={ev.link}
                  className="flex gap-4 group block rounded-lg p-2 -mx-2 hover:bg-muted/50 transition-colors"
                >
                  <div className={`mt-1 p-2 rounded-full h-fit flex-shrink-0 ${color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground leading-none">{ev.reason || "Event"}</p>
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                        <Clock className="w-3.5 h-3.5" /> {formatEventTime(ev.lastTimestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{ev.message}</p>
                    <p className="text-[10px] text-muted-foreground/80">
                      {ev.resourceKind}/{ev.resourceName || "—"} · {ev.namespace}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
