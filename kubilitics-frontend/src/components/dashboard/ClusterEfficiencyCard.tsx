/**
 * ClusterResourceIntelligence — World-class resource efficiency dashboard card.
 *
 * Shows:
 * 1. Animated SVG radial gauge for efficiency score
 * 2. Actual Usage vs Requested dual-layer progress bars (via metrics-server)
 * 3. Top Namespace Consumers with proportional bar charts
 * 4. Smart algorithmic recommendations
 *
 * Gracefully degrades when metrics-server is unavailable (shows requested only).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Zap,
  Cpu,
  HardDrive,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Info,
  Download,
  ArrowRight,
} from "lucide-react";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { useClusterUtilization } from "@/hooks/useClusterUtilization";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { parseCpu, parseMemory, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getEfficiencyLabel,
  getGaugeColor,
  calculateOverprovisioningRatio,
  generateRecommendations,
  type Recommendation,
} from "@/lib/resourceIntelligence";

// ─── Recommendation icon map ─────────────────────────────────────────────────

const RECOMMENDATION_ICONS = {
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  ShieldAlert: AlertTriangle,
} as const;

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700" },
  warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  info: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700" },
};

// ─── SVG Radial Gauge ────────────────────────────────────────────────────────

const GAUGE_SIZE = 132;
const GAUGE_RADIUS = 52;
const GAUGE_STROKE = 8;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const GAUGE_CENTER = GAUGE_SIZE / 2;

function RadialGauge({ score, color }: { score: number; color: string }) {
  const strokeDash = `${(Math.min(score, 100) / 100) * GAUGE_CIRCUMFERENCE} ${GAUGE_CIRCUMFERENCE}`;

  return (
    <div className="relative flex-shrink-0" style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}>
      <svg
        width={GAUGE_SIZE}
        height={GAUGE_SIZE}
        className="-rotate-90"
        role="img"
        aria-label={`Efficiency score: ${score}%`}
      >
        <defs>
          <linearGradient id="efficiency-gauge-grad" gradientTransform="rotate(90)">
            <stop offset="0%" stopColor={color} stopOpacity={0.85} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        {/* Track ring */}
        <circle
          cx={GAUGE_CENTER}
          cy={GAUGE_CENTER}
          r={GAUGE_RADIUS}
          fill="none"
          strokeWidth={GAUGE_STROKE}
          className="stroke-muted/30"
        />
        {/* Score ring */}
        <motion.circle
          cx={GAUGE_CENTER}
          cy={GAUGE_CENTER}
          r={GAUGE_RADIUS}
          fill="none"
          strokeWidth={GAUGE_STROKE}
          stroke="url(#efficiency-gauge-grad)"
          strokeLinecap="round"
          strokeDasharray={strokeDash}
          initial={{ strokeDasharray: `0 ${GAUGE_CIRCUMFERENCE}` }}
          animate={{ strokeDasharray: strokeDash }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-3xl font-bold tracking-tight text-foreground tabular-nums"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          {score}
          <span className="text-lg text-muted-foreground font-medium">%</span>
        </motion.span>
        <span className="text-[10px] text-muted-foreground font-medium mt-0.5">Allocation</span>
      </div>
    </div>
  );
}

// ─── Dual-Layer Progress Bar ─────────────────────────────────────────────────

