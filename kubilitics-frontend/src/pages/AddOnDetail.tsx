import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useCatalogEntry, useInstalledAddons } from "@/hooks/useAddOnCatalog";
import { useAddonMutations } from "@/hooks/useAddonInstall";
import {
    ChevronLeft, Info, Cpu, Shield,
    Workflow, DollarSign, ExternalLink, AlertTriangle,
    Settings2, History, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/addons/TierBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstallWizard } from "@/components/addons/InstallWizard";
import { LifecyclePanel } from "@/components/addons/LifecyclePanel";
import { UpgradeDialog } from "@/components/addons/UpgradeDialog";
import { RollbackDialog } from "@/components/addons/RollbackDialog";
import { AuditHistoryPanel } from "@/components/addons/AuditHistoryPanel";
import { RBACManifestViewer } from "@/components/addons/RBACManifestViewer";
import { DriftAlert } from "@/components/addons/DriftAlert";
import { ChangelogPanel } from "@/components/addons/ChangelogPanel";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";

export default function AddOnDetail() {
    const rawAddonId = useParams<{ addonId: string }>().addonId ?? "";
    const addonId = rawAddonId ? decodeURIComponent(rawAddonId) : "";
    const clusterId = useActiveClusterId();
    const { data: addon, isLoading, error } = useCatalogEntry(addonId);
    const { data: installedItems } = useInstalledAddons(clusterId || "");
    const { upgrade, uninstall } = useAddonMutations(clusterId || "");

    const [wizardOpen, setWizardOpen] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [rollbackOpen, setRollbackOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

    const installed = installedItems?.find(i => i.addon_id === addonId);

    if (isLoading) {
        return <AddOnDetailSkeleton />;
    }

    if (error || !addon) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-12">
                <AlertTriangle className="h-12 w-12 text-destructive" />
                <h2 className="text-xl font-bold">Add-on Not Found</h2>
                <p className="text-muted-foreground">The requested add-on could not be found in the catalog.</p>
                <Button asChild variant="outline">
                    <Link to="/addons">Back to Catalog</Link>
                </Button>
            </div>
        );
    }

    const handleUpgrade = async (version: string) => {
        if (!installed) return;
        await upgrade({ installId: installed.id, version });
        setUpgradeOpen(false);
    };

    return (
        <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild className="-ml-2">
                    <Link to="/addons">
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Back to Catalog
                    </Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 flex flex-col gap-8">
                    <div className="flex gap-6 items-start">
                        <div className="h-24 w-24 rounded-2xl bg-muted flex items-center justify-center p-4 overflow-hidden border">
                            {addon.icon_url ? (
                                <img src={addon.icon_url} alt={addon.display_name} className="w-full h-full object-contain" />
                            ) : (
                                <Workflow className="h-12 w-12 text-muted-foreground" />
                            )}
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                            <div className="flex items-center gap-3 flex-wrap">
                                <h1 className="text-3xl font-bold tracking-tight">{addon.display_name}</h1>
                                <TierBadge tier={addon.tier} />
                                {typeof addon.stars === "number" && addon.stars > 0 && (
                                    <span className="flex items-center gap-1 text-sm text-muted-foreground font-medium" title="Artifact Hub stars">
                                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                                        {addon.stars >= 1000 ? `${(addon.stars / 1000).toFixed(1)}k` : addon.stars}
                                    </span>
                                )}
                                {installed && (
                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/10 dark:text-emerald-400">
                                        Installed
                                    </Badge>
                                )}
                            </div>
                            <p className="text-lg text-muted-foreground">{addon.description}</p>
                            <div className="flex gap-4 mt-2">
                                {(addon.tags ?? []).map(tag => (
                                    <Badge key={tag} variant="secondary" className="bg-muted/50 text-xs">{tag}</Badge>
                                ))}
                            </div>
                        </div>
                    </div>

                    {installed && installed.status === 'DRIFTED' && (
                        <DriftAlert
                            severity="STRUCTURAL"
                            message="One or more resources managed by this add-on have been modified directly in the cluster."
                            onRemediate={() => handleUpgrade(installed.installed_version)}
                        />
                    )}

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="mb-4">
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="security">Security & RBAC</TabsTrigger>
                            <TabsTrigger value="changelog">Changelog</TabsTrigger>
                            {installed && <TabsTrigger value="lifecycle">Management</TabsTrigger>}
                            {installed && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
                        </TabsList>

                        <TabsContent value="overview" className="mt-0 space-y-8">
                            <section>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Info className="h-5 w-5 text-primary" />
                                    About this Add-on
                                </h3>
                                <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-relaxed">
                                    {addon.description}
                                </div>
                            </section>

                            <section>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Workflow className="h-5 w-5 text-primary" />
                                    Infrastructure Impact
                                </h3>
                                <div className="grid md:grid-cols-2 gap-4">
                                    <Card className="bg-muted/30 border-none shadow-none">
                                        <CardContent className="p-4 flex gap-4 items-center">
                                            <div className="h-10 w-10 rounded-full bg-background flex items-center justify-center border shadow-sm">
                                                <Shield className="h-5 w-5 text-indigo-500" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-semibold">RBAC Requirements</h4>
                                                <p className="text-xs text-muted-foreground">
                                                    Requires RBAC permission groups for operation.
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <Card className="bg-muted/30 border-none shadow-none">
                                        <CardContent className="p-4 flex gap-4 items-center">
                                            <div className="h-10 w-10 rounded-full bg-background flex items-center justify-center border shadow-sm">
                                                <Cpu className="h-5 w-5 text-emerald-500" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-semibold">Resource Profile</h4>
                                                <p className="text-xs text-muted-foreground">
                                                    Managed resource footprint with automated scaling.
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </section>

                            {addon.dependencies && addon.dependencies.length > 0 && (
                                <section>
                                    <h3 className="text-lg font-semibold mb-4">Dependencies</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {addon.dependencies.map(dep => (
                                            <Badge key={dep.depends_on_id} variant="outline" className="text-xs">{dep.depends_on_id}</Badge>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-2 italic">
                                        Dependencies will be automatically resolved during the installation process.
                                    </p>
                                </section>
                            )}
                        </TabsContent>

                        <TabsContent value="security" className="mt-0">
                            <RBACManifestViewer
                                clusterId={clusterId || "current"}
                                addonId={addonId!}
                                namespace={installed?.namespace || "default"}
                            />
                        </TabsContent>

                        <TabsContent value="changelog" className="mt-0">
                            <ChangelogPanel versions={addon.versions || []} />
                        </TabsContent>

                        {installed && (
                            <>
                                <TabsContent value="lifecycle" className="mt-0">
                                    <LifecyclePanel
                                        install={installed}
                                        onUpgrade={() => setUpgradeOpen(true)}
                                        onRollback={() => setRollbackOpen(true)}
                                        onUninstall={() => uninstall(installed.id)}
                                    />
                                </TabsContent>
                                <TabsContent value="audit" className="mt-0">
                                    <AuditHistoryPanel
                                        clusterId={clusterId || ""}
                                        installId={installed.id}
                                    />
                                </TabsContent>
                            </>
                        )}
                    </Tabs>
                </div>

                <div className="flex flex-col gap-6">
                    {!installed ? (
                        <Card className="border-primary/20 shadow-lg shadow-primary/5">
                            <CardHeader>
                                <CardTitle className="text-base">Installation</CardTitle>
                                <CardDescription>Install {addon.display_name} on your cluster</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Latest Version</span>
                                    <Badge variant="secondary" className="font-mono">v{addon.version}</Badge>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Compat (K8s)</span>
                                    <span className="font-medium text-xs">≥ {addon.k8s_compat_min}</span>
                                </div>

                                <Separator />

                                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/50">
                                    <div className="flex items-center gap-2 mb-2">
                                        <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                        <span className="text-sm font-semibold">Estimated Cost Impact</span>
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">+$12.50</span>
                                        <span className="text-xs text-muted-foreground uppercase">/ Month</span>
                                    </div>
                                </div>

                                <Button
                                    className="w-full py-6 text-base font-bold shadow-md shadow-primary/10 transition-all hover:scale-[1.02]"
                                    onClick={() => setWizardOpen(true)}
                                    disabled={!clusterId}
                                >
                                    {clusterId ? "Install Add-on" : "Select Cluster to Install"}
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Quick Actions</CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                <Button variant="outline" className="justify-start gap-3" onClick={() => setActiveTab("lifecycle")}>
                                    <Settings2 className="h-4 w-4" /> Configuration
                                </Button>
                                <Button variant="outline" className="justify-start gap-3" onClick={() => setActiveTab("audit")}>
                                    <History className="h-4 w-4" /> View History
                                </Button>
                                <Button variant="outline" className="justify-start gap-3 text-destructive hover:text-destructive" onClick={() => uninstall(installed.id)}>
                                    <Trash2 className="h-4 w-4" /> Uninstall
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Publisher Info</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">Maintainer</span>
                                <span className="text-sm font-medium">{addon.maintainer || "Kubilitics Community"}</span>
                            </div>
                            {addon.home_url && (
                                <a href={addon.home_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline text-[10px]">
                                    Project Homepage <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            <InstallWizard
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                addonId={addonId!}
                clusterId={clusterId!}
            />

            {installed && (
                <>
                    <UpgradeDialog
                        open={upgradeOpen}
                        onClose={() => setUpgradeOpen(false)}
                        install={installed}
                        onConfirm={handleUpgrade}
                    />
                    <RollbackDialog
                        open={rollbackOpen}
                        onClose={() => setRollbackOpen(false)}
                        install={installed}
                    />
                </>
            )}
        </div>
    );
}

function AddOnDetailSkeleton() {
    return (
        <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
            <Skeleton className="h-8 w-32" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 flex flex-col gap-8">
                    <Skeleton className="h-24 w-full" />
                    <Separator />
                    <Skeleton className="h-64 w-full" />
                </div>
                <Skeleton className="h-96 w-full" />
            </div>
        </div>
    );
}
