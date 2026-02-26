import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/useApi";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    CheckCircle2, AlertTriangle, XCircle, Info,
    Loader2, ShieldCheck, Gauge, AlertCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function PreflightStep({ planId }: { planId: string }) {
    const api = useApi();
    const clusterId = useActiveClusterId();

    const { data: report, isLoading, error } = useQuery({
        queryKey: ["addons", "preflight", clusterId, planId],
        queryFn: () => api.runAddonPreflight(clusterId!, planId),
        enabled: !!clusterId && !!planId,
    });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <div className="text-center">
                    <p className="font-semibold">Running Pre-flight Checks</p>
                    <p className="text-xs text-muted-foreground">Validating kube-api, CRDs, and RBAC permissions...</p>
                </div>
            </div>
        );
    }

    if (error || !report) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Pre-flight Execution Failed</AlertTitle>
                <AlertDescription>The backend could not complete the pre-flight analysis.</AlertDescription>
            </Alert>
        );
    }

    const statusIcons = {
        GO: <CheckCircle2 className="h-10 w-10 text-emerald-500" />,
        WARN: <AlertTriangle className="h-10 w-10 text-amber-500" />,
        BLOCK: <XCircle className="h-10 w-10 text-destructive" />,
    };

    const statusColors = {
        GO: "bg-emerald-500/10 border-emerald-500/20",
        WARN: "bg-amber-500/10 border-amber-500/20",
        BLOCK: "bg-destructive/10 border-destructive/20",
    };

    return (
        <div className="flex flex-col gap-6">
            <div className={cn("p-6 rounded-2xl border flex items-center gap-6", statusColors[report.status])}>
                {statusIcons[report.status]}
                <div>
                    <h3 className="text-xl font-bold uppercase tracking-tight">Status: {report.status === 'GO' ? 'Ready' : report.status === 'WARN' ? 'Warning' : 'Blocked'}</h3>
                    <p className="text-sm opacity-80 leading-tight mt-1">
                        {report.status === 'GO' ? "All cluster requirements are met. You can safely proceed." :
                            report.status === 'WARN' ? "Minor issues detected. Review the warnings before proceeding." :
                                "Critical issues detected. Installation is blocked until resolved."}
                    </p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div className="border rounded-xl bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-widest">Permissions (RBAC)</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground bg-background p-2 rounded border font-mono max-h-32 overflow-y-auto">
                        {report.rbac_diff || "No RBAC changes detected."}
                    </div>
                </div>

                <div className="border rounded-xl bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Gauge className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-widest">Resource Estimate</span>
                    </div>
                    <div className="space-y-2">
                        {report.resource_estimates?.map((res: any, i: number) => (
                            <div key={i} className="flex justify-between items-center text-[10px]">
                                <span className="font-medium truncate max-w-[100px]">{res.resource_name}</span>
                                <div className="flex gap-2">
                                    <Badge variant="outline" className="text-[9px] py-0">{res.cpu_request} CPU</Badge>
                                    <Badge variant="outline" className="text-[9px] py-0">{res.memory_request} RAM</Badge>
                                </div>
                            </div>
                        )) || <p className="text-[10px] text-muted-foreground italic">No resource impact detected.</p>}
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Individual Checks</label>
                <ScrollArea className="h-64 border rounded-xl bg-background">
                    <div className="p-4 space-y-4">
                        {report.checks.map((check: any, i: number) => (
                            <div key={i} className="flex gap-3 pb-3 border-b last:border-0 last:pb-0">
                                {check.passed ?
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-1 shrink-0" /> :
                                    check.severity === 'ERROR' ?
                                        <XCircle className="h-4 w-4 text-destructive mt-1 shrink-0" /> :
                                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-1 shrink-0" />
                                }
                                <div className="min-w-0">
                                    <h4 className="text-sm font-semibold">{check.name}</h4>
                                    <p className="text-xs text-muted-foreground leading-normal mt-0.5">{check.message}</p>
                                    {check.details && <p className="text-[10px] text-muted-foreground mt-1 font-mono bg-muted/50 p-1.5 rounded truncate">{check.details}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
