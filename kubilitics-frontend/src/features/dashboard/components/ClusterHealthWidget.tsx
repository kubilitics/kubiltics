/**
 * Cluster Health — gauge, breakdown, insight. Uses overview API when available; else useHealthScore.
 */
import React from "react";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Label } from "recharts";
import { Info, CheckCircle2, AlertTriangle, AlertCircle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useHealthScore } from "@/hooks/useHealthScore";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { badge: string; icon: typeof CheckCircle2 }> = {
  excellent: { badge: "bg-success/10 border-success/20 text-success", icon: CheckCircle2 },
  good: { badge: "bg-success/10 border-success/20 text-success", icon: CheckCircle2 },
  fair: { badge: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 text-amber-700 dark:text-amber-400", icon: AlertTriangle },
  poor: { badge: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 text-amber-700 dark:text-amber-400", icon: AlertTriangle },
  critical: { badge: "bg-rose-100 dark:bg-rose-900/30 border-rose-200 text-rose-700 dark:text-rose-400", icon: AlertCircle },
};

const BREAKDOWN_LABELS: Record<string, string> = {
  podHealth: "Pods",
  nodeHealth: "Nodes",
  stability: "Stability",
  eventHealth: "Events",
};

export const ClusterHealthWidget = () => {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const clusterId = currentClusterId ?? undefined;

  const overview = useClusterOverview(clusterId);
  const healthScore = useHealthScore();

  const hasOverview = isBackendConfigured && clusterId && overview.data?.health;
  const score = hasOverview ? overview.data!.health.score : healthScore.score;
  const grade = hasOverview ? overview.data!.health.grade : healthScore.grade;
  const status = hasOverview ? overview.data!.health.status : healthScore.status;
  const { breakdown, insight } = healthScore;

  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.critical;
  const StatusIcon = config.icon;

  const data = [
    { name: "Healthy", value: score, color: "url(#colorGradient)" },
    { name: "Issues", value: 100 - score, color: "hsl(var(--muted))" },
  ];

  const statusLabel = status === "excellent" || status === "good" ? "Good State" : status === "fair" ? "Needs Attention" : "At Risk";
  const hasData = activeCluster || clusterId;

  return (
    <Card className="h-full min-h-[28rem] border-none soft-shadow glass-panel relative overflow-hidden group flex flex-col">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-blue-500 to-cyan-500" />
      <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <CardHeader className="pb-2 pt-5 px-6 relative z-10 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">
            Cluster Health
          </h2>
          <div className="flex items-center gap-2">
            <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur-sm", config.badge)}>
              <StatusIcon className="w-3 h-3" />
              <span>{statusLabel}</span>
            </div>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors shrink-0" />
              </TooltipTrigger>
              <TooltipContent>Overall cluster health based on node status, pod availability, and event severity.</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col pt-2 pb-6 px-6 relative z-10">
        <div className="flex items-center justify-center shrink-0" style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart aria-label="Cluster health score chart">
              <defs>
                <linearGradient id="colorGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="100%" stopColor="#00E5FF" />
                </linearGradient>
              </defs>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={72}
                startAngle={90}
                endAngle={-270}
                dataKey="value"
                stroke="none"
                cornerRadius={10}
                paddingAngle={4}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} aria-label={`${entry.name}: ${entry.value}%`} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 4} className="fill-foreground text-3xl font-black tracking-tighter">
                            {hasData ? score : "—"}
                          </tspan>
                          <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 14} className="fill-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em]">
                            Grade {grade}
                          </tspan>
                        </text>
                      );
                    }
                    return null;
                  }}
                />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Breakdown — 4 factors */}
        <div className="space-y-2 pt-2 border-t border-border/50">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Health factors</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(["podHealth", "nodeHealth", "stability", "eventHealth"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{BREAKDOWN_LABELS[key]}</span>
                  <span className="font-semibold tabular-nums">{Math.min(100, Math.max(0, breakdown[key]))}%</span>
                </div>
                <Progress
                  value={Math.min(100, Math.max(0, breakdown[key]))}
                  className="h-1.5 bg-muted/50"
                  indicatorClassName={cn(
                    breakdown[key] >= 80 ? "bg-emerald-500" : breakdown[key] >= 60 ? "bg-amber-500" : "bg-rose-500"
                  )}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Insight */}
        {insight && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{insight}</p>
            {(status === "fair" || status === "poor" || status === "critical") && (
              <Link
                to="/events"
                className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:underline"
              >
                View events
                <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
