import { useState, useEffect, useRef } from "react";
import * as yaml from "js-yaml";
import { useAddonInstallFlow } from "@/hooks/useAddonInstall";
import { useAddOnStore } from "@/stores/addonStore";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { Button } from "@/components/ui/button";
import {
    Rocket, CheckCircle2, XCircle, Loader2,
    Terminal, Activity, ExternalLink, WifiOff, AlertTriangle
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

export function ExecuteStep() {
    const navigate = useNavigate();
    const clusterId = useActiveClusterId();
    const { activeInstallPlan, valuesYaml, installProgress } = useAddOnStore();
    const flow = useAddonInstallFlow(clusterId || "");
    const [complete, setComplete] = useState(false);
    const [failed, setFailed] = useState(false);
    // Guard against React StrictMode double-invocation — executeInstall must fire only once
    const hasStartedRef = useRef(false);

    // Reconnection state from the hook (T6.FE-02)
    const isReconnecting = flow.wsReconnectStatus === 'reconnecting';
    const isExhausted = flow.wsReconnectStatus === 'exhausted';

    // Extract the primary step data from the plan (steps[0] holds the install target)
    const primaryStep = activeInstallPlan?.steps?.[0];
    const addonId = primaryStep?.addon_id ?? activeInstallPlan?.requested_addon_id ?? '';
    const targetNamespace = primaryStep?.namespace ?? 'default';
    const releaseName = primaryStep?.release_name ?? addonId;

    // Resolve the "View Documentation" URL for this add-on:
    //  • community/{repo}/{chart}  → ArtifactHub package page
    //  • anything else             → ArtifactHub search (always valid, no 404)
    const docsUrl = (() => {
        const parts = addonId.split('/');
        if (parts[0] === 'community' && parts.length === 3) {
            return `https://artifacthub.io/packages/helm/${parts[1]}/${parts[2]}`;
        }
        return `https://artifacthub.io/packages/search?ts_query_web=${encodeURIComponent(parts[parts.length - 1])}`;
    })();

    useEffect(() => {
        if (!activeInstallPlan || !clusterId || !primaryStep) return;
        // Prevent double-invocation from React StrictMode or dependency re-fires
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        const startExecution = async () => {
            try {
                // Parse YAML values string → object; fall back to empty object on any error
                let parsedValues: Record<string, unknown> = {};
                if (valuesYaml?.trim()) {
                    try {
                        const loaded = yaml.load(valuesYaml);
                        if (loaded && typeof loaded === 'object') {
                            parsedValues = loaded as Record<string, unknown>;
                        }
                    } catch {
                        // Invalid YAML — the ValuesEditorStep already validates; just proceed with {}
                    }
                }

                await flow.executeInstall({
                    addon_id: addonId,
                    release_name: releaseName,
                    namespace: targetNamespace,
                    values: parsedValues,
                    // Always attempt to create the namespace — Helm handles it gracefully
                    // if it already exists. Hardcoding false caused immediate failure when
                    // the plan's namespace (e.g. "jenkins") didn't yet exist on the cluster.
                    create_namespace: true,
                });

                // Progress events are streamed in real-time via the WebSocket
                // connection established by useAddonInstallFlow. Each InstallProgressEvent
                // emitted by the backend is appended via appendInstallProgress in the
                // hook's onmessage handler. We simply mark completion here once the
                // install Promise resolves (backend sends the final "complete" status event).
                setComplete(true);
            } catch (err) {
                // Preserve the actual error message so the user sees meaningful feedback
                // (e.g. "Lost connection to server", "Helm install failed: ...", etc.).
                if (err instanceof Error && err.message) {
                    console.error('[ExecuteStep] install failed:', err.message);
                }
                setFailed(true);
            }
        };

        startExecution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeInstallPlan, valuesYaml, clusterId]);

    // Progress: indeterminate while installing (the log stream IS the progress indicator),
    // 100% on completion, 0 on failure. No fake percentage — the logs tell the real story.
    const isDone = complete || failed || isExhausted;

    // Determine header icon and title based on install + reconnect state.
    // isExhausted is checked BEFORE failed: when retries exhaust, the hook both sets
    // wsReconnectStatus='exhausted' AND calls reject() (→ failed=true). Without this
    // order, 'failed' would always win and mask the "Connection Lost" state.
    const headerState = complete ? 'complete'
        : isExhausted ? 'exhausted'
        : failed ? 'failed'
        : isReconnecting ? 'reconnecting'
        : 'installing';

    return (
        <div className="flex flex-col gap-8 h-full">
            <div className="flex flex-col items-center text-center gap-4 py-8">
                {headerState === 'installing' && (
                    <div className="relative">
                        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                            <Rocket className="h-10 w-10 text-primary animate-bounce-slow" />
                        </div>
                        <Loader2 className="h-24 w-24 absolute -top-2 -left-2 text-primary/40 animate-spin-slow" />
                    </div>
                )}
                {headerState === 'reconnecting' && (
                    <div className="relative">
                        <div className="h-20 w-20 rounded-full bg-amber-500/10 flex items-center justify-center animate-pulse">
                            <WifiOff className="h-10 w-10 text-amber-500" />
                        </div>
                        <Loader2 className="h-24 w-24 absolute -top-2 -left-2 text-amber-400/40 animate-spin" />
                    </div>
                )}
                {headerState === 'exhausted' && (
                    <div className="h-20 w-20 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <AlertTriangle className="h-10 w-10 text-amber-500 animate-in zoom-in-50 duration-500" />
                    </div>
                )}
                {headerState === 'complete' && (
                    <div className="h-20 w-20 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-10 w-10 text-emerald-500 animate-in zoom-in-50 duration-500" />
                    </div>
                )}
                {headerState === 'failed' && (
                    <div className="h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center">
                        <XCircle className="h-10 w-10 text-destructive animate-in zoom-in-50 duration-500" />
                    </div>
                )}

                <div className="space-y-1">
                    <h3 className="text-2xl font-bold tracking-tight">
                        {headerState === 'installing' && "Installing Add-on..."}
                        {headerState === 'reconnecting' && `Reconnecting... (attempt ${flow.wsReconnectAttempt}/5)`}
                        {headerState === 'exhausted' && "Connection Lost"}
                        {headerState === 'complete' && "Installation Complete!"}
                        {headerState === 'failed' && "Installation Failed"}
                    </h3>
                    <p className="text-sm text-muted-foreground font-medium">
                        {headerState === 'installing' && (
                            `Provisioning ${releaseName} into namespace ${targetNamespace}`
                        )}
                        {headerState === 'reconnecting' && (
                            "Connection interrupted. Attempting to re-establish the install stream..."
                        )}
                        {headerState === 'exhausted' && (
                            "Lost connection to server. The install may still be running. Check the Installed tab."
                        )}
                        {headerState === 'complete' && (
                            "The add-on has been successfully deployed and initialized."
                        )}
                        {headerState === 'failed' && (
                            flow.error || "An error occurred during the final execution phase."
                        )}
                    </p>
                </div>
            </div>

            {/* Progress bar: indeterminate pulse while running, solid on done */}
            <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest px-1">
                    {complete ? "Complete" : failed || isExhausted ? "Stopped" : "Installing…"}
                </span>
                {!isDone ? (
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full w-1/3 rounded-full bg-primary origin-left animate-[indeterminate_1.6s_ease-in-out_infinite]"
                            style={{ animation: 'indeterminate 1.6s ease-in-out infinite' }} />
                    </div>
                ) : (
                    <Progress value={complete ? 100 : 0} className="h-1.5" />
                )}
            </div>

            <div className="flex-1 flex flex-col gap-2 min-h-[200px]">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                    <Terminal className="h-3 w-3" />
                    Execution Logs
                </label>
                <ScrollArea className="flex-1 border rounded-xl bg-slate-950 p-4 font-mono text-[11px] shadow-inner">
                    <div className="space-y-1">
                        <div className="text-slate-500">$ kcli addon install {addonId}</div>
                        <div className="text-emerald-500 opacity-80 italic">CONNECTED: session established via AOE engine</div>
                        {installProgress.map((evt, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "animate-in fade-in slide-in-from-left-2 duration-300",
                                    evt.status === 'warning' && "text-amber-400"
                                )}
                            >
                                <span className="text-slate-500">[{new Date(evt.timestamp).toLocaleTimeString()}]</span>{" "}
                                {evt.status === 'warning' ? (
                                    <span className="text-amber-400 font-bold">{evt.message}</span>
                                ) : (
                                    <>
                                        <span className="text-emerald-400 font-bold">{evt.step}:</span>{" "}
                                        <span className="text-slate-300">{evt.message}</span>
                                    </>
                                )}
                            </div>
                        ))}
                        {complete && (
                            <div className="text-emerald-400 font-bold mt-2 animate-in zoom-in-95 duration-500">
                                SUCCESS: {releaseName} is healthy and active.
                            </div>
                        )}
                        {isExhausted && (
                            <div className="text-amber-400 font-bold mt-2 animate-in zoom-in-95 duration-500">
                                WARN: Stream disconnected after {flow.wsReconnectAttempt} retries. Verify status in the Installed tab.
                            </div>
                        )}
                        {failed && !isExhausted && (
                            <div className="text-destructive font-bold mt-2 break-words whitespace-pre-wrap">
                                ERROR: {flow.error || "Execution failed — check cluster state."}
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            {complete && (
                <div className="flex gap-4 animate-in slide-in-from-bottom-4 duration-500">
                    <Button className="flex-1 gap-2 py-6 text-base font-bold" variant="default" onClick={() => navigate('/addons?tab=installed')}>
                        Go to Installed Add-ons <Activity className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" className="flex-1 gap-2 py-6 text-base font-bold" onClick={() => window.open(docsUrl, '_blank', 'noopener,noreferrer')}>
                        View Documentation <ExternalLink className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {(failed || isExhausted) && (
                <div className="flex gap-4 animate-in slide-in-from-bottom-4 duration-500">
                    <Button
                        variant="outline"
                        className="flex-1 gap-2 py-6 text-sm"
                        onClick={() => { navigate('/addons?tab=installed'); }}
                    >
                        Check Installed Tab <Activity className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}
