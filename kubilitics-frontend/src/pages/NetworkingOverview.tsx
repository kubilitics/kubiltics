import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Globe,
    Search,
    RefreshCw,
    ArrowUpRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNetworkingOverview } from '@/hooks/useNetworkingOverview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { NetworkingPulse } from '@/components/networking/NetworkingPulse';
import { ServiceDistribution } from '@/components/networking/ServiceDistribution';

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
        <div className="flex flex-col gap-6 p-6">
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
                <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
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
                <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm flex flex-col items-center justify-center p-6 px-0 text-center relative overflow-hidden">
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
                        <Button variant="outline" className="w-full h-10 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl transition-all">
                            Manage Load Balancers
                        </Button>
                    </div>
                </Card>

            </div>

            {/* Explorer Table */}
            <div className="bg-card border border-primary/5 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-primary/5 flex flex-col md:flex-row md:items-center gap-4 justify-between bg-muted/20">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search network resources..."
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
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-muted-foreground border-b border-primary/5">Type</th>
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
                                            <div className={cn("h-1.5 w-1.5 rounded-full", resource.status === 'Active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500")} />
                                            <span className="text-[12px] font-bold text-slate-700">{resource.status}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[12px] font-medium text-muted-foreground italic">
                                            {resource.type || '-'}
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
