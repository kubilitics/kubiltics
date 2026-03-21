/**
 * Cluster Overview — Apple-level design polish.
 *
 * Sections:
 *   1. Header with sync + live badge
 *   2. Hero: Health Donut (Recharts) + Node Grid + Utilization
 *   3. Resources table with dark-mode support
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Label,
} from "recharts";
import {
  Server,
  Search,
  ArrowUpRight,
  Layers,
  Monitor,
  Box,
  Cpu,
  MemoryStick,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  Gauge,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClusterOverviewData } from "@/hooks/useClusterOverviewData";
import { useClusterUtilization } from "@/hooks/useClusterUtilization";
import { useBackendConfigStore } from "@/stores/backendConfigStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { SectionOverviewHeader } from "@/components/layout/SectionOverviewHeader";
import { ListPagination } from "@/components/list/ListPagination";
import { ConnectionRequiredBanner } from "@/components/layout/ConnectionRequiredBanner";
import { PageLoadingState } from "@/components/PageLoadingState";

/* ─── Constants ────────────────────────────────────────────────────────────── */

const KIND_ICONS: Record<string, typeof Server> = {
  Node: Monitor,
  Namespace: Layers,
};

const STATUS_BADGE: Record<string, string> = {
  Ready:
    "text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10",
  Active:
    "text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10",
  NotReady:
    "text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10",
  Terminating:
    "text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10",
};

type ClusterResource = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  version?: string;
};

function getResourceKey(r: ClusterResource): string {
  return `${r.kind}/${r.name}`;
}

/* ─── Stat Row ─────────────────────────────────────────────────────────────── */

function StatRow({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-muted/40 border border-border/50">
      <div className="flex items-center gap-2.5">
        <div className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
        <span className="text-[13px] font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="text-[13px] font-bold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

/* ─── Node Card ────────────────────────────────────────────────────────────── */

function NodeCard({
  node,
  index,
}: {
  node: { name: string; status: string };
  index: number;
}) {
  const navigate = useNavigate();
  const isReady = node.status === "Ready";
  const shortName = node.name.length > 20
    ? node.name.slice(0, 8) + "…" + node.name.slice(-8)
    : node.name;

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 260, damping: 20 }}
      onClick={() => navigate(`/nodes/${node.name}`)}
      className={cn(
        "group relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border-2 transition-all duration-300 cursor-pointer",
        "bg-card hover:shadow-lg hover:-translate-y-1",
        isReady
          ? "border-border/60 hover:border-primary/50 hover:shadow-primary/10"
          : "border-amber-300/60 dark:border-amber-500/30 hover:border-amber-400"
      )}
    >
      {/* Status indicator */}
      <div
        className={cn(
          "absolute top-2.5 right-2.5 h-2 w-2 rounded-full",
          isReady
            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
            : "bg-amber-500 animate-pulse"
        )}
      />

      {/* Icon */}
      <div
        className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center transition-colors duration-300",
          isReady
            ? "bg-primary/10 text-primary group-hover:bg-primary/20"
            : "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
        )}
      >
        <Server className="h-5 w-5" />
      </div>

      {/* Name */}
      <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-full tracking-tight">
        {shortName}
      </span>
    </motion.button>
  );
}

/* ─── Utilization Meter ────────────────────────────────────────────────────── */

function UtilizationMeter({
  label,
  icon: Icon,
  percent,
  used,
  total,
  unit,
}: {
  label: string;
  icon: typeof Cpu;
  percent: number;
  used: string;
  total: string;
  unit: string;
}) {
  const color =
    percent >= 80
      ? "bg-rose-500"
      : percent >= 60
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span className="text-sm font-bold tabular-nums text-foreground">
          {percent.toFixed(1)}%
        </span>
      </div>
      <Progress
        value={percent}
        className="h-2 bg-muted/50"
        indicatorClassName={color}
      />
      <p className="text-[10px] text-muted-foreground tabular-nums">
        {used} / {total} {unit}
      </p>
    </div>
  );
}

/* ─── Format helpers ───────────────────────────────────────────────────────── */

