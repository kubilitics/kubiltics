import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Cpu, Database, Zap } from 'lucide-react';
import { useK8sResourceList } from '@/hooks/useKubernetes';
import { useClusterStore } from '@/stores/clusterStore';
import { parseCpu, parseMemory, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export function ClusterEfficiencyCard() {
    const { activeCluster } = useClusterStore();

    const nodesList = useK8sResourceList('nodes', undefined, {
        enabled: !!activeCluster,
        limit: 1000,
        refetchInterval: 60000,
    });

    const podsList = useK8sResourceList('pods', undefined, {
        enabled: !!activeCluster,
        limit: 5000, // Fetch all pods to sum up requests
        refetchInterval: 30000,
    });

    const { cpu, memory, topNamespaces } = useMemo(() => {
        let totalCpuCapacity = 0;
        let totalMemCapacity = 0;
        let totalCpuRequests = 0;
        let totalMemRequests = 0;
        const nsUsage: Record<string, { cpu: number; mem: number }> = {};

        // 1. Calculate Capacity from Nodes
        const nodes = nodesList.data?.items ?? [];
        for (const node of nodes) {
            const allocatable = (node as any)?.status?.allocatable ?? {};
            totalCpuCapacity += parseCpu(allocatable.cpu || '0');
            totalMemCapacity += parseMemory(allocatable.memory || '0');
        }

        // 2. Calculate Requests from Pods (Running only ideally, but requests are reserved anyway)
        const pods = podsList.data?.items ?? [];
        for (const pod of pods) {
            // Only count non-terminal pods ideally, but for capacity planning, even Pending claims resources if scheduled.
            // For simplicity/accuracy of "allocation", we count everything not Succeeded/Failed if we want "current load",
            // but traditionally Requests are sum of all pods.
            const phase = (pod as any)?.status?.phase;
            if (phase === 'Succeeded' || phase === 'Failed') continue;

            const containers = (pod as any)?.spec?.containers ?? [];
            let podCpu = 0;
            let podMem = 0;
            for (const c of containers) {
                const requests = c.resources?.requests ?? {};
                podCpu += parseCpu(requests.cpu || '0');
                podMem += parseMemory(requests.memory || '0');
            }
            totalCpuRequests += podCpu;
            totalMemRequests += podMem;

            const ns = (pod as any)?.metadata?.namespace ?? 'default';
            if (!nsUsage[ns]) nsUsage[ns] = { cpu: 0, mem: 0 };
            nsUsage[ns].cpu += podCpu;
            nsUsage[ns].mem += podMem;
        }

        // Convert to friendly units
        // CPU: millicores
        // Memory: GiB
        const cpuCap = totalCpuCapacity;
        const memCap = totalMemCapacity;

        // Top Consumers (by combined weight or just CPU for now)
        const sortedNs = Object.entries(nsUsage)
            .map(([name, usage]) => ({ name, ...usage }))
            .sort((a, b) => b.cpu - a.cpu)
            .slice(0, 3);

        return {
            cpu: {
                capacity: cpuCap,
                requests: totalCpuRequests,
                percent: cpuCap > 0 ? (totalCpuRequests / cpuCap) * 100 : 0,
            },
            memory: {
                capacity: memCap,
                requests: totalMemRequests,
                percent: memCap > 0 ? (totalMemRequests / memCap) * 100 : 0,
            },
            topNamespaces: sortedNs,
        };
    }, [nodesList.data, podsList.data]);

    const efficiencyScore = useMemo(() => {
        // Simple heuristic: 
        // Too Low (< 10%) = Wasteful (Red/Orange)
        // Low (10-30%) = Poor (Yellow)
        // Good (30-70%) = Efficient (Green)
        // High (70-90%) = Optimized (Blue/Green)
        // Critical (> 90%) = Risk (Red)

        const avgUtil = (cpu.percent + memory.percent) / 2;
        return Math.round(avgUtil);
    }, [cpu.percent, memory.percent]);

    const getEfficiencyLabel = (score: number) => {
        if (score < 10) return { label: 'Idle / Wasteful', color: 'text-amber-500' };
        if (score < 30) return { label: 'Underutilized', color: 'text-yellow-500' };
        if (score < 70) return { label: 'Healthy Balance', color: 'text-emerald-500' };
        if (score < 90) return { label: 'High Load', color: 'text-blue-500' };
        return { label: 'Overcommitted', color: 'text-rose-500' };
    };

    const status = getEfficiencyLabel(efficiencyScore);

    return (
        <Card
            className={cn(
                "h-full min-h-[28rem] border-none glass-panel relative overflow-hidden flex flex-col group",
                "hover:shadow-lg transition-all duration-300"
            )}
        >
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500/80 to-fuchsia-500/80" />

            <CardHeader className="pb-2 pt-5 px-6">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                            <Zap className="h-5 w-5" />
                        </div>
                        <span>Cluster Efficiency</span>
                    </CardTitle>
                    <div className={cn("text-xs font-medium px-3 py-1 rounded-full bg-background/50 border", status.color, "border-current opacity-80")}>
                        {status.label}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 px-6 pb-6 pt-4 space-y-8">
                {/* Main Score Area */}
                <div className="flex items-end justify-between">
                    <div>
                        <div className="text-5xl font-bold tabular-nums tracking-tight">
                            {efficiencyScore}<span className="text-2xl text-muted-foreground font-medium">%</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 font-medium">Resource Allocation Score</p>
                    </div>
                    {/* Mini Sparkline visual */}
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                        <Activity className="h-7 w-7 text-violet-500" />
                    </div>
                </div>

                {/* Resources Bars */}
                <div className="space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm font-medium">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Cpu className="h-4 w-4" /> CPU Requested
                            </span>
                            <span className="tabular-nums font-bold text-foreground">{Math.round(cpu.percent)}%</span>
                        </div>
                        <Progress value={cpu.percent} className="h-2.5" indicatorClassName="bg-violet-500" />
                        <div className="flex justify-between text-xs text-muted-foreground opacity-90 font-medium">
                            <span>{Math.round(cpu.requests / 1000)} Cores</span>
                            <span>of {Math.round(cpu.capacity / 1000)} Cores</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-sm font-medium">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Database className="h-4 w-4" /> Memory Requested
                            </span>
                            <span className="tabular-nums font-bold text-foreground">{Math.round(memory.percent)}%</span>
                        </div>
                        <Progress value={memory.percent} className="h-2.5" indicatorClassName="bg-fuchsia-500" />
                        <div className="flex justify-between text-xs text-muted-foreground opacity-90 font-medium">
                            <span>{(memory.requests / (1024 * 1024 * 1024)).toFixed(1)} GiB</span>
                            <span>of {(memory.capacity / (1024 * 1024 * 1024)).toFixed(1)} GiB</span>
                        </div>
                    </div>
                </div>

                {/* Top Consumers */}
                <div className="pt-4 border-t border-border/40">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">Top Namespace Consumers</p>
                    <div className="space-y-3">
                        {topNamespaces.map(ns => (
                            <div key={ns.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2.5">
                                    <span className="w-2 h-2 rounded-full bg-violet-400/50" />
                                    <span className="font-medium text-foreground">{ns.name}</span>
                                </div>
                                <span className="text-muted-foreground tabular-nums font-medium">
                                    {Math.round(ns.cpu / 1000)}m / {(ns.mem / (1024 * 1024)).toFixed(0)}Mi
                                </span>
                            </div>
                        ))}
                        {topNamespaces.length === 0 && (
                            <div className="text-sm text-muted-foreground italic">No active workloads</div>
                        )}
                    </div>
                </div>

            </CardContent>
        </Card>
    );
}
