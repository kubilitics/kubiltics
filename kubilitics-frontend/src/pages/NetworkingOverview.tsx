import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Globe,
    Search,
    RefreshCw,
    ArrowUpRight,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNetworkingOverview } from '@/hooks/useNetworkingOverview';
import { useOverviewPagination } from '@/hooks/useOverviewPagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { NetworkingPulse } from '@/components/networking/NetworkingPulse';
import { ServiceDistribution } from '@/components/networking/ServiceDistribution';
import { ListPagination } from '@/components/list/ListPagination';

export default function NetworkingOverview() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data, isLoading } = useNetworkingOverview();

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

    const servicesCount = data?.resources.filter(r => r.kind === 'Service').length ?? 0;
    const ingressCount = data?.resources.filter(r => r.kind === 'Ingress').length ?? 0;
    const policyCount = data?.resources.filter(r => r.kind === 'NetworkPolicy').length ?? 0;

    return (
        <div className="flex flex-col gap-6 p-6" role="main" aria-label="Networking Overview">
            {/* Header Section */}
            <SectionOverviewHeader
                title="Networking Overview"
                description="High-fidelity visibility across cluster services, traffic flow, and security layers."
                icon={Globe}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Hero Section: Traffic Pulse & Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Traffic Pulse Chart */}
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm elevation-2" aria-live="polite">
                    <CardHeader className="pb-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-[#326CE5]">Traffic Pulse</CardTitle>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Real-time Connectivity Signals</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-[#326CE5] animate-ping" />
                                <span className="text-[10px] font-black text-[#326CE5] uppercase">Live Monitor</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <NetworkingPulse />
                        <div className="grid grid-cols-3 gap-4 mt-4 border-t border-slate-100 pt-6">
                            <div className="text-center">
                                <span className="block text-2xl font-black text-[#326CE5]">{data?.pulse.optimal_percent.toFixed(1)}%</span>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Availability</span>
                            </div>
                            <div className="text-center">
                                <span className="block text-2xl font-black text-[#326CE5]">{servicesCount}</span>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Total Endpoints</span>
                            </div>
                            <div className="text-center">
                                <span className="block text-2xl font-black text-[#326CE5]">{policyCount}</span>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Active Policies</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Service Distribution Donut */}
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col items-center justify-center p-6 px-0 text-center relative overflow-hidden elevation-2">
                    <CardHeader className="pb-0">
                        <CardTitle className="text-sm font-black uppercase text-[#326CE5]/60">Domain Allocation</CardTitle>
                    </CardHeader>
                    <CardContent className="w-full flex flex-col items-center">
                        <ServiceDistribution data={{
                            services: servicesCount,
                            ingresses: ingressCount,
                            policies: policyCount
                        }} />

                        <div className="flex flex-wrap justify-center gap-4 mt-2">
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-[#326CE5]" />
                                <span className="text-[10px] font-bold text-muted-foreground">Services</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-[#60A5FA]" />
                                <span className="text-[10px] font-bold text-muted-foreground">Ingress</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-[#93C5FD]" />
                                <span className="text-[10px] font-bold text-muted-foreground">Policies</span>
                            </div>
                        </div>
                    </CardContent>

                    <div className="mt-4 w-full px-6">
                        <Button variant="outline" className="w-full h-10 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl transition-all press-effect">
                            Manage Load Balancers
                        </Button>
                    </div>
                </Card>

            </div>

            {/* Explorer Table */}
            <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm ring-1 ring-slate-100">
                <div className="p-8 border-b border-slate-50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h3 className="text-xl font-bold tracking-tight text-slate-900">Network Explorer</h3>
                            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mt-1">Services, Ingress & Policy Registry</p>
                        </div>
                        <div className="relative min-w-[320px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                            <Input
                                placeholder="Search network resources..."
                                className="pl-12 bg-slate-50 border-transparent transition-all rounded-xl focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-slate-200 h-10 font-medium text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                aria-label="Search network resources"
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
                                <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100">Type</th>
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
                                    <td className="px-8 py-4">
                                        <span className="text-[12px] font-medium text-slate-500 italic">
                                            {resource.type || '-'}
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
                                        {searchQuery ? 'No resources match your search.' : 'No network resources found.'}
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
                            rangeLabel={`Network Registry: ${pagination.totalItems} Resources`}
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
