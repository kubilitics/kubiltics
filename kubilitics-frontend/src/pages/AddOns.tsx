import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListPageHeader } from "@/components/list";
import { Package, CheckCircle, Sparkles, Puzzle, GitMerge, Database } from "lucide-react";
import { CatalogBrowser } from "@/components/addons/CatalogBrowser";
import { InstalledAddOnsList } from "@/components/addons/InstalledAddOnsList";
import { FinancialStackPrompt } from "@/components/addons/FinancialStackPrompt";
import { ProfilesTab } from "@/components/addons/ProfilesTab";
import { DependencyGraph } from "@/components/addons/DependencyGraph";
// @ts-ignore - The module exists and builds cleanly; this clears a stale IDE language server error.
import { RegistriesTab } from "@/components/addons/RegistriesTab";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { useCatalog } from "@/hooks/useAddOnCatalog";

export default function AddOns() {
    const [activeTab, setActiveTab] = useState("catalog");
    const clusterId = useActiveClusterId();
    const { data: catalogPage, refetch: refetchCatalog } = useCatalog(1, 24);

    return (
        <div className="flex flex-col gap-8 pb-10">
            <ListPageHeader
                title="Add-ons Platform"
                subtitle="Helm packages from Artifact Hub"
                icon={<Puzzle className="h-8 w-8 text-primary shadow-apple rounded-xl" />}
                resourceCount={catalogPage?.total ?? 0}
                onRefresh={() => refetchCatalog()}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-10 animate-fade-in mt-2">
                <div className="flex items-center justify-between border-b-2 border-slate-100 pb-4">
                    <TabsList className="bg-slate-100/80 p-1.5 rounded-2xl h-14 border border-slate-300/60 shadow-inner flex gap-1 items-center overflow-x-auto no-scrollbar max-w-full">
                        <TabsTrigger
                            value="catalog"
                            className="px-8 h-11 flex gap-3 items-center rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-xl data-[state=active]:shadow-primary/25 transition-all duration-300 active:scale-95 shrink-0"
                        >
                            <Sparkles className="h-4 w-4" />
                            Catalog
                        </TabsTrigger>
                        <TabsTrigger
                            value="installed"
                            className="px-8 h-11 flex gap-3 items-center rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-xl data-[state=active]:shadow-primary/25 transition-all duration-300 active:scale-95 shrink-0"
                        >
                            <CheckCircle className="h-4 w-4" />
                            Installed
                        </TabsTrigger>
                        <TabsTrigger
                            value="profiles"
                            className="px-8 h-11 flex gap-3 items-center rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-xl data-[state=active]:shadow-primary/25 transition-all duration-300 active:scale-95 shrink-0"
                        >
                            <Package className="h-4 w-4" />
                            Profiles
                        </TabsTrigger>
                        <TabsTrigger
                            value="registries"
                            className="px-8 h-11 flex gap-3 items-center rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-xl data-[state=active]:shadow-primary/25 transition-all duration-300 active:scale-95 shrink-0"
                        >
                            <Database className="h-4 w-4" />
                            Registries
                        </TabsTrigger>
                        <TabsTrigger
                            value="graph"
                            className="px-8 h-11 flex gap-3 items-center rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-xl data-[state=active]:shadow-primary/25 transition-all duration-300 active:scale-95 shrink-0"
                        >
                            <GitMerge className="h-4 w-4" />
                            Graph
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="catalog" className="mt-0 outline-none">
                    <CatalogBrowser />
                </TabsContent>

                <TabsContent value="installed" className="mt-0 outline-none">
                    <div className="space-y-6">
                        <FinancialStackPrompt />
                        {clusterId ? (
                            <InstalledAddOnsList clusterId={clusterId} />
                        ) : (
                            <div className="flex flex-col items-center justify-center py-32 glass-card bg-slate-50/20 border-slate-100 shadow-sm border-dashed">
                                <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-6 ring-8 ring-slate-50/50">
                                    <Puzzle className="h-8 w-8 text-slate-400 opacity-40 shrink-0" />
                                </div>
                                <h3 className="apple-title text-xl">No cluster selected</h3>
                                <p className="apple-description mt-2 max-w-sm text-center">
                                    Please select a cluster to view its installed add-ons.
                                </p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="profiles" className="mt-0 outline-none">
                    <ProfilesTab />
                </TabsContent>

                <TabsContent value="registries" className="mt-0 outline-none">
                    <RegistriesTab />
                </TabsContent>

                <TabsContent value="graph" className="mt-0 outline-none">
                    <DependencyGraph />
                </TabsContent>
            </Tabs>
        </div>
    );
}
