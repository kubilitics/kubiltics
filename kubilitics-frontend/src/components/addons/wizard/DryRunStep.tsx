// T6.FE-04: DryRunStep — simulates Helm install and previews generated manifests
// - Reads steps[0] from activeInstallPlan for addon_id, namespace, release_name (mirrors ExecuteStep)
// - Parses valuesYaml string → object before posting (empty YAML → {})
// - Maps DryRunResult correctly: manifest, notes, resource_count, resource_diff
// - "success" is derived from !error && !!result (no result.success field on backend)
// - Resource diff table shows CREATE / UPDATE / DELETE badges per resource
// - Manifest preview in read-only CodeEditor (result.manifest)
// - Re-runs automatically when values change (valuesYaml trimmed key in queryKey)
// - enabled: !!clusterId && !!activeInstallPlan && !!addonId (no !!valuesYaml gate)
// - Error parsing: extracts unique missing CRD types, provides structured guidance

import { useEffect, useMemo, useState } from "react";
import * as yaml from "js-yaml";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/useApi";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { useAddOnStore } from "@/stores/addonStore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    FileCheck, AlertCircle, Loader2, Terminal,
    Plus, RefreshCw, Minus, Zap, Info, ClipboardList,
    ChevronDown, ChevronUp, PackageX, ShieldAlert, ServerCrash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstallRequest } from "@/types/api/addons";

// ── Error parsing ─────────────────────────────────────────────────────────────

type HelmErrorType = 'crd-missing' | 'namespace-not-found' | 'auth' | 'generic';

interface ParsedHelmError {
    type: HelmErrorType;
    summary: string;
    /** Unique structured items (e.g. missing CRD kinds) */
    items: string[];
    guidance: string;
    rawMessage: string;
}

