import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Cpu,
  Clock,
  Server,
  RotateCcw,
  Download,
  Trash2,
  CheckCircle2,
  Activity,
  Box,
  FileText,
  Terminal,
  LayoutDashboard,
  Layers,
  CalendarClock,
  BarChart2,
  FileCode,
  GitCompare,
  Network,
  Settings,
  History,
  Gauge,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  ResourceDetailLayout,
  ContainersSection,
  YamlViewer,
  EventsSection,
  MetadataCard,
  ActionsSection,
  MetricsDashboard,
  RolloutActionsDialog,
  DeleteConfirmDialog,
  SectionCard,
  LogViewer,
  TerminalViewer,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ContainerInfo,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, usePatchK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useQuery } from '@tanstack/react-query';
import { getDaemonSetMetrics } from '@/services/backendApiClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { downloadResourceJson } from '@/lib/exportUtils';

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

export default function DaemonSetDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRolloutDialog, setShowRolloutDialog] = useState(false);
  const [selectedLogPod, setSelectedLogPod] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');

  const { isConnected } = useConnectionStatus();
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('DaemonSet', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const { resource: daemonSet, isLoading, error, age, yaml, refetch } = useResourceDetail<DaemonSetResource>(
    'daemonsets',
    name,
    namespace,
    {} as DaemonSetResource
  );
  const resourceEvents = useResourceEvents('DaemonSet', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const deleteDaemonSet = useDeleteK8sResource('daemonsets');
  const updateDaemonSet = useUpdateK8sResource('daemonsets');
  const patchDaemonSet = usePatchK8sResource('daemonsets');

  const status: ResourceStatus = daemonSet.status?.numberReady === daemonSet.status?.desiredNumberScheduled ? 'Running' :
    daemonSet.status?.numberReady ? 'Pending' : 'Failed';

  const desired = daemonSet.status?.desiredNumberScheduled || 0;
  const current = daemonSet.status?.currentNumberScheduled || 0;
  const ready = daemonSet.status?.numberReady || 0;
  const available = daemonSet.status?.numberAvailable || 0;
  const updated = daemonSet.status?.updatedNumberScheduled || 0;

  const containers: ContainerInfo[] = (daemonSet.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name,
    image: c.image,
    ready: true,
    restartCount: 0,
    state: 'running',
    ports: c.ports || [],
    resources: c.resources || {},
  }));

  const tolerations = daemonSet.spec?.template?.spec?.tolerations || [];
  const nodeSelector = daemonSet.spec?.template?.spec?.nodeSelector || {};

  const { data: podsList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string }; spec?: { nodeName?: string } }>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!daemonSet?.spec?.selector?.matchLabels, limit: 5000 }
  );
  const dsMatchLabels = daemonSet.spec?.selector?.matchLabels ?? {};
  const dsPods = (podsList?.items ?? []).filter((pod) => {
    const labels = pod.metadata?.labels ?? {};
    return Object.entries(dsMatchLabels).every(([k, v]) => labels[k] === v);
  });
  const firstDsPodName = dsPods[0]?.metadata?.name ?? '';

  const { data: nodesList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> } }>(
    'nodes',
    undefined,
    { enabled: !!daemonSet?.metadata?.name, limit: 5000 }
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
    enabled: !!(isBackendConfigured() && backendBaseUrl && clusterId && namespace && name),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = dsMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => { map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' }; });
    return map;
  }, [dsMetricsQuery.data?.pods]);

  const logPod = selectedLogPod || firstDsPodName;
  const terminalPod = selectedTerminalPod || firstDsPodName;
  const logPodContainers = (dsPods.find((p) => p.metadata?.name === logPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);
  const terminalPodContainers = (dsPods.find((p) => p.metadata?.name === terminalPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);


  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${daemonSet.metadata?.name || 'daemonset'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }, [yaml, daemonSet.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(daemonSet, `${daemonSet.metadata?.name || 'daemonset'}.json`);
    toast.success('JSON downloaded');
  }, [daemonSet]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleRestart = useCallback(async () => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to restart DaemonSet'); return; }
    try {
      await patchDaemonSet.mutateAsync({
        name,
        namespace,
        patch: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
      });
      toast.success(`Rollout restart initiated for ${name}`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to restart');
      throw err;
    }
  }, [isConnected, name, namespace, patchDaemonSet, refetch]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update DaemonSet');
      throw new Error('Not connected');
    }
    try {
      await updateDaemonSet.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('DaemonSet updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateDaemonSet, refetch]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!daemonSet?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">DaemonSet not found.</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/daemonsets')}>
              Back to DaemonSets
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const nodeCoveragePct = desired > 0 ? Math.round((ready / desired) * 100) : 0;
  const statusCards = [
    { label: 'Desired', value: desired, icon: Server, iconColor: 'primary' as const },
    { label: 'Current', value: current, icon: Server, iconColor: 'muted' as const },
    { label: 'Ready', value: `${ready}/${desired}`, icon: CheckCircle2, iconColor: ready === desired ? 'success' as const : 'warning' as const },
    { label: 'Up-to-date', value: `${updated}/${desired}`, icon: Activity, iconColor: updated === desired ? 'success' as const : 'warning' as const },
    { label: 'Available', value: available, icon: Activity, iconColor: 'success' as const },
    { label: 'Node Coverage', value: `${nodeCoveragePct}%`, icon: Gauge, iconColor: nodeCoveragePct === 100 ? 'success' as const : 'warning' as const },
  ];

  const yamlVersions: YamlVersion[] = [
    { id: 'current', label: 'Current Version', yaml, timestamp: 'now' },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">DaemonSet Information</CardTitle>
                <CardDescription>Configuration and update strategy</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Update Strategy</p>
                    <Badge variant="outline">{daemonSet.spec?.updateStrategy?.type || 'RollingUpdate'}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Max Unavailable</p>
                    <p className="font-mono">{daemonSet.spec?.updateStrategy?.rollingUpdate?.maxUnavailable || '1'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Misscheduled</p>
                    <p className="font-mono">{daemonSet.status?.numberMisscheduled || 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Updated</p>
                    <p className="font-mono">{updated}/{desired}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pod Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
              </CardContent>
            </Card>
          </div>

          {tolerations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tolerations</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetadataCard title="Labels" items={daemonSet.metadata?.labels || {}} variant="badges" />
            <MetadataCard title="Node Selector" items={nodeSelector} variant="default" />
          </div>
        </div>
      ),
    },
    {
      id: 'nodeDistribution',
      label: 'Node Distribution',
      icon: Server,
      content: (
        <SectionCard icon={Server} title="Node Distribution" tooltip={<p className="text-xs text-muted-foreground">Per-node pod placement and status. Click a node card for details.</p>}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <span className="text-muted-foreground">Eligible Nodes: <span className="font-medium text-foreground">{desired}</span></span>
              <span className="text-muted-foreground">Covered Nodes: <span className="font-medium text-[hsl(142,76%,36%)]">{ready}</span></span>
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
                            cardVariant === 'green' && 'border-[hsl(142,76%,36%)]/50 bg-[hsl(142,76%,36%)]/10',
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
      ),
    },
    {
      id: 'rolloutHistory',
      label: 'Rollout History',
      icon: History,
      content: (
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
      badge: containers.length.toString(),
      content: <ContainersSection containers={containers} />,
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: dsPods.length.toString(),
      content: (
        <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods managed by this DaemonSet</p>}>
          {dsPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods match this DaemonSet&apos;s selector yet.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Node</th>
                    <th className="text-left p-3 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {dsPods.map((pod) => {
                    const podName = pod.metadata?.name ?? '';
                    const podNs = pod.metadata?.namespace ?? namespace ?? '';
                    const phase = (pod.status as { phase?: string } | undefined)?.phase ?? '-';
                    const nodeName = (pod.spec as { nodeName?: string } | undefined)?.nodeName ?? '-';
                    const created = pod.metadata?.creationTimestamp ? calculateAge(pod.metadata.creationTimestamp) : '-';
                    return (
                      <tr key={podName} className="border-t">
                        <td className="p-3">
                          <Link to={`/pods/${podNs}/${podName}`} className="text-primary hover:underline font-medium">
                            {podName}
                          </Link>
                        </td>
                        <td className="p-3">{phase}</td>
                        <td className="p-3 font-mono text-xs">{nodeName}</td>
                        <td className="p-3">{created}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      content: (
        <SectionCard icon={FileText} title="Logs" tooltip={<p className="text-xs text-muted-foreground">Stream logs from DaemonSet pods</p>}>
          {dsPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods available to view logs.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>Pod</Label>
                  <Select value={logPod} onValueChange={setSelectedLogPod}>
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select pod" />
                    </SelectTrigger>
                    <SelectContent>
                      {dsPods.map((p) => (
                        <SelectItem key={p.metadata?.name} value={p.metadata?.name ?? ''}>
                          {p.metadata?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={selectedLogContainer || logPodContainers[0]} onValueChange={setSelectedLogContainer}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select container" />
                    </SelectTrigger>
                    <SelectContent>
                      {logPodContainers.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <LogViewer podName={logPod} namespace={namespace ?? undefined} containerName={selectedLogContainer || logPodContainers[0]} containers={logPodContainers} onContainerChange={setSelectedLogContainer} />
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      content: (
        <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into DaemonSet pods</p>}>
          {dsPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods available for terminal.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>Pod</Label>
                  <Select value={terminalPod} onValueChange={setSelectedTerminalPod}>
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select pod" />
                    </SelectTrigger>
                    <SelectContent>
                      {dsPods.map((p) => (
                        <SelectItem key={p.metadata?.name} value={p.metadata?.name ?? ''}>
                          {p.metadata?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={selectedTerminalContainer || terminalPodContainers[0]} onValueChange={setSelectedTerminalContainer}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select container" />
                    </SelectTrigger>
                    <SelectContent>
                      {terminalPodContainers.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TerminalViewer podName={terminalPod} namespace={namespace ?? undefined} containerName={selectedTerminalContainer || terminalPodContainers[0]} containers={terminalPodContainers} onContainerChange={setSelectedTerminalContainer} />
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'events',
      label: 'Events',
      icon: CalendarClock,
      badge: displayEvents.length.toString(),
      content: <EventsSection events={displayEvents} />,
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      content: <MetricsDashboard resourceType="daemonset" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={daemonSet.metadata?.name || ''} editable onSave={handleSaveYaml} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="daemonsets"
          resourceKind="DaemonSet"
          namespace={namespace}
          initialSelectedResources={namespace && name ? [`${namespace}/${name}`] : [name || '']}
          clusterId={clusterId ?? undefined}
          backendBaseUrl={backendBaseUrl ?? ''}
          isConnected={isConnected}
          embedded
        />
      ),
    },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('DaemonSet')}
          namespace={namespace || daemonSet?.metadata?.namespace || ''}
          name={name || daemonSet?.metadata?.name || ''}
          sourceResourceType="DaemonSet"
          sourceResourceName={daemonSet?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          { icon: RotateCcw, label: 'Rollout Restart', description: 'Trigger a rolling restart of all pods', onClick: () => setShowRolloutDialog(true) },
          { icon: Download, label: 'Download YAML', description: 'Export DaemonSet definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export DaemonSet as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete DaemonSet', description: 'Permanently remove this DaemonSet', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="DaemonSet"
        resourceIcon={Cpu}
        name={daemonSet.metadata?.name || ''}
        namespace={daemonSet.metadata?.namespace}
        status={status}
        backLink="/daemonsets"
        backLabel="DaemonSets"
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {age}
            <span className="mx-2">•</span>
            <Server className="h-3.5 w-3.5" />
            {desired} nodes
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Restart', icon: RotateCcw, variant: 'outline', onClick: () => setShowRolloutDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
      >
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
      </ResourceDetailLayout>

      <RolloutActionsDialog
        open={showRolloutDialog}
        onOpenChange={setShowRolloutDialog}
        resourceType="DaemonSet"
        resourceName={daemonSet.metadata?.name || ''}
        namespace={daemonSet.metadata?.namespace}
        revisions={[]}
        onRestart={handleRestart}
        onRollback={() => { toast.info('DaemonSet does not support rollback to revision.'); setShowRolloutDialog(false); }}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="DaemonSet"
        resourceName={daemonSet.metadata?.name || ''}
        namespace={daemonSet.metadata?.namespace}
        onConfirm={async () => {
          if (!isConnected || !name || !namespace) {
            toast.error('Connect cluster to delete DaemonSet');
            return;
          }
          await deleteDaemonSet.mutateAsync({ name, namespace });
          toast.success(`DaemonSet ${name} deleted`);
          navigate('/daemonsets');
        }}
        requireNameConfirmation
      />
    </>
  );
}
