import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Bug,
  Clock,
  Server,
  RotateCcw,
  Terminal,
  FileText,
  ExternalLink,
  Copy,
  HardDrive,
  Activity,
  LayoutDashboard,
  Info,
  BarChart2,
  FolderOpen,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import {
  GenericResourceDetail,
  SectionCard,
  ContainersSection,
  DetailRow,
  LogViewer,
  PortForwardDialog,
  FileTransferDialog,
  DebugContainerDialog,
  MetricsDashboard,
  LabelList,
  AnnotationList,
  TolerationsList,
  type ContainerInfo,
  type ResourceContext,
  type ResourceStatus,
  type CustomTab,
} from '@/components/resources';
import { PodTerminal } from '@/components/resources/PodTerminal';
import { PodWorkspace } from '@/components/resources/PodWorkspace';
import {
  TOOLTIP_RESTART_POLICY,
  TOOLTIP_DNS_POLICY,
  TOOLTIP_TERMINATION_GRACE,
  TOOLTIP_PRIORITY,
  TOOLTIP_VOLUME_KIND,
  TOOLTIP_VOLUME_DEFAULT_MODE,
} from '@/lib/k8sTooltips';
import { calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useMetricsSummary } from '@/hooks/useMetricsSummary';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useTrackRecentResource } from '@/hooks/useTrackRecentResource';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { cn } from '@/lib/utils';

function parseCPUToMillicores(s: string): number {
  if (!s || s === '-') return 0;
  const v = parseFloat(s.replace(/[nmuµ]$/i, '').trim());
  if (Number.isNaN(v)) return 0;
  if (s.endsWith('n')) return v / 1e6;
  if (s.endsWith('u') || s.endsWith('µ')) return v / 1000;
  if (s.endsWith('m')) return v;
  return v * 1000;
}