function formatCpu(millicores: number): string {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)} cores`;
  return `${Math.round(millicores)}m`;
}

function formatMemory(bytes: number): string {
  const gi = bytes / (1024 ** 3);
  if (gi >= 1) return `${gi.toFixed(1)} Gi`;
  const mi = bytes / (1024 ** 2);
  return `${mi.toFixed(0)} Mi`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ClusterOverview() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? undefined;

  const { data, isLoading } = useClusterOverviewData();
  const { utilization } = useClusterUtilization(clusterId);

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ["k8s"] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

  const resources: ClusterResource[] = data?.resources ?? [];

  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    const q = searchQuery.toLowerCase();
    return resources.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [resources, searchQuery]);

  const totalFiltered = filteredResources.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredResources.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery]);

  const toggleSelection = (r: ClusterResource) => {
    const key = getResourceKey(r);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map(getResourceKey)));
  };

  const isAllSelected =
    itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;

  if (isLoading) {
    return <PageLoadingState message="Loading cluster data..." />;
  }

  /* ─── Derived data ─── */
  const nodes = resources.filter((r) => r.kind === "Node");
  const namespaces = resources.filter((r) => r.kind === "Namespace");
  const readyNodes = nodes.filter((n) => n.status === "Ready").length;
  const activeNamespaces = namespaces.filter(
    (n) => n.status === "Active"
  ).length;
  const healthPercent = data?.pulse.optimal_percent ?? 0;

  /* Donut data */
  const donutData = [
    { name: "Healthy", value: healthPercent, color: "url(#overviewGradient)" },
    {
      name: "Issues",
      value: 100 - healthPercent,
      color: "hsl(var(--muted))",
    },
  ];

  const healthLabel =
    healthPercent >= 90
      ? "Excellent"
      : healthPercent >= 70
      ? "Good"
      : healthPercent >= 50
      ? "Fair"
      : "Critical";

  const healthBadge =
    healthPercent >= 70
      ? "bg-emerald-100 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
      : healthPercent >= 50
      ? "bg-amber-100 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400"
      : "bg-rose-100 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400";

  const HealthIcon =
    healthPercent >= 70
      ? CheckCircle2
      : healthPercent >= 50
      ? AlertTriangle
      : AlertCircle;

  return (
    <div className="page-container" role="main" aria-label="Cluster Overview">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <ConnectionRequiredBanner />

        {/* ── Header ── */}
        <SectionOverviewHeader
          title="Cluster Overview"
          description="Nodes, namespaces, and overall cluster health at a glance."
          icon={Server}
          onSync={handleSync}
          isSyncing={isSyncing}
          showAiButton={false}
        />

        {/* ── Hero Band ── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Health Donut Card */}
          <Card className="lg:col-span-4 border-none soft-shadow glass-panel relative overflow-hidden flex flex-col min-h-[26rem]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-blue-500 to-cyan-500" />
            <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

            <div className="p-6 pb-2 shrink-0 relative z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">
                  Cluster Health
                </h2>
                <div
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur-sm",
                    healthBadge
                  )}
                >
                  <HealthIcon className="w-3 h-3" />
                  <span>{healthLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col px-6 pb-6 relative z-10">
              {/* Recharts donut */}
              <div
                className="flex items-center justify-center shrink-0"
                style={{ height: "160px" }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart aria-label="Cluster health score">
                    <defs>
                      <linearGradient
                        id="overviewGradient"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="hsl(var(--primary))"
                        />
                        <stop offset="100%" stopColor="#00E5FF" />
                      </linearGradient>
                    </defs>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={64}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      stroke="none"
                      cornerRadius={10}
                      paddingAngle={4}
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                      <Label
                        content={({ viewBox }) => {
                          if (
                            viewBox &&
                            "cx" in viewBox &&
                            "cy" in viewBox
                          ) {
                            return (
                              <text
                                x={viewBox.cx}
                                y={viewBox.cy}
                                textAnchor="middle"
                                dominantBaseline="middle"
                              >
                                <tspan
                                  x={viewBox.cx}
                                  y={(viewBox.cy || 0) - 4}
                                  className="fill-foreground text-3xl font-black tracking-tighter"
                                >
                                  {Math.round(healthPercent)}
                                </tspan>
                                <tspan
                                  x={viewBox.cx}
                                  y={(viewBox.cy || 0) + 14}
                                  className="fill-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em]"
                                >
                                  Score
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

              {/* Quick stats */}
              <div className="space-y-2.5 mt-auto pt-4 border-t border-border/50">
                <StatRow
                  dot="bg-emerald-500"
                  label="Healthy"
                  value={data?.pulse.healthy ?? 0}
                />
                <StatRow
                  dot="bg-amber-500"
                  label="Warning"
                  value={data?.pulse.warning ?? 0}
                />
                <StatRow
                  dot="bg-rose-500"
                  label="Critical"
                  value={data?.pulse.critical ?? 0}
                />
              </div>
            </div>
          </Card>

          {/* Node Grid + Utilization Card */}
          <Card className="lg:col-span-8 border-none soft-shadow glass-panel relative overflow-hidden flex flex-col min-h-[26rem]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-primary" />

            <div className="p-6 pb-3 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    Infrastructure
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Compute nodes and cluster utilization
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[11px] font-semibold border-border text-muted-foreground"
                >
                  {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
                </Badge>
              </div>
            </div>

            <div className="flex-1 flex flex-col px-6 pb-6">
              {/* Node grid */}
              <div className="flex-1 min-h-0">
                {nodes.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    <AnimatePresence>
                      {nodes.map((node, i) => (
                        <NodeCard
                          key={node.name}
                          node={node}
                          index={i}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 rounded-2xl border-2 border-dashed border-border/50">
                    <p className="text-sm text-muted-foreground">
                      No nodes discovered yet
                    </p>
                  </div>
                )}
              </div>

              {/* Bottom stats + utilization */}
              <div className="mt-auto pt-4 border-t border-border/50">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {/* Quick counts */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Ready Nodes
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold tabular-nums text-foreground">
                        {readyNodes}
                        <span className="text-sm text-muted-foreground font-normal">
                          /{nodes.length}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Namespaces
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold tabular-nums text-foreground">
                        {activeNamespaces}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        active
                      </span>
                    </div>
                  </div>

                  {/* CPU utilization */}
                  {utilization.metricsAvailable ? (
                    <>
                      <UtilizationMeter
                        label="CPU"
                        icon={Cpu}
                        percent={utilization.cpuPercent}
                        used={formatCpu(utilization.cpuUsedMillicores)}
                        total={formatCpu(utilization.cpuTotalMillicores)}
                        unit=""
                      />
                      <UtilizationMeter
                        label="Memory"
                        icon={MemoryStick}
                        percent={utilization.memoryPercent}
                        used={formatMemory(utilization.memoryUsedBytes)}
                        total={formatMemory(utilization.memoryTotalBytes)}
                        unit=""
                      />
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Total Resources
                        </span>
                        <span className="text-2xl font-bold tabular-nums text-foreground block">
                          {resources.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                          <Gauge className="w-3 h-3" /> Metrics
                        </span>
                        <Link
                          to={`/addons/${encodeURIComponent('kubilitics/metrics-server')}`}
                          className="text-xs text-primary hover:text-primary/80 underline underline-offset-2"
                        >
                          Install metrics-server for live utilization
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* ── Resources Table ── */}
        <section>
          <Card className="border-none soft-shadow glass-panel overflow-hidden">
            {/* Table header */}
            <div className="p-6 border-b border-border/50">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Cluster Resources
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Nodes and namespaces in your cluster
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative min-w-[280px]">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      placeholder="Search resources..."
                      className="pl-10 bg-muted/30 border-border rounded-xl focus:bg-card focus:ring-2 focus:ring-primary/10 focus:border-primary/40 h-10 text-sm"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search cluster resources"
                    />
                  </div>
                  {selectedItems.size > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-primary/10 text-primary border-primary/20"
                    >
                      {selectedItems.size} selected
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-6 py-3.5 border-b border-border/50 w-10">
                      <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Kind
                    </th>
                    <th className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Version
                    </th>
                    <th className="px-6 py-3.5 border-b border-border/50" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {itemsOnPage.map((resource, idx) => {
                    const Icon = KIND_ICONS[resource.kind] ?? Box;
                    const isSelected = selectedItems.has(
                      getResourceKey(resource)
                    );
                    const statusColor =
                      STATUS_BADGE[resource.status] ??
                      "text-muted-foreground border-border bg-muted/30";
                    const kindPath =
                      resource.kind.toLowerCase() === "node"
                        ? "nodes"
                        : "namespaces";
                    const detailPath = `/${kindPath}/${resource.name}`;

                    return (
                      <motion.tr
                        key={getResourceKey(resource)}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        className={cn(
                          "group hover:bg-muted/30 transition-colors",
                          isSelected && "bg-primary/5"
                        )}
                      >
                        <td className="px-6 py-3.5">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              toggleSelection(resource)
                            }
                          />
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                              <Icon className="h-4 w-4" />
                            </div>
                            <Link
                              to={detailPath}
                              className="font-semibold text-foreground group-hover:text-primary transition-colors leading-tight"
                            >
                              {resource.name}
                            </Link>
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider font-semibold border-border text-muted-foreground"
                          >
                            {resource.kind}
                          </Badge>
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] uppercase tracking-wider font-semibold",
                              statusColor
                            )}
                          >
                            {resource.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-3.5">
                          {resource.version ? (
                            <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-md">
                              {resource.version}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-muted hover:text-primary rounded-lg transition-all border border-transparent hover:border-border"
                            onClick={() => navigate(detailPath)}
                          >
                            <ArrowUpRight
                              className="h-4 w-4"
                              aria-hidden
                            />
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })}
                  {itemsOnPage.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-12 text-center text-sm text-muted-foreground"
                      >
                        {searchQuery
                          ? "No resources match your search."
                          : "No cluster resources found."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalFiltered > 0 && (
              <div className="p-4 border-t border-border/50 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                <ListPagination
                  rangeLabel={`${totalFiltered} ${
                    totalFiltered === 1 ? "resource" : "resources"
                  }`}
                  hasPrev={safePageIndex > 0}
                  hasNext={start + pageSize < totalFiltered}
                  onPrev={() =>
                    setPageIndex((i) => Math.max(0, i - 1))
                  }
                  onNext={() =>
                    setPageIndex((i) =>
                      Math.min(totalPages - 1, i + 1)
                    )
                  }
                  currentPage={safePageIndex + 1}
                  totalPages={totalPages}
                  onPageChange={(p) => setPageIndex(p - 1)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-9 px-4 font-medium border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl transition-all"
                  >
                    <Link to="/nodes">
                      All Nodes
                      <ChevronRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-9 px-4 font-medium border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl transition-all"
                  >
                    <Link to="/namespaces">
                      All Namespaces
                      <ChevronRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
