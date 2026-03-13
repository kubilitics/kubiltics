import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Database,
    Search,
    RefreshCw,
    ArrowUpRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useStorageOverview } from '@/hooks/useStorageOverview';
import { useOverviewPagination } from '@/hooks/useOverviewPagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { StorageRadial } from '@/components/storage/StorageRadial';
import { StoragePerformanceSparkline } from '@/components/storage/StoragePerformanceSparkline';
import { ListPagination } from '@/components/list/ListPagination';

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

    const pagination = useOverviewPagination(filteredResources, searchQuery, 10);

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
        <div className="flex flex-col gap-6 p-6" role="main" aria-label="Storage Overview">
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
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm elevation-2" aria-live="polite">
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
                                <Button variant="default" className="w-full bg-[#326CE5] hover:bg-[#2856b3] h-12 text-sm font-bold rounded-xl shadow-lg shadow-[#326CE5]/10 press-effect">
                                    Expand Storage Quotas
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Performance & SC insights */}
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-6 relative overflow-hidden elevation-2">
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
                            <Button variant="outline" className="w-full h-10 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl transition-all press-effect">
                                Configure Backend
                            </Button>
                        </div>
                    </CardContent>
                </Card>

            </div>

            {/* Explorer Table */}
            <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm ring-1 ring-slate-100">
                <div className="p-8 border-b border-slate-50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-bold tracking-tight text-slate-900">Storage Explorer</h3>
                            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mt-1">Persistent Volumes & Claims Registry</p>
                        </div>
                        <div className="relative min-w-[320px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                            <Input
                                placeholder="Search storage resources..."
                                className="pl-12 bg-slate-50 border-transparent transition-all rounded-xl focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-slate-200 h-10 font-medium text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                aria-label="Search storage resources"
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Resource Name</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Kind</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Namespace</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Status</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Capacity</th>
                                <th className="px-8 py-5 border-b border-slate-100"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-sm">
                            {pagination.paginatedItems.map((resource, idx) => (
                                <motion.tr
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.02 }}
                                    key={`${resource.kind}-${resource.name}`}
                                    className="group hover:bg-slate-50 transition-colors"
                                >
                                    <td className="px-8 py-4">
                                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-tight tracking-tight">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-8 py-4">
                                        <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-bold border-slate-100 text-slate-500">
                                            {resource.kind}
                                        </Badge>
                                    </td>
                                    <td className="px-8 py-4">
                                        <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                                            {resource.namespace}
                                        </span>
                                    </td>
                                    <td className="px-8 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("h-1.5 w-1.5 rounded-full", ['Bound', 'Available', 'Active'].includes(resource.status) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-[12px] font-bold text-slate-700">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-4">
                                        <span className="text-[12px] font-black text-blue-600 tabular-nums">
                                            {resource.capacity || '-'}
                                        </span>
                                    </td>
                                    <td className="px-8 py-4 text-right">
                                        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 hover:bg-white hover:text-blue-600 hover:shadow-sm rounded-xl transition-all border border-transparent hover:border-slate-100 press-effect">
                                            <ArrowUpRight className="h-4 w-4" aria-hidden />
                                        </Button>
                                    </td>
                                </motion.tr>
                            ))}
                            {pagination.paginatedItems.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-8 py-12 text-center text-sm text-slate-400">
                                        {searchQuery ? 'No resources match your search.' : 'No storage resources found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {pagination.totalItems > 0 && (
                    <div className="p-6 border-t border-slate-50 bg-slate-50/30">
                        <ListPagination
                            hasPrev={pagination.hasPrev}
                            hasNext={pagination.hasNext}
                            onPrev={pagination.onPrev}
                            onNext={pagination.onNext}
                            rangeLabel={`Storage Registry: ${pagination.totalItems} Resources`}
                            currentPage={pagination.currentPage}
                            totalPages={pagination.totalPages}
                            onPageChange={pagination.setCurrentPage}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
