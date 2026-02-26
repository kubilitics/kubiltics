import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    ShieldCheck,
    Eye,
    GitBranch,
    Rocket,
    CheckCircle2,
    XCircle,
    Loader2,
    Package,
    Edit2,
    Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClusterProfile, InstallProgressEvent } from "@/types/api/addons";
import { useApi } from "@/hooks/useApi";

// ── Profile icon mapping ──────────────────────────────────────────────────────

const PROFILE_ICONS: Record<string, React.ReactNode> = {
    "builtin-production-security": <ShieldCheck className="h-6 w-6 text-blue-500" />,
    "builtin-full-observability": <Eye className="h-6 w-6 text-violet-500" />,
    "builtin-gitops-ready": <GitBranch className="h-6 w-6 text-emerald-500" />,
};

function profileIcon(profile: ClusterProfile) {
    return PROFILE_ICONS[profile.id] ?? <Package className="h-6 w-6 text-slate-400" />;
}

// ── Addon pill ────────────────────────────────────────────────────────────────

function AddonPill({ addonId }: { addonId: string }) {
    const short = addonId.includes("/") ? addonId.split("/")[1] : addonId;
    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            {short}
        </span>
    );
}

// ── Progress event row ────────────────────────────────────────────────────────

function ProgressRow({ event }: { event: InstallProgressEvent }) {
    const isError = event.status === "error" || event.status === "failed";
    const isSuccess = event.status === "success" || event.status === "complete";
    const isRunning = event.status === "running" || event.status === "pending";

    return (
        <div className={cn("flex items-start gap-2 text-xs py-1", isError && "text-red-600", isSuccess && "text-emerald-600", isRunning && "text-slate-600")}>
            {isError && <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {isSuccess && <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {isRunning && <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin" />}
            <span>{event.message}</span>
        </div>
    );
}

// ── Apply Profile Dialog ──────────────────────────────────────────────────────

interface ApplyProfileDialogProps {
    profile: ClusterProfile;
    clusterId: string;
    open: boolean;
    onClose: () => void;
}

function ApplyProfileDialog({ profile, clusterId, open, onClose }: ApplyProfileDialogProps) {
    const api = useApi();
    const [events, setEvents] = useState<InstallProgressEvent[]>([]);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleApply = useCallback(async () => {
        setRunning(true);
        setDone(false);
        setError(null);
        setEvents([]);
        try {
            await api.applyProfile(clusterId, profile.id, (ev) => {
                setEvents((prev) => [...prev, ev]);
            });
            setDone(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    }, [api, clusterId, profile.id]);

    const handleClose = () => {
        if (!running) {
            setEvents([]);
            setDone(false);
            setError(null);
            onClose();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {profileIcon(profile)}
                        Apply: {profile.name}
                    </DialogTitle>
                    <DialogDescription>{profile.description}</DialogDescription>
                </DialogHeader>

                {/* Addon list */}
                {events.length === 0 && !done && !error && (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-600">The following add-ons will be installed:</p>
                        <div className="flex flex-wrap gap-2">
                            {profile.addons.map((a) => (
                                <AddonPill key={a.addon_id} addonId={a.addon_id} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Progress stream */}
                {events.length > 0 && (
                    <div className="max-h-56 overflow-y-auto rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-0.5">
                        {events.map((ev, i) => (
                            <ProgressRow key={i} event={ev} />
                        ))}
                        {running && (
                            <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Installing…
                            </div>
                        )}
                    </div>
                )}

                {done && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        Profile applied successfully.
                    </div>
                )}
                {error && (
                    <div className="flex items-start gap-2 text-sm text-red-600">
                        <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        {error}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={handleClose} disabled={running}>
                        {done || error ? "Close" : "Cancel"}
                    </Button>
                    {!done && !running && (
                        <Button onClick={handleApply} disabled={running}>
                            <Rocket className="h-4 w-4 mr-2" />
                            Apply Profile
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── ClusterProfileCard ────────────────────────────────────────────────────────

interface ClusterProfileCardProps {
    profile: ClusterProfile;
    clusterId: string | null;
    onEdit?: () => void;
    onDelete?: () => void;
}

export function ClusterProfileCard({ profile, clusterId, onEdit, onDelete }: ClusterProfileCardProps) {
    const [applyOpen, setApplyOpen] = useState(false);

    return (
        <>
            <div className="glass-card rounded-2xl border border-slate-100 p-6 flex flex-col gap-4 hover:shadow-lg transition-all duration-200 hover:border-primary/20">
                {/* Header */}
                <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                        {profileIcon(profile)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <h3 className="font-bold text-slate-900 text-sm leading-tight truncate">
                                    {profile.name}
                                </h3>
                                {profile.is_builtin && (
                                    <Badge
                                        variant="outline"
                                        className="text-[9px] px-1.5 py-0 bg-blue-50 text-blue-600 border-blue-200 shrink-0"
                                    >
                                        Built-in
                                    </Badge>
                                )}
                            </div>
                            {!profile.is_builtin && (
                                <div className="flex items-center gap-1 shrink-0">
                                    {onEdit && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                            className="p-1 text-slate-400 hover:text-primary transition-colors"
                                            title="Edit Profile"
                                        >
                                            <Edit2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    {onDelete && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                            title="Delete Profile"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{profile.description}</p>
                    </div>
                </div>

                {/* Addon pills */}
                <div className="flex flex-wrap gap-1.5">
                    {profile.addons.map((a) => (
                        <AddonPill key={a.addon_id} addonId={a.addon_id} />
                    ))}
                    {profile.addons.length === 0 && (
                        <span className="text-[10px] text-slate-400 italic">No add-ons</span>
                    )}
                </div>

                {/* CTA */}
                <Button
                    className="w-full mt-auto"
                    size="sm"
                    disabled={!clusterId}
                    onClick={() => setApplyOpen(true)}
                    title={clusterId ? undefined : "Select a cluster first"}
                >
                    <Rocket className="h-3.5 w-3.5 mr-1.5" />
                    Apply to Cluster
                </Button>
            </div>

            {clusterId && (
                <ApplyProfileDialog
                    profile={profile}
                    clusterId={clusterId}
                    open={applyOpen}
                    onClose={() => setApplyOpen(false)}
                />
            )}
        </>
    );
}
