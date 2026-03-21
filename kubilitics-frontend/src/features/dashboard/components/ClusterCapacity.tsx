/**
 * Cluster Capacity — Three Recharts donut gauges (Pods, CPU, Memory)
 * plus layered capacity bars. Matches ClusterHealthWidget visual language.
 *
 * Data:
 *   Nodes  → .status.allocatable  (totals)
 *   Pods   → container requests   (reserved)
 *   useClusterUtilization → actual usage from metrics-server
 *   useClusterOverview   → fallback utilization %
 */
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Label } from "recharts";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { useClusterOverview } from "@/hooks/useClusterOverview";
import { useClusterUtilization } from "@/hooks/useClusterUtilization";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Loader2, Server, Cpu, MemoryStick, Hexagon, Info, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const METRICS_SERVER_ADDON_URL = `/addons/${encodeURIComponent('kubilitics/metrics-server')}`;

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function parseCpuMillis(v: string | number | undefined): number {
  if (v == null) return 0;
  const s = String(v);
  if (s.endsWith("m")) return parseInt(s, 10) || 0;
  if (s.endsWith("n")) return Math.round((parseInt(s, 10) || 0) / 1e6);
  return (parseFloat(s) || 0) * 1000;
}

function parseMemoryBytes(v: string | number | undefined): number {
  if (v == null) return 0;
  const s = String(v);
  const match = s.match(/^(\d+(?:\.\d+)?)\s*([EPTGMK]i?|[eptgmk])?$/);
  if (!match) return parseInt(s, 10) || 0;
  const num = parseFloat(match[1]!);
  const unit = match[2] ?? "";
  const m: Record<string, number> = {
    "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
    k: 1e3, m: 1e6, g: 1e9, t: 1e12, p: 1e15, e: 1e18,
  };
  return Math.round(num * (m[unit] ?? 1));
}

function formatCpu(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(1)} cores`;
  return `${Math.round(millis)}m`;
}
function formatMemory(bytes: number): string {
  if (bytes === 0) return "0";
  const gi = bytes / 1024 ** 3;
  if (gi >= 1) return `${gi.toFixed(1)} GiB`;
  const mi = bytes / 1024 ** 2;
  if (mi >= 1) return `${mi.toFixed(0)} MiB`;
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

type Sev = "ok" | "warn" | "crit";
function toSev(p: number): Sev {
  if (p >= 90) return "crit";
  if (p >= 75) return "warn";
  return "ok";
}

const SEV_COLORS = {
  ok: { fill: "#10b981", muted: "hsl(var(--muted))" },
  warn: { fill: "#f59e0b", muted: "hsl(var(--muted))" },
  crit: { fill: "#ef4444", muted: "hsl(var(--muted))" },
} as const;

const SEV_BADGE = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  crit: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   CapacityDonut — Recharts PieChart donut, same style as ClusterHealthWidget
   ═══════════════════════════════════════════════════════════════════════════ */

interface DonutProps {
  id: string;
  percent: number;
  label: string;
  centerLine1: string;
  centerLine2: string;
  gradientFrom: string;
  gradientTo: string;
  icon: React.ComponentType<{ className?: string }>;
  tooltipText: React.ReactNode;
}

function CapacityDonut({
  id,
  percent,
  label,
  centerLine1,
  centerLine2,
  gradientFrom,
  gradientTo,
  icon: Icon,
  tooltipText,
}: DonutProps) {
  const sev = toSev(percent);
  const data = [
    { name: "Used", value: percent },
    { name: "Free", value: 100 - percent },
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          className="flex flex-col items-center cursor-help select-none"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Icon + Label above chart */}
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          </div>

          {/* Donut */}
          <div style={{ width: 130, height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <linearGradient id={`cap-grad-${id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={gradientFrom} />
                    <stop offset="100%" stopColor={gradientTo} />
                  </linearGradient>
                </defs>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={54}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  stroke="none"
                  cornerRadius={8}
                  paddingAngle={3}
                  animationBegin={0}
                  animationDuration={1200}
                  animationEasing="ease-out"
                >
                  <Cell fill={`url(#cap-grad-${id})`} />
                  <Cell fill="hsl(var(--muted))" />
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) - 2}
                              className="fill-foreground text-2xl font-black tracking-tighter"
                            >
                              {percent}%
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 14}
                              className="fill-muted-foreground text-[9px] font-semibold uppercase tracking-[0.15em]"
                            >
                              {centerLine2}
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

          {/* Value below donut */}
          <div className="flex flex-col items-center -mt-1 gap-0.5">
            <span className="text-[12px] font-semibold tabular-nums text-foreground/80">
              {centerLine1}
            </span>
          </div>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed p-3">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main
   ═══════════════════════════════════════════════════════════════════════════ */

