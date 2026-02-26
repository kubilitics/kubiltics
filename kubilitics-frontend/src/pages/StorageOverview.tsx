import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Database,
    Search,
    RefreshCw,
    ArrowUpRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useStorageOverview } from '@/hooks/useStorageOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { StorageRadial } from '@/components/storage/StorageRadial';
import { StoragePerformanceSparkline } from '@/components/storage/StoragePerformanceSparkline';

export default function StorageOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useStorageOverview();

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

    const pvcCount = data?.resources.filter(r => r.kind === 'PersistentVolumeClaim').length ?? 0;
    const pvCount = data?.resources.filter(r => r.kind === 'PersistentVolume').length ?? 0;

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Storage Overview"
                description="High-fidelity visibility across persistent volumes, claims, and storage class performance."
                icon={Database}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Capacity & Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Capacity Hero */}
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
                    <CardHeader className="pb-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-[#326CE5]">Storage Capacity</CardTitle>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Global Allocation Metrics</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-[#326CE5] animate-ping" />
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">Live Provisioning</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mt-6">
                            <StorageRadial
                                title="PVC Utilization"
                                value={data?.pulse.optimal_percent ?? 0}
                                subtext="Claims"
                            />
                            <div className="space-y-6 px-4">
                                <div className="p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10 flex items-center justify-between">
                                    <div>
                                        <span className="block text-2xl font-black text-[#326CE5]">{pvcCount}</span>
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Total PVCs</span>
                                    </div>
                                    <div>
                                        <span className="block text-2xl font-black text-[#326CE5]">{pvCount}</span>
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Matched PVs</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        <span>Provisioning Health</span>
                                        <span className="text-[#326CE5]">Optimal</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${data?.pulse.optimal_percent}%` }}
                                            className="h-full bg-[#326CE5] rounded-full"
                                        />
                                    </div>
                                </div>
                                <Button variant="default" className="w-full bg-[#326CE5] hover:bg-[#2856b3] h-12 text-sm font-bold rounded-xl shadow-lg shadow-[#326CE5]/10">
                                    Expand Storage Quotas
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Performance & SC insights */}
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-6 relative overflow-hidden">
                    <CardHeader className="p-0 mb-6">
                        <CardTitle className="text-sm font-black uppercase text-[#326CE5]/60">IOPS Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 flex flex-col gap-6">
                        <StoragePerformanceSparkline />

                        <div className="space-y-4">
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Storage Classes</span>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    <Badge className="bg-[#326CE5]/10 text-[#326CE5] border-transparent font-bold text-[10px]">Standard</Badge>
                                    <Badge className="bg-[#326CE5]/10 text-[#326CE5] border-transparent font-bold text-[10px]">Premium-LRS</Badge>
                                    <Badge className="bg-emerald-50 text-emerald-600 border-transparent font-bold text-[10px]">SSD-Optimized</Badge>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-muted-foreground italic">System Latency</span>
                                    <span className="text-xs font-black text-emerald-500">2.4ms</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-tight">Cluster storage backend is performing within defined health parameters (v1.23 standard).</p>
                            </div>
                        </div>

                        <div className="mt-auto">
                            <Button variant="outline" className="w-full h-10 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl transition-all">
                                Configure Backend
                            </Button>
                        </div>
                    </CardContent>
                </Card>

            </div>

            {/* Explorer Table */}
            <div className="bg-card border border-primary/5 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-primary/5 flex flex-col md:flex-row md:items-center gap-4 justify-between bg-muted/20">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search storage resources..."
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
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Capacity</th>
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
                                            <div className={cn("h-1.5 w-1.5 rounded-full", ['Bound', 'Available', 'Active'].includes(resource.status) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-[12px] font-bold text-slate-700">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[12px] font-black text-[#326CE5]">
                                            {resource.capacity || '-'}
                                        </span>
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
