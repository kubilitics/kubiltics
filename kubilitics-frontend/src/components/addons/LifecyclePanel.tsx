import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Activity,
    ArrowUpCircle,
    RotateCcw,
    Trash2,
    Shield,
    Clock,
    DollarSign,
    TrendingDown,
    Zap,
    Scale,
    FlaskConical,
    Loader2,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronRight,
    CalendarClock,
    Plus,
    Trash,
} from "lucide-react";
import { AddOnStatusBadge } from './AddOnStatusBadge';
import { TierBadge } from './TierBadge';
import { CostDisplay } from './CostDisplay';
import type { AddOnInstallWithHealth } from '@/types/api/addons';
import { format } from 'date-fns';
import {
    useAddonCostAttribution,
    useAddonRightsizing,
    useRunAddonTests,
    useMaintenanceWindows,
    useCreateMaintenanceWindow,
    useDeleteMaintenanceWindow,
} from '@/hooks/useAddOnCatalog';
import type { TestSuite } from '@/services/backendApiClient';
import { cn } from '@/lib/utils';

interface LifecyclePanelProps {
    install: AddOnInstallWithHealth;
    onUpgrade?: () => void;
    onRollback?: () => void;
    onUninstall?: () => void;
    onViewAudit?: () => void;
}

// ── Helm Test Results sub-component ──────────────────────────────────────────

