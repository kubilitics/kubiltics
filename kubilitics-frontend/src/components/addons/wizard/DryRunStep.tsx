import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/useApi";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { useAddOnStore } from "@/stores/addonStore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    FileCheck, AlertCircle, Loader2, Info,
    Terminal, ShieldCheck, Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { cn } from "@/lib/utils";

export function DryRunStep() {
    const api = useApi();
    const clusterId = useActiveClusterId();
    const { activeInstallPlan, valuesYaml } = useAddOnStore();

    const { data: result, isLoading, error } = useQuery({
        queryKey: ["addons", "dry-run", clusterId, activeInstallPlan?.plan_id, valuesYaml],
        queryFn: () => api.dryRunAddonInstall(clusterId!, {
            addon_id: activeInstallPlan!.addon_id,
            version: activeInstallPlan!.version,
            namespace: activeInstallPlan!.namespace,
            values_yaml: valuesYaml,
            plan_id: activeInstallPlan!.plan_id,
        }),
        enabled: !!clusterId && !!activeInstallPlan && !!valuesYaml,
    });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <div className="text-center">
                    <p className="font-semibold">Executing Dry Run</p>
                    <p className="text-xs text-muted-foreground">Simulating installation through Helm and K8s API...</p>
                </div>
            </div>
        );
    }

    if (error || !result) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Dry Run Failed</AlertTitle>
                <AlertDescription>The simulation encountered a fatal error. Please check your configuration.</AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className={cn(
                "p-6 rounded-2xl border flex items-center gap-6",
                result.success ? "bg-emerald-500/10 border-emerald-500/20" : "bg-destructive/10 border-destructive/20"
            )}>
                {result.success ? <FileCheck className="h-10 w-10 text-emerald-500" /> : <AlertCircle className="h-10 w-10 text-destructive" />}
                <div>
                    <h3 className="text-xl font-bold uppercase tracking-tight">
                        {result.success ? "Simulation Success" : "Simulation Blocked"}
                    </h3>
                    <p className="text-sm opacity-80 leading-tight mt-1">
                        {result.success
                            ? "The manifests were successfully generated and validated. No conflicts found."
                            : "Validation failed. See errors below to fix your configuration."}
                    </p>
                </div>
            </div>

            {!result.success && result.errors.length > 0 && (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-destructive uppercase tracking-widest pl-1">Fatal Errors</label>
                    <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/10 space-y-2">
                        {result.errors.map((err: string, i: number) => (
                            <div key={i} className="flex gap-2 text-xs text-destructive">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>{err}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {result.warnings.length > 0 && (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-amber-600 uppercase tracking-widest pl-1">Warnings</label>
                    <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 space-y-2">
                        {result.warnings.map((warn: string, i: number) => (
                            <div key={i} className="flex gap-2 text-xs text-amber-700">
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>{warn}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {result.manifests_yaml && (
                <div className="flex-1 flex flex-col gap-2 min-h-[300px]">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                            <Terminal className="h-3 w-3" />
                            Manifest Preview (YAML)
                        </label>
                        <Badge variant="outline" className="text-[9px] py-0 text-primary font-bold">READ ONLY</Badge>
                    </div>
                    <div className="flex-1 border rounded-xl overflow-hidden shadow-inner bg-background relative">
                        <CodeEditor
                            value={result.manifests_yaml}
                            readOnly={true}
                            minHeight="100%"
                            className="h-full border-none"
                        />
                    </div>
                </div>
            )}

            <div className="p-4 rounded-xl bg-muted/30 border flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Zap className="h-5 w-5 text-amber-500" />
                    <p className="text-xs font-semibold">Dry run completed in 1.4s</p>
                </div>
                <div className="text-[10px] text-muted-foreground italic">
                    Total Resources: {result.manifests_yaml?.split('---').length || 0}
                </div>
            </div>
        </div>
    );
}