export const ClusterCapacity = () => {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? undefined;
  const { isConnected } = useConnectionStatus();
  const overview = useClusterOverview(clusterId);
  const { utilization: clusterUtil } = useClusterUtilization(clusterId);

  const { data: nodesData, isLoading: nodesLoading } = useK8sResourceList(
    "nodes", undefined, { enabled: isConnected },
  );
  const { data: podsData, isLoading: podsLoading } = useK8sResourceList(
    "pods", undefined, { enabled: isConnected, limit: 5000 },
  );

  const isLoading = nodesLoading || podsLoading;

  const cap = useMemo(() => {
    const nodes = (nodesData?.items ?? []) as Array<{
      status?: { capacity?: Record<string, string>; allocatable?: Record<string, string> };
    }>;
    const pods = (podsData?.items ?? []) as Array<{
      status?: { phase?: string };
      spec?: {
        containers?: Array<{
          resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
        }>;
      };
    }>;

    // Use allocatable for CPU/Memory (real schedulable resources),
    // capacity.pods for pod slots (kubelet --max-pods), fallback to allocatable.pods
    let tCpu = 0, tMem = 0, tPods = 0;
    for (const n of nodes) {
      const alloc = n.status?.allocatable ?? {};
      const capacity = n.status?.capacity ?? {};
      tCpu += parseCpuMillis(alloc.cpu || capacity.cpu);
      tMem += parseMemoryBytes(alloc.memory || capacity.memory);
      // Pod capacity: prefer capacity.pods (kubelet max), then allocatable.pods
      const podCap = capacity.pods || alloc.pods;
      tPods += podCap ? parseInt(String(podCap), 10) || 110 : 110;
    }

    // Count active pods: all non-terminal pods (not Succeeded, not Failed)
    let rCpu = 0, rMem = 0, aPods = 0;
    for (const p of pods) {
      const ph = (p.status?.phase ?? "").toLowerCase();
      if (ph !== "succeeded" && ph !== "failed") {
        aPods++;
        for (const c of p.spec?.containers ?? []) {
          rCpu += parseCpuMillis(c.resources?.requests?.cpu);
          rMem += parseMemoryBytes(c.resources?.requests?.memory);
        }
      }
    }

    const hasClusterUtil = clusterUtil.metricsAvailable && clusterUtil.cpuTotalMillicores > 0;
    const overviewUtil = overview.data?.utilization;

    let usedCpuMillis: number, usedMemBytes: number, usedCpuPct: number, usedMemPct: number;
    let hasMetrics: boolean;

    if (hasClusterUtil) {
      usedCpuMillis = clusterUtil.cpuUsedMillicores;
      usedMemBytes = clusterUtil.memoryUsedBytes;
      usedCpuPct = Math.round(clusterUtil.cpuPercent);
      usedMemPct = Math.round(clusterUtil.memoryPercent);
      hasMetrics = true;
    } else if (overviewUtil) {
      usedCpuPct = overviewUtil.cpu_percent ?? 0;
      usedMemPct = overviewUtil.memory_percent ?? 0;
      usedCpuMillis = Math.round(tCpu * usedCpuPct / 100);
      usedMemBytes = Math.round(tMem * usedMemPct / 100);
      hasMetrics = true;
    } else {
      usedCpuMillis = 0; usedMemBytes = 0; usedCpuPct = 0; usedMemPct = 0;
      hasMetrics = false;
    }

    return {
      nodeCount: nodes.length,
      usedPods: aPods, totalPods: tPods, podPct: pct(aPods, tPods),
      totalCpu: tCpu, reservedCpu: rCpu, usedCpu: usedCpuMillis,
      reservedCpuPct: pct(rCpu, tCpu), usedCpuPct,
      totalMem: tMem, reservedMem: rMem, usedMem: usedMemBytes,
      reservedMemPct: pct(rMem, tMem), usedMemPct,
      hasMetrics,
    };
  }, [nodesData, podsData, overview.data?.utilization, clusterUtil]);

  const hasData = cap.nodeCount > 0;

  /* ── Derived display values ── */
  const cpuPct = cap.hasMetrics ? cap.usedCpuPct : cap.reservedCpuPct;
  const memPct = cap.hasMetrics ? cap.usedMemPct : cap.reservedMemPct;
  const cpuLabel = cap.hasMetrics ? "used" : "reserved";
  const memLabel = cap.hasMetrics ? "used" : "reserved";

  return (
    <Card className="h-full min-h-[28rem] border-none soft-shadow glass-panel relative overflow-hidden group flex flex-col">
      {/* Top accent — matches ClusterHealthWidget */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500" />
      <div className="absolute top-0 right-0 w-48 h-48 bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <CardHeader className="pb-2 pt-5 px-6 relative z-10 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">
            Cluster Capacity
          </h2>
          <div className="flex items-center gap-2">
            {cap.hasMetrics && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur-sm bg-success/10 border-success/20 text-success">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                Live
              </div>
            )}
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors shrink-0" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs leading-relaxed p-3">
                <p className="font-semibold mb-1">Understanding Capacity</p>
                <p><strong>Reserved</strong> — guaranteed to pods via resource requests.</p>
                <p><strong>Used</strong> — real-time consumption (requires metrics-server).</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {cap.nodeCount} node{cap.nodeCount !== 1 ? "s" : ""} · {cap.usedPods} active pod{cap.usedPods !== 1 ? "s" : ""}
        </p>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col pt-2 pb-6 px-6 relative z-10">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/40" />
          </div>
        ) : !hasData ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Server className="h-9 w-9 text-muted-foreground/25" />
            <p className="text-sm text-muted-foreground">No node data available</p>
          </div>
        ) : (
          <>
            {/* ═══ Three Donut Gauges ═══ */}
            <div className="grid grid-cols-3 gap-2 shrink-0">
              <CapacityDonut
                id="pods"
                percent={cap.podPct}
                label="Pods"
                centerLine1={`${cap.usedPods} / ${cap.totalPods}`}
                centerLine2={`${cap.totalPods - cap.usedPods} free`}
                gradientFrom="hsl(var(--primary))"
                gradientTo="#00E5FF"
                icon={Hexagon}
                tooltipText={
                  <div className="space-y-1">
                    <p className="font-semibold">Pod Capacity</p>
                    <p><strong>{cap.usedPods}</strong> active of <strong>{cap.totalPods}</strong> slots across {cap.nodeCount} node{cap.nodeCount !== 1 ? "s" : ""}.</p>
                    <p className="text-muted-foreground">~110 slots per node. System pods included.</p>
                  </div>
                }
              />
              <CapacityDonut
                id="cpu"
                percent={cpuPct}
                label="CPU"
                centerLine1={formatCpu(cap.totalCpu)}
                centerLine2={cpuLabel}
                gradientFrom="#10b981"
                gradientTo="#22d3ee"
                icon={Cpu}
                tooltipText={
                  <div className="space-y-1">
                    <p className="font-semibold">CPU Capacity</p>
                    <p><strong>Total:</strong> {formatCpu(cap.totalCpu)}</p>
                    <p><strong>Reserved:</strong> {formatCpu(cap.reservedCpu)} ({cap.reservedCpuPct}%)</p>
                    {cap.hasMetrics
                      ? <p><strong>Used:</strong> {formatCpu(cap.usedCpu)} ({cap.usedCpuPct}%)</p>
                      : <p className="text-muted-foreground italic">Install <Link to={METRICS_SERVER_ADDON_URL} className="underline text-primary hover:text-primary/80">metrics-server</Link> for real-time usage</p>
                    }
                  </div>
                }
              />
              <CapacityDonut
                id="memory"
                percent={memPct}
                label="Memory"
                centerLine1={formatMemory(cap.totalMem)}
                centerLine2={memLabel}
                gradientFrom="#a855f7"
                gradientTo="#ec4899"
                icon={MemoryStick}
                tooltipText={
                  <div className="space-y-1">
                    <p className="font-semibold">Memory Capacity</p>
                    <p><strong>Total:</strong> {formatMemory(cap.totalMem)}</p>
                    <p><strong>Reserved:</strong> {formatMemory(cap.reservedMem)} ({cap.reservedMemPct}%)</p>
                    {cap.hasMetrics
                      ? <p><strong>Used:</strong> {formatMemory(cap.usedMem)} ({cap.usedMemPct}%)</p>
                      : <p className="text-muted-foreground italic">Install <Link to={METRICS_SERVER_ADDON_URL} className="underline text-primary hover:text-primary/80">metrics-server</Link> for real-time usage</p>
                    }
                  </div>
                }
              />
            </div>

            {/* ═══ Capacity Breakdown Bars — aligned with health factors ═══ */}
            <div className="space-y-2 pt-3 mt-auto border-t border-border/50">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Resource allocation
              </p>

              <div className="space-y-3">
                {/* CPU Reserved */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="w-3 h-3" /> CPU reserved
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCpu(cap.reservedCpu)} / {formatCpu(cap.totalCpu)}
                    </span>
                  </div>
                  <Progress
                    value={cap.reservedCpuPct}
                    className="h-1.5 bg-muted/50"
                    indicatorClassName={cn(
                      cap.reservedCpuPct >= 90 ? "bg-rose-500" : cap.reservedCpuPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{cap.reservedCpuPct}% reserved</span>
                    {cap.hasMetrics && (
                      <span className="font-medium text-foreground/70">{cap.usedCpuPct}% actual usage</span>
                    )}
                  </div>
                </div>

                {/* Memory Reserved */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <MemoryStick className="w-3 h-3" /> Memory reserved
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatMemory(cap.reservedMem)} / {formatMemory(cap.totalMem)}
                    </span>
                  </div>
                  <Progress
                    value={cap.reservedMemPct}
                    className="h-1.5 bg-muted/50"
                    indicatorClassName={cn(
                      cap.reservedMemPct >= 90 ? "bg-rose-500" : cap.reservedMemPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{cap.reservedMemPct}% reserved</span>
                    {cap.hasMetrics && (
                      <span className="font-medium text-foreground/70">{cap.usedMemPct}% actual usage</span>
                    )}
                  </div>
                </div>

                {/* Pods */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Hexagon className="w-3 h-3" /> Pod slots
                    </span>
                    <span className="font-semibold tabular-nums">
                      {cap.usedPods} / {cap.totalPods}
                    </span>
                  </div>
                  <Progress
                    value={cap.podPct}
                    className="h-1.5 bg-muted/50"
                    indicatorClassName={cn(
                      cap.podPct >= 90 ? "bg-rose-500" : cap.podPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{cap.podPct}% occupied</span>
                    <span>{cap.totalPods - cap.usedPods} available</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ Metrics hint ═══ */}
            {!cap.hasMetrics && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Install{" "}
                  <Link
                    to={METRICS_SERVER_ADDON_URL}
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/80 underline underline-offset-2"
                  >
                    <code className="bg-muted/60 px-1.5 py-0.5 rounded text-[10px] font-mono">metrics-server</code>
                  </Link>{" "}
                  for real-time CPU &amp; memory usage.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
