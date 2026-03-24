import { motion } from 'framer-motion';
import {
  Container,
  CheckCircle2,
  XCircle,
  Cpu,
  MemoryStick,
  Clock,
  Terminal,
  FileText,
  Copy,
  ExternalLink,
  Box,
  BarChart2,
  Settings,
  Info,
  HardDrive,
  Variable,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DetailRow } from './DetailRow';
import { SectionCard } from './SectionCard';
import {
  TOOLTIP_CPU_M,
  TOOLTIP_MEMORY_MIB,
  TOOLTIP_IMAGE_PULL_POLICY,
  TOOLTIP_PROBE_DELAY,
  TOOLTIP_PROBE_TIMEOUT,
  TOOLTIP_PROBE_PERIOD,
  TOOLTIP_PROBE_SUCCESS,
  TOOLTIP_PROBE_FAILURE,
  TOOLTIP_MOUNT_READONLY,
  TOOLTIP_HIGH_RESTART,
  TOOLTIP_CONTAINER_ID,
  TOOLTIP_CONTAINER_CPU_USAGE_PCT,
  TOOLTIP_CONTAINER_MEMORY_USAGE_PCT,
  TOOLTIP_READY,
  TOOLTIP_LAST_EXIT,
} from '@/lib/k8sTooltips';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { usePortForwardStore } from '@/stores/portForwardStore';
import { Square } from 'lucide-react';

export interface ContainerInfo {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: 'running' | 'waiting' | 'terminated';
  stateReason?: string;
  ports?: { containerPort: number; protocol: string; name?: string }[];
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  currentUsage?: { cpu: number; memory: number; cpuRaw?: number; memoryRaw?: number };
  /** Status (from pod.status.containerStatuses) */
  startedAt?: string;
  lastState?: { reason: string; exitCode?: number; startedAt?: string; finishedAt?: string };
  containerID?: string;
  imageID?: string;
  imagePullPolicy?: string;
  env?: { name: string; value?: string; valueFrom?: unknown }[];
  livenessProbe?: Record<string, unknown>;
  readinessProbe?: Record<string, unknown>;
  volumeMounts?: { name: string; mountPath: string; readOnly?: boolean }[];
}

export interface ContainersSectionProps {
  containers: ContainerInfo[];
  className?: string;
  /** Resource name (pod name) — used to show active port forwards inline. */
  resourceName?: string;
  /** Namespace — used to filter active port forwards. */
  namespace?: string;
  /** Called when user clicks "Forward port" for a container port; PodDetail can open PortForwardDialog. */
  onForwardPort?: (containerName: string, port: number) => void;
  /** Called when user clicks "Shell" on a container — switches to Terminal tab with that container pre-selected. */
  onOpenShell?: (containerName: string) => void;
  /** Called when user clicks "Logs" on a container — switches to Logs tab with that container pre-selected. */
  onOpenLogs?: (containerName: string) => void;
}

