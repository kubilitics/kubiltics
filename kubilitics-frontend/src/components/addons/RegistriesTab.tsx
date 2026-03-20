import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Plus,
    Database,
    Loader2,
    Trash2,
    ExternalLink,
    ShieldCheck,
    ShieldAlert,
    RefreshCw,
    Globe,
    Lock,
    Search,
    AlertCircle
} from "lucide-react";
import { useCatalogSources, useCreateCatalogSource, useDeleteCatalogSource } from "@/hooks/useAddOnCatalog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PrivateCatalogSource } from "@/types/api/addons";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

// ── Registry Form Dialog ──────────────────────────────────────────────────────

function RegistryFormDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [type, setType] = useState<"helm" | "oci">("helm");
    const [authType, setAuthType] = useState<"none" | "basic" | "token">("none");

    const createMutation = useCreateCatalogSource();

    const handleSubmit = async () => {
        if (!name.trim() || !url.trim()) return;

        await createMutation.mutateAsync({
            name: name.trim(),
            url: url.trim(),
            type,
            auth_type: authType,
            sync_enabled: true,
        });

        handleClose();
    };

    const handleClose = () => {
        setName("");
        setUrl("");
        setType("helm");
        setAuthType("none");
        onClose();
    };

    const isPending = createMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Connect Private Registry</DialogTitle>
                    <DialogDescription>
                        Add a private OCI or Helm repository to extend your add-on catalog.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="registry-name">Display Name</Label>
                        <Input
                            id="registry-name"
                            placeholder="e.g. Internal Platform Tools"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Registry Type</Label>
                            <Select value={type} onValueChange={(v: any) => setType(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="helm">Helm Repository</SelectItem>
                                    <SelectItem value="oci">OCI Registry</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Authentication</Label>
                            <Select value={authType} onValueChange={(v: any) => setAuthType(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None (Public)</SelectItem>
                                    <SelectItem value="basic">Basic Auth</SelectItem>
                                    <SelectItem value="token">Bearer Token</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="registry-url">Repository URL</Label>
                        <Input
                            id="registry-url"
                            placeholder={type === "helm" ? "https://charts.example.com" : "oci://registry.example.com/addons"}
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />
                        <p className="text-[10px] text-slate-400">
                            {type === "helm"
                                ? "Ensure the URL points to a valid Helm 'index.yaml'."
                                : "OCI URLs should start with 'oci://'."}
                        </p>
                    </div>
                </div>

                <DialogFooter className="gap-2 mt-4 pt-4 border-t">
                    <Button variant="outline" onClick={handleClose} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || !url.trim() || isPending}>
                        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Connect Registry
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Registry Card ─────────────────────────────────────────────────────────────

function RegistryCard({
    source,
    onDelete
}: {
    source: PrivateCatalogSource,
    onDelete: () => void
}) {
    return (
        <div className="glass-card p-5 group hover:shadow-apple-xl transition-all duration-500 border-slate-200/60 relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute -right-8 -top-8 h-24 w-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />

            <div className="flex items-start justify-between relative z-10">
                <div className="flex items-center gap-4">
                    <div className={cn(
                        "h-12 w-12 rounded-2xl flex items-center justify-center shadow-apple-sm group-hover:scale-110 transition-transform duration-500",
                        source.type === "oci" ? "bg-indigo-50 text-indigo-500" : "bg-blue-50 text-blue-500"
                    )}>
                        {source.type === "oci" ? <Globe className="h-6 w-6" /> : <Database className="h-6 w-6" />}
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 group-hover:text-primary transition-colors">{source.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider bg-slate-50/50 border-slate-200 text-slate-500">
                                {source.type}
                            </Badge>
                            {source.auth_type !== "none" && (
                                <div className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                                    <Lock className="h-3 w-3" />
                                    {source.auth_type}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    onClick={onDelete}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>

            <div className="mt-5 space-y-3">
                <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 flex items-center justify-between group-hover:border-slate-200 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 truncate font-mono">
                            {source.url}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                        {source.last_synced_at ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">
                                <ShieldCheck className="h-3 w-3" />
                                Synchronized
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold bg-slate-100 px-2 py-0.5 rounded-full animate-pulse">
                                <RefreshCw className="h-3 w-3" />
                                Pending Sync
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] text-slate-400">
                        Added {new Date(source.created_at).toLocaleDateString()}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── RegistriesTab ─────────────────────────────────────────────────────────────

export function RegistriesTab() {
    const { data: sources, isLoading, isError, refetch } = useCatalogSources();
    const [createOpen, setCreateOpen] = useState(false);
    const [deleteSource, setDeleteSource] = useState<PrivateCatalogSource | null>(null);
    const [search, setSearch] = useState("");

    const deleteMutation = useDeleteCatalogSource();

    const filteredSources = sources?.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.url.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Context Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-3">
                        <Lock className="h-3 w-3" />
                        Enterprise Governance
                    </div>
                    <h2 className="apple-title text-3xl font-black tracking-tight text-slate-900">Private Registries</h2>
                    <p className="apple-description mt-3 text-lg leading-relaxed text-slate-500">
                        Securely connect your internal OCI and Helm repositories.
                        Add-ons from these sources will be available under the <span className="text-primary font-bold">PRIVATE</span> tier.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Filter registries…"
                            className="pl-10 h-10 border-slate-200 shadow-sm rounded-xl focus:ring-primary/20 transition-all"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <Button className="h-10 px-6 rounded-xl shadow-apple active:scale-95 transition-all font-bold" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Connect Registry
                    </Button>
                </div>
            </div>

            {/* Content Area */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 text-slate-400 gap-4">
                    <div className="relative">
                        <Loader2 className="h-10 w-10 animate-spin text-primary opacity-40" />
                        <Database className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                    </div>
                    <p className="text-sm font-medium animate-pulse">Loading private catalogs…</p>
                </div>
            ) : isError ? (
                <div className="flex flex-col items-center justify-center py-32 glass-card bg-red-50/20 border-red-100/50">
                    <ShieldAlert className="h-12 w-12 text-red-400 mb-4" />
                    <h3 className="font-bold text-slate-900 text-lg">Connection failed</h3>
                    <p className="text-sm text-slate-500 mt-1">We couldn&apos;t retrieve your private registries.</p>
                    <Button variant="outline" className="mt-6 border-red-200 text-red-600 hover:bg-red-50" onClick={() => refetch()}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Try Again
                    </Button>
                </div>
            ) : filteredSources && filteredSources.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-10">
                    {filteredSources.map(source => (
                        <RegistryCard
                            key={source.id}
                            source={source}
                            onDelete={() => setDeleteSource(source)}
                        />
                    ))}

                    {/* Add Placeholder Card */}
                    <div
                        onClick={() => setCreateOpen(true)}
                        className="border-2 border-dashed border-slate-200 rounded-3xl p-8 flex flex-col items-center justify-center gap-3 text-slate-400 hover:border-primary/40 hover:text-primary/60 hover:bg-primary/5 transition-all cursor-pointer group group-hover:duration-300"
                    >
                        <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-primary/10 group-hover:scale-110 transition-all">
                            <Plus className="h-6 w-6" />
                        </div>
                        <span className="text-sm font-bold">Add Another Repository</span>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-32 glass-card bg-slate-50/20 border-slate-100 shadow-sm border-dashed rounded-[32px]">
                    <div className="h-24 w-24 rounded-[32px] bg-slate-100/80 flex items-center justify-center mb-8 ring-[12px] ring-slate-50/50 relative">
                        <Database className="h-10 w-10 text-slate-400 opacity-30 shrink-0" />
                        <div className="absolute -right-2 -top-2 h-10 w-10 bg-white rounded-2xl shadow-apple-sm flex items-center justify-center text-primary border border-slate-100 transform rotate-12">
                            <Lock className="h-5 w-5" />
                        </div>
                    </div>
                    <h3 className="apple-title text-2xl font-black">No private registries yet</h3>
                    <p className="apple-description mt-3 max-w-sm text-center text-slate-500">
                        Connect your company&apos;s internal repositories to distribute
                        custom add-ons across your organization.
                    </p>
                    <Button size="lg" className="mt-10 px-10 h-14 rounded-2xl shadow-apple-xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-5 w-5 mr-2" />
                        Get Started
                    </Button>
                </div>
            )}

            <RegistryFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />

            {/* Delete Confirmation */}
            {deleteSource && (
                <Dialog open={!!deleteSource} onOpenChange={(v) => !v && setDeleteSource(null)}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-red-500" />
                                Disconnect Registry
                            </DialogTitle>
                            <DialogDescription>
                                Are you sure you want to disconnect <strong>{deleteSource.name}</strong>?
                                Add-ons from this source will no longer be available in the catalog.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2 pt-4">
                            <Button variant="outline" onClick={() => setDeleteSource(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                className="font-bold"
                                onClick={async () => {
                                    await deleteMutation.mutateAsync(deleteSource.id);
                                    setDeleteSource(null);
                                }}
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Disconnect
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
