import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAddonInstallFlow } from "@/hooks/useAddonInstall";
import { useCatalogEntry } from "@/hooks/useAddOnCatalog";
import { useAddOnStore } from "@/stores/addonStore";
import { DependencyPlanStep } from "./wizard/DependencyPlanStep";
import { PreflightStep } from "./wizard/PreflightStep";
import { ValuesEditorStep } from "./wizard/ValuesEditorStep";
import { DryRunStep } from "./wizard/DryRunStep";
import { ExecuteStep } from "./wizard/ExecuteStep";
import { ChevronLeft, ChevronRight, X, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface InstallWizardProps {
    open: boolean;
    onClose: () => void;
    addonId: string;
    clusterId: string;
}

export function InstallWizard({ open, onClose, addonId, clusterId }: InstallWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const { data: addon } = useCatalogEntry(addonId);
    const flow = useAddonInstallFlow(clusterId);
    const { yamlValidationError } = useAddOnStore();

    const steps = [
        { title: "Plan", description: "Resolve dependencies and prepare installation path" },
        { title: "Preflight", description: "Validate cluster compatibility and RBAC" },
        { title: "Configure", description: "Set installation values and parameters" },
        { title: "Dry Run", description: "Preview generated manifests and warnings" },
        { title: "Install", description: "Execute installation on cluster" },
    ];

    const handleNext = () => {
        if (currentStep < 5) setCurrentStep(currentStep + 1);
    };

    const handleBack = () => {
        if (currentStep > 1) setCurrentStep(currentStep - 1);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background border-primary/20">
                <div className="flex h-full">
                    {/* Sidebar Navigation */}
                    <div className="w-64 bg-muted/30 border-r p-6 hidden md:flex flex-col gap-8">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                                <Sparkles className="h-4 w-4 text-primary" />
                            </div>
                            <span className="font-bold text-sm tracking-tight capitalize">{addon?.display_name || 'Add-on'} Install</span>
                        </div>

                        <nav className="flex flex-col gap-1">
                            {steps.map((step, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex items-center gap-3 p-2 rounded-lg transition-colors",
                                        currentStep === i + 1 ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"
                                    )}
                                >
                                    <div className={cn(
                                        "h-6 w-6 rounded-full border-2 flex items-center justify-center text-[10px]",
                                        currentStep === i + 1 ? "border-primary bg-primary text-primary-foreground" :
                                            currentStep > i + 1 ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30"
                                    )}>
                                        {currentStep > i + 1 ? "✓" : i + 1}
                                    </div>
                                    <span className="text-xs">{step.title}</span>
                                </div>
                            ))}
                        </nav>

                        <div className="mt-auto p-4 rounded-xl bg-muted/50 border border-muted-foreground/10">
                            <div className="flex items-center gap-2 text-primary mb-1">
                                <AlertCircle className="h-3 w-3" />
                                <span className="text-[10px] uppercase font-bold tracking-widest">Enterprise Safe</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-tight">
                                Kubilitics ensures all add-on installs are pre-validated and reversible.
                            </p>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 flex flex-col">
                        <DialogHeader className="p-6 pb-0 border-b md:border-none">
                            <div className="flex justify-between items-start">
                                <div>
                                    <DialogTitle className="text-xl font-bold">{steps[currentStep - 1].title}</DialogTitle>
                                    <DialogDescription className="text-xs mt-1">
                                        {steps[currentStep - 1].description}
                                    </DialogDescription>
                                </div>
                                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 -mt-2 -mr-2">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            <Progress value={(currentStep / 5) * 100} className="h-1 mt-6" />
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">
                            {currentStep === 1 && (
                                <DependencyPlanStep
                                    addonId={addonId}
                                    clusterId={clusterId}
                                    onPlanResolved={handleNext}
                                />
                            )}
                            {currentStep === 2 && <PreflightStep planId={flow.plan?.plan_id || ""} />}
                            {currentStep === 3 && <ValuesEditorStep addonId={addonId} />}
                            {currentStep === 4 && <DryRunStep />}
                            {currentStep === 5 && <ExecuteStep />}
                        </div>

                        <div className="p-4 border-t bg-muted/20 flex justify-between items-center px-6">
                            <Button
                                variant="outline"
                                onClick={handleBack}
                                disabled={currentStep === 1 || currentStep === 5}
                                className="gap-2"
                            >
                                <ChevronLeft className="h-4 w-4" /> Back
                            </Button>

                            <div className="flex gap-3">
                                <Button variant="ghost" onClick={onClose} disabled={currentStep === 5}>
                                    Cancel
                                </Button>
                                {currentStep < 5 && (
                                    <Button
                                        onClick={handleNext}
                                        className="gap-2 px-6"
                                        disabled={
                                            (currentStep === 1 && !flow.plan) ||
                                            (currentStep === 3 && !!yamlValidationError)
                                        }
                                    >
                                        Next <ChevronRight className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
