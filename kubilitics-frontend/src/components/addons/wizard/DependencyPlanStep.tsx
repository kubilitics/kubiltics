import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAddonInstallFlow } from "@/hooks/useAddonInstall";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2, Workflow, Clock, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function DependencyPlanStep({ addonId, clusterId, onPlanResolved }: any) {
    const [namespace, setNamespace] = useState("default");
    const flow = useAddonInstallFlow(clusterId);

    const handleResolve = async () => {
        await flow.resolvePlan(addonId, namespace);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Target Namespace</label>
                <div className="flex gap-2">
                    <Input
                        value={namespace}
                        onChange={(e) => setNamespace(e.target.value)}
                        placeholder="e.g. kubilitics-monitoring"
                        className="font-mono"
                        disabled={!!flow.plan}
                    />
                    {!flow.plan && (
                        <Button onClick={handleResolve} disabled={flow.isLoading}>
                            {flow.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resolve Plan"}
                        </Button>
                    )}
                </div>
            </div>

            {flow.error && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Resolution Error</AlertTitle>
                    <AlertDescription>{flow.error}</AlertDescription>
                </Alert>
            )}

            {flow.plan && (
                <div className="animate-in fade-in slide-in-from-top-4 duration-500 space-y-6">
                    <div className="border rounded-xl bg-muted/30 overflow-hidden">
                        <div className="p-4 bg-muted/50 border-b font-semibold text-sm flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Workflow className="h-4 w-4 text-primary" />
                                Execution Plan
                            </div>
                        </div>
                        <div className="p-4 space-y-4">
                            {flow.plan.steps.map((step: any, i: number) => (
                                <div key={i} className="flex gap-3 items-start">
                                    <div className="h-5 w-5 rounded-full bg-background border flex items-center justify-center text-[10px] font-bold mt-0.5">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 justify-between">
                                            <span className="text-sm font-semibold">{step.name}</span>
                                            <Badge className={cn(
                                                "text-[10px] py-0",
                                                step.action === 'INSTALL' ? "bg-blue-100 text-blue-700" :
                                                    step.action === 'UPGRADE' ? "bg-emerald-100 text-emerald-700" :
                                                        "bg-slate-100 text-slate-700"
                                            )}>
                                                {step.action}
                                            </Badge>
                                        </div>
                                        {step.reason && <p className="text-xs text-muted-foreground mt-0.5">{step.reason}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 dark:bg-blue-900/10 dark:border-blue-800/50 flex items-center gap-4">
                            <Clock className="h-8 w-8 text-blue-500 opacity-50" />
                            <div>
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-widest">Est. Time</span>
                                <p className="text-xl font-bold">{Math.ceil(flow.plan.total_estimated_duration_sec / 60)} Minutes</p>
                            </div>
                        </div>
                        <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/50 flex items-center gap-4">
                            <DollarSign className="h-8 w-8 text-emerald-500 opacity-50" />
                            <div>
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-widest">Cost Delta</span>
                                <p className="text-xl font-bold">+$12.50 / mo</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