function parseMemoryToBytes(s: string): number {
  if (!s || s === '-') return 0;
  const num = parseFloat(s.replace(/[KMGT]i?$/i, '').trim());
  if (Number.isNaN(num)) return 0;
  if (s.endsWith('Ki')) return num * 1024;
  if (s.endsWith('Mi')) return num * 1024 * 1024;
  if (s.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  if (s.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
  if (s.endsWith('K')) return num * 1000;
  if (s.endsWith('M')) return num * 1000 * 1000;
  if (s.endsWith('G')) return num * 1000 * 1000 * 1000;
  if (s.endsWith('T')) return num * 1000 * 1000 * 1000 * 1000;
  return num;
}

interface PodResource extends KubernetesResource {
  status?: {
    phase?: string;
    podIP?: string;
    podIPs?: Array<{ ip?: string }>;
    hostIP?: string;
    qosClass?: string;
    startTime?: string;
    conditions?: Array<{ type: string; status: string; lastTransitionTime: string; reason?: string; message?: string }>;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state: {
        running?: { startedAt?: string };
        waiting?: { reason: string; message?: string };
        terminated?: { reason: string; exitCode?: number; startedAt?: string; finishedAt?: string };
      };
      lastState?: {
        running?: { startedAt?: string };
        waiting?: { reason: string; message?: string };
        terminated?: { reason: string; exitCode?: number; startedAt?: string; finishedAt?: string };
      };
      image: string;
      imageID?: string;
      containerID?: string;
    }>;
  };
  spec?: {
    nodeName?: string;
    serviceAccountName?: string;
    restartPolicy?: string;
    dnsPolicy?: string;
    terminationGracePeriodSeconds?: number;
    priority?: number;
    containers?: Array<{
      name: string;
      image: string;
      imagePullPolicy?: string;
      ports?: Array<{ containerPort: number; protocol: string; name?: string }>;
      resources?: {
        requests?: { cpu?: string; memory?: string };
        limits?: { cpu?: string; memory?: string };
      };
      env?: Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }>;
      volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }>;
      livenessProbe?: Record<string, unknown>;
      readinessProbe?: Record<string, unknown>;
    }>;
    volumes?: Array<{
      name: string;
      configMap?: { name: string };
      secret?: { secretName: string };
      emptyDir?: Record<string, never>;
      persistentVolumeClaim?: { claimName: string };
      projected?: {
        defaultMode?: number;
        sources?: Array<{ serviceAccountToken?: { audience?: string }; configMap?: { name: string }; downwardAPI?: Record<string, never> }>;
      };
    }>;
    affinity?: Record<string, unknown>;
    tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string; tolerationSeconds?: number }>;
    nodeSelector?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PodDetail() {
  const { namespace, name } = useParams();
  useTrackRecentResource({ resourceKind: 'Pod', name, namespace });
  const clusterId = useActiveClusterId();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerFilterFromUrl = searchParams.get('container');

  const [selectedContainerFilter, setSelectedContainerFilter] = useState<string | null>(() => {
    return containerFilterFromUrl === '' || containerFilterFromUrl === 'all' ? null : containerFilterFromUrl;
  });
  useEffect(() => {
    const c = searchParams.get('container');
    setSelectedContainerFilter(c === '' || c === 'all' || !c ? null : c);
  }, [searchParams]);
  const [selectedLogContainer, setSelectedLogContainer] = useState<string | undefined>(undefined);
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string | undefined>(undefined);
  const [showPortForwardDialog, setShowPortForwardDialog] = useState(false);
  const [showFileTransferDialog, setShowFileTransferDialog] = useState(false);
  const [showDebugContainerDialog, setShowDebugContainerDialog] = useState(false);
  const [portForwardInitial, setPortForwardInitial] = useState<{ containerName: string; port: number } | null>(null);

  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data: metricsResult } = useMetricsSummary('pod', namespace ?? undefined, name ?? undefined, { enabled: !!namespace && !!name });

  // GenericResourceDetail manages tab state via URL search params.
  // To programmatically switch tabs (e.g. "Open Shell" -> terminal), we update the search params.
  const switchToTab = useCallback((tabId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === 'overview') next.delete('tab');
      else next.set('tab', tabId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Helper to build containers from a pod resource + metrics
  const buildContainers = useCallback((pod: PodResource, podMetrics: { CPU?: string; Memory?: string; containers?: Array<{ name: string; cpu: string; memory: string }> } | undefined): ContainerInfo[] => {
    const specContainers = pod.spec?.containers || [];
    const containerStatuses = pod.status?.containerStatuses || [];
    const containerMetricsList = podMetrics?.containers ?? [];
    const podCpuMc = podMetrics?.CPU ? parseCPUToMillicores(podMetrics.CPU) : 0;
    const podMemBytes = podMetrics?.Memory ? parseMemoryToBytes(podMetrics.Memory) : 0;
    const containerCount = specContainers.length;

    return specContainers.map((c) => {
      const containerStatus = containerStatuses.find((s) => s.name === c.name);
      const cm = containerMetricsList.find((m) => m.name === c.name);

      const usageCpuMc = cm ? parseCPUToMillicores(cm.cpu) : containerCount > 0 ? podCpuMc / containerCount : 0;
      const usageMemBytes = cm ? parseMemoryToBytes(cm.memory) : containerCount > 0 ? podMemBytes / containerCount : 0;
      const limitCpuMc = c.resources?.limits?.cpu ? parseCPUToMillicores(c.resources.limits.cpu) : 0;
      const limitMemBytes = c.resources?.limits?.memory ? parseMemoryToBytes(c.resources.limits.memory) : 0;
      const cpuPct = limitCpuMc > 0 ? Math.min(100, Math.round((usageCpuMc / limitCpuMc) * 100)) : -1;
      const memPct = limitMemBytes > 0 ? Math.min(100, Math.round((usageMemBytes / limitMemBytes) * 100)) : -1;

      const lastState = containerStatus?.lastState?.terminated ?? containerStatus?.lastState?.waiting;
      return {
        name: c.name,
        image: c.image,
        ready: containerStatus?.ready ?? false,
        restartCount: containerStatus?.restartCount ?? 0,
        state: containerStatus?.state?.running ? 'running' : containerStatus?.state?.waiting ? 'waiting' : 'terminated',
        stateReason: containerStatus?.state?.waiting?.reason ?? containerStatus?.state?.terminated?.reason,
        ports: c.ports ?? [],
        resources: c.resources ?? {},
        currentUsage: { cpu: cpuPct, memory: memPct, cpuRaw: usageCpuMc, memoryRaw: usageMemBytes },
        startedAt: containerStatus?.state?.running?.startedAt,
        lastState: lastState
          ? {
            reason: lastState.reason ?? 'Unknown',
            exitCode: (lastState as { exitCode?: number }).exitCode,
            startedAt: (lastState as { startedAt?: string }).startedAt,
            finishedAt: (lastState as { finishedAt?: string }).finishedAt,
          }
          : undefined,
        containerID: containerStatus?.containerID,
        imageID: containerStatus?.imageID,
        imagePullPolicy: c.imagePullPolicy,
        env: c.env,
        livenessProbe: c.livenessProbe,
        readinessProbe: c.readinessProbe,
        volumeMounts: c.volumeMounts,
      };
    });
  }, []);

  const customTabs: CustomTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      render: (ctx) => {
        const pod = ctx.resource;
        const conditions = pod.status?.conditions || [];
        const ownerRef = pod.metadata?.ownerReferences?.[0];
        const ownerKindToPath: Record<string, string> = {
          ReplicaSet: 'replicasets', Deployment: 'deployments', StatefulSet: 'statefulsets',
          DaemonSet: 'daemonsets', Job: 'jobs', CronJob: 'cronjobs',
        };
        const ownerPath = ownerRef ? ownerKindToPath[ownerRef.kind] : null;

        const podIPsList = (pod.status?.podIPs?.map((p) => p.ip).filter(Boolean) as string[]) ?? (pod.status?.podIP ? [pod.status.podIP] : []);
        const hostIPsList = pod.status?.hostIP ? [pod.status.hostIP] : [];

        const volumes = (pod.spec?.volumes || []).map((v) => {
          const kind = v.configMap ? 'ConfigMap' : v.secret ? 'Secret' : v.persistentVolumeClaim ? 'PVC' : v.emptyDir ? 'EmptyDir' : v.projected ? 'Projected' : 'Other';
          const source = v.configMap?.name || v.secret?.secretName || v.persistentVolumeClaim?.claimName || 'N/A';
          const projectedSources = v.projected?.sources?.map((s) => {
            if (s.serviceAccountToken) return 'serviceAccountToken';
            if (s.configMap) return `configMap:${s.configMap.name}`;
            if (s.downwardAPI) return 'downwardAPI';
            return 'unknown';
          });
          return {
            name: v.name, kind, source,
            defaultMode: v.projected?.defaultMode,
            projectedSources: projectedSources?.join(', ') || undefined,
          };
        });

        return (
          <div className="space-y-6">
            {/* Pod overview */}
            <SectionCard
              icon={LayoutDashboard}
              title="Pod overview"
              tooltip={
                <>
                  <p className="font-medium">Pod overview</p>
                  <p className="mt-1 text-muted-foreground text-xs">Scheduling, networking, and ownership</p>
                </>
              }
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                  {ownerRef && ownerPath && (
                    <DetailRow
                      label="Controlled by"
                      value={
                        <span className="flex items-center gap-1.5">
                          <Button
                            variant="link"
                            className="h-auto p-0 font-mono text-left"
                            onClick={() => navigate(`/${ownerPath}/${ownerRef.name}${namespace ? `?namespace=${namespace}` : ''}`)}
                          >
                            {ownerRef.kind}: {ownerRef.name}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(ownerRef.name); toast.success('Copied'); }}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </span>
                      }
                    />
                  )}
                  <DetailRow
                    label="Node"
                    value={
                      pod.spec?.nodeName ? (
                        <span className="flex items-center gap-1.5">
                          <Button variant="link" className="h-auto p-0 font-mono" onClick={() => navigate(`/nodes/${pod.spec!.nodeName}`)}>
                            {pod.spec.nodeName}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(pod.spec!.nodeName!); toast.success('Copied'); }}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </span>
                      ) : '-'
                    }
                  />
                  <DetailRow
                    label="Service Account"
                    value={
                      <span className="flex items-center gap-1.5 font-mono">
                        {pod.spec?.serviceAccountName || 'default'}
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(pod.spec?.serviceAccountName || 'default'); toast.success('Copied'); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </span>
                    }
                  />
                  <div className="space-y-1">
                    <DetailRow
                      label="Pod IP(s)"
                      value={
                        podIPsList.length > 0 ? (
                          <span className="flex items-center gap-1.5 flex-wrap">
                            {podIPsList.map((ip) => (
                              <span key={ip} className="flex items-center gap-1 font-mono">
                                {ip}
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(ip); toast.success('Copied'); }}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </span>
                            ))}
                          </span>
                        ) : '-'
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <DetailRow
                      label="Host IP(s)"
                      value={
                        hostIPsList.length > 0 ? (
                          <span className="flex items-center gap-1.5 flex-wrap">
                            {hostIPsList.map((ip) => (
                              <span key={ip} className="flex items-center gap-1 font-mono">
                                {ip}
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(ip); toast.success('Copied'); }}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </span>
                            ))}
                          </span>
                        ) : '-'
                      }
                    />
                  </div>
                  <DetailRow label="Priority" value={pod.spec?.priority ?? 0} tooltip={TOOLTIP_PRIORITY} />
                </div>
              </div>
            </SectionCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Runtime Configuration */}
              <SectionCard icon={Info} title="Runtime Configuration" tooltip={<p className="text-xs text-muted-foreground">Restart policy, DNS, and termination settings</p>}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <DetailRow label="Restart Policy" value={<Badge variant="outline">{pod.spec?.restartPolicy || 'Always'}</Badge>} tooltip={TOOLTIP_RESTART_POLICY} />
                  <DetailRow label="DNS Policy" value={<Badge variant="outline">{pod.spec?.dnsPolicy || 'ClusterFirst'}</Badge>} tooltip={TOOLTIP_DNS_POLICY} />
                  <DetailRow label="Termination Grace" value={`${pod.spec?.terminationGracePeriodSeconds ?? 30}s`} tooltip={TOOLTIP_TERMINATION_GRACE} />
                </div>
              </SectionCard>

              {/* Conditions */}
              <SectionCard icon={Activity} title="Conditions" tooltip={<><p className="font-medium">Conditions</p><p className="mt-1 text-muted-foreground text-xs">Current pod condition status</p></>}>
                <div className="space-y-3">
                  {conditions.map((condition) => {
                    const isTrue = condition.status === 'True';
                    const transitionExact = new Date(condition.lastTransitionTime).toLocaleString();
                    const transitionRelative = calculateAge(condition.lastTransitionTime);
                    const tooltipParts = [transitionExact];
                    if (condition.reason) tooltipParts.push(`Reason: ${condition.reason}`);
                    if (condition.message) tooltipParts.push(condition.message);
                    const tooltipContent = tooltipParts.join('\n');
                    return (
                      <div key={condition.type} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 flex-wrap">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge variant="secondary" className="font-medium text-xs bg-background">{condition.type}</Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              isTrue && 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
                              !isTrue && 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
                            )}
                          >
                            {condition.status}
                          </Badge>
                          {condition.message && <p className="text-xs text-muted-foreground">{condition.message}</p>}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2 shrink-0">{transitionRelative}</span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line">{tooltipContent}</TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            </div>

            {/* Labels */}
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <LabelList labels={pod.metadata?.labels ?? {}} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Volumes */}
              <SectionCard icon={HardDrive} title="Volumes" tooltip={<p className="text-xs text-muted-foreground">Volume definitions for this pod</p>}>
                {volumes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No volumes configured</p>
                ) : (
                  <div className="space-y-3">
                    {volumes.map((volume) => (
                      <div key={volume.name} className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="font-medium text-sm">{volume.name}</p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="text-xs cursor-help">{volume.kind}</Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              {TOOLTIP_VOLUME_KIND[volume.kind] ?? volume.kind}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-muted-foreground">Source: <span className="font-mono">{volume.source}</span></p>
                        {volume.projectedSources && <p className="text-xs text-muted-foreground">Sources: <span className="font-mono">{volume.projectedSources}</span></p>}
                        {volume.defaultMode != null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="text-xs text-muted-foreground cursor-help">defaultMode: <span className="font-mono">{volume.defaultMode}</span></p>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">{TOOLTIP_VOLUME_DEFAULT_MODE}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Tolerations */}
            {pod.spec?.tolerations && pod.spec.tolerations.length > 0 && (
              <TolerationsList tolerations={pod.spec.tolerations} />
            )}

            {/* Annotations */}
            <div className="lg:col-span-2">
              <AnnotationList annotations={pod.metadata?.annotations ?? {}} />
            </div>
          </div>
        );
      },
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Box,
      badge: (ctx) => ctx.resource?.spec?.containers?.length || undefined,
      render: (ctx) => {
        const pod = ctx.resource;
        const podMetrics = (() => {
          const summary = metricsResult?.summary;
          const p = summary?.pods?.[0];
          if (!p) return undefined;
          return { CPU: p.cpu, Memory: p.memory, containers: p.containers ?? [] };
        })();
        const containers = buildContainers(pod, podMetrics);
        const filteredContainers = selectedContainerFilter && selectedContainerFilter !== 'all'
          ? containers.filter((c) => c.name === selectedContainerFilter)
          : containers;

        return (
          <div className="space-y-4">
            {containers.length > 1 && (
              <div className="flex items-center gap-3">
                <Label htmlFor="container-filter" className="text-sm font-medium text-muted-foreground shrink-0">Container</Label>
                <Select
                  value={selectedContainerFilter ?? 'all'}
                  onValueChange={(value) => {
                    const next = value === 'all' || !value ? null : value;
                    setSelectedContainerFilter(next);
                    setSearchParams((prev) => {
                      const p = new URLSearchParams(prev);
                      if (next) p.set('container', next);
                      else p.delete('container');
                      return p;
                    });
                  }}
                >
                  <SelectTrigger id="container-filter" className="w-[220px]">
                    <SelectValue placeholder="All containers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All containers</SelectItem>
                    {containers.map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <ContainersSection
              containers={filteredContainers}
              resourceName={name}
              namespace={namespace}
              onForwardPort={(containerName, port) => {
                setPortForwardInitial({ containerName, port });
                setShowPortForwardDialog(true);
              }}
              onOpenShell={(containerName) => {
                setSelectedTerminalContainer(containerName);
                switchToTab('terminal');
              }}
              onOpenLogs={(containerName) => {
                setSelectedLogContainer(containerName);
                switchToTab('logs');
              }}
            />
          </div>
        );
      },
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      render: (ctx) => {
        const pod = ctx.resource;
        const containers = (pod.spec?.containers || []).map(c => c.name);
        return (
          <LogViewer
            podName={name}
            namespace={namespace}
            containerName={selectedLogContainer || containers[0]}
            containers={containers}
            onContainerChange={setSelectedLogContainer}
          />
        );
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      render: (ctx) => {
        const pod = ctx.resource;
        const allContainers = [
          ...(pod.spec?.containers || []).map(c => c.name),
          ...(pod.spec?.ephemeralContainers || []).map(c => c.name),
        ];
        return (
          <PodWorkspace
            podName={name || ''}
            namespace={namespace || ''}
            containerName={selectedTerminalContainer || allContainers[0]}
            containers={allContainers}
            onContainerChange={setSelectedTerminalContainer}
            baseUrl={backendBaseUrl ?? ''}
            clusterId={clusterId ?? ''}
          />
        );
      },
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      render: (ctx) => <MetricsDashboard resourceType="pod" resourceName={name} namespace={namespace} podResource={ctx.resource} clusterId={clusterId} />,
    },
  ];

  return (
    <GenericResourceDetail<PodResource>
      resourceType="pods"
      kind="Pod"
      pluralLabel="Pods"
      listPath="/pods"
      resourceIcon={Box}
      loadingCardCount={4}
      customTabs={customTabs}
      deriveStatus={(pod) => (pod.status?.phase as ResourceStatus) || 'Unknown'}
      headerMetadata={(ctx) => {
        const pod = ctx.resource;
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {ctx.age}
            <span className="mx-2">•</span>
            <Server className="h-3.5 w-3.5" />
            {pod.spec?.nodeName || '-'}
            {ctx.isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        );
      }}
      extraHeaderActions={() => [
        { label: 'Port Forward', icon: ExternalLink, variant: 'outline', onClick: () => setShowPortForwardDialog(true), className: 'press-effect' },
      ]}
      extraActionItems={(ctx) => {
        const pod = ctx.resource;
        const ownerRef = pod.metadata?.ownerReferences?.[0];
        return [
          { icon: Terminal, label: 'Execute Shell', description: 'Open interactive terminal in container', onClick: () => switchToTab('terminal') },
          { icon: FileText, label: 'View Logs', description: 'Stream logs from container', onClick: () => switchToTab('logs') },
          { icon: ExternalLink, label: 'Port Forward', description: 'Forward local port to container', onClick: () => setShowPortForwardDialog(true) },
          { icon: FolderOpen, label: 'Browse Files', description: 'Browse, upload, and download container files', onClick: () => setShowFileTransferDialog(true) },
          { icon: Bug, label: 'Debug Container', description: 'Attach an ephemeral debug container', onClick: () => setShowDebugContainerDialog(true) },
          { icon: RotateCcw, label: 'Restart Pod', description: 'Delete and recreate the pod (controller will recreate)', variant: 'warning', onClick: async () => {
            if (ctx.isConnected && ctx.name && ctx.namespace) {
              try {
                const { deleteResource } = await import('@/services/api/resources');
                await deleteResource(ctx.backendBaseUrl, ctx.clusterId || '', 'pods', ctx.namespace, ctx.name);
                toast.success(`Pod ${ctx.name} deleted — controller will recreate it`);
                ctx.refetch();
              } catch (error: unknown) {
                toast.error(`Failed to restart: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }},
        ];
      }}
      extraDialogs={(ctx) => {
        const pod = ctx.resource;
        return (
          <>
            <PortForwardDialog
              open={showPortForwardDialog}
              onOpenChange={(open) => {
                setShowPortForwardDialog(open);
                if (!open) setPortForwardInitial(null);
              }}
              podName={pod.metadata?.name || ''}
              namespace={pod.metadata?.namespace || ''}
              baseUrl={backendBaseUrl ?? ''}
              clusterId={clusterId ?? ''}
              containers={(pod.spec?.containers || []).map(c => ({
                name: c.name,
                ports: c.ports,
              }))}
              initialContainer={portForwardInitial?.containerName}
              initialPort={portForwardInitial?.port}
            />
            <FileTransferDialog
              open={showFileTransferDialog}
              onOpenChange={setShowFileTransferDialog}
              podName={pod.metadata?.name || ''}
              namespace={pod.metadata?.namespace || ''}
              baseUrl={backendBaseUrl ?? ''}
              clusterId={clusterId ?? ''}
              containers={(pod.spec?.containers || []).map(c => ({ name: c.name }))}
            />
            <DebugContainerDialog
              open={showDebugContainerDialog}
              onOpenChange={setShowDebugContainerDialog}
              podName={pod.metadata?.name || ''}
              namespace={pod.metadata?.namespace || ''}
              baseUrl={backendBaseUrl ?? ''}
              clusterId={clusterId ?? ''}
              containers={[
                ...(pod.spec?.containers || []).map(c => c.name),
                ...(pod.spec?.ephemeralContainers || []).map(c => c.name),
              ]}
              onCreated={() => switchToTab('terminal')}
            />
          </>
        );
      }}
      buildStatusCards={(ctx) => {
        const pod = ctx.resource;
        const containerStatuses = pod.status?.containerStatuses || [];
        const readyContainers = containerStatuses.filter(c => c.ready).length;
        const totalContainers = pod.spec?.containers?.length || containerStatuses.length;
        const totalRestarts = containerStatuses.reduce((sum, c) => sum + c.restartCount, 0);

        return [
          { label: 'Ready', value: `${readyContainers}/${totalContainers}`, icon: Server, iconColor: 'success' as const },
          { label: 'Restarts', value: totalRestarts, icon: RotateCcw, iconColor: totalRestarts > 0 ? 'warning' as const : 'info' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'primary' as const },
          { label: 'QoS Class', value: pod.status?.qosClass || 'Unknown', icon: Activity, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
