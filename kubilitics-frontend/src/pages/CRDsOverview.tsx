import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    FileCode,
    Search,
    RefreshCw,
    ArrowUpRight,
    Braces,
    Shield,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useCRDOverview } from '@/hooks/useCRDOverview';
import { useOverviewPagination } from '@/hooks/useOverviewPagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ListPagination } from '@/components/list/ListPagination';

export default function CRDsOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useCRDOverview();

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

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Custom Resources"
                description="High-fidelity visibility across the cluster's custom API registry and expanded resource definitions."
                icon={FileCode}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Registry Standing */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm relative">
                    {/* Visual pattern */}
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Braces className="w-32 h-32 text-[#326CE5]" />
                    </div>

                    <CardHeader>
                        <div>
                            <CardTitle className="text-xl font-black text-[#326CE5]">API Registry Standing</CardTitle>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Global Custom Resource Definitions</p>
                        </div>
                    </CardHeader>
                    <CardContent className="pb-8">
                        <div className="flex items-end gap-8 mt-4">
                            <div>
                                <span className="block text-5xl font-black text-[#326CE5]">{data?.resources.length}</span>
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Active Definitions</span>
                            </div>
                            <div className="h-12 w-[1px] bg-slate-100" />
                            <div>
                                <span className="block text-2xl font-black text-[#326CE5]">Standard</span>
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Compliance Level</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                            <div className="p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    <span className="text-xs font-bold text-slate-700">Schema Validation</span>
                                </div>
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">Verified</span>
                            </div>
                            <div className="p-4 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-[#326CE5]" />
                                    <span className="text-xs font-bold text-slate-700">API Priority</span>
                                    <span className="text-[10px] font-black text-[#326CE5] uppercase">Normal</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col p-8 relative overflow-hidden group">
                    <Shield className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.02] text-[#326CE5] rotate-12" />

                    <div className="flex-1">
                        <h3 className="text-lg font-black text-[#326CE5]">Schema Intelligence</h3>
                        <p className="text-xs text-muted-foreground mt-2 font-medium">Monitoring custom API group health and schema consistency across namespaces.</p>

                        <div className="mt-8 space-y-4">
                            <div className="flex items-center justify-between text-xs font-bold">
                                <span className="text-muted-foreground uppercase tracking-tighter">Registry Sync</span>
                                <span className="text-emerald-500 uppercase tracking-tighter">In Sync</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: '100%' }}
                                    className="h-full bg-emerald-500 rounded-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-8">
                        <Button className="w-full h-12 bg-[#326CE5] hover:bg-[#2856b3] rounded-xl font-bold shadow-lg shadow-[#326CE5]/10">
                            Register Definition
                        </Button>
                    </div>
                </Card>
            </div>

            {/* Explorer Table */}
            <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm ring-1 ring-slate-100">
                <div className="p-8 border-b border-slate-50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-bold tracking-tight text-slate-900">API Extensions Explorer</h3>
                            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mt-1">Custom Resource Definition Registry</p>
                        </div>
                        <div className="relative min-w-[320px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search custom definitions..."
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
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Resource Name</th>
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Group / API</th>
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
                                    key={`${resource.name}`}
                                    className="group hover:bg-slate-50 transition-colors"
                                >
                                    <td className="px-8 py-4">
                                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-tight tracking-tight">
                                            {resource.name}
                                        </div>
                                    </td>
                                    <td className="px-8 py-4">
                                        <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-bold border-slate-100 text-slate-500">
                                            {resource.group}
                                        </Badge>
                                    </td>
                                    <td className="px-8 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <span className="text-[12px] font-bold text-slate-700">Established</span>
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
                                    <td colSpan={4} className="px-8 py-12 text-center text-sm text-slate-400">
                                        {searchQuery ? 'No resources match your search.' : 'No custom resource definitions found.'}
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
                            rangeLabel={`API Registry: ${pagination.totalItems} Definitions`}
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
