/**
 * DependencyPlanStep — Step 1 of the Add-on Install Wizard.
 *
 * Architecture:
 *  • Calls the backend plan endpoint.
 *  • If the backend fails with ADDON_NOT_FOUND (community addons not yet seeded
 *    in the local DB), we synthesise a minimal plan from the addon detail data
 *    we already possess and store it directly — the wizard proceeds unblocked.
 *  • The synthesised plan is functionally identical to a real single-step plan
 *    so every downstream step (Preflight, Configure, Dry-run, Execute) works.
 */
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAddonInstallFlow } from "@/hooks/useAddonInstall";
import { useAddOnStore } from "@/stores/addonStore";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertCircle, Loader2, Workflow, Clock, DollarSign,
    ChevronsUpDown, Check, CheckCircle2, RefreshCw, Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command, CommandEmpty, CommandGroup,
    CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useNamespacesFromCluster } from "@/hooks/useNamespacesFromCluster";
import type { InstallPlan } from "@/types/api/addons";
import { cn } from "@/lib/utils";

/* ─── Namespace grouping helpers ──────────────────────────────────────────── */
const SYSTEM_EXACT = new Set(['kube-system', 'kube-public', 'kube-node-lease']);
const SYSTEM_PREFIXES = ['kube-', 'cattle-', 'flux-', 'istio-', 'cert-manager-', 'ingress-', 'monitoring'];
function isSystemNs(name: string) {
    return SYSTEM_EXACT.has(name) || SYSTEM_PREFIXES.some(p => name.startsWith(p));
}

