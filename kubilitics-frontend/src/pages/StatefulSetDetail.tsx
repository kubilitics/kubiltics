import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Database,
  Clock,
  Server,
  RotateCcw,
  Download,
  Trash2,
  Copy,
  CheckCircle2,
  XCircle,
  Activity,
  Scale,
  HardDrive,
  History,
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
  Globe,
  SlidersHorizontal,
  Hash,
  ArrowDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ContainersSection,
  YamlViewer,
  EventsSection,
  MetadataCard,
  ActionsSection,
  MetricsDashboard,
  ScaleDialog,
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
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, usePatchK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery } from '@tanstack/react-query';

interface StatefulSetResource extends KubernetesResource {
  spec?: {
    replicas?: number;
    serviceName?: string;
    podManagementPolicy?: string;
    revisionHistoryLimit?: number;
    minReadySeconds?: number;
    updateStrategy?: { type?: string; rollingUpdate?: { partition?: number } };
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol?: string }>;
          resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } };
        }>;
      };
    };
    volumeClaimTemplates?: Array<{
      metadata?: { name: string };
      spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
    }>;
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    currentReplicas?: number;
    updatedReplicas?: number;
    conditions?: Array<{ type: string; status: string; lastTransitionTime?: string; reason?: string; message?: string }>;
  };
}