function parseHelmError(rawMsg: string): ParsedHelmError {
    // The API client embeds the raw HTTP response body in the error message:
    //   "Backend API error: 500 - {\"error\":\"dry-run: ... no matches for kind \\\"Foo\\\" ...\"}"
    // Normalise in two steps:
    //   1. Try to pull the actual error string out of the embedded JSON body.
    //   2. Fall back to stripping all backslash-escapes on quotes so our regexes match.
    let workMsg = rawMsg;
    try {
        // Extract the JSON payload that follows "NNN - "
        const jsonStart = rawMsg.indexOf(' - ');
        if (jsonStart !== -1) {
            const payload = JSON.parse(rawMsg.slice(jsonStart + 3)) as Record<string, unknown>;
            if (typeof payload.error === 'string') workMsg = payload.error;
        }
    } catch {
        // JSON parse failed — fall back to simple quote normalisation
        workMsg = rawMsg.replace(/\\"/g, '"');
    }

    // ── Missing CRDs ──
    // Pattern: no matches for kind "Foo" in version "group.io/v1"
    const kindRe = /no matches for kind "([^"]+)" in version "([^"]+)"/g;
    const missingKinds = new Map<string, string>(); // kind → apiGroup
    let m: RegExpExecArray | null;
    while ((m = kindRe.exec(workMsg)) !== null) {
        if (!missingKinds.has(m[1])) missingKinds.set(m[1], m[2]);
    }
    if (missingKinds.size > 0) {
        const items = [...missingKinds.entries()].map(([kind, ver]) => `${kind}  ·  ${ver}`);
        return {
            type: 'crd-missing',
            summary: `${missingKinds.size} Custom Resource Definition${missingKinds.size > 1 ? 's' : ''} not installed in the cluster.`,
            items,
            guidance: 'These CRDs must be present before this chart can be installed. Install the required operator or CRD bundle first, then re-run the dry run.',
            rawMessage: rawMsg,
        };
    }

    // ── Namespace not found ──
    if (/namespace[^.]*not found|no namespace/i.test(workMsg)) {
        return {
            type: 'namespace-not-found',
            summary: 'Target namespace does not exist.',
            items: [],
            guidance: 'Create the namespace first (`kubectl create namespace <name>`) or go back to the Plan step and enable "Create namespace".',
            rawMessage: rawMsg,
        };
    }

    // ── Auth / RBAC ──
    if (/forbidden|unauthorized|permission denied|cannot.*resource/i.test(workMsg)) {
        return {
            type: 'auth',
            summary: 'Insufficient cluster permissions for the dry run.',
            items: [],
            guidance: 'Ensure your kubeconfig credentials have the necessary RBAC permissions (create / get) in the target namespace.',
            rawMessage: rawMsg,
        };
    }

    // ── Generic fallback ──
    return {
        type: 'generic',
        summary: 'The Helm simulation failed with an unexpected error.',
        items: [],
        guidance: 'Check cluster connectivity and verify your chart values are correct. You can go back to Configure to adjust values.',
        rawMessage: rawMsg,
    };
}

const errorTypeIcon: Record<HelmErrorType, React.ReactNode> = {
    'crd-missing':         <PackageX className="h-6 w-6 text-amber-500 shrink-0" />,
    'namespace-not-found': <ServerCrash className="h-6 w-6 text-destructive shrink-0" />,
    'auth':                <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />,
    'generic':             <AlertCircle className="h-6 w-6 text-destructive shrink-0" />,
};

const errorTypeBg: Record<HelmErrorType, string> = {
    'crd-missing':         'bg-amber-50/80 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50',
    'namespace-not-found': 'bg-destructive/5 border-destructive/20',
    'auth':                'bg-destructive/5 border-destructive/20',
    'generic':             'bg-destructive/5 border-destructive/20',
};

const errorTypeTitle: Record<HelmErrorType, string> = {
    'crd-missing':         'CRDs Required Before Install',
    'namespace-not-found': 'Namespace Not Found',
    'auth':                'Insufficient Permissions',
    'generic':             'Dry Run Failed',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stable query-key slice from values YAML (trimmed first 200 chars). */
function valuesKey(raw: string): string {
    return (raw ?? "").trim().slice(0, 200);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DryRunStep() {
    const api = useApi();
    const clusterId = useActiveClusterId();
    const { activeInstallPlan, valuesYaml } = useAddOnStore();
    const [showRawError, setShowRawError] = useState(false);

    // Extract primary install step data — same pattern as ExecuteStep
    const primaryStep = activeInstallPlan?.steps?.[0];
    const addonId    = primaryStep?.addon_id    ?? activeInstallPlan?.requested_addon_id ?? "";
    const namespace  = primaryStep?.namespace   ?? "default";
    const releaseName = primaryStep?.release_name ?? addonId;

    // Parse YAML string → values object; fall back to {} on empty / invalid YAML
    const parsedValues = useMemo<Record<string, unknown>>(() => {
        const trimmed = (valuesYaml ?? "").trim();
        if (!trimmed) return {};
        try {
            const loaded = yaml.load(trimmed);
            if (loaded && typeof loaded === "object") return loaded as Record<string, unknown>;
        } catch {
            // ValuesEditorStep already blocks Next via yamlValidationError; proceed with {}
        }
        return {};
    }, [valuesYaml]);

    const req: InstallRequest = {
        addon_id: addonId,
        release_name: releaseName,
        namespace,
        values: parsedValues,
        create_namespace: false,
    };

    const { setActiveDryRunResult } = useAddOnStore();

    const { data: result, isLoading, error } = useQuery({
        queryKey: [
            "addons", "dry-run",
            clusterId, addonId, namespace, releaseName,
            valuesKey(valuesYaml ?? ""),
        ],
        queryFn: () => api.dryRunAddonInstall(clusterId!, req),
        enabled: !!clusterId && !!activeInstallPlan && !!addonId,
        retry: 1,
        staleTime: 0,
    });

    // Sync dry-run result to the addon store so InstallWizard can gate the
    // "Confirm Install" button — prevents advancing to ExecuteStep while the
    // simulation is still loading.  Error results are also synced: users can
    // still choose to proceed (e.g. CRD-missing addons may install fine).
    useEffect(() => {
        if (result) {
            setActiveDryRunResult(result);
        } else if (error) {
            // On error, set a synthetic result so the gate opens (user can still proceed).
            setActiveDryRunResult({ manifest: '', notes: '', resource_count: 0, resource_diff: [] } as unknown as typeof result);
        }
    }, [result, error, setActiveDryRunResult]);

    // ── Loading ───────────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="flex flex-col gap-6 h-full">
                <div className="p-6 rounded-2xl border bg-muted/30 flex items-center gap-5 animate-pulse">
                    <Loader2 className="h-10 w-10 text-primary animate-spin shrink-0" />
                    <div className="flex flex-col gap-2 flex-1">
                        <Skeleton className="h-5 w-52" />
                        <Skeleton className="h-3 w-80" />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
                <Skeleton className="flex-1 min-h-[300px] rounded-xl" />
            </div>
        );
    }

    // ── Error — structured, actionable ────────────────────────────────────────

    if (error || !result) {
        const rawMsg = error instanceof Error ? error.message : "The simulation encountered an unexpected error.";
        const parsed = parseHelmError(rawMsg);

        return (
            <div className="flex flex-col gap-4">

                {/* Primary error banner */}
                <div className={cn("p-5 rounded-2xl border flex items-start gap-4", errorTypeBg[parsed.type])}>
                    {errorTypeIcon[parsed.type]}
                    <div className="flex-1 min-w-0">
                        <h3 className={cn(
                            "text-base font-bold leading-tight",
                            parsed.type === 'crd-missing' ? "text-amber-800 dark:text-amber-300" : "text-destructive"
                        )}>
                            {errorTypeTitle[parsed.type]}
                        </h3>
                        <p className={cn(
                            "text-sm mt-1 leading-snug",
                            parsed.type === 'crd-missing' ? "text-amber-700 dark:text-amber-400" : "text-destructive/80"
                        )}>
                            {parsed.summary}
                        </p>
                    </div>
                </div>

                {/* Missing CRDs list (only for crd-missing type) */}
                {parsed.items.length > 0 && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                            <PackageX className="h-3 w-3" />
                            Missing CRD Kinds ({parsed.items.length})
                        </label>
                        <div className="border rounded-xl overflow-hidden divide-y divide-border/50">
                            {parsed.items.map((item, i) => {
                                const [kind, apiGroup] = item.split('  ·  ');
                                return (
                                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs bg-amber-50/40 dark:bg-amber-900/5 hover:bg-amber-50/80 transition-colors">
                                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-0 text-[9px] font-bold py-0 px-1.5 shrink-0">
                                            CRD
                                        </Badge>
                                        <span className="font-bold text-amber-800 dark:text-amber-300 shrink-0">{kind}</span>
                                        <span className="font-mono text-[10px] text-muted-foreground truncate">{apiGroup}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Guidance */}
                <Alert className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/50">
                    <Info className="h-4 w-4 text-blue-600 shrink-0" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                        {parsed.guidance}
                        {parsed.type === 'crd-missing' && (
                            <span className="block mt-1.5 font-medium">
                                You can still click <strong>Confirm Install</strong> — Helm will attempt to install and may succeed if CRDs are present at runtime.
                            </span>
                        )}
                    </AlertDescription>
                </Alert>

                {/* Collapsible raw error */}
                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-xs text-muted-foreground h-7 px-2"
                        onClick={() => setShowRawError(v => !v)}
                    >
                        {showRawError ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {showRawError ? 'Hide' : 'Show'} technical details
                    </Button>
                    {showRawError && (
                        <ScrollArea className="mt-2 border rounded-xl bg-slate-950 p-4 font-mono text-[10px] text-slate-300 max-h-56 animate-in fade-in-0 duration-200">
                            <pre className="whitespace-pre-wrap break-all leading-relaxed">{parsed.rawMessage}</pre>
                        </ScrollArea>
                    )}
                </div>
            </div>
        );
    }

    // ── Success ───────────────────────────────────────────────────────────────

    const success = !error && !!result;

    return (
        <div className="flex flex-col gap-6 h-full">

            {/* Status banner */}
            <div className={cn(
                "p-5 rounded-2xl border flex items-center gap-5",
                success
                    ? "bg-emerald-500/8 dark:bg-emerald-900/10 border-emerald-500/20"
                    : "bg-destructive/10 border-destructive/20"
            )}>
                {success
                    ? <FileCheck className="h-10 w-10 text-emerald-500 shrink-0" />
                    : <AlertCircle className="h-10 w-10 text-destructive shrink-0" />
                }
                <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold tracking-tight">
                        {success ? "Simulation Passed — Ready to Install" : "Simulation Blocked"}
                    </h3>
                    <p className="text-sm opacity-70 leading-tight mt-0.5">
                        {success
                            ? "Manifests generated and validated. No conflicts detected."
                            : "Validation failed. Review errors and adjust your configuration."}
                    </p>
                </div>
                {success && result.resource_count > 0 && (
                    <div className="flex items-center gap-2 shrink-0 px-3 py-2 rounded-lg bg-emerald-500/10">
                        <Zap className="h-4 w-4 text-emerald-600" />
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                            {result.resource_count} resource{result.resource_count !== 1 ? "s" : ""}
                        </span>
                    </div>
                )}
            </div>

            {/* Resource diff table */}
            {result.resource_diff && result.resource_diff.length > 0 && (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                        <ClipboardList className="h-3 w-3" />
                        Resource Changes ({result.resource_diff.length})
                    </label>
                    <div className="border rounded-xl overflow-hidden divide-y divide-border/50">
                        {result.resource_diff.map((change, i) => {
                            const action = (change.action ?? "").toLowerCase();
                            return (
                                <div
                                    key={i}
                                    className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-muted/30 transition-colors"
                                >
                                    {action === "create" ? (
                                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0 text-[9px] font-bold py-0 px-1.5 flex items-center gap-0.5 shrink-0">
                                            <Plus className="h-2.5 w-2.5" /> CREATE
                                        </Badge>
                                    ) : action === "update" ? (
                                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-0 text-[9px] font-bold py-0 px-1.5 flex items-center gap-0.5 shrink-0">
                                            <RefreshCw className="h-2.5 w-2.5" /> UPDATE
                                        </Badge>
                                    ) : action === "delete" ? (
                                        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-0 text-[9px] font-bold py-0 px-1.5 flex items-center gap-0.5 shrink-0">
                                            <Minus className="h-2.5 w-2.5" /> DELETE
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[9px] font-bold py-0 px-1.5 shrink-0">
                                            {change.action.toUpperCase()}
                                        </Badge>
                                    )}
                                    <span className="font-semibold text-muted-foreground shrink-0">
                                        {change.kind}
                                    </span>
                                    <span className="font-mono text-[10px] text-foreground truncate">
                                        {change.namespace ? `${change.namespace}/` : ""}{change.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Helm notes */}
            {result.notes && (
                <Alert className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/50">
                    <Info className="h-4 w-4 text-blue-600 shrink-0" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-300 whitespace-pre-wrap leading-relaxed">
                        {result.notes}
                    </AlertDescription>
                </Alert>
            )}

            {/* Manifest preview */}
            {result.manifest ? (
                <div className="flex-1 flex flex-col gap-2 min-h-[300px]">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                            <Terminal className="h-3 w-3" />
                            Manifest Preview (YAML)
                        </label>
                        <Badge variant="outline" className="text-[9px] py-0 text-primary font-bold">
                            READ ONLY
                        </Badge>
                    </div>
                    <div className="flex-1 border rounded-xl overflow-hidden shadow-inner bg-background">
                        <CodeEditor
                            value={result.manifest}
                            readOnly={true}
                            minHeight="100%"
                            className="h-full border-none"
                        />
                    </div>
                </div>
            ) : success && (
                <Alert className="bg-muted/40 border-muted">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                        No manifest preview returned. The chart may produce resources dynamically at install time.
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}
