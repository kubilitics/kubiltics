import { useState, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { diagnoseWorkload } from '@/lib/diagnose';
import type { DiagnoseAction } from '@/lib/diagnose/types';
import { DiagnosePanel } from '@/components/diagnose/DiagnosePanel';
import {
  Cpu,
  Clock,
  Server,
  RotateCcw,
  CheckCircle2,
  Activity,
  Box,
  FileText,
  Terminal,
  LayoutDashboard,
  Layers,
  BarChart2,
  Settings,
  History,
  Gauge,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/sonner';
import {
  GenericResourceDetail,
  ContainersSection,
  LabelList,
  AnnotationList,
  MetricsDashboard,
  RolloutActionsDialog,
  SectionCard,
  DetailRow,
  DetailPodTable,
  WorkloadLogsTab,
  type CustomTab,
  type ResourceContext,
  type ContainerInfo,
} from '@/components/resources';
import { WorkloadTerminalTab } from '@/components/resources/WorkloadTerminalTab';
import { useK8sResourceList, usePatchK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useMutationPolling } from '@/hooks/useMutationPolling';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useQuery } from '@tanstack/react-query';
import { getDaemonSetMetrics } from '@/services/backendApiClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DaemonSetResource extends KubernetesResource {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    updateStrategy?: { type: string; rollingUpdate?: { maxUnavailable?: string } };
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol: string }>;
          resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } };
        }>;
        nodeSelector?: Record<string, string>;
        tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string }>;
      };
    };
  };
  status?: {
    currentNumberScheduled?: number;
    desiredNumberScheduled?: number;
    numberReady?: number;
    numberAvailable?: number;
    updatedNumberScheduled?: number;
    numberMisscheduled?: number;
  };
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ resource: daemonSet }: ResourceContext<DaemonSetResource>) {
  const { namespace } = useParams();
  const [, setSearchParams] = useSearchParams();
  const desired = daemonSet.status?.desiredNumberScheduled || 0;
  const current = daemonSet.status?.currentNumberScheduled || 0;
  const ready = daemonSet.status?.numberReady || 0;
  const available = daemonSet.status?.numberAvailable || 0;
  const updated = daemonSet.status?.updatedNumberScheduled || 0;
  const tolerations = daemonSet.spec?.template?.spec?.tolerations || [];
  const nodeSelector = daemonSet.spec?.template?.spec?.nodeSelector || {};

  const matchLabels = daemonSet.spec?.selector?.matchLabels ?? {};
  const labelSelector = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',');
  const { data: childPodsList } = useK8sResourceList<KubernetesResource>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!labelSelector, staleTime: 30000 },
  );
  const childPods = (childPodsList?.items ?? []).filter((pod) => {
    const podLabels = pod.metadata?.labels ?? {};
    return Object.entries(matchLabels).every(([k, v]) => podLabels[k] === v);
  });

  const diagnosis = useMemo(
    () => diagnoseWorkload({ ...daemonSet, kind: 'DaemonSet' } as unknown as Parameters<typeof diagnoseWorkload>[0], { relatedPods: childPods }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [daemonSet?.metadata?.uid, daemonSet?.metadata?.resourceVersion, childPods],
  );

  const handleDiagnoseAction = (action: DiagnoseAction) => {
    if (action.type === 'jump_to_tab') setSearchParams({ tab: action.tab });
  };

  return (
    <div className="space-y-6">
      <DiagnosePanel diagnosis={diagnosis} resource={daemonSet} onAction={handleDiagnoseAction} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Server} title="DaemonSet Information" tooltip={<p className="text-xs text-muted-foreground">Configuration and update strategy</p>}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Update Strategy" value={<Badge variant="outline">{daemonSet.spec?.updateStrategy?.type || 'RollingUpdate'}</Badge>} />
              <DetailRow label="Max Unavailable" value={String(daemonSet.spec?.updateStrategy?.rollingUpdate?.maxUnavailable || '1')} />
              <DetailRow label="Misscheduled" value={String(daemonSet.status?.numberMisscheduled || 0)} />
              <DetailRow label="Updated" value={`${updated}/${desired}`} />
            </div>
        </SectionCard>

        <SectionCard icon={Activity} title="Pod Status">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">Scheduled</span>
                <div className="flex items-center gap-2">
                  <Progress value={desired > 0 ? (current / desired) * 100 : 0} className="w-32 h-2" />
                  <span className="font-mono text-sm w-12">{current}/{desired}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Ready</span>
                <div className="flex items-center gap-2">
                  <Progress value={desired > 0 ? (ready / desired) * 100 : 0} className="w-32 h-2" />
                  <span className="font-mono text-sm w-12">{ready}/{desired}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Available</span>
                <div className="flex items-center gap-2">
                  <Progress value={desired > 0 ? (available / desired) * 100 : 0} className="w-32 h-2" />
                  <span className="font-mono text-sm w-12">{available}/{desired}</span>
                </div>
              </div>
            </div>
        </SectionCard>
      </div>

      {tolerations.length > 0 && (
        <SectionCard icon={Settings} title="Tolerations">
            <div className="space-y-2">
              {tolerations.map((t, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/50 font-mono text-sm">
                  {t.operator === 'Exists' ? (
                    <span>Tolerates all taints</span>
                  ) : (
                    <span>{t.key}={t.value}:{t.effect}</span>
                  )}
                </div>
              ))}
            </div>
        </SectionCard>
      )}

      {/* Metadata */}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={daemonSet.metadata?.labels || {}} />
          <LabelList labels={nodeSelector} title="Node Selector" />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={daemonSet.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DaemonSetDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const { isConnected } = useConnectionStatus();

  const [showRolloutDialog, setShowRolloutDialog] = useState(false);

  const { refetchInterval: fastPollInterval, isFastPolling, triggerFastPolling } = useMutationPolling({
    fastInterval: 2000,
    fastDuration: 30000,
    normalInterval: 60000,
  });

  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const patchDaemonSet = usePatchK8sResource('daemonsets');

  const resourceEvents = useResourceEvents('DaemonSet', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;

  // Pods & nodes lists
  const { data: podsList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string; containerStatuses?: Array<{ ready?: boolean }> }; spec?: { nodeName?: string } }>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace, limit: 5000, refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 30000 }
  );
  const { data: nodesList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> } }>(
    'nodes',
    undefined,
    { enabled: true, limit: 5000 }
  );
  const nodeByName = useMemo(() => {
    const map = new Map<string, { metadata?: { name?: string; labels?: Record<string, string> } }>();
    for (const n of nodesList?.items ?? []) {
      const nodeName = n.metadata?.name;
      if (nodeName) map.set(nodeName, n);
    }
    return map;
  }, [nodesList?.items]);

  const dsMetricsQuery = useQuery({
    queryKey: ['backend', 'daemonset-metrics', clusterId, namespace, name],
    queryFn: () => getDaemonSetMetrics(backendBaseUrl!, clusterId!, namespace!, name!),
    // '' backendBaseUrl = same-origin (dev proxy / in-cluster nginx); do not gate on truthy.
    enabled: !!(isBackendConfigured && clusterId && namespace && name),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = dsMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => { map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' }; });
    return map;
  }, [dsMetricsQuery.data?.pods]);

  const handleRestart = useCallback(async () => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to restart DaemonSet'); return; }
    try {
      await patchDaemonSet.mutateAsync({
        name,
        namespace,
        patch: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
      });
      toast.success(`Rollout restart initiated for ${name}`);
      triggerFastPolling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restart');
      throw err;
    }
  }, [isConnected, name, namespace, patchDaemonSet, triggerFastPolling]);

  const customTabs: CustomTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      render: (ctx) => <OverviewTab {...ctx} />,
    },
    {
      id: 'nodeDistribution',
      label: 'Node Distribution',
      icon: Server,
      render: (ctx) => {
        const ds = ctx.resource;
        const dsMatchLabels = ds.spec?.selector?.matchLabels ?? {};
        const dsPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.entries(dsMatchLabels).every(([k, v]) => labels[k] === v);
        });
        const desired = ds.status?.desiredNumberScheduled || 0;
        const ready = ds.status?.numberReady || 0;

        return (
          <SectionCard icon={Server} title="Node Distribution" tooltip={<p className="text-xs text-muted-foreground">Per-node pod placement and status. Click a node card for details.</p>}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-6 text-sm">
                <span className="text-muted-foreground">Eligible Nodes: <span className="font-medium text-foreground">{desired}</span></span>
                <span className="text-muted-foreground">Covered Nodes: <span className="font-medium text-emerald-600">{ready}</span></span>
                <span className="text-muted-foreground">Missing Nodes: <span className="font-medium text-destructive">{Math.max(0, desired - ready)}</span></span>
              </div>
              {dsPods.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pods scheduled yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {dsPods.map((pod) => {
                    const podName = pod.metadata?.name ?? '';
                    const podNs = pod.metadata?.namespace ?? namespace ?? '';
                    const phase = (pod.status as { phase?: string } | undefined)?.phase ?? 'Unknown';
                    const nodeName = (pod.spec as { nodeName?: string } | undefined)?.nodeName ?? '';
                    const containerStatuses = (pod.status as { containerStatuses?: Array<{ ready?: boolean }> })?.containerStatuses ?? [];
                    const allReady = containerStatuses.length > 0 && containerStatuses.every((c) => c.ready);
                    const cardVariant = phase === 'Running' && allReady ? 'green' : phase === 'Running' || phase === 'Pending' ? 'yellow' : 'red';
                    const nodeMeta = nodeName ? nodeByName.get(nodeName) : undefined;
                    const zone = nodeMeta?.metadata?.labels?.['topology.kubernetes.io/zone'] ?? nodeMeta?.metadata?.labels?.['failure-domain.beta.kubernetes.io/zone'] ?? '';
                    const metrics = podMetricsByName[podName];
                    return (
                      <Popover key={podName}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              'rounded-lg border p-3 text-left transition-all hover:ring-2 hover:ring-primary/30 focus:outline-none focus:ring-2 focus:ring-primary',
                              cardVariant === 'green' && 'border-emerald-500/50 bg-emerald-500/10',
                              cardVariant === 'yellow' && 'border-amber-500/50 bg-amber-500/10',
                              cardVariant === 'red' && 'border-destructive/50 bg-destructive/10'
                            )}
                          >
                            <p className="font-mono text-xs font-medium truncate" title={nodeName || '—'}>{nodeName || '—'}</p>
                            {zone && <p className="text-xs text-muted-foreground mt-0.5">Zone: {zone}</p>}
                            <p className="text-xs mt-1 truncate text-muted-foreground">{podName}</p>
                            <Badge variant={cardVariant === 'green' ? 'default' : cardVariant === 'yellow' ? 'secondary' : 'destructive'} className="mt-2 text-xs">{phase}</Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" align="start">
                          <div className="space-y-2 text-sm">
                            <p><span className="text-muted-foreground">Node:</span> <Link to={`/nodes/${nodeName}`} className="font-mono text-primary hover:underline">{nodeName || '—'}</Link></p>
                            <p><span className="text-muted-foreground">Pod:</span> <Link to={`/pods/${podNs}/${podName}`} className="font-mono text-primary hover:underline">{podName}</Link></p>
                            <p><span className="text-muted-foreground">Status:</span> <Badge variant={phase === 'Running' ? 'default' : 'secondary'} className="text-xs">{phase}</Badge></p>
                            <div className="flex items-center gap-2 pt-1">
                              <Cpu className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">CPU:</span>
                              <span className="font-mono text-xs">{metrics?.cpu ?? '–'}</span>
                              <span className="text-muted-foreground ml-2">Memory:</span>
                              <span className="font-mono text-xs">{metrics?.memory ?? '–'}</span>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>
        );
      },
    },
    {
      id: 'rolloutHistory',
      label: 'Rollout History',
      icon: History,
      render: () => (
        <SectionCard icon={History} title="Rollout History" tooltip={<p className="text-xs text-muted-foreground">ControllerRevisions or last rollout from events</p>}>
          {displayEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rollout events available. Backend may support ControllerRevisions for revision timeline later.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">Recent events (rollout-related):</p>
              <ul className="space-y-2 max-h-[300px] overflow-y-auto">
                {displayEvents.slice(0, 15).map((ev, i) => (
                  <li key={i} className="text-sm p-2 rounded bg-muted/50 flex flex-wrap gap-2 items-center">
                    <Badge variant={ev.type === 'Warning' ? 'destructive' : 'secondary'} className="text-xs">{ev.type}</Badge>
                    <span className="font-medium">{ev.reason}</span>
                    <span className="text-muted-foreground">{ev.message}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{ev.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Layers,
      render: (ctx) => {
        const containers: ContainerInfo[] = (ctx.resource.spec?.template?.spec?.containers || []).map(c => ({
          name: c.name, image: c.image, ready: true, restartCount: 0, state: 'running', ports: c.ports || [], resources: c.resources || {},
        }));
        return <ContainersSection containers={containers} />;
      },
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      render: (ctx) => {
        const dsMatchLabels = ctx.resource.spec?.selector?.matchLabels ?? {};
        const dsPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.entries(dsMatchLabels).every(([k, v]) => labels[k] === v);
        });
        return (
          <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods managed by this DaemonSet</p>}>
            {dsPods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods match this DaemonSet&apos;s selector yet.</p>
            ) : (
              <DetailPodTable pods={dsPods} namespace={namespace ?? ''} />
            )}
          </SectionCard>
        );
      },
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      render: (ctx) => {
        const dsMatchLabels = ctx.resource.spec?.selector?.matchLabels ?? {};
        const dsPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.entries(dsMatchLabels).every(([k, v]) => labels[k] === v);
        });
        const templateContainers = (ctx.resource.spec?.template?.spec?.containers || []).map(c => c.name);

        return (
          <WorkloadLogsTab
            pods={dsPods}
            namespace={namespace ?? undefined}
            kindLabel="DaemonSet"
            templateContainers={templateContainers}
          />
        );
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      render: (ctx) => (
        <WorkloadTerminalTab
          matchLabels={ctx.resource.spec?.selector?.matchLabels ?? {}}
          namespace={namespace ?? undefined}
          tooltip="Exec into DaemonSet pods"
        />
      ),
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      render: () => <MetricsDashboard resourceType="daemonset" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
  ];

  return (
    <>
      <GenericResourceDetail<DaemonSetResource>
        resourceType="daemonsets"
        kind="DaemonSet"
        pluralLabel="DaemonSets"
        listPath="/daemonsets"
        resourceIcon={Cpu}
        loadingCardCount={6}
        detailOptions={{ refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 5000 }}
        deriveStatus={(ds) => ds.status?.numberReady === ds.status?.desiredNumberScheduled ? 'Running' : ds.status?.numberReady ? 'Pending' : 'Failed'}
        customTabs={customTabs}
        buildStatusCards={(ctx) => {
          const ds = ctx.resource;
          const desired = ds.status?.desiredNumberScheduled || 0;
          const current = ds.status?.currentNumberScheduled || 0;
          const ready = ds.status?.numberReady || 0;
          const available = ds.status?.numberAvailable || 0;
          const updated = ds.status?.updatedNumberScheduled || 0;
          const nodeCoveragePct = desired > 0 ? Math.round((ready / desired) * 100) : 0;
          return [
            { label: 'Desired', value: desired, icon: Server, iconColor: 'primary' as const },
            { label: 'Current', value: current, icon: Server, iconColor: 'muted' as const },
            { label: 'Ready', value: `${ready}/${desired}`, icon: CheckCircle2, iconColor: ready === desired ? 'success' as const : 'warning' as const },
            { label: 'Up-to-date', value: `${updated}/${desired}`, icon: Activity, iconColor: updated === desired ? 'success' as const : 'warning' as const },
            { label: 'Available', value: available, icon: Activity, iconColor: 'success' as const },
            { label: 'Node Coverage', value: `${nodeCoveragePct}%`, icon: Gauge, iconColor: nodeCoveragePct === 100 ? 'success' as const : 'warning' as const },
          ];
        }}
        headerMetadata={(ctx) => {
          const desired = ctx.resource.status?.desiredNumberScheduled || 0;
          return (
            <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Created {ctx.age}
              <span className="mx-2">&bull;</span>
              <Server className="h-3.5 w-3.5" />
              {desired} nodes
              {ctx.isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
              {isFastPolling && (
                <Badge className="ml-2 text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Syncing
                </Badge>
              )}
            </span>
          );
        }}
        extraHeaderActions={() => [
          { label: 'Restart', icon: RotateCcw, variant: 'outline', onClick: () => setShowRolloutDialog(true), className: 'press-effect' },
        ]}
        extraActionItems={() => [
          { icon: RotateCcw, label: 'Rollout Restart', description: 'Trigger a rolling restart of all pods', className: 'press-effect', onClick: () => setShowRolloutDialog(true) },
        ]}
        extraDialogs={(ctx) => (
          <RolloutActionsDialog
            open={showRolloutDialog}
            onOpenChange={setShowRolloutDialog}
            resourceType="DaemonSet"
            resourceName={ctx.name}
            namespace={ctx.namespace}
            revisions={[]}
            onRestart={handleRestart}
            onRollback={() => { toast.info('DaemonSet does not support rollback to revision.'); setShowRolloutDialog(false); }}
          />
        )}
      />
    </>
  );
}
