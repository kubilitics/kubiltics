import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Gauge,
    Search,
    RefreshCw,
    ArrowUpRight,
    Scale,
    Activity,
    Cpu,
    Zap
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useResourcesOverview } from '@/hooks/useResourcesOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { QuotaPulse } from '@/components/resources/QuotaPulse';

export default function ResourcesOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useResourcesOverview();

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

    const quotaCount = data?.resources.filter(r => r.kind === 'ResourceQuota').length ?? 0;
    const limitCount = data?.resources.filter(r => r.kind === 'LimitRange').length ?? 0;
    const sliceCount = data?.resources.filter(r => r.kind === 'ResourceSlice').length ?? 0;
    const classCount = data?.resources.filter(r => r.kind === 'DeviceClass').length ?? 0;

    return (
        <div className="flex flex-col gap-6 p-6">
            <SectionOverviewHeader
                title="Resources Overview"
                description="Manage cluster-wide resource constraints and Dynamic Resource Allocation (DRA) capabilities."
                icon={Gauge}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Quota Pulse & Control */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Global Constraint Status */}
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
                    <CardHeader className="pb-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-[#326CE5]">Constraint Intelligence</CardTitle>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Global Resource Enforcement</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Activity className="h-4 w-4 text-[#326CE5] animate-pulse" />
                                <span className="text-[10px] font-black text-[#326CE5] uppercase tracking-tighter">Enforced</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4 pb-8">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <QuotaPulse title="CPU Quota" percent={24} color="#326CE5" />
                            <QuotaPulse title="Memory Quota" percent={68} color="#326CE5" />
                            <QuotaPulse title="Storage Quota" percent={42} color="#326CE5" />
                        </div>

                        <div className="mt-8 border-t border-slate-100 pt-6 flex items-center justify-between">
                            <div>
                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Active Constraints</h4>
                                <div className="flex items-center gap-4 mt-1">
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-[#326CE5]/10 text-[#326CE5] border-transparent font-bold text-[10px]">{quotaCount} Quotas</Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-[#326CE5]/10 text-[#326CE5] border-transparent font-bold text-[10px]">{limitCount} Limits</Badge>
                                    </div>
                                </div>
                            </div>
                            <Button variant="outline" className="h-10 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl">
                                System Quota Map
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* DRA Action Card */}
                <Card className="lg:col-span-4 border-amber-200/50 shadow-sm bg-gradient-to-br from-amber-50/30 to-white/50 backdrop-blur-sm flex flex-col p-8 relative overflow-hidden group">
                    <Cpu className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.03] text-amber-600 rotate-12" />

                    <div className="flex-1 space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-5 w-5 text-amber-500 fill-amber-500/20" />
                            <h3 className="text-lg font-black text-slate-900">Dynamic Resource Allocation</h3>
                        </div>
                        <p className="text-xs text-muted-foreground font-medium">
                            DRA (Dynamic Resource Allocation) is a new way to request specialized hardware (GPUs, FPGAs) that goes beyond standard resource limits.
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="py-3 px-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                                <span className="block text-[10px] font-black text-amber-600/60 uppercase tracking-wider">Resource Slices</span>
                                <span className="text-2xl font-black text-amber-600">{sliceCount}</span>
                            </div>
                            <div className="py-3 px-4 rounded-xl bg-slate-50 border border-slate-100">
                                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Device Classes</span>
                                <span className="text-2xl font-black text-slate-400">{classCount}</span>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Button variant="outline" asChild className="w-full h-11 border-amber-200 text-amber-700 font-bold hover:bg-amber-50 rounded-xl">
                                <a href="https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2">
                                    DRA Documentation <ArrowUpRight className="h-4 w-4" />
                                </a>
                            </Button>
                        </div>
                    </div>
                </Card>

            </div>

            {/* Explorer Table */}
            <div className="bg-card border border-primary/5 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-primary/5 flex flex-col md:flex-row md:items-center gap-4 justify-between bg-muted/20">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search resource constraints..."
                            className="pl-10 bg-background/50 border-primary/10 transition-all rounded-xl focus:ring-[#326CE5]/20"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-muted/30">
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Resource Name</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Kind</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Namespace</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Status</th>
                                <th className="px-6 py-4 border-b border-primary/5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-primary/5">
                            {filteredResources.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    key={`${resource.kind}-${resource.name}`}
                                    className="group hover:bg-[#326CE5]/5 transition-colors"
                                >
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-foreground group-hover:text-[#326CE5] transition-colors">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className="font-bold text-[9px] uppercase tracking-wider bg-white border-[#326CE5]/20 text-[#326CE5]">
                                            {resource.kind}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-medium text-muted-foreground">
                                        {resource.namespace}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <span className="text-[12px] font-bold text-slate-700">Enforced</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-[#326CE5] hover:text-white rounded-lg transition-all">
                                            <ArrowUpRight className="h-4 w-4" />
                                        </Button>
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
