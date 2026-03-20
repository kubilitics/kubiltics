import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, Server, Hash, Trash2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    getProject,
    getClusters,
    listResources,
    addClusterToProject,
    removeClusterFromProject,
    addNamespaceToProject,
    removeNamespaceFromProject,
    deleteProject,
    BackendProject,
} from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ProjectSettingsDialogProps {
    project: BackendProject;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ProjectSettingsDialog({ project, open, onOpenChange }: ProjectSettingsDialogProps) {
    const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
    const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const queryClient = useQueryClient();
    const [selectedClusterId, setSelectedClusterId] = useState<string>('');
    const [selectedNamespace, setSelectedNamespace] = useState<string>('');

    const { data: projectDetails, isLoading: isDetailsLoading } = useQuery({
        queryKey: ['project', project.id],
        queryFn: () => (isBackendConfigured ? getProject(backendBaseUrl, project.id) : Promise.resolve(null)),
        enabled: open && isBackendConfigured,
    });

    const { data: allClusters } = useQuery({
        queryKey: ['clusters'],
        queryFn: () => (isBackendConfigured ? getClusters(backendBaseUrl) : Promise.resolve([])),
        enabled: open && isBackendConfigured,
    });

    const { data: namespacesForSelectedCluster } = useQuery({
        queryKey: ['namespaces', selectedClusterId],
        queryFn: async () => {
            if (!isBackendConfigured || !selectedClusterId) return [];
            const resp = await listResources(backendBaseUrl, selectedClusterId, 'namespaces');
            return resp.items.map((i: any) => i.metadata.name as string);
        },
        enabled: !!selectedClusterId && isBackendConfigured,
    });

    const addClusterMutation = useMutation({
        mutationFn: (clusterId: string) => addClusterToProject(backendBaseUrl!, project.id, clusterId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project', project.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            toast.success("Cluster account attached");
        },
        onError: (error: any) => toast.error(`Attachment failed: ${error.message}`),
    });

    const removeClusterMutation = useMutation({
        mutationFn: (clusterId: string) => removeClusterFromProject(backendBaseUrl!, project.id, clusterId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project', project.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            toast.success("Cluster account detached");
        },
        onError: (error: any) => toast.error(`Detachment failed: ${error.message}`),
    });

    const addNamespaceMutation = useMutation({
        mutationFn: ({ clusterId, ns }: { clusterId: string; ns: string }) =>
            addNamespaceToProject(backendBaseUrl!, project.id, clusterId, ns),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project', project.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            setSelectedNamespace('');
            toast.success("Resource slice linked");
        },
        onError: (error: any) => toast.error(`Resource linkage failed: ${error.message}`),
    });

    const removeNamespaceMutation = useMutation({
        mutationFn: ({ clusterId, ns }: { clusterId: string; ns: string }) =>
            removeNamespaceFromProject(backendBaseUrl!, project.id, clusterId, ns),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project', project.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            toast.success("Resource slice unlinked");
        },
        onError: (error: any) => toast.error(`Resource unlinking failed: ${error.message}`),
    });

    const deleteProjectMutation = useMutation({
        mutationFn: () => deleteProject(backendBaseUrl!, project.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            onOpenChange(false);
            toast.success(`Project "${project.name}" has been purged`);
        },
        onError: (error: any) => toast.error(`Purge failed: ${error.message}`),
    });

    const availableClusters = useMemo(() => {
        return allClusters || [];
    }, [allClusters]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-hidden rounded-[3rem] p-0 border-none bg-slate-50 shadow-2xl flex flex-col">
                {/* Header Section */}
                <div className="p-10 pb-8 bg-white border-b border-slate-100 relative">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />
                    <DialogHeader>
                        <DialogTitle className="text-3xl font-extrabold tracking-tight text-slate-900">
                            Logical Governance
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 font-medium text-sm mt-1">
                            Fine-tune infrastructure allocation for <span className="text-blue-600 font-bold">{project.name}</span>
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="flex-1 overflow-y-auto p-10 space-y-12">
                    {isDetailsLoading ? (
                        <div className="flex flex-col items-center justify-center py-24 space-y-4">
                            <div className="relative h-12 w-12">
                                <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                                <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
                            </div>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Synchronizing state...</span>
                        </div>
                    ) : (
                        <>
                            {/* Unified Resource Linker */}
                            <section className="space-y-6">
                                <div className="space-y-1">
                                    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Resource Allocation</h4>
                                    <p className="text-sm font-semibold text-slate-800">Provision Infrastructure</p>
                                </div>

                                <div className="bg-white/70 backdrop-blur-sm rounded-[2.5rem] p-8 border border-white shadow-sm space-y-8">
                                    <div className="flex flex-col sm:flex-row gap-4 items-end">
                                        <div className="flex-1 space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-2">Source Context</label>
                                            <Select onValueChange={(val) => { setSelectedClusterId(val); setSelectedNamespace(''); }} value={selectedClusterId}>
                                                <SelectTrigger className="h-12 rounded-2xl border-slate-100 bg-slate-50 text-sm font-bold tracking-tight">
                                                    <SelectValue placeholder="Select Cluster..." />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-2xl shadow-2xl border-slate-100 p-2">
                                                    {availableClusters.map(c => (
                                                        <SelectItem key={c.id} value={c.id} className="rounded-xl py-3 font-semibold">
                                                            {c.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="flex-1 space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] ml-2">Governance Scope</label>
                                            <Select onValueChange={setSelectedNamespace} value={selectedNamespace} disabled={!selectedClusterId}>
                                                <SelectTrigger className="h-12 rounded-2xl border-slate-100 bg-slate-50 text-sm font-bold tracking-tight">
                                                    <SelectValue placeholder="Select Depth..." />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-2xl shadow-2xl border-slate-100 p-2">
                                                    <SelectItem value="__ENTIRE_CLUSTER__" className="rounded-xl py-2 font-bold text-blue-600 focus:bg-blue-50">
                                                        Entire Cluster
                                                    </SelectItem>
                                                    <div className="h-px bg-slate-100 my-2 mx-2" />
                                                    {namespacesForSelectedCluster?.map(ns => (
                                                        <SelectItem key={ns} value={ns} className="rounded-xl py-2 font-semibold">
                                                            {ns}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <Button
                                            className="h-12 rounded-2xl px-10 bg-slate-900 text-white font-bold hover:bg-slate-800 hover:shadow-lg hover:translate-y-[-2px] transition-all shadow-md"
                                            disabled={!selectedClusterId || !selectedNamespace || addNamespaceMutation.isPending || addClusterMutation.isPending}
                                            onClick={() => {
                                                if (selectedNamespace === '__ENTIRE_CLUSTER__') {
                                                    addClusterMutation.mutate(selectedClusterId);
                                                } else {
                                                    addNamespaceMutation.mutate({ clusterId: selectedClusterId, ns: selectedNamespace });
                                                }
                                                setSelectedNamespace('');
                                            }}
                                        >
                                            {addNamespaceMutation.isPending || addClusterMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link Resource"}
                                        </Button>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-6">
                                <div className="space-y-1">
                                    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Inventory</h4>
                                    <p className="text-sm font-semibold text-slate-800">Active Allocations</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Full Cluster Associations */}
                                    {projectDetails?.clusters.map((pc) => (
                                        <div key={`cluster-${pc.cluster_id}`} className="group relative bg-white p-5 rounded-[2rem] border border-blue-100 shadow-sm hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 bg-blue-50 rounded-2xl flex items-center justify-center border border-blue-100">
                                                        <Server className="h-6 w-6 text-blue-500" />
                                                    </div>
                                                    <div>
                                                        <div className="text-base font-extrabold text-slate-900 tracking-tight">{pc.cluster_name}</div>
                                                        <Badge variant="outline" className="mt-1 h-5 text-[9px] border-blue-100 bg-blue-50/50 font-bold uppercase tracking-widest text-blue-600">
                                                            Entire Context
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-10 w-10 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                                                    onClick={() => removeClusterMutation.mutate(pc.cluster_id)}
                                                >
                                                    {removeClusterMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                                                </Button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Namespace Slices */}
                                    {projectDetails?.namespaces.map((pn) => (
                                        <div
                                            key={`ns-${pn.cluster_id}-${pn.namespace_name}`}
                                            className="bg-white border border-slate-100 p-5 rounded-[2rem] flex items-center justify-between group/ns transition-all hover:shadow-md hover:border-slate-200"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-50 group-hover/ns:bg-blue-50">
                                                    <Hash className="h-6 w-6 text-slate-400 group-hover/ns:text-blue-500" />
                                                </div>
                                                <div>
                                                    <div className="text-base font-extrabold text-slate-900 tracking-tight">{pn.namespace_name}</div>
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">{pn.cluster_name}</div>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-10 w-10 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                                                onClick={() => removeNamespaceMutation.mutate({ clusterId: pn.cluster_id, ns: pn.namespace_name })}
                                            >
                                                <Trash2 className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    ))}

                                    {projectDetails?.clusters.length === 0 && projectDetails?.namespaces.length === 0 && (
                                        <div className="col-span-full py-16 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center space-y-4">
                                            <div className="p-4 bg-slate-50 rounded-full">
                                                <Server className="h-8 w-8 text-slate-200" />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Awaiting Provisining</p>
                                                <p className="text-xs text-slate-300 font-medium mt-1">Link a cluster context or namespace slice above</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </div>

                <div className="p-8 bg-white border-t border-slate-100 flex justify-between items-center">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="ghost"
                                className="rounded-2xl h-12 px-6 font-bold text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Purge Project
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[2.5rem] p-10 border-none shadow-2xl">
                            <AlertDialogHeader>
                                <AlertDialogTitle className="text-2xl font-bold text-slate-900">Purge logical environment?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-500 font-medium">
                                    This action is <span className="text-red-600 font-bold uppercase tracking-widest text-[10px]">irreversible</span>.
                                    All cluster associations and resource links for <span className="font-bold text-slate-900">{project.name}</span> will be permanently deleted.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="mt-8 gap-3">
                                <AlertDialogCancel className="rounded-2xl h-12 px-8 font-bold border-slate-100">Abort</AlertDialogCancel>
                                <AlertDialogAction
                                    className="rounded-2xl h-12 px-8 font-bold bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200"
                                    onClick={() => deleteProjectMutation.mutate()}
                                    disabled={deleteProjectMutation.isPending}
                                >
                                    {deleteProjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Purge"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    <Button
                        variant="ghost"
                        className="rounded-2xl h-12 px-8 font-bold text-slate-500 hover:text-slate-900"
                        onClick={() => onOpenChange(false)}
                    >
                        Done
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