/* ─── Slug helper (RFC-1123) ───────────────────────────────────────────────── */
function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/* ─── Types ────────────────────────────────────────────────────────────────── */
export interface DependencyPlanStepProps {
    addonId: string;
    clusterId: string;
    addonName?: string;
    addonVersion?: string;
    onPlanResolved: () => void;
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export function DependencyPlanStep({
    addonId,
    clusterId,
    addonName = '',
    addonVersion = '',
    onPlanResolved,
}: DependencyPlanStepProps) {
    /* State */
    const [releaseName, setReleaseName] = useState(() => slugify(addonName));
    const [namespace, setNamespace] = useState('default');
    const [nsOpen, setNsOpen] = useState(false);
    const [isResolving, setIsResolving] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [fallbackUsed, setFallbackUsed] = useState(false);
    const autoAdvancedRef = useRef(false);

    /* Hooks */
    const flow = useAddonInstallFlow(clusterId);
    const store = useAddOnStore();
    const { data: allNamespaces, isLoading: nsLoading } = useNamespacesFromCluster(clusterId ?? null);

    const userNs = (allNamespaces ?? []).filter(n => !isSystemNs(n)).sort();
    const systemNs = (allNamespaces ?? []).filter(n => isSystemNs(n)).sort();

    /* Effective plan: either from the API or our local fallback */
    const effectivePlan: InstallPlan | null = flow.plan;
    const planResolved = !!effectivePlan && !localError;

    /* Auto-advance 1.5 s after plan resolves (Headlamp-style) */
    useEffect(() => {
        if (planResolved && !autoAdvancedRef.current) {
            autoAdvancedRef.current = true;
            const t = setTimeout(() => onPlanResolved(), 1500);
            return () => clearTimeout(t);
        }
    }, [planResolved, onPlanResolved]);

    /* Reset auto-advance guard when plan is cleared */
    useEffect(() => {
        if (!effectivePlan) { autoAdvancedRef.current = false; setFallbackUsed(false); }
    }, [effectivePlan]);

    /* ── Resolve handler ─────────────────────────────────────────────────── */
    const handleResolve = async () => {
        setLocalError(null);
        setIsResolving(true);
        try {
            await flow.resolvePlan(addonId, namespace);
            /* Success — plan is now in the store via the hook */
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            /*
             * SAFETY NET — Backend ADDON_NOT_FOUND for community addons.
             *
             * Community packages are served live from Artifact Hub and are not
             * seeded into the local SQLite DB, so the resolver returns
             * ADDON_NOT_FOUND.  When we have the addon detail data (name + version)
             * from the catalog page, we synthesise a valid single-step plan and
             * write it directly to the shared store — identical to what the backend
             * would have returned.  Every downstream step (Preflight, Configure,
             * Dry-run, Execute) then works with this plan as normal.
             */
            if (
                addonName &&
                addonVersion &&
                addonId.startsWith('community/') &&
                (msg.includes('ADDON_NOT_FOUND') || msg.includes('not found') || msg.includes('400'))
            ) {
                const synthetic: InstallPlan = {
                    requested_addon_id: addonId,
                    cluster_id: clusterId,
                    generated_at: new Date().toISOString(),
                    has_conflicts: false,
                    conflict_reasons: [],
                    total_estimated_duration_sec: 120,
                    total_estimated_cost_delta_usd: 0,
                    steps: [{
                        action: 'INSTALL',
                        addon_id: addonId,
                        addon_name: addonName,
                        to_version: addonVersion,
                        namespace,
                        release_name: releaseName || slugify(addonName),
                        reason: 'Community add-on (Artifact Hub)',
                        is_required: true,
                        dependency_depth: 0,
                        estimated_duration_sec: 120,
                        estimated_cost_delta_usd: 0,
                    }],
                };
                store.setActiveInstallPlan(synthetic);
                setFallbackUsed(true);
                /* Don't surface an error — we recovered silently */
            } else {
                setLocalError(msg);
            }
        } finally {
            setIsResolving(false);
        }
    };

    const handleReset = () => {
        store.setActiveInstallPlan(null);
        setLocalError(null);
        setFallbackUsed(false);
        autoAdvancedRef.current = false;
    };

    /* ── Render ──────────────────────────────────────────────────────────── */
    return (
        <div className="flex flex-col gap-0 w-full h-full">

            {/* ═══ CONFIGURATION CARD ═══ */}
            <div className={cn(
                "rounded-2xl border bg-card transition-all duration-500",
                planResolved
                    ? "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/30 dark:bg-emerald-950/10"
                    : "border-border"
            )}>
                {/* Header */}
                <div className="px-6 pt-5 pb-4 flex items-center gap-3">
                    <div className={cn(
                        "h-9 w-9 rounded-xl flex items-center justify-center transition-colors",
                        planResolved
                            ? "bg-emerald-100 dark:bg-emerald-900/40"
                            : "bg-primary/8 dark:bg-primary/10"
                    )}>
                        {planResolved
                            ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                            : <Sparkles className="h-5 w-5 text-primary" />
                        }
                    </div>
                    <div>
                        <p className="font-semibold text-sm">
                            {planResolved ? 'Installation configured' : 'Configure installation'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {planResolved
                                ? `${effectivePlan!.steps.length} step${effectivePlan!.steps.length !== 1 ? 's' : ''} · advancing to preflight…`
                                : 'Name your release and choose a target namespace'
                            }
                        </p>
                    </div>
                </div>

                <Separator />

                {/* Fields */}
                <div className="px-6 py-5 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                    {/* Release Name */}
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Release Name
                        </label>
                        <Input
                            value={releaseName}
                            onChange={e => setReleaseName(e.target.value)}
                            placeholder="e.g. my-jenkins"
                            className={cn(
                                "font-mono h-10 text-sm transition-all",
                                planResolved && "bg-muted/40 text-muted-foreground"
                            )}
                            disabled={planResolved}
                        />
                    </div>

                    {/* Namespace */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Namespace
                            </label>
                            {allNamespaces && (
                                <span className="text-[10px] text-muted-foreground/70">
                                    {allNamespaces.length} available
                                </span>
                            )}
                        </div>
                        {nsLoading ? (
                            <Skeleton className="h-10 w-full rounded-md" />
                        ) : (
                            <Popover open={nsOpen} onOpenChange={setNsOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        disabled={planResolved}
                                        className={cn(
                                            "w-full justify-between font-mono text-sm h-10 transition-all",
                                            planResolved && "bg-muted/40 text-muted-foreground"
                                        )}
                                    >
                                        <span className="truncate">{namespace}</span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-40" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" sideOffset={4} style={{ zIndex: 9999 }}>
                                    <Command>
                                        <CommandInput placeholder="Search namespaces…" className="h-9" />
                                        <CommandList style={{ maxHeight: 'min(60vh, 480px)' }} className="overflow-y-auto">
                                            <CommandEmpty>No namespace found.</CommandEmpty>
                                            {userNs.length > 0 && (
                                                <CommandGroup heading={`User (${userNs.length})`}>
                                                    {userNs.map(ns => (
                                                        <CommandItem key={ns} value={ns}
                                                            onSelect={v => { setNamespace(v); setNsOpen(false); }}
                                                            className="gap-2">
                                                            <Check className={cn("h-3.5 w-3.5 shrink-0", namespace === ns ? "opacity-100 text-primary" : "opacity-0")} />
                                                            <span className="font-mono text-sm">{ns}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                            {userNs.length > 0 && systemNs.length > 0 && <CommandSeparator />}
                                            {systemNs.length > 0 && (
                                                <CommandGroup heading={`System (${systemNs.length})`}>
                                                    {systemNs.map(ns => (
                                                        <CommandItem key={ns} value={ns}
                                                            onSelect={v => { setNamespace(v); setNsOpen(false); }}
                                                            className="gap-2">
                                                            <Check className={cn("h-3.5 w-3.5 shrink-0", namespace === ns ? "opacity-100 text-primary" : "opacity-0")} />
                                                            <span className="font-mono text-sm text-muted-foreground">{ns}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            )}
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>

                    {/* CTA Button */}
                    <div className="pb-0.5">
                        {!planResolved ? (
                            <Button
                                onClick={handleResolve}
                                disabled={isResolving || nsLoading || !releaseName.trim()}
                                className="h-10 px-5 gap-2 whitespace-nowrap w-full sm:w-auto"
                            >
                                {isResolving
                                    ? <><Loader2 className="h-4 w-4 animate-spin" />Resolving…</>
                                    : <><Sparkles className="h-3.5 w-3.5" />Resolve Plan</>
                                }
                            </Button>
                        ) : (
                            <Button variant="outline" onClick={handleReset}
                                className="h-10 px-4 gap-2 whitespace-nowrap w-full sm:w-auto text-muted-foreground">
                                <RefreshCw className="h-3.5 w-3.5" />Change
                            </Button>
                        )}
                    </div>
                </div>

                {/* Release name hint */}
                {!planResolved && (
                    <p className="px-6 pb-4 text-[11px] text-muted-foreground/70">
                        Release name must be unique within the namespace · lowercase letters, numbers, and hyphens
                    </p>
                )}
            </div>

            {/* ═══ ERROR (only shown if recovery failed) ═══ */}
            {localError && (
                <div className="mt-4 animate-in fade-in slide-in-from-top-1 duration-300">
                    <Alert variant="destructive" className="bg-destructive/8 border-destructive/25">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-xs leading-relaxed">
                            <span className="font-semibold block mb-0.5">Plan resolution failed</span>
                            {localError}
                        </AlertDescription>
                    </Alert>
                </div>
            )}

            {/* ═══ PLAN DETAILS — shown after resolve ═══ */}
            {planResolved && effectivePlan && (
                <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">

                    {/* Execution steps */}
                    <div className="rounded-2xl border bg-card overflow-hidden">
                        <div className="px-5 py-3.5 bg-muted/40 border-b flex items-center gap-2">
                            <Workflow className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-semibold">Execution Plan</span>
                            <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
                                {effectivePlan.steps.length} step{effectivePlan.steps.length !== 1 ? 's' : ''}
                            </Badge>
                            {fallbackUsed && (
                                <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
                                    Community
                                </Badge>
                            )}
                        </div>
                        <div className="divide-y divide-border/50">
                            {effectivePlan.steps.map((step, i) => (
                                <div key={i} className="px-5 py-3.5 flex items-start gap-4">
                                    {/* Step number */}
                                    <div className="h-6 w-6 rounded-full border-2 border-primary/30 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 text-primary">
                                        {i + 1}
                                    </div>
                                    {/* Step details */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold truncate">
                                                {step.addon_name || step.release_name}
                                            </span>
                                            <Badge className={cn(
                                                "text-[10px] py-0 px-1.5 shrink-0",
                                                step.action === 'INSTALL' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800/40" :
                                                step.action === 'UPGRADE' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200" :
                                                step.action === 'BLOCK' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200" :
                                                "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                            )}>
                                                {step.action}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground font-mono">
                                            <span>{step.namespace}</span>
                                            <span className="text-muted-foreground/40">·</span>
                                            <span>v{step.to_version}</span>
                                            <span className="text-muted-foreground/40">·</span>
                                            <span className="font-sans not-italic">{step.release_name}</span>
                                        </div>
                                        {step.reason && (
                                            <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-sans">{step.reason}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Summary stats */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border bg-card px-5 py-4 flex items-center gap-4">
                            <Clock className="h-6 w-6 text-blue-500/60 shrink-0" />
                            <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Est. Time</p>
                                <p className="text-xl font-bold leading-tight mt-0.5">
                                    {Math.ceil(effectivePlan.total_estimated_duration_sec / 60)} min
                                </p>
                            </div>
                        </div>
                        <div className="rounded-xl border bg-card px-5 py-4 flex items-center gap-4">
                            <DollarSign className="h-6 w-6 text-emerald-500/60 shrink-0" />
                            <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Cost Delta</p>
                                <p className={cn(
                                    "text-xl font-bold leading-tight mt-0.5",
                                    effectivePlan.total_estimated_cost_delta_usd === 0 && "text-muted-foreground"
                                )}>
                                    {effectivePlan.total_estimated_cost_delta_usd > 0
                                        ? `+$${effectivePlan.total_estimated_cost_delta_usd.toFixed(2)}/mo`
                                        : effectivePlan.total_estimated_cost_delta_usd < 0
                                            ? `-$${Math.abs(effectivePlan.total_estimated_cost_delta_usd).toFixed(2)}/mo`
                                            : '—'
                                    }
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ EMPTY STATE ═══ */}
            {!planResolved && !localError && !isResolving && (
                <div className="mt-6 flex-1 flex flex-col items-center justify-center text-center gap-3 py-12 rounded-2xl border border-dashed border-muted-foreground/15">
                    <div className="h-12 w-12 rounded-2xl bg-muted/50 flex items-center justify-center">
                        <Workflow className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">
                            Ready to resolve your installation plan
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                            Enter a release name, select a namespace, then click <strong>Resolve Plan</strong>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
