import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
    Server,
    Search,
    RefreshCw,
    ArrowUpRight,
    Activity,
    Layers
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useClusterOverviewData } from '@/hooks/useClusterOverviewData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { InfrastructureMap } from '@/components/cluster/InfrastructureMap';
export default function ClusterOverview() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useClusterOverviewData();
    const handleSync = useCallback(() => {
        setIsSyncing(true);
        queryClient.invalidateQueries({ queryKey: ['k8s'] });
        setTimeout(() => setIsSyncing(false), 1500);
    }, [queryClient]);

    const filteredResources = data?.resources.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.kind.toLowerCase().includes(searchQuery.toLowerCase())
    ) ?? [];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <RefreshCw className="h-8 w-8 animate-spin text-[#326CE5]" />
            </div>
        );
    }

    const nodes = data?.resources.filter(r => r.kind === 'Node').map(n => ({
        name: n.name,
        status: n.status as 'Ready' | 'NotReady'
    })) ?? [];

    const namespaceCount = data?.resources.filter(r => r.kind === 'Namespace').length ?? 0;

    return (
        <div className="flex flex-col gap-10 p-8">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Cluster Intelligence"
                description="Harnessing real-time topography and global health metrics to orchestrate your cloud-native infrastructure."
                icon={Server}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Infrastructure Map & Health Pulse */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Node Topography */}
                <div className="lg:col-span-8 glass-card p-8 group relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="apple-title text-2xl mb-1">Compute Topography</h2>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Distributed Node Matrix</p>
                        </div>
                        <div className="px-5 py-2 rounded-full bg-blue-500/10 text-blue-600 text-[11px] font-bold border border-blue-500/10">
                            {nodes.length} Primary Compute Nodes
                        </div>
                    </div>

                    <div className="relative z-10">
                        <InfrastructureMap nodes={nodes} />
                    </div>

                    <div className="grid grid-cols-3 gap-10 mt-12 pt-8 border-t border-white/40">
                        <div className="space-y-1">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">System Load</span>
                            <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold text-slate-900 tracking-tight">Nominal</span>
                                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Control Plane</span>
                            <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold text-slate-900 tracking-tight">v1.28.3</span>
                                <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md">STABLE</span>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Zones</span>
                            <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold text-slate-900 tracking-tight">Multi-AZ</span>
                                <span className="text-xs font-bold text-slate-500">Global</span>
                            </div>
                        </div>
                    </div>

                    {/* Background Shine */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />
                </div>

                {/* Health Metric & Pulse */}
                <div className="lg:col-span-4 glass-card p-10 flex flex-col items-center justify-between text-center relative overflow-hidden group">
                    <div className="relative z-10 w-full">
                        <div className="relative h-48 w-48 mx-auto mb-8 flex items-center justify-center">
                            {/* Outer animated ring */}
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
                                className="absolute inset-0 rounded-full border-[10px] border-slate-100/50 border-t-blue-600 shadow-xl"
                            />
                            {/* Inner ring pulse */}
                            <div className="absolute inset-4 rounded-full border-4 border-emerald-500/20 animate-pulse" />

                            <div className="z-20">
                                <span className="block text-5xl font-extrabold text-slate-900 tracking-tight tabular-nums">{data?.pulse.optimal_percent.toFixed(0)}%</span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em] mt-1 block">Stability index</span>
                            </div>
                        </div>

                        <h4 className="apple-title text-xl mb-3">Global Pulse Health</h4>
                        <p className="apple-description text-sm px-4">99.9% SLO maintained across all compute clusters in the logical scope.</p>
                    </div>

                    <div className="w-full relative z-10 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-5 rounded-2xl bg-white/40 border border-white shadow-sm">
                                <span className="block text-2xl font-extrabold text-slate-900 tabular-nums">{namespaceCount}</span>
                                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mt-1 block">Namespaces</span>
                            </div>
                            <div className="p-5 rounded-2xl bg-white/40 border border-white shadow-sm">
                                <span className="block text-2xl font-extrabold text-slate-900 tabular-nums">{nodes.length}</span>
                                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mt-1 block">Compute Units</span>
                            </div>
                        </div>
                        <Button className="w-full h-14 bg-slate-900 hover:bg-black text-white rounded-2xl font-bold shadow-xl shadow-slate-900/10 transition-all active:scale-[0.98]">
                            View Diagnostics
                        </Button>
                    </div>

                    {/* Gradient Background Wash */}
                    <div className="absolute inset-0 bg-gradient-to-b from-blue-50/20 to-transparent pointer-events-none" />
                </div>
            </div>

            {/* Explorer Table */}
            <div className="glass-card overflow-hidden">
                <div className="p-8 border-b border-white/40 flex flex-col md:flex-row md:items-center gap-6 justify-between bg-white/20">
                    <div>
                        <h2 className="apple-title text-xl mb-1">Infrastructure Explorer</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Global Resource Registry</p>
                    </div>
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                        <Input
                            placeholder="Search nodes, pods, and services..."
                            className="pl-12 h-12 bg-white/50 border-white rounded-[1rem] shadow-sm focus:ring-blue-500/20"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Identity</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Class</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">State</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Telemetry</th>
                                <th className="px-8 py-5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                            {filteredResources.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.03 }}
                                    key={`${resource.kind}-${resource.name}`}
                                    className="group hover:bg-white/80 transition-all duration-500 cursor-pointer"
                                    onClick={() => {
                                        const kindPath = resource.kind.toLowerCase() === 'node' ? 'nodes' :
                                            resource.kind.toLowerCase() === 'namespace' ? 'namespaces' :
                                                `${resource.kind.toLowerCase()}s`;
                                        navigate(`/${kindPath}/${resource.name}`);
                                    }}
                                >
                                    <td className="px-8 py-6">
                                        <div className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors tracking-tight text-base">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <Badge className="font-bold text-[10px] uppercase tracking-widest bg-slate-100 text-slate-500 hover:bg-blue-600 hover:text-white border-transparent transition-all px-3 py-1 rounded-full">
                                            {resource.kind}
                                        </Badge>
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "h-2 w-2 rounded-full",
                                                ['Ready', 'Active', 'Running'].includes(resource.status)
                                                    ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                                    : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                                            )} />
                                            <span className="text-sm font-bold text-slate-700 group-hover:text-slate-900">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <span className="text-sm font-extrabold text-blue-600 tabular-nums bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">
                                            {resource.version || 'v1.0.0'}
                                        </span>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:bg-blue-700 transition-all duration-700 ease-spring">
                                            <ArrowUpRight className="h-5 w-5 text-slate-400 group-hover:text-white" />
                                        </div>
                                    </td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
