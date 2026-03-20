/**
 * Data-Driven Insights — real cluster health details when AI is not configured.
 * Uses useHealthScore (pods, nodes, events) — no mock data, no LLM required.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { useHealthScore } from "@/hooks/useHealthScore";
import { useClusterStore } from "@/stores/clusterStore";

export function DataDrivenInsightsCard() {
  const { activeCluster } = useClusterStore();
  const health = useHealthScore();

  if (!activeCluster) {
    return null;
  }

  const hasIssues = health.details.length > 0;
  const details = health.details.slice(0, 5);

  return (
    <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-blue-500/80" />
      <CardHeader className="pb-4 pt-5 px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5 text-base font-semibold text-foreground">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-4 w-4 text-primary" aria-hidden />
            </div>
            <span>Cluster Insights</span>
          </CardTitle>
          <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Real-time data
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 font-normal">
          Health analysis from cluster telemetry (pods, nodes, events)
        </p>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto px-6 pb-6 pt-0">
        <div className="space-y-4">
          {/* Primary insight */}
          <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
            <div className="flex items-start gap-3">
              {hasIssues ? (
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground leading-relaxed">
                  {health.insight}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Grade {health.grade} · Score {health.score}/100
                </p>
              </div>
            </div>
          </div>

          {/* Detail items with links */}
          {details.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Details
              </p>
              <ul className="space-y-2">
                {details.map((d, i) => {
                  const href = d.toLowerCase().includes("pod") ? "/pods" :
                    d.toLowerCase().includes("node") ? "/nodes" :
                    d.toLowerCase().includes("event") || d.toLowerCase().includes("warning") ? "/events" : "/dashboard";
                  return (
                    <li key={i}>
                      <Link
                        to={href}
                        className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-sm hover:bg-muted/40 hover:border-primary/20 transition-colors group"
                      >
                        <span className="flex-1 text-foreground">{d}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Link
                to="/events"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline mt-2"
              >
                View all events
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500/60 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">All systems normal</p>
              <p className="text-xs text-muted-foreground mt-1">
                No issues detected. Pods, nodes, and events look healthy.
              </p>
              <Link
                to="/events"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline mt-3"
              >
                View events
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