const stateConfig = {
  running: { icon: CheckCircle2, color: 'text-[hsl(var(--success))]', bg: 'bg-[hsl(var(--success)/0.1)]', label: 'Running' },
  waiting: { icon: Clock, color: 'text-[hsl(var(--warning))]', bg: 'bg-[hsl(var(--warning)/0.1)]', label: 'Waiting' },
  terminated: { icon: XCircle, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Terminated' },
};

interface ProbeHttpGet {
  path?: string;
  port?: number | string;
}

interface ProbeTcpSocket {
  port?: number | string;
}

interface Probe {
  httpGet?: ProbeHttpGet;
  tcpSocket?: ProbeTcpSocket;
  exec?: unknown;
  grpc?: unknown;
  initialDelaySeconds?: number;
  timeoutSeconds?: number;
  periodSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

function probeToChips(probe: Record<string, unknown> | undefined): string[] {
  if (!probe || typeof probe !== 'object') return [];
  const chips: string[] = [];
  const typedProbe = probe as Probe;

  if (typedProbe.httpGet && typeof typedProbe.httpGet.path === 'string') {
    chips.push(`path: ${typedProbe.httpGet.path}`);
  }
  if (typedProbe.httpGet && typedProbe.httpGet.port !== undefined) {
    chips.push(`port: ${typedProbe.httpGet.port}`);
  }
  if (typedProbe.tcpSocket && typedProbe.tcpSocket.port !== undefined) {
    chips.push(`tcp:${typedProbe.tcpSocket.port}`);
  }
  if (typedProbe.exec) chips.push('exec');
  if (typedProbe.grpc) chips.push('grpc');
  if (typedProbe.initialDelaySeconds != null) chips.push(`delay=${typedProbe.initialDelaySeconds}s`);
  if (typedProbe.timeoutSeconds != null) chips.push(`timeout=${typedProbe.timeoutSeconds}s`);
  if (typedProbe.periodSeconds != null) chips.push(`period=${typedProbe.periodSeconds}s`);
  if (typedProbe.successThreshold != null) chips.push(`#success=${typedProbe.successThreshold}`);
  if (typedProbe.failureThreshold != null) chips.push(`#failure=${typedProbe.failureThreshold}`);
  return chips;
}

export function ContainersSection({ containers, className, resourceName, namespace, onForwardPort, onOpenShell, onOpenLogs }: ContainersSectionProps) {
  const activeForwards = usePortForwardStore((s) => s.forwards).filter(
    (f) => f.resourceName === resourceName && f.namespace === namespace
  );
  const stopAndRemove = usePortForwardStore((s) => s.stopAndRemove);
  return (
    <div className={cn('space-y-4', className)}>
      {containers.map((container, index) => {
        const state = stateConfig[container.state];
        const StateIcon = state.icon;

        return (
          <motion.div
            key={container.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="overflow-hidden rounded-xl border border-border/50 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40 bg-muted/5 px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={cn('p-2.5 rounded-xl shrink-0', state.bg)}>
                      <Container className={cn('h-5 w-5', state.color)} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-lg font-semibold tracking-tight">{container.name}</CardTitle>
                      <p className="text-sm text-muted-foreground font-mono truncate mt-1">{container.image}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className={cn('gap-1.5 px-2.5 py-0.5', state.bg, state.color)}>
                      <StateIcon className="h-3 w-3" />
                      {state.label}
                      {container.stateReason && ` (${container.stateReason})`}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => onOpenShell?.(container.name)}
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      Shell
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => onOpenLogs?.(container.name)}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Logs
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* 1. Status (left) + Resources & Usage (right) at top */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <SectionCard
                    icon={Box}
                    title="Status"
                    tooltip={
                      <>
                        <p className="font-medium">Status</p>
                        <p className="mt-1 text-muted-foreground text-xs">Ready — container passes readiness and can receive traffic. Restarts — high count may indicate crashes or OOM. Check logs and events.</p>
                      </>
                    }
                  >
                    <div className="space-y-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/40 px-4 py-3 cursor-help">
                            <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                              <CheckCircle2 className={cn('h-4 w-4', container.ready ? 'text-[hsl(var(--success))]' : 'text-muted-foreground/70')} />
                              Ready
                            </span>
                            <span className={cn('font-semibold text-sm', container.ready ? 'text-[hsl(var(--success))]' : 'text-muted-foreground')}>{container.ready ? 'Yes' : 'No'}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">{TOOLTIP_READY}</TooltipContent>
                      </Tooltip>
                      {container.startedAt && (
                        <div className="rounded-lg bg-muted/20 border border-border/30 px-4 py-2">
                          <DetailRow label="Started" value={new Date(container.startedAt).toLocaleString()} tooltip={container.startedAt} />
                        </div>
                      )}
                      <div className="rounded-lg bg-muted/20 border border-border/30 px-4 py-2">
                        <DetailRow
                          label="Restart Count"
                          value={<span className={cn('tabular-nums font-semibold', container.restartCount > 5 && 'text-destructive')}>{container.restartCount}</span>}
                          tooltip={container.restartCount > 5 ? TOOLTIP_HIGH_RESTART : undefined}
                        />
                      </div>
                      {container.lastState && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1.5 cursor-help">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last exit</span>
                              </div>
                              <span className="text-sm font-semibold text-destructive">
                                {container.lastState.reason}
                                {container.lastState.exitCode != null ? ` (exit ${container.lastState.exitCode})` : ''}
                              </span>
                              {container.lastState.startedAt && <p className="text-xs text-muted-foreground">Started: {new Date(container.lastState.startedAt).toLocaleString()}</p>}
                              {container.lastState.finishedAt && <p className="text-xs text-muted-foreground">Finished: {new Date(container.lastState.finishedAt).toLocaleString()}</p>}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">{TOOLTIP_LAST_EXIT}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </SectionCard>
                  <SectionCard
                    icon={BarChart2}
                    title="Resources & Usage"
                    tooltip={
                      <>
                        <p className="font-medium">Resources & Usage</p>
                        <p className="mt-1 text-muted-foreground text-xs">CPU/Memory % are vs container limits. Requests/Limits use m (millicores) and Mi (mebibytes).</p>
                      </>
                    }
                  >
                    <div className="space-y-4">
                      {/* CPU Usage */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="flex items-center gap-2 text-foreground/70"><Cpu className="h-4 w-4" /> CPU</span>
                          {(container.currentUsage?.cpu ?? -1) >= 0 ? (
                            <span className={cn('font-semibold tabular-nums', (container.currentUsage?.cpu ?? 0) > 80 && 'text-destructive')}>
                              {(container.currentUsage?.cpu ?? 0).toFixed(1)}%
                              {(container.currentUsage?.cpu ?? 0) > 80 && <AlertCircle className="inline h-3.5 w-3.5 ml-1 text-destructive" />}
                            </span>
                          ) : (
                            <span className="font-semibold tabular-nums text-foreground">
                              {container.currentUsage?.cpuRaw != null && container.currentUsage.cpuRaw > 0
                                ? `${container.currentUsage.cpuRaw.toFixed(1)}m`
                                : '—'}
                            </span>
                          )}
                        </div>
                        {(container.currentUsage?.cpu ?? -1) >= 0 ? (
                          <>
                            <Progress value={container.currentUsage?.cpu ?? 0} className="h-2.5 rounded-full bg-muted/60" />
                            <p className="text-[11px] text-foreground/50">{(container.currentUsage?.cpu ?? 0).toFixed(1)}% of limit</p>
                          </>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="text-[11px] text-amber-600 cursor-help flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> No CPU limit — set limits to prevent resource contention
                              </p>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">Without CPU limits, this container can consume unlimited CPU on the node. Add spec.containers[].resources.limits.cpu to your Pod manifest.</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {/* Memory Usage */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="flex items-center gap-2 text-foreground/70"><MemoryStick className="h-4 w-4" /> Memory</span>
                          {(container.currentUsage?.memory ?? -1) >= 0 ? (
                            <span className={cn('font-semibold tabular-nums', (container.currentUsage?.memory ?? 0) > 80 && 'text-destructive')}>
                              {(container.currentUsage?.memory ?? 0).toFixed(1)}%
                              {(container.currentUsage?.memory ?? 0) > 80 && <AlertCircle className="inline h-3.5 w-3.5 ml-1 text-destructive" />}
                            </span>
                          ) : (
                            <span className="font-semibold tabular-nums text-foreground">
                              {container.currentUsage?.memoryRaw != null && container.currentUsage.memoryRaw > 0
                                ? `${(container.currentUsage.memoryRaw / (1024 * 1024)).toFixed(1)} Mi`
                                : '—'}
                            </span>
                          )}
                        </div>
                        {(container.currentUsage?.memory ?? -1) >= 0 ? (
                          <>
                            <Progress value={container.currentUsage?.memory ?? 0} className="h-2.5 rounded-full bg-muted/60" />
                            <p className="text-[11px] text-foreground/50">{(container.currentUsage?.memory ?? 0).toFixed(1)}% of limit</p>
                          </>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="text-[11px] text-amber-600 cursor-help flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> No memory limit — OOM kills can happen unexpectedly
                              </p>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">Without memory limits, this container may be OOM-killed by the kernel without warning. Add spec.containers[].resources.limits.memory to your Pod manifest.</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="pt-2 border-t border-border/40 space-y-1.5">
                        <DetailRow label="CPU Request" value={container.resources?.requests?.cpu ?? '-'} tooltip={container.resources?.requests?.cpu ? TOOLTIP_CPU_M : undefined} />
                        <DetailRow label="CPU Limit" value={container.resources?.limits?.cpu ?? '-'} tooltip={container.resources?.limits?.cpu ? TOOLTIP_CPU_M : undefined} />
                        <DetailRow label="Memory Request" value={container.resources?.requests?.memory ?? '-'} tooltip={container.resources?.requests?.memory ? TOOLTIP_MEMORY_MIB : undefined} />
                        <DetailRow label="Memory Limit" value={container.resources?.limits?.memory ?? '-'} tooltip={container.resources?.limits?.memory ? TOOLTIP_MEMORY_MIB : undefined} />
                      </div>
                    </div>
                  </SectionCard>
                </div>

                {/* 2. Runtime */}
                <SectionCard
                  icon={Box}
                  title="Runtime"
                  tooltip={
                    <>
                      <p className="font-medium">Runtime</p>
                      <p className="mt-1 text-muted-foreground text-xs">Container ID, image, and ports. Standardized for deep inspection.</p>
                    </>
                  }
                >
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="group relative">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-1.5 block">Container ID</span>
                          <div className="flex items-center gap-2 rounded-xl bg-muted/30 border border-border/40 p-3 font-mono text-xs transition-colors hover:bg-muted/50 group-hover:border-primary/20">
                            <span className="truncate flex-1 text-foreground/80">{container.containerID || '—'}</span>
                            {container.containerID && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => { navigator.clipboard.writeText(container.containerID!); toast.success('Copied'); }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="group relative">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-1.5 block">Image Reference</span>
                          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2">
                            <div className="flex items-center justify-between gap-4">
                              <div className="font-mono text-sm font-semibold text-primary/90 truncate">{container.image || '—'}</div>
                              {container.imagePullPolicy && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-tighter bg-background/50 border-primary/20">{container.imagePullPolicy}</Badge>
                              )}
                            </div>
                            {container.imageID && (
                              <p className="text-[10px] text-muted-foreground font-mono truncate">{container.imageID}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-1.5 block">Exposed Ports</span>
                        {container.ports && container.ports.length > 0 ? (
                          <div className="rounded-xl border border-border/40 bg-muted/10 divide-y divide-border/30 overflow-hidden">
                            {container.ports.map((p, pIdx) => {
                              const activeFwd = activeForwards.find((f) => f.remotePort === p.containerPort);
                              return (
                                <div key={`${p.containerPort}-${pIdx}`} className="group hover:bg-muted/30 transition-colors">
                                  <div className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-foreground">{p.containerPort}</span>
                                        <span className="text-[10px] text-muted-foreground uppercase">{p.protocol || 'TCP'}</span>
                                      </div>
                                      {p.name && (
                                        <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0">{p.name}</Badge>
                                      )}
                                    </div>
                                    {onForwardPort && !activeFwd && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 text-[10px] font-bold uppercase tracking-tight border-primary/20 hover:bg-primary/10 hover:border-primary/40 text-primary"
                                        onClick={() => onForwardPort(container.name, p.containerPort)}
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        Forward
                                      </Button>
                                    )}
                                  </div>
                                  {activeFwd && (
                                    <div className="flex items-center justify-between px-4 py-2 bg-emerald-50/50 dark:bg-emerald-950/20 border-t border-emerald-200/40 dark:border-emerald-800/30">
                                      <div className="flex items-center gap-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                          localhost:{activeFwd.localPort} → {activeFwd.remotePort}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 text-[10px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                          onClick={() => window.open(`http://localhost:${activeFwd.localPort}`, '_blank')}
                                        >
                                          <ExternalLink className="h-3 w-3 mr-1" />
                                          Open
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 text-[10px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                                          onClick={() => stopAndRemove(activeFwd.sessionId)}
                                        >
                                          <Square className="h-3 w-3 mr-1" />
                                          Stop
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-border/60 p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-muted/5">
                            <Box className="h-5 w-5 opacity-20" />
                            <span className="text-xs font-medium">No ports detected</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {/* 3. Configuration */}
                <SectionCard
                  icon={Settings}
                  title="Configuration"
                  tooltip={
                    <>
                      <p className="font-medium">Configuration</p>
                      <p className="mt-1 text-muted-foreground text-xs">Environment variables and volume mounts. ro = read-only.</p>
                    </>
                  }
                >
                  <div className="space-y-6">
                    {container.env && container.env.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Variable className="h-4 w-4 text-primary/80" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Environment</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {container.env.map((e) => (
                            <Tooltip key={e.name}>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 cursor-help hover:bg-muted/50 transition-colors">
                                  <span className="font-semibold text-sm text-foreground shrink-0">{e.name}</span>
                                  <span className="text-muted-foreground text-xs shrink-0">=</span>
                                  <span className="font-mono text-xs text-foreground truncate min-w-0">{e.value ?? '(from valueFrom)'}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">{e.valueFrom ? 'From: fieldRef / configMapKeyRef / secretKeyRef' : String(e.value)}</TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    )}
                    {(container.livenessProbe || container.readinessProbe) && (
                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Health probes</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {container.livenessProbe && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                                  <div className="px-3 py-2 border-b border-border/40 bg-[hsl(var(--success)/0.08)]">
                                    <span className="text-xs font-semibold text-[hsl(var(--success))]">Liveness</span>
                                  </div>
                                  <div className="p-3 flex flex-wrap gap-1.5">
                                    {probeToChips(container.livenessProbe).map((chip, i) => (
                                      <span key={i} className="inline-flex rounded-md bg-background/80 border border-border/40 px-2 py-0.5 font-mono text-[11px] font-medium">
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs"><p className="font-medium mb-1">Probe params</p><p className="text-xs">{TOOLTIP_PROBE_DELAY}</p><p className="text-xs">{TOOLTIP_PROBE_TIMEOUT}</p><p className="text-xs">{TOOLTIP_PROBE_PERIOD}</p></TooltipContent>
                            </Tooltip>
                          )}
                          {container.readinessProbe && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                                  <div className="px-3 py-2 border-b border-border/40 bg-[hsl(var(--primary)/0.1)]">
                                    <span className="text-xs font-semibold text-primary">Readiness</span>
                                  </div>
                                  <div className="p-3 flex flex-wrap gap-1.5">
                                    {probeToChips(container.readinessProbe).map((chip, i) => (
                                      <span key={i} className="inline-flex rounded-md bg-background/80 border border-border/40 px-2 py-0.5 font-mono text-[11px] font-medium">
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs"><p className="font-medium mb-1">Probe params</p><p className="text-xs">{TOOLTIP_PROBE_DELAY}</p><p className="text-xs">{TOOLTIP_PROBE_TIMEOUT}</p><p className="text-xs">{TOOLTIP_PROBE_PERIOD}</p></TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    )}
                    {container.volumeMounts && container.volumeMounts.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-primary/80" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Volume mounts</span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-border/50">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/40 border-b border-border/50">
                                <th className="text-left py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mount path</th>
                                <th className="text-left py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                                <th className="text-left py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">I/O</th>
                              </tr>
                            </thead>
                            <tbody>
                              {container.volumeMounts.map((vm, i) => (
                                <tr key={vm.mountPath} className={cn('border-b border-border/30 last:border-0 transition-colors hover:bg-muted/20', i % 2 === 1 && 'bg-muted/5')}>
                                  <td className="py-2.5 px-4 font-mono text-xs text-foreground">{vm.mountPath}</td>
                                  <td className="py-2.5 px-4 font-mono text-xs text-foreground">{vm.name}</td>
                                  <td className="py-2.5 px-4">
                                    {vm.readOnly ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium cursor-help border border-amber-500/20">Read only</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs">{TOOLTIP_MOUNT_READONLY}</TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="inline-flex rounded-md bg-muted/60 px-2 py-0.5 text-xs font-medium">Read/write</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {(!container.env?.length && !container.livenessProbe && !container.readinessProbe && !container.volumeMounts?.length) && (
                      <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
                        No environment or mounts configured
                      </div>
                    )}
                  </div>
                </SectionCard>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
