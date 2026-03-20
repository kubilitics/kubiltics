import { useNavigate } from "react-router-dom";
import { useInstalledAddons, useAddonCostAttribution } from "@/hooks/useAddOnCatalog";
import { useAddonMutations } from "@/hooks/useAddonInstall";
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow
} from "@/components/ui/table";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuTrigger, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, ArrowUpCircle, RotateCcw, Trash2, ExternalLink, Settings2, Activity, DollarSign } from "lucide-react";
import { AddOnStatusBadge } from "./AddOnStatusBadge";
import { TierBadge } from "./TierBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { DeleteConfirmDialog } from "@/components/resources";
import { UpgradeDialog } from "./UpgradeDialog";
import { RollbackDialog } from "./RollbackDialog";
import type { AddOnInstallWithHealth } from "@/types/api/addons";

/**
 * Helper component to render cost for a specific addon install.
 * T8.09b: Fetches and displays real-time cost attribution.
 */
function CostCell({ clusterId, installId }: { clusterId: string, installId: string }) {
    const { data: cost, isLoading } = useAddonCostAttribution(clusterId, installId);

    if (isLoading) return <Skeleton className="h-4 w-16" />;
    if (!cost) return <span className="text-muted-foreground opacity-30">—</span>;

    return (
        <div className="flex flex-col items-end">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                ${cost.monthly_cost_usd.toFixed(2)}
            </span>
            <span className="text-[9px] text-muted-foreground uppercase font-medium tracking-tight">Est. Monthly</span>
        </div>
    );
}

/**
 * T5.17: InstalledAddOnsList component
 * Displays a table of installed add-ons with quick actions and status tracking.
 */
export function InstalledAddOnsList({ clusterId }: { clusterId: string }) {
    const navigate = useNavigate();
    const { data: installed, isLoading, error } = useInstalledAddons(clusterId);
    const { upgrade, uninstall } = useAddonMutations(clusterId);

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [rollbackOpen, setRollbackOpen] = useState(false);
    const [selectedAddon, setSelectedAddon] = useState<AddOnInstallWithHealth | null>(null);

    if (isLoading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-16 w-full" />
                ))}
            </div>
        );
    }

    if (error || !installed || installed.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg bg-muted/20 text-center p-6">
                <Activity className="h-10 w-10 text-muted-foreground mb-4 opacity-20" />
                <h3 className="text-lg font-semibold">No add-ons installed</h3>
                <p className="text-muted-foreground max-w-xs mx-auto">
                    Choose an add-on from the catalog to get started.
                </p>
            </div>
        );
    }

    const handleDelete = (addon: AddOnInstallWithHealth) => {
        setSelectedAddon(addon);
        setDeleteOpen(true);
    };

    const handleUpgrade = (addon: AddOnInstallWithHealth) => {
        setSelectedAddon(addon);
        setUpgradeOpen(true);
    };

    const handleRollback = (addon: AddOnInstallWithHealth) => {
        setSelectedAddon(addon);
        setRollbackOpen(true);
    };

    const confirmDelete = async () => {
        if (selectedAddon) {
            await uninstall(selectedAddon.id);
            setDeleteOpen(false);
        }
    };

    const confirmUpgrade = async (version: string) => {
        if (selectedAddon) {
            await upgrade(selectedAddon.id, version);
            setUpgradeOpen(false);
        }
    };

    return (
        <>
            <div className="border rounded-xl bg-background overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-[280px]">Add-on</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Namespace</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead className="text-right">Monthly Cost</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {installed.map((item) => (
                            <TableRow
                                key={item.id}
                                className="group cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => navigate(`/addons/${encodeURIComponent(item.addon_id)}`)}
                            >
                                <TableCell className="font-medium">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center p-1.5 border">
                                            {item.catalog_entry?.icon_url ? (
                                                <img src={item.catalog_entry.icon_url} alt="" className="w-full h-full object-contain" />
                                            ) : (
                                                <Activity className="h-4 w-4 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-sm tracking-tight">{item.catalog_entry?.display_name || item.addon_id}</span>
                                            {item.catalog_entry && <TierBadge tier={item.catalog_entry.tier} size="sm" />}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <AddOnStatusBadge status={item.status} />
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="font-mono text-[10px] bg-muted/20">{item.namespace}</Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">v{item.installed_version}</span>
                                        {item.catalog_entry && item.catalog_entry.version !== item.installed_version && (
                                            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5">
                                                <ArrowUpCircle className="h-3 w-3" /> Update Available
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <CostCell clusterId={clusterId} installId={item.id} />
                                </TableCell>
                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                            <DropdownMenuItem onClick={() => navigate(`/addons/${encodeURIComponent(item.addon_id)}`)}>
                                                <ExternalLink className="h-4 w-4 mr-2" /> View Details
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => navigate(`/addons/${encodeURIComponent(item.addon_id)}?tab=lifecycle`)}>
                                                <Settings2 className="h-4 w-4 mr-2" /> Configuration
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-emerald-600 focus:text-emerald-600"
                                                onClick={() => handleUpgrade(item)}
                                            >
                                                <ArrowUpCircle className="h-4 w-4 mr-2" /> Upgrade
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleRollback(item)}>
                                                <RotateCcw className="h-4 w-4 mr-2" /> Rollback
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => handleDelete(item)}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" /> Uninstall
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <DeleteConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                resourceType="Add-on"
                resourceName={selectedAddon?.catalog_entry?.display_name ?? selectedAddon?.addon_id ?? "Add-on"}
                onConfirm={confirmDelete}
            />

            {selectedAddon && (
                <>
                    <UpgradeDialog
                        open={upgradeOpen}
                        onClose={() => setUpgradeOpen(false)}
                        install={selectedAddon}
                        onConfirm={confirmUpgrade}
                    />
                    <RollbackDialog
                        open={rollbackOpen}
                        onClose={() => setRollbackOpen(false)}
                        install={selectedAddon}
                    />
                </>
            )}
        </>
    );
}
