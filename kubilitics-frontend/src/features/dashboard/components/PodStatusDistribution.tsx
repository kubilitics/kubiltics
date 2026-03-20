import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Label } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useClusterStore } from "@/stores/clusterStore";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useK8sResourceList } from "@/hooks/useKubernetes";
import { Loader2, TrendingUp, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDER_LABELS: Record<string, string> = {
    eks: "EKS",
    gke: "GKE",
    aks: "AKS",
    minikube: "Minikube",
    kind: "Kind",
    "docker-desktop": "Docker",
    "on-prem": "On-Prem",
};

function formatProvider(p: string): string {
    return PROVIDER_LABELS[p?.toLowerCase()] ?? (p || "Unknown");
}

const STATUS_CONFIG = [
    { key: "running", label: "Running", color: "#00E676", css: "bg-emerald-500" },
    { key: "pending", label: "Pending", color: "#FFD600", css: "bg-amber-500" },
    { key: "failed", label: "Failed", color: "#FF1744", css: "bg-rose-500" },
    { key: "succeeded", label: "Succeeded", color: "#26A69A", css: "bg-teal-500" },
] as const;

export const PodStatusDistribution = () => {
    const { activeCluster } = useClusterStore();
    const { counts, isConnected } = useResourceCounts();
    const { data: podsList, isLoading: podsLoading } = useK8sResourceList(
        "pods",
        undefined,
        { enabled: !!activeCluster, limit: 5000 }
    );

    const { running, pending, failed, succeeded, totalRestarts, topNamespaces, healthScore, insight } = useMemo(() => {
        // useK8sResourceList returns { data: { items: [] }, isLoading, ... }
        const rawItems = podsList?.items ?? [];
        const items = Array.isArray(rawItems) ? rawItems : [];
        const stats = { running: 0, pending: 0, failed: 0, succeeded: 0, totalRestarts: 0 };
        const nsCount: Record<string, number> = {};
        for (const pod of items as {
            status?: { phase?: string; containerStatuses?: Array<{ restartCount?: number }> };
            metadata?: { namespace?: string };
        }[]) {
            const phase = (pod?.status?.phase ?? "Unknown").toLowerCase();
            if (phase === "running") stats.running++;
            else if (phase === "pending") stats.pending++;
            else if (phase === "failed" || phase === "unknown") stats.failed++;
            else if (phase === "succeeded") stats.succeeded++;
            for (const cs of pod?.status?.containerStatuses ?? []) {
                stats.totalRestarts += cs.restartCount ?? 0;
            }
            const ns = pod?.metadata?.namespace ?? "default";
            nsCount[ns] = (nsCount[ns] ?? 0) + 1;
        }
        const total = stats.running + stats.pending + stats.failed + stats.succeeded;
        const healthy = stats.running + stats.succeeded;
        const healthScore = total > 0 ? Math.round((healthy / total) * 100) : 100;
        const topNamespaces = Object.entries(nsCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 4)
            .map(([name, count]) => ({ name, count }));
        let insight = "All pods healthy";
        if (stats.failed > 0) insight = `${stats.failed} pod(s) failed — investigate`;
        else if (stats.pending > 2) insight = `${stats.pending} pods pending — check scheduling`;
        else if (stats.totalRestarts > 10) insight = `${stats.totalRestarts} restarts — check stability`;
        else if (stats.succeeded > 0 && stats.running > 0) insight = "Workloads running normally";
        return { ...stats, totalRestarts: stats.totalRestarts, topNamespaces, healthScore, insight };
    }, [podsList]);

    const pieData = useMemo(
        () =>
            [
                { name: "Running", value: running, color: STATUS_CONFIG[0].color },
                { name: "Pending", value: pending, color: STATUS_CONFIG[1].color },
                { name: "Failed", value: failed, color: STATUS_CONFIG[2].color },
                { name: "Succeeded", value: succeeded, color: STATUS_CONFIG[3].color },
            ].filter((d) => d.value > 0),
        [running, pending, failed, succeeded]
    );

    const hasAnyPods = running + pending + failed + succeeded > 0;

    const version = activeCluster?.version || "—";
    const provider = formatProvider(activeCluster?.provider ?? activeCluster?.name ?? "");
    const namespaces =
        isConnected && counts.namespaces != null
            ? counts.namespaces
            : (activeCluster?.namespaces ?? 0);

    return (
        <Card className="h-full min-h-[28rem] flex flex-col border-none glass-panel relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-blue-500" />
            <CardHeader className="pb-2 pt-5 px-6">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <CardTitle className="text-base font-semibold">Pod Status Distribution</CardTitle>
                        <CardDescription>Health, restarts, and workload by namespace</CardDescription>
                    </div>
                    {hasAnyPods && (
                        <div
                            className={cn(
                                "shrink-0 px-2.5 py-1 rounded-full text-xs font-bold",
                                healthScore >= 95 ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                                healthScore >= 80 ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" :
                                "bg-rose-500/20 text-rose-700 dark:text-rose-400"
                            )}
                        >
                            {healthScore}% healthy
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-5 px-6 pb-6 pt-4">
                {podsLoading ? (
                    <div className="flex-1 flex items-center justify-center min-h-[220px]">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : !hasAnyPods ? (
                    <div className="flex-1 flex items-center justify-center min-h-[220px] text-sm text-muted-foreground">
                        No pod data yet
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {/* Donut chart */}
                            <div className="h-[200px] flex items-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={58}
                                            outerRadius={78}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} stroke="none" />
                                            ))}
                                            <Label
                                                content={({ viewBox }) =>
                                                    viewBox && "cx" in viewBox ? (
                                                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                                            <tspan className="fill-foreground text-3xl font-bold" x={viewBox.cx} y={(viewBox.cy as number) - 6}>
                                                                {running + pending + failed + succeeded}
                                                            </tspan>
                                                            <tspan className="fill-muted-foreground text-xs" x={viewBox.cx} y={(viewBox.cy as number) + 16}>
                                                                pods
                                                            </tspan>
                                                        </text>
                                                    ) : null
                                                }
                                            />
                                        </Pie>
                                        <Tooltip
                                            formatter={(v: number, name: string) => [v, name]}
                                            contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            {/* Status breakdown + insight */}
                            <div className="flex flex-col justify-center gap-3">
                                <div className="flex flex-wrap gap-x-4 gap-y-2">
                                    {STATUS_CONFIG.map(({ key, label, css }, i) => {
                                        const v = key === "running" ? running : key === "pending" ? pending : key === "failed" ? failed : succeeded;
                                        if (v === 0 && (key === "succeeded" || key === "failed")) return null;
                                        return (
                                            <div key={key} className="flex items-center gap-2">
                                                <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", css)} />
                                                <span className="text-sm">
                                                    <span className="font-semibold tabular-nums">{v}</span>
                                                    <span className="text-muted-foreground ml-1">{label}</span>
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                                {totalRestarts > 0 && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <TrendingUp className="w-3.5 h-3.5" />
                                        <span>{totalRestarts} total restarts</span>
                                    </div>
                                )}
                                <div className={cn(
                                    "flex items-start gap-2 p-2 rounded-lg text-xs",
                                    failed > 0 ? "bg-rose-500/10 text-rose-700 dark:text-rose-400" :
                                    pending > 2 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                )}>
                                    {failed > 0 ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                                    <span>{insight}</span>
                                </div>
                            </div>
                        </div>
                        {/* Top namespaces by pod count */}
                        {topNamespaces.length > 0 && (
                            <div className="pt-3 border-t border-border/60">
                                <div className="text-xs font-medium text-muted-foreground mb-2">Top namespaces by pod count</div>
                                <div className="flex flex-wrap gap-2">
                                    {topNamespaces.map(({ name, count }) => (
                                        <Link
                                            key={name}
                                            to={`/pods?namespace=${encodeURIComponent(name)}`}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-sm font-medium transition-colors"
                                        >
                                            <span className="text-foreground">{name}</span>
                                            <span className="text-muted-foreground tabular-nums">{count}</span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* Cluster meta */}
                        <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>v{version}</span>
                                <span>{provider}</span>
                                <span>{namespaces} namespaces</span>
                            </div>
                            <Link to="/pods" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                View all pods
                                <ChevronRight className="w-3 h-3" />
                            </Link>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};
