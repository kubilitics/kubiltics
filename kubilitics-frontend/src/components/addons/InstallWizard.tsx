import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAddonInstallFlow } from "@/hooks/useAddonInstall";
import { useCatalogEntry } from "@/hooks/useAddOnCatalog";
import { useAddOnStore } from "@/stores/addonStore";
import { DependencyPlanStep } from "./wizard/DependencyPlanStep";
import { PreflightStep } from "./wizard/PreflightStep";
import { ValuesEditorStep } from "./wizard/ValuesEditorStep";
import { DryRunStep } from "./wizard/DryRunStep";
import { ExecuteStep } from "./wizard/ExecuteStep";
import {
    ChevronLeft, ChevronRight, X, ShieldCheck,
    ClipboardList, Settings2, FlaskConical, Rocket, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface InstallWizardProps {
    open: boolean;
    onClose: () => void;
    addonId: string;
    clusterId: string;
}

const STEPS = [
    {
        id: 1, title: "Plan",
        description: "Name release, pick namespace, resolve dependencies",
        Icon: ClipboardList,
        color: "text-blue-500",
    },
    {
        id: 2, title: "Preflight",
        description: "Validate cluster compatibility & RBAC",
        Icon: ShieldCheck,
        color: "text-indigo-500",
    },
    {
        id: 3, title: "Configure",
        description: "Customise Helm values",
        Icon: Settings2,
        color: "text-violet-500",
    },
    {
        id: 4, title: "Dry Run",
        description: "Preview manifests, catch issues early",
        Icon: FlaskConical,
        color: "text-amber-500",
    },
    {
        id: 5, title: "Install",
        description: "Execute on cluster with live progress",
        Icon: Rocket,
        color: "text-emerald-500",
    },
];

export function InstallWizard({ open, onClose, addonId, clusterId }: InstallWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const { data: addon } = useCatalogEntry(addonId);
    const flow = useAddonInstallFlow(clusterId);
    const { yamlValidationError, activeDryRunResult, isInstalling, resetWizard } = useAddOnStore();

    // Reset fully when dialog opens fresh (clears valuesYaml, progress, plan, etc.)
    useEffect(() => {
        if (open) {
            setCurrentStep(1);
            resetWizard();
            flow.reset?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Stable callbacks — prevents re-render churn propagating to child effects
    // (DependencyPlanStep's auto-advance timer depends on onPlanResolved identity).
    const handleNext = useCallback(() => { setCurrentStep(s => s < 5 ? s + 1 : s); }, []);
    const handleBack = useCallback(() => { setCurrentStep(s => s > 1 ? s - 1 : s); }, []);

    // Installation is in progress — lock the dialog (prevent Escape, X button, Cancel)
    const installInFlight = currentStep === 5 && isInstalling;

    const step = STEPS[currentStep - 1];
    const pct = Math.round((currentStep / 5) * 100);

    // Gate: prevent advancing when prerequisites aren't met.
    // Step 1: Plan must be resolved.
    // Step 3: YAML must be valid.
    // Step 4: Dry run must have completed (result available in store) — prevents clicking
    //         "Confirm Install" while the simulation is still loading. Users can still
    //         proceed after a dry-run error (intentional — CRD-missing addons may install fine).
    const nextDisabled =
        (currentStep === 1 && !flow.plan) ||
        (currentStep === 3 && !!yamlValidationError) ||
        (currentStep === 4 && !activeDryRunResult);

    // The wizard is a multi-step form — NEVER close via overlay click, focus loss,
    // or Escape. In Tauri/WKWebView, async operations (API calls, sidecar IPC,
    // WebSocket) can trigger synthetic focus/pointer events that Radix Dialog
    // interprets as "interact outside", closing the dialog unexpectedly.
    // Users close the wizard ONLY via the explicit X button or Cancel button.
    const handleOpenChange = useCallback((o: boolean) => {
        // Block ALL implicit close attempts from Radix (Escape, overlay, focus loss).
        // Only explicit button clicks (handleClose) can dismiss the wizard.
        if (!o) return;
    }, []);

    // Explicit close: only via X button or Cancel button.
    const handleClose = useCallback(() => {
        if (installInFlight) return;
        onClose();
    }, [installInFlight, onClose]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                hideCloseButton
                // ALWAYS prevent Radix from closing the wizard via overlay/Escape/focus.
                // In Tauri/WKWebView, async operations (sidecar IPC, API calls, WebSocket)
                // can trigger synthetic focus/pointer events that Radix interprets as
                // "interact outside", closing the dialog unexpectedly mid-wizard.
                // The wizard is a multi-step form — it should only close via the
                // explicit X button or Cancel button (handleClose).
                onEscapeKeyDown={(e) => { if (!installInFlight) { handleClose(); } e.preventDefault(); }}
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onFocusOutside={(e) => e.preventDefault()}
                className="flex flex-col p-0 overflow-hidden bg-background rounded-2xl border-border/60"
                style={{
                    width: 'min(1320px, 96vw)',
                    maxWidth: 'min(1320px, 96vw)',
                    height: '92vh',
                    maxHeight: '92vh',
                }}
            >
                <div className="flex h-full min-h-0">

                    {/* ═══════════════════════════════ SIDEBAR ═══════════════════════════════ */}
                    <aside className="w-[280px] shrink-0 bg-muted/25 border-r border-border/60 hidden md:flex flex-col">

                        {/* Addon identity */}
                        <div className="px-6 pt-6 pb-5 border-b border-border/40">
                            <div className="flex items-start gap-3">
                                <div className="h-11 w-11 rounded-xl bg-background border border-border/60 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                    {addon?.icon_url
                                        ? <img src={addon.icon_url} alt="" className="w-full h-full object-contain p-1" />
                                        : <Workflow className="h-5 w-5 text-muted-foreground/50" />
                                    }
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm leading-tight truncate">
                                        {addon?.display_name ?? 'Add-on'}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        v{addon?.version ?? '—'}
                                    </p>
                                    {addon?.tier && (
                                        <span className={cn(
                                            "inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mt-1",
                                            addon.tier === 'CORE' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                                            addon.tier === 'COMMUNITY' ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" :
                                            "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                        )}>
                                            {addon.tier}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Step nav */}
                        <nav className="flex-1 px-3 py-4 space-y-0.5">
                            {STEPS.map(s => {
                                const done = currentStep > s.id;
                                const active = currentStep === s.id;
                                return (
                                    <div
                                        key={s.id}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-150",
                                            active ? "bg-background shadow-sm border border-border/50" : "hover:bg-muted/40"
                                        )}
                                    >
                                        {/* Step circle */}
                                        <div className={cn(
                                            "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all",
                                            done ? "bg-emerald-500 text-white" :
                                            active ? "bg-primary text-primary-foreground shadow-sm" :
                                            "bg-muted border border-border/50 text-muted-foreground"
                                        )}>
                                            {done ? <span className="text-sm">✓</span> : s.id}
                                        </div>
                                        {/* Label */}
                                        <div className="min-w-0">
                                            <p className={cn(
                                                "text-xs font-semibold leading-none",
                                                active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/70"
                                            )}>
                                                {s.title}
                                            </p>
                                            {active && (
                                                <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-tight line-clamp-2">
                                                    {s.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </nav>

                        {/* Footer trust badge */}
                        <div className="px-4 pb-5">
                            <div className="rounded-xl bg-muted/50 border border-border/40 px-4 py-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                                        Enterprise Safe
                                    </span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    All installs are pre-validated, dry-run tested, and reversible.
                                </p>
                            </div>
                        </div>
                    </aside>

                    {/* ═══════════════════════════════ MAIN PANEL ═════════════════════════════ */}
                    <div className="flex-1 flex flex-col min-w-0 min-h-0">

                        {/* Top bar */}
                        <header className="flex items-center justify-between px-7 py-4 border-b border-border/60 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "h-8 w-8 rounded-lg flex items-center justify-center",
                                    "bg-primary/8 dark:bg-primary/12"
                                )}>
                                    <step.Icon className={cn("h-4 w-4", step.color)} />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold leading-none">{step.title}</h2>
                                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {/* Progress pill */}
                                <div className="hidden sm:flex items-center gap-2">
                                    <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                                        <div
                                            className="h-full bg-primary rounded-full transition-all duration-500"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
                                        {currentStep} / 5
                                    </span>
                                </div>
                                {/* X button: disabled during install to prevent accidental close */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClose}
                                    disabled={installInFlight}
                                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </header>

                        {/* Step content */}
                        <div className="flex-1 overflow-y-auto px-7 py-6 min-h-0">
                            {currentStep === 1 && (
                                <DependencyPlanStep
                                    addonId={addonId}
                                    clusterId={clusterId}
                                    addonName={addon?.name ?? addon?.display_name ?? ''}
                                    addonVersion={addon?.version ?? ''}
                                    onPlanResolved={handleNext}
                                />
                            )}
                            {currentStep === 2 && <PreflightStep planId={(flow.plan as any)?.plan_id ?? ''} />}
                            {currentStep === 3 && <ValuesEditorStep addonId={addonId} />}
                            {currentStep === 4 && <DryRunStep />}
                            {currentStep === 5 && <ExecuteStep />}
                        </div>

                        {/* Bottom nav */}
                        <footer className="shrink-0 border-t border-border/60 px-7 py-4 bg-muted/10 flex justify-between items-center">
                            <Button
                                variant="ghost"
                                onClick={handleBack}
                                disabled={currentStep === 1 || currentStep === 5}
                                className="gap-1.5 text-muted-foreground"
                            >
                                <ChevronLeft className="h-4 w-4" /> Back
                            </Button>

                            <div className="flex items-center gap-2">
                                {currentStep < 5 && (
                                    <Button variant="ghost" onClick={handleClose}
                                        disabled={currentStep === 5}
                                        className="text-muted-foreground text-sm">
                                        Cancel
                                    </Button>
                                )}
                                {currentStep < 5 && (
                                    <Button
                                        onClick={handleNext}
                                        disabled={nextDisabled}
                                        className="gap-1.5 px-6 min-w-[110px]"
                                    >
                                        {currentStep === 4 ? 'Confirm Install' : 'Next'}
                                        {currentStep !== 4 && <ChevronRight className="h-4 w-4" />}
                                    </Button>
                                )}
                            </div>
                        </footer>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
