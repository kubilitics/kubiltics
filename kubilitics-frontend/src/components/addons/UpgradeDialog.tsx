import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, ArrowUpCircle, AlertCircle, Loader2, FileText, ChevronDown, ChevronUp, ShieldCheck, Zap, CheckCircle2 } from 'lucide-react';
import type { AddOnInstallWithHealth } from '@/types/api/addons';
import { cn } from '@/lib/utils';

interface UpgradeDialogProps {
    open: boolean;
    onClose: () => void;
    install: AddOnInstallWithHealth;
    onConfirm: (version: string) => Promise<void>;
}

// UpgradePhaseRow renders a single step in the in-progress upgrade phase list.
interface UpgradePhaseRowProps {
    icon: React.ReactNode;
    label: string;
    description: string;
    active?: boolean;
}
function UpgradePhaseRow({ icon, label, description, active = false }: UpgradePhaseRowProps) {
    return (
        <li className={cn(
            "flex items-start gap-3 p-2.5 rounded-lg transition-colors",
            active ? "bg-emerald-50/70 dark:bg-emerald-900/10" : "opacity-50"
        )}>
            <div className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
            )}>
                {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
            </div>
            <div className="space-y-0.5">
                <p className={cn("text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{label}</p>
                <p className="text-[11px] text-muted-foreground">{description}</p>
            </div>
        </li>
    );
}

// UpgradeProgressPhases shows descriptive phase indicators while the upgrade is in flight.
// The backend sequentially: (1) creates a Velero backup if installed, (2) runs helm upgrade.
// Since there is no streaming for upgrades, all phases are shown as pending — the spinner
// on the first active phase indicates that the operation is in progress.
function UpgradeProgressPhases() {
    return (
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-900/10 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-200/50 dark:border-emerald-800/30">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Upgrade in progress</span>
            </div>
            <ul className="px-2 py-2 space-y-1">
                <UpgradePhaseRow
                    icon={<ShieldCheck className="h-3.5 w-3.5" />}
                    label="Creating backup checkpoint"
                    description="Velero namespace backup (skipped if Velero is not installed)"
                    active
                />
                <UpgradePhaseRow
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Running Helm upgrade"
                    description="Atomic upgrade with auto-rollback on failure"
                />
                <UpgradePhaseRow
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Verifying rollout health"
                    description="Waiting for all pods to reach Running state"
                />
            </ul>
        </div>
    );
}

/**
 * T5.20 / T8.13: UpgradeDialog component
 * Allows selecting a version and reviewing the upgrade plan.
 * Includes a collapsible Changelog section (T8.13) with release notes when available.
 */
export function UpgradeDialog({ open, onClose, install, onConfirm }: UpgradeDialogProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [changelogExpanded, setChangelogExpanded] = useState(false);
    const nextVersion = install.policy?.next_available_version || install.catalog_entry?.version;
    const hasUpgrade = nextVersion && nextVersion !== install.installed_version;

    // T8.13: changelog may be on catalog_entry (AddOnDetail shape) — cast safely.
    const detail = install.catalog_entry as (typeof install.catalog_entry & {
        changelog?: string;
        release_notes?: string;
    }) | undefined;
    const changelog = detail?.changelog || detail?.release_notes;

    const handleConfirm = async () => {
        if (!nextVersion) return;
        setIsSubmitting(true);
        try {
            await onConfirm(nextVersion);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowUpCircle className="h-5 w-5 text-emerald-500" />
                        Upgrade Add-on
                    </DialogTitle>
                    <DialogDescription>
                        Update {install.catalog_entry?.display_name || install.addon_id} to a newer version.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {/* Version transition banner */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Current</span>
                            <Badge variant="secondary" className="font-mono">v{install.installed_version}</Badge>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <div className="flex flex-col gap-1 items-end">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Target</span>
                            <Badge className="font-mono bg-emerald-500 hover:bg-emerald-600">v{nextVersion}</Badge>
                        </div>
                    </div>

                    {!hasUpgrade && (
                        <div className="flex gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 text-xs border border-blue-100 dark:border-blue-800/50">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>You are already on the latest version available in the catalog.</span>
                        </div>
                    )}

                    {/* T8.13: Changelog / Release Notes */}
                    {changelog ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                            <button
                                type="button"
                                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-100/70 transition-colors"
                                onClick={() => setChangelogExpanded((v) => !v)}
                            >
                                <div className="flex items-center gap-2">
                                    <FileText className="h-3.5 w-3.5 text-indigo-500" />
                                    Release Notes — v{nextVersion}
                                </div>
                                {changelogExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-slate-400" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-slate-400" />
                                )}
                            </button>
                            {changelogExpanded && (
                                <ScrollArea className="max-h-48 px-4 pb-4">
                                    <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">
                                        {changelog}
                                    </pre>
                                </ScrollArea>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
                            <FileText className="h-3.5 w-3.5 opacity-40" />
                            <span>No changelog available for this version.</span>
                        </div>
                    )}

                    {/* Upgrade phases — static list when idle, animated when submitting */}
                    {isSubmitting ? (
                        <UpgradeProgressPhases />
                    ) : (
                        <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider">What to expect</h4>
                            <ul className="text-xs space-y-2 text-muted-foreground">
                                <li className="flex gap-2">
                                    <span className="text-emerald-500 font-bold">•</span>
                                    <span>A Velero backup checkpoint is created before the upgrade if Velero is installed.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-emerald-500 font-bold">•</span>
                                    <span>Settings and values will be preserved.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-emerald-500 font-bold">•</span>
                                    <span>Resources will be updated via Helm upgrade (atomic, with auto-rollback on failure).</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-emerald-500 font-bold">•</span>
                                    <span>Minimal to zero downtime depending on add-on architecture.</span>
                                </li>
                            </ul>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!hasUpgrade || isSubmitting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                        {isSubmitting
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Upgrading…</>
                            : <><ArrowUpCircle className="h-4 w-4 mr-2" />Confirm Upgrade</>
                        }
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