export default function StatefulSetDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('StatefulSet', name ?? undefined, namespace ?? undefined, activeCluster?.name);

  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [showRolloutDialog, setShowRolloutDialog] = useState(false);
  const [selectedLogPod, setSelectedLogPod] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');
  const [partitionInput, setPartitionInput] = useState<string>('');

  const { isConnected } = useConnectionStatus();
  const { resource: statefulSet, isLoading, error, age, yaml, refetch } = useResourceDetail<StatefulSetResource>(
    'statefulsets',
    name,
    namespace,
    {} as StatefulSetResource
  );
  const resourceEvents = useResourceEvents('StatefulSet', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const deleteStatefulSet = useDeleteK8sResource('statefulsets');
  const updateStatefulSet = useUpdateK8sResource('statefulsets');
  const patchStatefulSet = usePatchK8sResource('statefulsets');

  const status: ResourceStatus = statefulSet.status?.readyReplicas === statefulSet.spec?.replicas ? 'Running' :
    statefulSet.status?.readyReplicas ? 'Pending' : 'Failed';

  const desired = statefulSet.spec?.replicas || 0;
  const ready = statefulSet.status?.readyReplicas || 0;
  const current = statefulSet.status?.currentReplicas || 0;
  const updated = statefulSet.status?.updatedReplicas || 0;

  const containers: ContainerInfo[] = (statefulSet.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name,
    image: c.image,
    ready: true,
    restartCount: 0,
    state: 'running',
    ports: c.ports?.map(p => ({ containerPort: p.containerPort, protocol: p.protocol || 'TCP' })) || [],
    resources: c.resources || {},
  }));

  const volumeClaimTemplates = statefulSet.spec?.volumeClaimTemplates || [];

  const { data: podsList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string; podIP?: string }; spec?: { nodeName?: string } }>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!statefulSet?.spec?.selector?.matchLabels, limit: 5000 }
  );
  const stsMatchLabels = statefulSet.spec?.selector?.matchLabels ?? {};
  const stsPodsRaw = (podsList?.items ?? []).filter((pod) => {
    const labels = pod.metadata?.labels ?? {};
    return Object.entries(stsMatchLabels).every(([k, v]) => labels[k] === v);
  });
  const stsName = statefulSet.metadata?.name ?? '';
  const stsPods = useMemo(() => {
    return [...stsPodsRaw].sort((a, b) => {
      const ordA = parseInt(a.metadata?.name?.replace(new RegExp(`^${stsName}-`), '') ?? '-1', 10);
      const ordB = parseInt(b.metadata?.name?.replace(new RegExp(`^${stsName}-`), '') ?? '-1', 10);
      return ordA - ordB;
    });
  }, [stsPodsRaw, stsName]);
  const firstStsPodName = stsPods[0]?.metadata?.name ?? '';

  const { data: pvcList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; creationTimestamp?: string }; status?: { phase?: string; capacity?: { storage?: string } }; spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } } }>(
    'persistentvolumeclaims',
    namespace ?? undefined,
    { enabled: !!namespace && !!name, limit: 5000 }
  );
  const stsPvcs = useMemo(() => {
    const items = pvcList?.items ?? [];
    return items.filter((pvc) => {
      const pvcName = pvc.metadata?.name ?? '';
      return pvcName.includes(stsName) && new RegExp(`^[a-z0-9-]+-${stsName}-\\d+$`).test(pvcName);
    });
  }, [pvcList?.items, stsName]);
  const stsPvcsWithOrdinal = useMemo(() => stsPvcs.map((pvc) => {
    const pvcName = pvc.metadata?.name ?? '';
    const match = pvcName.match(new RegExp(`-${stsName}-(\\d+)$`));
    const ordinal = match ? parseInt(match[1], 10) : null;
    return { pvc, ordinal };
  }).sort((a, b) => (a.ordinal ?? -1) - (b.ordinal ?? -1)), [stsPvcs, stsName]);
  const pvcTotalStorage = useMemo(() => {
    let totalGi = 0;
    for (const { pvc } of stsPvcsWithOrdinal) {
      const raw = (pvc.status as { capacity?: { storage?: string } })?.capacity?.storage ?? '';
      const m = raw.match(/^(\d+(?:\.\d+)?)\s*Gi?$/i);
      if (m) totalGi += parseFloat(m[1]);
      else {
        const mMi = raw.match(/^(\d+(?:\.\d+)?)\s*Mi?$/i);
        if (mMi) totalGi += parseFloat(mMi[1]) / 1024;
      }
    }
    return totalGi > 0 ? `${totalGi.toFixed(2)} Gi` : null;
  }, [stsPvcsWithOrdinal]);
  const logPod = selectedLogPod || firstStsPodName;
  const terminalPod = selectedTerminalPod || firstStsPodName;
  const logPodContainers = (stsPods.find((p) => p.metadata?.name === logPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);
  const terminalPodContainers = (stsPods.find((p) => p.metadata?.name === terminalPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);


  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${statefulSet.metadata?.name || 'statefulset'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }, [yaml, statefulSet.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(statefulSet, `${statefulSet.metadata?.name || 'statefulset'}.json`);
    toast.success('JSON downloaded');
  }, [statefulSet]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleScale = useCallback(async (replicas: number) => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to scale StatefulSet'); return; }
    try {
      await patchStatefulSet.mutateAsync({ name, namespace, patch: { spec: { replicas } } });
      toast.success(`Scaled ${name} to ${replicas} replicas`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to scale');
      throw err;
    }
  }, [isConnected, name, namespace, patchStatefulSet, refetch]);

  const handleRestart = useCallback(async () => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to restart StatefulSet'); return; }
    try {
      await patchStatefulSet.mutateAsync({
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
  }, [isConnected, name, namespace, patchStatefulSet, refetch]);

  const handleRollback = useCallback(async (_revision: number) => {
    toast.info('Rollback for StatefulSet is revision-specific; use detail when supported.');
    refetch();
  }, [refetch]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update StatefulSet');
      throw new Error('Not connected');
    }
    try {
      await updateStatefulSet.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('StatefulSet updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateStatefulSet, refetch]);

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

  if (!statefulSet?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">StatefulSet not found.</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/statefulsets')}>
              Back to StatefulSets
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const updateStrategyType = statefulSet.spec?.updateStrategy?.type ?? 'RollingUpdate';
  const partition = statefulSet.spec?.updateStrategy?.rollingUpdate?.partition ?? 0;
  const pvcCount = volumeClaimTemplates.length * desired;
  const statusCards = [
    { label: 'Ready', value: `${ready}/${desired}`, icon: Server, iconColor: ready === desired ? 'success' as const : 'warning' as const },
    { label: 'Replicas', value: desired, icon: Activity, iconColor: 'info' as const },
    { label: 'Update Strategy', value: updateStrategyType, icon: SlidersHorizontal, iconColor: 'primary' as const },
    { label: 'Partition', value: partition, icon: Hash, iconColor: 'primary' as const },
    { label: 'Service', value: statefulSet.spec?.serviceName || '—', icon: Globe, iconColor: 'primary' as const },
    { label: 'PVCs', value: pvcCount, icon: HardDrive, iconColor: 'primary' as const },
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
                <CardTitle className="text-base">StatefulSet Information</CardTitle>
                <CardDescription>Configuration and update strategy</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Service Name</p>
                    <Button
                      variant="link"
                      className="h-auto p-0 font-mono"
                      onClick={() => navigate(`/services/${namespace}/${statefulSet.spec?.serviceName}`)}
                    >
                      {statefulSet.spec?.serviceName || '-'}
                    </Button>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Pod Management</p>
                    <Badge variant="outline">{statefulSet.spec?.podManagementPolicy || 'OrderedReady'}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Update Strategy</p>
                    <Badge variant="outline">{statefulSet.spec?.updateStrategy?.type || 'RollingUpdate'}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Partition</p>
                    <p className="font-mono">{statefulSet.spec?.updateStrategy?.rollingUpdate?.partition ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Revision History Limit</p>
                    <p className="font-mono">{statefulSet.spec?.revisionHistoryLimit ?? 10}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Min Ready Seconds</p>
                    <p className="font-mono">{statefulSet.spec?.minReadySeconds ?? 0}s</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Replica Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Ready</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(ready / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{ready}/{desired}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Current</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(current / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{current}/{desired}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Updated</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(updated / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{updated}/{desired}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {volumeClaimTemplates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Volume Claim Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {volumeClaimTemplates.map((vct, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="font-medium text-sm">{vct.metadata?.name || `volume-${i}`}</p>
                        <p className="text-xs text-muted-foreground">
                          Storage Class: {vct.spec?.storageClassName || 'default'}
                        </p>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        {vct.spec?.resources?.requests?.storage || 'N/A'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(statefulSet.status?.conditions?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conditions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {statefulSet.status?.conditions?.map((c) => (
                    <div key={c.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        {c.status === 'True' ? <CheckCircle2 className="h-5 w-5 text-[hsl(142,76%,36%)]" /> : <XCircle className="h-5 w-5 text-[hsl(0,72%,51%)]" />}
                        <div>
                          <p className="font-medium text-sm">{c.type}</p>
                          {c.reason && <p className="text-xs text-muted-foreground">{c.reason}</p>}
                        </div>
                      </div>
                      {c.lastTransitionTime && <span className="text-xs text-muted-foreground">{new Date(c.lastTransitionTime).toLocaleString()}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetadataCard title="Labels" items={statefulSet.metadata?.labels || {}} variant="badges" />
            <MetadataCard title="Selector" items={statefulSet.spec?.selector?.matchLabels || {}} variant="default" />
          </div>
        </div>
      ),
    },
    {
      id: 'pods-ordinals',
      label: 'Pods & Ordinals',
      icon: Hash,
      badge: stsPods.length.toString(),
      content: (
        <SectionCard icon={Box} title="Pods & Ordinals" tooltip={<p className="text-xs text-muted-foreground">Ordered pod list with ordinal index and partition state</p>}>
          {stsPods.length > 0 && updateStrategyType === 'RollingUpdate' && (
            <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
              <ArrowDown className="h-4 w-4 shrink-0" aria-hidden />
              <span>Update direction: highest ordinal first (e.g. {Math.max(0, stsPods.length - 1)} → … → 0)</span>
            </div>
          )}
          {stsPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods match this StatefulSet&apos;s selector yet.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Ordinal</th>
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Template</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Node</th>
                    <th className="text-left p-3 font-medium">IP</th>
                    <th className="text-left p-3 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {stsPods.map((pod) => {
                    const podName = pod.metadata?.name ?? '';
                    const podNs = pod.metadata?.namespace ?? namespace ?? '';
                    const phase = (pod.status as { phase?: string } | undefined)?.phase ?? '-';
                    const nodeName = (pod.spec as { nodeName?: string } | undefined)?.nodeName ?? '-';
                    const podIP = (pod.status as { podIP?: string } | undefined)?.podIP ?? '-';
                    const created = pod.metadata?.creationTimestamp ? calculateAge(pod.metadata.creationTimestamp) : '-';
                    const ordinalStr = podName.replace(new RegExp(`^${stsName}-`), '') || '?';
                    const ordinalNum = /^\d+$/.test(ordinalStr) ? parseInt(ordinalStr, 10) : -1;
                    const isNewTemplate = ordinalNum >= partition;
                    const templateBadge = updateStrategyType === 'RollingUpdate' && partition > 0
                      ? (isNewTemplate ? <Badge variant="default" className="bg-primary/90 text-primary-foreground text-xs">New Template</Badge> : <Badge variant="secondary" className="text-muted-foreground text-xs">Old Template</Badge>)
                      : null;
                    return (
                      <tr key={podName} className="border-t">
                        <td className="p-3"><Badge variant="secondary" className="font-mono">[{ordinalStr}]</Badge></td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-2">
                            <span className="font-mono text-muted-foreground text-xs">[{ordinalStr}]</span>
                            <Link to={`/pods/${podNs}/${podName}`} className="text-primary hover:underline font-medium">
                              {podName}
                            </Link>
                          </span>
                        </td>
                        <td className="p-3">{templateBadge ?? '—'}</td>
                        <td className="p-3"><Badge variant={phase === 'Running' ? 'default' : 'secondary'} className="text-xs">{phase}</Badge></td>
                        <td className="p-3 font-mono text-xs">{nodeName}</td>
                        <td className="p-3 font-mono text-xs">{podIP}</td>
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
      id: 'pvc',
      label: 'PersistentVolumeClaims',
      icon: HardDrive,
      badge: stsPvcs.length.toString(),
      content: (
        <SectionCard icon={HardDrive} title="PersistentVolumeClaims" tooltip={<p className="text-xs text-muted-foreground">PVCs used by this StatefulSet, per pod ordinal</p>}>
          {volumeClaimTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No volume claim templates defined.</p>
          ) : stsPvcs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PVCs found for this StatefulSet yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">PVC Name</th>
                      <th className="text-left p-3 font-medium">Bound Pod (ordinal)</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Capacity</th>
                      <th className="text-left p-3 font-medium">StorageClass</th>
                      <th className="text-left p-3 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stsPvcsWithOrdinal.map(({ pvc, ordinal }) => {
                      const pvcName = pvc.metadata?.name ?? '';
                      const phase = (pvc.status as { phase?: string })?.phase ?? 'Unknown';
                      const storageClass = (pvc.spec as { storageClassName?: string })?.storageClassName ?? 'default';
                      const capacity = (pvc.status as { capacity?: { storage?: string } })?.capacity?.storage ?? '—';
                      const age = pvc.metadata?.creationTimestamp ? calculateAge(pvc.metadata.creationTimestamp) : '—';
                      const podLabel = ordinal !== null ? `${stsName}-${ordinal}` : '—';
                      const statusVariant = phase === 'Bound' ? 'default' : phase === 'Pending' ? 'secondary' : 'destructive';
                      const statusClassName = phase === 'Bound' ? 'bg-[hsl(142,76%,36%)]/90 text-white border-0' : phase === 'Pending' ? 'bg-amber-500/90 text-white border-0' : phase === 'Lost' ? 'bg-destructive/90 text-destructive-foreground border-0' : '';
                      return (
                        <tr key={pvcName} className="border-t">
                          <td className="p-3">
                            <Link to={`/persistentvolumeclaims/${namespace}/${pvcName}`} className="text-primary hover:underline font-mono text-xs">
                              {pvcName}
                            </Link>
                          </td>
                          <td className="p-3 font-mono text-xs">
                            {ordinal !== null ? <Link to={`/pods/${namespace}/${podLabel}`} className="text-primary hover:underline">{podLabel}</Link> : '—'}
                          </td>
                          <td className="p-3">
                            <Badge variant={statusVariant} className={statusClassName || undefined}>{phase}</Badge>
                          </td>
                          <td className="p-3 font-mono text-xs">{capacity}</td>
                          <td className="p-3 font-mono text-xs">{storageClass}</td>
                          <td className="p-3 text-muted-foreground">{age}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pvcTotalStorage && (
                <p className="text-sm font-medium text-muted-foreground">
                  Total storage: <span className="font-mono text-foreground">{pvcTotalStorage}</span>
                </p>
              )}
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'headless-service',
      label: 'Headless Service',
      icon: Globe,
      content: (
        <SectionCard icon={Globe} title="Headless Service" tooltip={<p className="text-xs text-muted-foreground">Service and DNS for StatefulSet pods</p>}>
          {!statefulSet.spec?.serviceName ? (
            <p className="text-sm text-muted-foreground">No service name configured.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Service</p>
                  <Link to={`/services/${namespace}/${statefulSet.spec.serviceName}`} className="font-mono text-primary hover:underline">
                    {statefulSet.spec.serviceName}
                  </Link>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Cluster IP</p>
                  <p className="font-mono">None (headless)</p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground mb-2">DNS names (pod-0, pod-1, ...)</p>
                <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs space-y-1">
                  {Array.from({ length: desired }, (_, i) => (
                    <div key={i}>{stsName}-{i}.{statefulSet.spec.serviceName}.{namespace}.svc.cluster.local</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'update-strategy',
      label: 'Update Strategy',
      icon: SlidersHorizontal,
      content: (
        <SectionCard icon={SlidersHorizontal} title="Update Strategy" tooltip={<p className="text-xs text-muted-foreground">Strategy and partition control</p>}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Type</p>
                <Badge variant="outline">{updateStrategyType}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Partition</p>
                <p className="font-mono">Pods with ordinal &gt;= partition receive updates.</p>
              </div>
            </div>
            {updateStrategyType === 'RollingUpdate' && (
              <>
                <div className="flex items-center gap-4 flex-wrap">
                  <Label className="w-24">Partition</Label>
                  <Input
                    type="number"
                    min={0}
                    max={desired}
                    value={partitionInput !== '' ? partitionInput : partition}
                    onChange={(e) => setPartitionInput(e.target.value)}
                    className="w-24 font-mono"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const val = partitionInput !== '' ? parseInt(partitionInput, 10) : partition;
                      if (Number.isNaN(val) || val < 0) return;
                      try {
                        await patchStatefulSet.mutateAsync({
                          name: name!,
                          namespace: namespace!,
                          patch: { spec: { updateStrategy: { type: 'RollingUpdate', rollingUpdate: { partition: val } } } },
                        });
                        toast.success(`Partition set to ${val}`);
                        setPartitionInput('');
                        refetch();
                      } catch (err: any) {
                        toast.error(err?.message ?? 'Failed to update partition');
                      }
                    }}
                  >
                    Apply
                  </Button>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm mb-1">Update progress</p>
                  <p className="text-sm">Updated replicas: <span className="font-mono">{updated}</span> of <span className="font-mono">{desired}</span></p>
                </div>
              </>
            )}
          </div>
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
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      content: (
        <SectionCard icon={FileText} title="Logs" tooltip={<p className="text-xs text-muted-foreground">Stream logs from StatefulSet pods</p>}>
          {stsPods.length === 0 ? (
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
                      {stsPods.map((p) => (
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
        <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into StatefulSet pods</p>}>
          {stsPods.length === 0 ? (
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
                      {stsPods.map((p) => (
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
      content: <MetricsDashboard resourceType="statefulset" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={statefulSet.metadata?.name || ''} editable onSave={handleSaveYaml} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="statefulsets"
          resourceKind="StatefulSet"
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
          kind={normalizeKindForTopology('StatefulSet')}
          namespace={namespace || statefulSet?.metadata?.namespace || ''}
          name={name || statefulSet?.metadata?.name || ''}
          sourceResourceType="StatefulSet"
          sourceResourceName={statefulSet?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          { icon: Scale, label: 'Scale StatefulSet', description: 'Adjust the number of replicas', onClick: () => setShowScaleDialog(true) },
          { icon: RotateCcw, label: 'Rollout Restart', description: 'Trigger a rolling restart', onClick: () => setShowRolloutDialog(true) },
          { icon: History, label: 'Rollout History', description: 'View and manage revisions', onClick: () => setShowRolloutDialog(true) },
          { icon: Download, label: 'Download YAML', description: 'Export StatefulSet definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export StatefulSet as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete StatefulSet', description: 'Permanently remove this StatefulSet', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="StatefulSet"
        resourceIcon={Database}
        name={statefulSet.metadata?.name || ''}
        namespace={statefulSet.metadata?.namespace}
        status={status}
        backLink="/statefulsets"
        backLabel="StatefulSets"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {age}
            <span className="mx-2">•</span>
            <Server className="h-3.5 w-3.5" />
            {statefulSet.spec?.serviceName}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true) },
          { label: 'Restart', icon: RotateCcw, variant: 'outline', onClick: () => setShowRolloutDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <ScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        resourceType="StatefulSet"
        resourceName={statefulSet.metadata?.name || ''}
        namespace={statefulSet.metadata?.namespace}
        currentReplicas={desired}
        onScale={handleScale}
      />

      <RolloutActionsDialog
        open={showRolloutDialog}
        onOpenChange={setShowRolloutDialog}
        resourceType="StatefulSet"
        resourceName={statefulSet.metadata?.name || ''}
        namespace={statefulSet.metadata?.namespace}
        revisions={[]}
        onRestart={handleRestart}
        onRollback={handleRollback}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="StatefulSet"
        resourceName={statefulSet.metadata?.name || ''}
        namespace={statefulSet.metadata?.namespace}
        onConfirm={async () => {
          if (!isConnected || !name || !namespace) {
            toast.error('Connect cluster to delete StatefulSet');
            return;
          }
          await deleteStatefulSet.mutateAsync({ name, namespace });
          toast.success(`StatefulSet ${name} deleted`);
          navigate('/statefulsets');
        }}
        requireNameConfirmation
      />
    </>
  );
}
