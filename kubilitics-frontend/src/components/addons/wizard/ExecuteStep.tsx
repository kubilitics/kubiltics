import { useState, useEffect } from "react";
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
    const { activeInstallPlan, valuesYaml, installProgress, appendInstallProgress } = useAddOnStore();
    const flow = useAddonInstallFlow(clusterId || "");
    const [complete, setComplete] = useState(false);
    const [failed, setFailed] = useState(false);

    // Reconnection state from the hook (T6.FE-02)
    const isReconnecting = flow.wsReconnectStatus === 'reconnecting';
    const isExhausted = flow.wsReconnectStatus === 'exhausted';

    useEffect(() => {
        if (!activeInstallPlan || !clusterId) return;

        const startExecution = async () => {
            try {
                await flow.executeInstall({
                    addon_id: (activeInstallPlan as any).addon_id,
                    version: (activeInstallPlan as any).version,
                    namespace: (activeInstallPlan as any).namespace,
                    values_yaml: valuesYaml,
                    plan_id: (activeInstallPlan as any).plan_id,
                } as any);

                // Progress events are streamed in real-time via the WebSocket
                // connection established by useAddonInstallFlow. Each InstallProgressEvent
                // emitted by the backend is appended via appendInstallProgress in the
                // hook's onmessage handler. We simply mark completion here once the
                // install Promise resolves (backend sends the final "complete" status event).
                setComplete(true);
            } catch (err) {
                setFailed(true);
            }
        };

        startExecution();
    }, [activeInstallPlan, valuesYaml, clusterId]);

    const progressValue = complete ? 100 : (installProgress.length / 5) * 100;

    // Determine header icon and title based on install + reconnect state
    const headerState = complete ? 'complete'
        : failed ? 'failed'
        : isExhausted ? 'exhausted'
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
                        {headerState === 'reconnecting' && `Reconnecting... (attempt ${flow.wsReconnectAttempt}/3)`}
                        {headerState === 'exhausted' && "Connection Lost"}
                        {headerState === 'complete' && "Installation Complete!"}
                        {headerState === 'failed' && "Installation Failed"}
                    </h3>
                    <p className="text-sm text-muted-foreground font-medium">
                        {headerState === 'installing' && (
                            `Provisioning ${(activeInstallPlan as any)?.addon_id} into namespace ${(activeInstallPlan as any)?.namespace}`
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
                            "An error occurred during the final execution phase."
                        )}
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex justify-between items-end px-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Progress</span>
                    <span className="text-xs font-mono font-bold text-primary">{Math.round(progressValue)}%</span>
                </div>
                <Progress value={progressValue} className="h-2" />
            </div>

            <div className="flex-1 flex flex-col gap-2 min-h-[200px]">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1 flex items-center gap-2">
                    <Terminal className="h-3 w-3" />
                    Execution Logs
                </label>
                <ScrollArea className="flex-1 border rounded-xl bg-slate-950 p-4 font-mono text-[11px] shadow-inner">
                    <div className="space-y-1">
                        <div className="text-slate-500">$ kubectl kcli addon install {(activeInstallPlan as any)?.addon_id}</div>
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
                                SUCCESS: {(activeInstallPlan as any)?.addon_id} is healthy and active.
                            </div>
                        )}
                        {isExhausted && (
                            <div className="text-amber-400 font-bold mt-2 animate-in zoom-in-95 duration-500">
                                WARN: Stream disconnected after {flow.wsReconnectAttempt} retries. Verify status in the Installed tab.
                            </div>
                        )}
                        {failed && !isExhausted && (
                            <div className="text-destructive font-bold mt-2">
                                CRITICAL_ERROR: Execution timed out or cluster rejected manifests.
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            {complete && (
                <div className="flex gap-4 animate-in slide-in-from-bottom-4 duration-500">
                    <Button className="flex-1 gap-2 py-6 text-base font-bold" variant="default" onClick={() => navigate('/addons')}>
                        Go to Installed Add-ons <Activity className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" className="gap-2 py-6 text-sm" onClick={() => window.open('/docs/addons')}>
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