function TestSuiteRow({ suite }: { suite: TestSuite }) {
    const [expanded, setExpanded] = useState(false);
    const passed = suite.status === "Succeeded";
    return (
        <div className="border-b last:border-0 border-muted-foreground/10">
            <button
                className="w-full flex items-center gap-2 py-2 px-3 text-xs hover:bg-muted/30 transition-colors text-left"
                onClick={() => suite.info && setExpanded(v => !v)}
            >
                {passed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                )}
                <span className="flex-1 font-mono">{suite.name}</span>
                <Badge
                    variant="outline"
                    className={cn(
                        "text-[10px] py-0",
                        passed ? "text-emerald-600 border-emerald-200" : "text-destructive border-destructive/30"
                    )}
                >
                    {suite.status}
                </Badge>
                {suite.info && (
                    expanded
                        ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
            </button>
            {expanded && suite.info && (
                <pre className="mx-3 mb-2 p-2 text-[10px] bg-slate-950 text-slate-300 rounded overflow-x-auto max-h-[120px]">
                    {suite.info}
                </pre>
            )}
        </div>
    );
}

function HelmTestSection({ install }: { install: AddOnInstallWithHealth }) {
    const { mutate: runTests, isPending, data: testResult, error: testError } = useRunAddonTests(install.cluster_id, install.id);

    const passedCount = testResult ? testResult.tests.filter(t => t.status === "Succeeded").length : 0;
    const totalCount = testResult?.tests?.length ?? 0;

    return (
        <Card className="border-muted-foreground/15">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                        <FlaskConical className="h-3.5 w-3.5 text-primary" />
                        Helm Tests
                    </CardTitle>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        disabled={isPending}
                        onClick={() => runTests()}
                    >
                        {isPending ? (
                            <><Loader2 className="h-3 w-3 animate-spin" /> Running...</>
                        ) : (
                            <><FlaskConical className="h-3 w-3" /> Run Tests</>
                        )}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {testError && (
                    <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {testError.message}
                    </div>
                )}

                {testResult && (
                    <div className="flex flex-col gap-2">
                        {/* Summary line */}
                        <div className="flex items-center gap-2">
                            {testResult.passed ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className={cn(
                                "text-sm font-semibold",
                                testResult.passed ? "text-emerald-600" : "text-destructive"
                            )}>
                                {passedCount}/{totalCount} test{totalCount !== 1 ? "s" : ""} passed
                            </span>
                        </div>

                        {/* Per-hook result rows (expandable for log snippets) */}
                        {testResult.tests.length > 0 && (
                            <div className="rounded-lg border border-muted-foreground/15 overflow-hidden">
                                {testResult.tests.map((suite, i) => (
                                    <TestSuiteRow key={i} suite={suite} />
                                ))}
                            </div>
                        )}

                        {testResult.tests.length === 0 && (
                            <p className="text-xs text-muted-foreground italic">
                                No helm test hooks are defined for this release.
                            </p>
                        )}
                    </div>
                )}

                {!testResult && !testError && !isPending && (
                    <p className="text-xs text-muted-foreground">
                        Click "Run Tests" to execute the Helm test suite for this release.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

// ── Maintenance Window sub-component (T9.03) ─────────────────────────────────

const DAY_OPTIONS = [
    { label: "Every day", value: -1 },
    { label: "Sunday", value: 0 },
    { label: "Monday", value: 1 },
    { label: "Tuesday", value: 2 },
    { label: "Wednesday", value: 3 },
    { label: "Thursday", value: 4 },
    { label: "Friday", value: 5 },
    { label: "Saturday", value: 6 },
];

const TIMEZONE_OPTIONS = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
];

function humanWindow(w: { day_of_week: number; start_hour: number; start_minute: number; timezone: string; duration_minutes: number }) {
    const day = DAY_OPTIONS.find(d => d.value === w.day_of_week)?.label ?? "Every day";
    const hh = String(w.start_hour).padStart(2, "0");
    const mm = String(w.start_minute).padStart(2, "0");
    const dh = Math.floor(w.duration_minutes / 60);
    const dm = w.duration_minutes % 60;
    const dur = dh > 0 && dm > 0 ? `${dh}h ${dm}m` : dh > 0 ? `${dh}h` : `${dm}m`;
    return `${day} at ${hh}:${mm} ${w.timezone} for ${dur}`;
}

interface MaintenanceWindowDialogProps {
    open: boolean;
    onClose: () => void;
    clusterId: string;
}

function MaintenanceWindowDialog({ open, onClose, clusterId }: MaintenanceWindowDialogProps) {
    const [name, setName] = useState("");
    const [dayOfWeek, setDayOfWeek] = useState(-1);
    const [startHour, setStartHour] = useState(2);
    const [startMinute, setStartMinute] = useState(0);
    const [timezone, setTimezone] = useState("UTC");
    const [durationMinutes, setDurationMinutes] = useState(120);

    const { mutate: createWindow, isPending } = useCreateMaintenanceWindow(clusterId);

    const handleSave = () => {
        if (!name.trim() || durationMinutes <= 0) return;
        createWindow({
            name: name.trim(),
            day_of_week: dayOfWeek,
            start_hour: startHour,
            start_minute: startMinute,
            timezone,
            duration_minutes: durationMinutes,
        }, {
            onSuccess: () => {
                setName("");
                onClose();
            },
        });
    };

    const preview = humanWindow({ day_of_week: dayOfWeek, start_hour: startHour, start_minute: startMinute, timezone, duration_minutes: durationMinutes });

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5 text-indigo-500" />
                        Configure Maintenance Window
                    </DialogTitle>
                    <DialogDescription>
                        Auto-upgrades will only run inside this window.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-3 space-y-4">
                    {/* Name */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Window Name</label>
                        <Input
                            placeholder="e.g. Weekly Sunday Maintenance"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="text-sm"
                        />
                    </div>

                    {/* Day + Time */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Day</label>
                            <select
                                value={dayOfWeek}
                                onChange={e => setDayOfWeek(Number(e.target.value))}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                {DAY_OPTIONS.map(d => (
                                    <option key={d.value} value={d.value}>{d.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Time</label>
                            <div className="flex items-center gap-1">
                                <Input
                                    type="number"
                                    min={0}
                                    max={23}
                                    value={startHour}
                                    onChange={e => setStartHour(Math.min(23, Math.max(0, Number(e.target.value))))}
                                    className="text-sm w-16 text-center"
                                />
                                <span className="text-muted-foreground font-bold">:</span>
                                <Input
                                    type="number"
                                    min={0}
                                    max={59}
                                    value={startMinute}
                                    onChange={e => setStartMinute(Math.min(59, Math.max(0, Number(e.target.value))))}
                                    className="text-sm w-16 text-center"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Timezone + Duration */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timezone</label>
                            <select
                                value={timezone}
                                onChange={e => setTimezone(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                {TIMEZONE_OPTIONS.map(tz => (
                                    <option key={tz} value={tz}>{tz}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duration (min)</label>
                            <Input
                                type="number"
                                min={1}
                                value={durationMinutes}
                                onChange={e => setDurationMinutes(Math.max(1, Number(e.target.value)))}
                                className="text-sm"
                            />
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/15 border border-indigo-100 dark:border-indigo-800/30 p-3">
                        <p className="text-[10px] text-indigo-600 dark:text-indigo-400 uppercase font-bold tracking-wider mb-1">Schedule Preview</p>
                        <p className="text-xs font-medium text-indigo-800 dark:text-indigo-300">{preview}</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
                    <Button
                        onClick={handleSave}
                        disabled={!name.trim() || durationMinutes <= 0 || isPending}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                        {isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : <><Plus className="h-4 w-4 mr-1.5" />Add Window</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MaintenanceWindowSection({ install }: { install: AddOnInstallWithHealth }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { data: windows = [], isLoading } = useMaintenanceWindows(install.cluster_id);
    const { mutate: deleteWindow } = useDeleteMaintenanceWindow(install.cluster_id);

    return (
        <Card className="border-muted-foreground/15">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5 text-indigo-500" />
                        Maintenance Windows
                    </CardTitle>
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
                        <Plus className="h-3.5 w-3.5" /> Configure Window
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {isLoading && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading windows…
                    </p>
                )}
                {!isLoading && windows.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        No maintenance windows configured. Auto-upgrades run at any time.
                    </p>
                )}
                {windows.length > 0 && (
                    <div className="rounded-lg border border-muted-foreground/15 overflow-hidden divide-y divide-muted-foreground/10">
                        {windows.map(w => (
                            <div key={w.id} className="flex items-start justify-between gap-3 p-2.5">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold">{w.name}</span>
                                    <span className="text-[11px] text-muted-foreground font-mono">
                                        {humanWindow(w)}
                                    </span>
                                    {w.apply_to !== "all" && (
                                        <span className="text-[10px] text-muted-foreground">
                                            Applies to: {w.apply_to}
                                        </span>
                                    )}
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    onClick={() => deleteWindow(w.id)}
                                    title="Delete window"
                                >
                                    <Trash className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
            <MaintenanceWindowDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                clusterId={install.cluster_id}
            />
        </Card>
    );
}

// ── Main LifecyclePanel ───────────────────────────────────────────────────────

/**
 * T5.19, T8.10, T9.01 & T9.03: LifecyclePanel
 * Detailed dashboard for managing an installed add-on instance.
 * Includes cost attribution, rightsizing recommendations, and helm test execution.
 */
export function LifecyclePanel({
    install,
    onUpgrade,
    onRollback,
    onUninstall,
    onViewAudit,
}: LifecyclePanelProps) {
    const { catalog_entry: addon, health, policy, cluster_id } = install;

    const { data: cost } = useAddonCostAttribution(cluster_id, install.id);
    const { data: reco } = useAddonRightsizing(cluster_id, install.id);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="flex gap-4 items-center">
                    <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center p-2 border">
                        {addon?.icon_url ? (
                            <img src={addon.icon_url} alt="" className="w-full h-full object-contain" />
                        ) : (
                            <Activity className="h-6 w-6 text-muted-foreground" />
                        )}
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold">{addon?.display_name || install.addon_id}</h3>
                            <AddOnStatusBadge status={install.status} />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>v{install.installed_version}</span>
                            <span>•</span>
                            <Badge variant="outline" className="font-mono text-[10px] py-0">{install.namespace}</Badge>
                            {addon && (
                                <>
                                    <span>•</span>
                                    <TierBadge tier={addon.tier} size="sm" />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={onUpgrade}>
                        <ArrowUpCircle className="h-4 w-4" /> Upgrade
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={onRollback}>
                        <RotateCcw className="h-4 w-4" /> Rollback
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-2" onClick={onUninstall}>
                        <Trash2 className="h-4 w-4" /> Uninstall
                    </Button>
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-muted/10 border-muted-foreground/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                            <Activity className="h-3.5 w-3.5 text-primary" />
                            Health & Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Pod Status</span>
                            <span className="font-medium">
                                {health?.ready_pods || 0} / {health?.total_pods || 0} Ready
                            </span>
                        </div>
                        {health?.last_error && (
                            <div className="p-2 rounded bg-destructive/10 text-destructive text-[10px] break-words">
                                {health.last_error}
                            </div>
                        )}
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Last Checked</span>
                            <span className="text-[10px] font-medium">
                                {health?.last_checked_at ? format(new Date(health.last_checked_at), 'HH:mm:ss') : 'Never'}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-muted/10 border-muted-foreground/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                            <Shield className="h-3.5 w-3.5 text-primary" />
                            Upgrade Policy
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Policy</span>
                            <Badge variant="outline" className="text-[10px] py-0 uppercase">
                                {policy?.policy || 'CONSERVATIVE'}
                            </Badge>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Auto-Upgrade</span>
                            <span className="font-medium">
                                {policy?.auto_upgrade_enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        {policy?.next_available_version && policy.next_available_version !== install.installed_version && (
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold animate-pulse">
                                <ArrowUpCircle className="h-3 w-3" /> v{policy.next_available_version} available
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="bg-muted/10 border-muted-foreground/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            Recent Activity
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Installed At</span>
                            <span className="text-xs font-medium">
                                {format(new Date(install.installed_at), 'PPP')}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Last Updated</span>
                            <span className="text-xs font-medium">
                                {format(new Date(install.updated_at), 'PPP p')}
                            </span>
                        </div>
                        <Button variant="link" className="p-0 h-auto text-[10px] justify-start text-primary" onClick={onViewAudit}>
                            View Audit History →
                        </Button>
                    </CardContent>
                </Card>

                <Card className="bg-muted/10 border-muted-foreground/10">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                            <DollarSign className="h-3.5 w-3.5 text-primary" />
                            Cost Efficiency
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Assigned Cost</span>
                            <span className="font-bold text-slate-900">
                                {cost ? `$${cost.monthly_cost_usd.toFixed(2)}/mo` : 'Calculating...'}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1.5 mt-1">
                            <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">Utility Score</span>
                                <span className={cost && cost.efficiency > 80 ? "text-emerald-600" : "text-amber-500"}>
                                    {cost ? `${(cost.efficiency).toFixed(0)}%` : '--'}
                                </span>
                            </div>
                            <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-500 ${cost && cost.efficiency > 80 ? "bg-emerald-500" : "bg-amber-500"
                                        }`}
                                    style={{ width: `${cost ? Math.min(100, cost.efficiency) : 0}%` }}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Helm Test Execution (T9.01) */}
            <HelmTestSection install={install} />

            {/* Maintenance Windows (T9.03) */}
            <MaintenanceWindowSection install={install} />

            {/* Intelligence Section (Rightsizing T8.10) */}
            {reco && (
                <Card className="border-primary/20 bg-primary/5 overflow-hidden">
                    <div className="bg-primary/10 px-4 py-2 border-b border-primary/10 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-primary font-bold text-xs">
                            <Zap className="h-3.5 w-3.5 fill-primary" />
                            AI Rightsizing Recommendation
                        </div>
                        <Badge className="bg-primary/20 text-primary border-none text-[10px] px-2 py-0">
                            {(reco.confidence * 100).toFixed(0)}% Confidence
                        </Badge>
                    </div>
                    <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row gap-6 items-center">
                            <div className="flex-1">
                                <p className="text-sm text-slate-700 leading-relaxed mb-4">
                                    {reco.description}
                                </p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/50 p-3 rounded-lg border border-slate-200/50">
                                        <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Current Config</div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-sm font-semibold">{reco.current_cpu} Cores</span>
                                            <span className="text-[10px] text-slate-400">/</span>
                                            <span className="text-sm font-semibold">{reco.current_mem} Mi</span>
                                        </div>
                                    </div>
                                    <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                                        <div className="text-[10px] text-emerald-600 uppercase font-bold mb-1">Suggested Config</div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-sm font-bold text-emerald-700">{reco.suggested_cpu} Cores</span>
                                            <span className="text-[10px] text-emerald-300">/</span>
                                            <span className="text-sm font-bold text-emerald-700">{reco.suggested_mem} Mi</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="w-full md:w-auto flex flex-col items-center gap-3 p-4 bg-white/40 rounded-xl border border-white/60 shadow-sm min-w-[180px]">
                                <div className="flex items-center gap-2 text-emerald-600">
                                    <TrendingDown className="h-5 w-5" />
                                    <span className="text-xl font-black">${reco.monthly_savings_usd.toFixed(2)}</span>
                                </div>
                                <span className="text-[10px] text-slate-500 uppercase font-bold text-center">Estimated Monthly Savings</span>
                                <Button size="sm" className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700">
                                    <Scale className="h-3.5 w-3.5 mr-1.5" /> Apply Now
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <DollarSign className="h-4 w-4" />
                    Resource Footprint
                </h4>
                <CostDisplay
                    cpuMillicores={install.health?.ready_pods ? 100 : 0}
                    memoryMb={install.health?.ready_pods ? 256 : 0}
                    storageGb={0}
                    monthlyCostUsd={cost?.monthly_cost_usd || 0}
                />
            </div>
        </div>
    );
}