function DualLayerBar({
  requestedPercent,
  actualPercent,
  metricsAvailable,
  accentColor,
  label,
  icon: Icon,
  requestedLabel,
  actualLabel,
  capacityLabel,
}: {
  requestedPercent: number;
  actualPercent: number;
  metricsAvailable: boolean;
  accentColor: string;
  label: string;
  icon: typeof Cpu;
  requestedLabel: string;
  actualLabel: string;
  capacityLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center gap-2 text-muted-foreground font-medium">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          {metricsAvailable && (
            <span className="text-foreground font-bold">
              {Math.round(actualPercent)}%
              <span className="text-muted-foreground font-normal ml-0.5">actual</span>
            </span>
          )}
          <span className={cn("font-bold", metricsAvailable ? "text-muted-foreground" : "text-foreground")}>
            {Math.round(requestedPercent)}%
            <span className="text-muted-foreground font-normal ml-0.5">req</span>
          </span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-2.5 rounded-full bg-muted/25 overflow-hidden">
        {/* Requested layer — translucent */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: `${accentColor}30` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(requestedPercent, 100)}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* Actual layer — solid (only when metrics available) */}
        {metricsAvailable && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ backgroundColor: accentColor }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(actualPercent, 100)}%` }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          />
        )}
        {/* If no metrics, show solid requested bar */}
        {!metricsAvailable && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ backgroundColor: accentColor }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(requestedPercent, 100)}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </div>

      {/* Caption */}
      <div className="flex justify-between text-[11px] text-muted-foreground font-medium">
        <span>{metricsAvailable ? actualLabel : requestedLabel}</span>
        <span>{capacityLabel}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ClusterResourceIntelligence() {
  const navigate = useNavigate();
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);

  // ── Data sources ──
  const nodesList = useK8sResourceList("nodes", undefined, {
    enabled: !!activeCluster,
    limit: 1000,
    refetchInterval: 60000,
  });

  const podsList = useK8sResourceList("pods", undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 30000,
  });

  // Actual usage from metrics-server
  const { utilization } = useClusterUtilization(currentClusterId ?? undefined);
  const metricsAvailable = utilization.metricsAvailable;

  // ── Compute requested resources + namespace breakdown ──
  const { cpu, memory, topNamespaces } = useMemo(() => {
    let totalCpuCapacity = 0;
    let totalMemCapacity = 0;
    let totalCpuRequests = 0;
    let totalMemRequests = 0;
    const nsUsage: Record<string, { cpu: number; mem: number }> = {};

    const nodes = nodesList.data?.items ?? [];
    for (const node of nodes) {
      const allocatable = (node as any)?.status?.allocatable ?? {};
      totalCpuCapacity += parseCpu(allocatable.cpu || "0");
      totalMemCapacity += parseMemory(allocatable.memory || "0");
    }

    const pods = podsList.data?.items ?? [];
    for (const pod of pods) {
      const phase = (pod as any)?.status?.phase;
      if (phase === "Succeeded" || phase === "Failed") continue;

      const containers = (pod as any)?.spec?.containers ?? [];
      let podCpu = 0;
      let podMem = 0;
      for (const c of containers) {
        const requests = c.resources?.requests ?? {};
        podCpu += parseCpu(requests.cpu || "0");
        podMem += parseMemory(requests.memory || "0");
      }
      totalCpuRequests += podCpu;
      totalMemRequests += podMem;

      const ns = (pod as any)?.metadata?.namespace ?? "default";
      if (!nsUsage[ns]) nsUsage[ns] = { cpu: 0, mem: 0 };
      nsUsage[ns].cpu += podCpu;
      nsUsage[ns].mem += podMem;
    }

    const sortedNs = Object.entries(nsUsage)
      .map(([name, usage]) => ({ name, ...usage }))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 4);

    return {
      cpu: {
        capacity: totalCpuCapacity,
        requests: totalCpuRequests,
        percent: totalCpuCapacity > 0 ? (totalCpuRequests / totalCpuCapacity) * 100 : 0,
      },
      memory: {
        capacity: totalMemCapacity,
        requests: totalMemRequests,
        percent: totalMemCapacity > 0 ? (totalMemRequests / totalMemCapacity) * 100 : 0,
      },
      topNamespaces: sortedNs,
    };
  }, [nodesList.data, podsList.data]);

  // ── Efficiency score ──
  const efficiencyScore = useMemo(
    () => Math.round((cpu.percent + memory.percent) / 2),
    [cpu.percent, memory.percent]
  );

  const status = getEfficiencyLabel(efficiencyScore);
  const gaugeColor = getGaugeColor(efficiencyScore);

  // ── Actual usage percentages ──
  const cpuActualPercent = metricsAvailable && utilization.cpuTotalMillicores > 0
    ? (utilization.cpuUsedMillicores / utilization.cpuTotalMillicores) * 100
    : 0;
  const memActualPercent = metricsAvailable && utilization.memoryTotalBytes > 0
    ? (utilization.memoryUsedBytes / utilization.memoryTotalBytes) * 100
    : 0;

  // ── Overprovisioning ──
  const cpuOverprov = metricsAvailable
    ? calculateOverprovisioningRatio(cpu.percent, cpuActualPercent)
    : 0;
  const memOverprov = metricsAvailable
    ? calculateOverprovisioningRatio(memory.percent, memActualPercent)
    : 0;
  const avgOverprov = metricsAvailable ? Math.round((cpuOverprov + memOverprov) / 2) : 0;

  // ── Recommendations ──
  const recommendations = useMemo<Recommendation[]>(
    () =>
      generateRecommendations({
        cpuActualPercent,
        cpuRequestedPercent: cpu.percent,
        memActualPercent,
        memRequestedPercent: memory.percent,
        metricsAvailable,
      }),
    [cpuActualPercent, cpu.percent, memActualPercent, memory.percent, metricsAvailable]
  );

  // Max namespace CPU for proportional bar widths
  const maxNsCpu = topNamespaces.length > 0 ? topNamespaces[0].cpu : 1;

  return (
    <Card
      className={cn(
        "h-full min-h-[28rem] border-none relative overflow-hidden flex flex-col group",
        "bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all duration-300"
      )}
    >
      {/* Gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500" />

      {/* Header */}
      <CardHeader className="pb-1 pt-5 px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5 text-base font-semibold text-foreground">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 text-violet-600">
              <Zap className="h-4.5 w-4.5" />
            </div>
            <span>Resource Intelligence</span>
          </CardTitle>
          <div
            className={cn(
              "text-[11px] font-semibold px-2.5 py-1 rounded-full border",
              status.bgColor,
              status.color,
              status.borderColor
            )}
          >
            {status.label}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 px-6 pb-5 pt-3 flex flex-col gap-5">
        {/* ── Gauge + Overprovisioning ── */}
        <div className="flex items-center gap-5">
          <RadialGauge score={efficiencyScore} color={gaugeColor} />

          <div className="flex-1 min-w-0 space-y-2.5">
            <p className="text-xs text-muted-foreground font-medium">
              Resource Allocation Score
            </p>

            {metricsAvailable && avgOverprov > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 cursor-help">
                    <TrendingDown className="h-3 w-3 text-amber-600" />
                    <span className="text-[11px] font-semibold text-amber-700 tabular-nums">
                      {avgOverprov}% overprovisioned
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">
                    CPU: {cpuOverprov}% gap between requested and actual.{" "}
                    Memory: {memOverprov}% gap.
                  </p>
                </TooltipContent>
              </Tooltip>
            )}

            {!metricsAvailable && (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/15 transition-colors group"
                onClick={() => navigate('/addons?search=metrics-server')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate('/addons?search=metrics-server')}
              >
                <Download className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" strokeWidth={2} />
                <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  Install <span className="font-semibold">metrics-server</span> for actual usage
                </span>
                <ArrowRight className="h-3 w-3 text-amber-500/60 dark:text-amber-400/60 shrink-0 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
              </div>
            )}
          </div>
        </div>

        {/* ── CPU & Memory Bars ── */}
        <div className="space-y-4">
          <DualLayerBar
            label="CPU"
            icon={Cpu}
            requestedPercent={cpu.percent}
            actualPercent={cpuActualPercent}
            metricsAvailable={metricsAvailable}
            accentColor="#8B5CF6"
            requestedLabel={`${(cpu.requests / 1000).toFixed(1)} Cores requested`}
            actualLabel={`${(utilization.cpuUsedMillicores / 1000).toFixed(1)} / ${(cpu.capacity / 1000).toFixed(0)} Cores`}
            capacityLabel={`of ${(cpu.capacity / 1000).toFixed(0)} Cores`}
          />

          <DualLayerBar
            label="Memory"
            icon={HardDrive}
            requestedPercent={memory.percent}
            actualPercent={memActualPercent}
            metricsAvailable={metricsAvailable}
            accentColor="#D946EF"
            requestedLabel={`${(memory.requests / (1024 ** 3)).toFixed(1)} GiB requested`}
            actualLabel={`${(utilization.memoryUsedBytes / (1024 ** 3)).toFixed(1)} / ${(memory.capacity / (1024 ** 3)).toFixed(1)} GiB`}
            capacityLabel={`of ${(memory.capacity / (1024 ** 3)).toFixed(1)} GiB`}
          />
        </div>

        {/* ── Top Namespace Consumers ── */}
        <div className="pt-3 border-t border-border/30">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
            Top Namespace Consumers
          </p>
          <div className="space-y-2.5">
            {topNamespaces.map((ns, i) => {
              const barWidth = maxNsCpu > 0 ? (ns.cpu / maxNsCpu) * 100 : 0;
              return (
                <div key={ns.name} className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-gradient-to-br from-violet-400 to-fuchsia-400" />
                  <span className="text-xs font-medium text-foreground w-28 truncate">{ns.name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted/25 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500/70 to-fuchsia-500/70"
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidth}%` }}
                      transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground font-medium w-[5.5rem] text-right">
                    {(ns.cpu / 1000).toFixed(1)}m / {(ns.mem / (1024 * 1024)).toFixed(0)}Mi
                  </span>
                </div>
              );
            })}
            {topNamespaces.length === 0 && (
              <div className="text-xs text-muted-foreground italic">No active workloads</div>
            )}
          </div>
        </div>

        {/* ── Smart Recommendations ── */}
        {recommendations.length > 0 && (
          <div className="pt-3 border-t border-border/30 space-y-2">
            {recommendations.map((rec, i) => {
              const IconComp = RECOMMENDATION_ICONS[rec.icon] ?? Lightbulb;
              const style = SEVERITY_STYLES[rec.severity] ?? SEVERITY_STYLES.info;
              return (
                <motion.div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 px-2.5 py-2 rounded-lg border text-[11px] leading-relaxed",
                    style.bg,
                    style.border,
                    style.text
                  )}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <IconComp className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{rec.message}</span>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Backward-compatible alias */
export { ClusterResourceIntelligence as ClusterEfficiencyCard };
