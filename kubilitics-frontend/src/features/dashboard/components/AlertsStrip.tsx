/**
 * Alerts Section — Polished card with reason-specific icons, grouped alerts, and clickable links.
 * Uses overview API when available; falls back to getEvents or K8s events when overview fails.
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Activity,
  XCircle,
  Zap,
  HeartCrack,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { getEvents, type BackendEvent } from "@/services/backendApiClient";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { getDetailPath } from "@/utils/resourceKindMapper";
import { cn } from "@/lib/utils";

const MAX_ALERTS_DISPLAY = 10;

type AlertItem = { reason: string; resource: string; namespace: string; kind: string; name: string };

function toAlertItem(
  e: BackendEvent | { type?: string; reason?: string; resource_kind?: string; resource_name?: string; namespace?: string }
): AlertItem {
  const kind = (e as BackendEvent).resource_kind ?? (e as { resource_kind?: string }).resource_kind ?? "";
  const name = (e as BackendEvent).resource_name ?? (e as { resource_name?: string }).resource_name ?? "";
  const ns = (e as BackendEvent).namespace ?? (e as { namespace?: string }).namespace ?? "";
  const resource = kind && name ? `${kind}/${name}` : name || kind || "—";
  return {
    reason: (e as BackendEvent).reason ?? (e as { reason?: string }).reason ?? "Event",
    resource,
    namespace: ns,
    kind,
    name,
  };
}

function iconForReason(reason: string): { icon: React.ComponentType<{ className?: string }>; color: string } {
  const r = (reason || "").toLowerCase();
  if (r.includes("getscale") || r.includes("scale")) return { icon: Activity, color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25" };
  if (r.includes("unhealthy")) return { icon: HeartCrack, color: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25" };
  if (r.includes("failedcreate")) return { icon: XCircle, color: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25" };
  if (r.includes("failed")) return { icon: HeartCrack, color: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25" };
  if (r.includes("pull") || r.includes("back")) return { icon: Zap, color: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/25" };
  return { icon: AlertTriangle, color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25" };
}

function groupAlertsByReason(alerts: AlertItem[]): Map<string, AlertItem[]> {
  const map = new Map<string, AlertItem[]>();
  for (const a of alerts) {
    const key = a.reason || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

export const AlertsStrip = () => {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const clusterId = currentClusterId ?? undefined;
  const { isConnected } = useConnectionStatus();
  const overview = useClusterOverview(clusterId);

  const eventsQuery = useQuery({
    queryKey: ["backend", "events", clusterId, "alerts"],
    queryFn: () => getEvents(backendBaseUrl, clusterId!, { limit: 200 }),
    enabled: !!clusterId && isBackendConfigured(),
    staleTime: 15000,
  });
  const k8sEvents = useK8sResourceList("events", "default", {
    enabled: isConnected && !isBackendConfigured(),
    limit: 200,
  });

  const { warnings, critical, criticalAlerts, warningAlerts } = useMemo(() => {
    if (overview.data && !overview.isError) {
      const a = overview.data.alerts;
      const topWarnings = (a.top_3 ?? []).slice(0, MAX_ALERTS_DISPLAY).map((t) => {
        const parts = (t.resource ?? "").split("/");
        const kind = parts[0] ?? "";
        const name = (parts.slice(1).join("/") || t.resource) ?? "";
        return { ...t, kind, name };
      });
      return { warnings: a.warnings, critical: a.critical, criticalAlerts: [] as AlertItem[], warningAlerts: topWarnings };
    }
    let events: Array<BackendEvent | { type?: string; reason?: string; resource_kind?: string; resource_name?: string; namespace?: string; involvedObject?: { kind?: string; name?: string; namespace?: string } }> = [];
    if (isBackendConfigured() && eventsQuery.data?.length) {
      events = eventsQuery.data;
    } else {
      const items = (k8sEvents.data?.items ?? []) as Array<{ type?: string; reason?: string; involvedObject?: { kind?: string; name?: string; namespace?: string } }>;
      events = items.map((i) => ({
        type: i.type,
        reason: i.reason,
        resource_kind: i.involvedObject?.kind,
        resource_name: i.involvedObject?.name,
        namespace: i.involvedObject?.namespace,
      }));
    }
    const warningEvents = events.filter((e) => (e as { type?: string }).type === "Warning");
    const criticalEvents = events.filter((e) => (e as { type?: string }).type === "Error" || ((e as { type?: string }).type && (e as { type?: string }).type !== "Normal" && (e as { type?: string }).type !== "Warning"));
    const criticalItems = criticalEvents.slice(0, MAX_ALERTS_DISPLAY).map((e) => toAlertItem(e));
    const warningItems = warningEvents.slice(0, MAX_ALERTS_DISPLAY).map((e) => toAlertItem(e));
    return { warnings: warningEvents.length, critical: criticalEvents.length, criticalAlerts: criticalItems, warningAlerts: warningItems };
  }, [overview.data, overview.isError, isBackendConfigured, eventsQuery.data, k8sEvents.data?.items]);

  if (!isConnected) {
    return (
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Alerts & warnings</h2>
        <Card className="border-none glass-panel overflow-hidden">
          <CardContent className="p-6">
            <span className="text-sm text-muted-foreground">No cluster connected</span>
          </CardContent>
        </Card>
      </section>
    );
  }

  const isLoading = (isBackendConfigured() && eventsQuery.isLoading) || (!isBackendConfigured() && k8sEvents.isLoading);
  if (isLoading && overview.isLoading && !overview.data) {
    return (
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Alerts & warnings</h2>
        <Card className="border-none glass-panel overflow-hidden">
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading alerts…</span>
          </CardContent>
        </Card>
      </section>
    );
  }

  const hasAlerts = warnings > 0 || critical > 0;

  const renderAlertColumn = (
    title: string,
    count: number,
    items: AlertItem[],
    variant: "critical" | "warning",
    emptyMessage: string
  ) => {
    const grouped = groupAlertsByReason(items);
    const isCritical = variant === "critical";
    const accentColor = isCritical ? "rose" : "amber";
    const Icon = isCritical ? AlertCircle : AlertTriangle;

    return (
      <Card className={cn(
        "border-none glass-panel overflow-hidden relative flex flex-col h-full min-h-[200px]",
        isCritical ? "ring-1 ring-rose-500/20" : "ring-1 ring-amber-500/20"
      )}>
        <div className={cn(
          "absolute top-0 left-0 right-0 h-1",
          isCritical ? "bg-gradient-to-r from-rose-500 to-rose-600" : "bg-gradient-to-r from-amber-500 to-orange-500"
        )} />
        <CardHeader className="pb-2 pt-5 px-5 relative z-10 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg border",
                isCritical ? "bg-rose-500/15 border-rose-500/25" : "bg-amber-500/15 border-amber-500/25"
              )}>
                <Icon className={cn("w-4 h-4", isCritical ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-xs text-muted-foreground">{count} {count === 1 ? "item" : "items"}</p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4 px-5 flex-1 min-h-0 overflow-y-auto relative z-10">
          {items.length > 0 ? (
            <div className="space-y-4">
              {Array.from(grouped.entries()).map(([reason, groupItems], groupIdx) => {
                const { icon: ReasonIcon, color } = iconForReason(reason);
                const borderColor = color.includes("rose") ? "border-l-rose-500" : color.includes("orange") ? "border-l-orange-500" : color.includes("amber") ? "border-l-amber-500" : "border-l-slate-500";
                return (
                  <motion.div
                    key={reason}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: groupIdx * 0.04, duration: 0.2 }}
                    className="rounded-lg border border-border/50 overflow-hidden bg-card/30"
                  >
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
                      <div className={cn("flex items-center justify-center w-6 h-6 rounded border", color)}>
                        <ReasonIcon className="w-3 h-3" />
                      </div>
                      <span className="text-xs font-semibold text-foreground">{reason}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">({groupItems.length})</span>
                    </div>
                    <div className="divide-y divide-border/30">
                      {groupItems.map((a, i) => {
                        const href = a.kind && a.name ? getDetailPath(a.kind, a.name, a.namespace) : null;
                        const content = (
                          <div
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 min-h-[48px] border-l-4 transition-all",
                              borderColor,
                              href && "hover:bg-muted/30 cursor-pointer group"
                            )}
                          >
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <p className="text-xs font-medium text-foreground truncate">{a.name || a.resource}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {a.namespace && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/80 text-muted-foreground">{a.namespace}</span>
                                )}
                                {a.kind && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">{a.kind}</span>
                                )}
                              </div>
                            </div>
                            {href && (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                            )}
                          </div>
                        );
                        return href ? <Link key={i} to={href}>{content}</Link> : <div key={i}>{content}</div>;
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4">{emptyMessage}</p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Alerts & warnings</h2>
        <Link
          to="/events"
          className="text-xs font-medium text-primary hover:underline"
        >
          View all events →
        </Link>
      </div>

      {hasAlerts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Alerts (Critical) */}
          {renderAlertColumn(
            "Alerts",
            critical,
            criticalAlerts,
            "critical",
            "No critical alerts"
          )}

          {/* Right: Warnings */}
          {renderAlertColumn(
            "Warnings",
            warnings,
            warningAlerts,
            "warning",
            "No warnings"
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card/50 p-6 flex items-center gap-3 glass-panel">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">All clear</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">No active alerts or warnings in the cluster</p>
          </div>
        </div>
      )}
    </section>
  );
};
