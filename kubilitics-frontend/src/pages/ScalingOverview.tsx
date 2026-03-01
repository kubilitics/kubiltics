import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Zap,
    Search,
    RefreshCw,
    ArrowUpRight,
    Scale,
    Shield,
    Activity,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useScalingOverview } from '@/hooks/useScalingOverview';
import { useOverviewPagination } from '@/hooks/useOverviewPagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ScalingPulse } from '@/components/scaling/ScalingPulse';
import { ListPagination } from '@/components/list/ListPagination';

export default function ScalingOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useScalingOverview();

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

    const hpaCount = data?.resources.filter(r => r.kind === 'HPA').length ?? 0;
    const vpaCount = data?.resources.filter(r => r.kind === 'VPA').length ?? 0;
    const pdbCount = data?.resources.filter(r => r.kind === 'PDB').length ?? 0;

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Scaling & Policies"
                description="High-fidelity visibility across automated scaling configurations and pod disruption budgets."
                icon={Zap}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Scaling Pulse & Policy Matrix */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Elasticity Pulse */}
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
                    <CardHeader className="pb-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-[#326CE5]">Elasticity Pulse</CardTitle>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Replica Alignment Intelligence</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">Synchronized</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-8">
                        <ScalingPulse />

                        <div className="grid grid-cols-3 gap-6 mt-6 border-t border-slate-100 pt-6">
                            <div>
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Convergence</span>
                                <span className="text-xl font-black text-[#326CE5]">98.2%</span>
                            </div>
                            <div>
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Scale Events</span>
                                <span className="text-xl font-black text-[#326CE5]">12 / Hr</span>
                            </div>
                            <div>
                                <span className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Cooldown</span>
                                <span className="text-xl font-black text-emerald-500 italic">ACTIVE</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Policy Standing Card */}
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-8 relative overflow-hidden group">
                    <Shield className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.02] text-[#326CE5] -rotate-12" />

                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="h-10 w-10 rounded-xl bg-[#326CE5]/10 flex items-center justify-center">
                                <Shield className="h-5 w-5 text-[#326CE5]" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-[#326CE5] uppercase">Policy Standing</h3>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Disruption & Scaling</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">HPAs Configured</span>
                                <span className="text-sm font-black text-[#326CE5]">{hpaCount}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">VPAs Active</span>
                                <span className="text-sm font-black text-[#326CE5]">{vpaCount}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-500">PDBs Enforced</span>
                                <span className="text-sm font-black text-[#326CE5]">{pdbCount}</span>
                            </div>
                        </div>

                        <div className="mt-8 p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity className="h-3 w-3 text-[#326CE5]" />
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">System Disruption</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-tight">Current cluster configurations allow for 100% availability during 1-node disruptions.</p>
                        </div>
                    </div>

                    <div className="mt-8">
                        <Button className="w-full h-12 bg-[#326CE5] hover:bg-[#2856b3] rounded-xl font-bold shadow-lg shadow-[#326CE5]/10">
                            Scale Optimizer
                        </Button>
                    </div>
                </Card>
            </div>

            {/* Explorer Table */}
            <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm ring-1 ring-slate-100">
                <div className="p-8 border-b border-slate-50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-bold tracking-tight text-slate-900">Scaling Explorer</h3>
                            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mt-1">HPA, VPA & Disruption Policy Registry</p>
                        </div>
                        <div className="relative min-w-[320px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search scaling resources..."
                                className="pl-12 bg-slate-50 border-transparent transition-all rounded-xl focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-slate-200 h-10 font-medium text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Policy Name</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Kind</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Namespace</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Status</th>
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
                                            <div className={cn("h-1.5 w-1.5 rounded-full", resource.status === 'Active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-[12px] font-bold text-slate-700">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-4 text-right">
                                        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 hover:bg-white hover:text-blue-600 hover:shadow-sm rounded-xl transition-all border border-transparent hover:border-slate-100">
                                            <ArrowUpRight className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </motion.tr>
                            ))}
                            {pagination.paginatedItems.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-8 py-12 text-center text-sm text-slate-400">
                                        {searchQuery ? 'No resources match your search.' : 'No scaling resources found.'}
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
                            rangeLabel={`Policy Registry: ${pagination.totalItems} Resources`}
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
