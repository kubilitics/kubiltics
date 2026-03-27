/**
 * RecentActivityPanel — Live cluster event stream for the dashboard.
 *
 * Replaces Quick Actions with genuinely useful information:
 * a timeline of the most recent cluster events showing what's
 * actually happening right now.
 *
 * Shows Normal + Warning events in a compact feed with:
 *   - Event type indicator (color dot)
 *   - Resource kind + name
 *   - Reason badge
 *   - Relative timestamp
 *   - Click-through to resource detail
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Play,
  Trash2,
  Download,
  Scale,
  ArrowRight,
} from "lucide-react";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { getEvents, type BackendEvent } from "@/services/backendApiClient";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { getDetailPath } from "@/utils/resourceKindMapper";
import { cn } from "@/lib/utils";

const MAX_EVENTS = 8;

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function relativeTime(timestamp: string): string {
  if (!timestamp) return "";
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface EventDisplay {
  id: string;
  type: "Normal" | "Warning" | "Error";
  reason: string;
  message: string;
  resourceKind: string;
  resourceName: string;
  namespace: string;
  timestamp: string;
  count: number;
  href: string | null;
}

function reasonIcon(reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("created") || r.includes("started") || r.includes("scheduled"))
    return Play;
  if (r.includes("killed") || r.includes("deleted") || r.includes("evicted"))
    return Trash2;
  if (r.includes("pulling") || r.includes("pulled"))
    return Download;
  if (r.includes("scaled") || r.includes("replica"))
    return Scale;
  if (r.includes("backoff") || r.includes("restart") || r.includes("unhealthy"))
    return RotateCcw;
  if (r.includes("failed") || r.includes("error"))
    return XCircle;
  return Activity;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export const RecentActivityPanel = () => {
  const { isConnected } = useConnectionStatus();
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));

  // Backend events
  const eventsQuery = useQuery({
    queryKey: ["backend", "events", clusterId, "recentActivity"],
    queryFn: () => getEvents(backendBaseUrl, clusterId!, { limit: 50 }),
    enabled: !!clusterId && isBackendConfigured(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Direct K8s fallback
  const k8sEvents = useK8sResourceList("events", undefined, {
    enabled: isConnected && !isBackendConfigured(),
    limit: 50,
    staleTime: 15_000,
  });

  const events = useMemo<EventDisplay[]>(() => {
    let rawEvents: EventDisplay[] = [];

    if (isBackendConfigured() && Array.isArray(eventsQuery.data)) {
      rawEvents = eventsQuery.data.map((e) => ({
        id: e.id || `${e.resource_kind}-${e.resource_name}-${e.reason}`,
        type: (e.type as EventDisplay["type"]) || "Normal",
        reason: e.reason || "Event",
        message: e.message || "",
        resourceKind: e.resource_kind || "",
        resourceName: e.resource_name || "",
        namespace: e.namespace || "",
        timestamp: e.last_timestamp || e.first_timestamp || "",
        count: e.count || 1,
        href: e.resource_kind && e.resource_name
          ? getDetailPath(e.resource_kind, e.resource_name, e.namespace) ?? null
          : null,
      }));
    } else if (k8sEvents.data?.items) {
      rawEvents = (k8sEvents.data.items as any[]).map((e, i) => ({
        id: e.metadata?.uid || `event-${i}`,
        type: (e.type as EventDisplay["type"]) || "Normal",
        reason: e.reason || "Event",
        message: e.message || "",
        resourceKind: e.involvedObject?.kind || "",
        resourceName: e.involvedObject?.name || "",
        namespace: e.involvedObject?.namespace || e.metadata?.namespace || "",
        timestamp: e.lastTimestamp || e.firstTimestamp || e.metadata?.creationTimestamp || "",
        count: e.count || 1,
        href: e.involvedObject?.kind && e.involvedObject?.name
          ? getDetailPath(e.involvedObject.kind, e.involvedObject.name, e.involvedObject.namespace || e.metadata?.namespace) ?? null
          : null,
      }));
    }

    // Sort by timestamp descending, take most recent
    return rawEvents
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, MAX_EVENTS);
  }, [eventsQuery.data, k8sEvents.data, isBackendConfigured]);

  const isLoading = (isBackendConfigured() && eventsQuery.isLoading) || (!isBackendConfigured() && k8sEvents.isLoading);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
        No cluster connected
      </div>
    );
  }

  if (isLoading && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading activity...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/50">
        <CheckCircle2 className="h-6 w-6" />
        <span className="text-sm">No recent events</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Events list */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        <div className="space-y-0.5">
          {events.map((evt, i) => {
            const Icon = reasonIcon(evt.reason);
            const isWarning = evt.type === "Warning" || evt.type === "Error";

            const content = (
              <div
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors duration-200",
                  evt.href && "hover:bg-muted/50 cursor-pointer group",
                )}
              >
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center pt-0.5 shrink-0">
                  <div
                    className={cn(
                      "h-7 w-7 rounded-lg flex items-center justify-center",
                      isWarning
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] font-semibold text-foreground truncate">
                      {evt.resourceKind}/{evt.resourceName}
                    </span>
                    {evt.count > 1 && (
                      <span className="text-[10px] font-medium text-muted-foreground/60 tabular-nums">
                        x{evt.count}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                        isWarning
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
                      )}
                    >
                      {evt.reason}
                    </span>
                    {evt.namespace && (
                      <span className="text-[10px] text-muted-foreground/50 truncate">
                        {evt.namespace}
                      </span>
                    )}
                  </div>
                </div>

                {/* Timestamp + chevron */}
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums whitespace-nowrap">
                    {relativeTime(evt.timestamp)}
                  </span>
                  {evt.href && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors" />
                  )}
                </div>
              </div>
            );

            return evt.href ? (
              <Link key={evt.id + i} to={evt.href} className="block">
                {content}
              </Link>
            ) : (
              <div key={evt.id + i}>{content}</div>
            );
          })}
        </div>
      </div>

      {/* Footer link */}
      <div className="pt-3 mt-auto border-t border-border/40">
        <Link
          to="/events"
          className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View all events
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};
