import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Layers,
  Clock,
  Server,
  Download,
  Trash2,
  Copy,
  CheckCircle2,
  Activity,
  Scale,
  Box,
  FileText,
  Terminal,
  LayoutDashboard,
  CalendarClock,
  BarChart2,
  FileCode,
  GitCompare,
  Network,
  Settings,
  Search,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import { cn } from '@/lib/utils';
import {
  ResourceDetailLayout,
  ContainersSection,
  YamlViewer,
  EventsSection,
  MetadataCard,
  ActionsSection,
  MetricsDashboard,
  ScaleDialog,
  DeleteConfirmDialog,
  LogViewer,
  TerminalViewer,
  SectionCard,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ContainerInfo,
  type YamlVersion,
} from '@/components/resources';
import { DetailPodTable } from '@/components/resources/DetailPodTable';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, usePatchK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useMutationPolling } from '@/hooks/useMutationPolling';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery } from '@tanstack/react-query';
import { getReplicaSetMetrics } from '@/services/backendApiClient';
import { AgeCell, ListPagination, PAGE_SIZE_OPTIONS } from '@/components/list';
import { Input } from '@/components/ui/input';

interface ReplicaSetResource extends KubernetesResource {
  spec?: {
    replicas?: number;
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol: string }>;
          resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } };
        }>;
      };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    fullyLabeledReplicas?: number;
  };
}

export default function ReplicaSetDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [selectedLogPod, setSelectedLogPod] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');
  const [podsTabSearch, setPodsTabSearch] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const { isConnected } = useConnectionStatus();
  const { refetchInterval: fastPollInterval, isFastPolling, triggerFastPolling } = useMutationPolling({
    fastInterval: 2000,
    fastDuration: 30000,
    normalInterval: 60000,
  });
  const { resource: replicaSet, isLoading, error, age, yaml, refetch } = useResourceDetail<ReplicaSetResource>(
    'replicasets',
    name,
    namespace,
    {} as ReplicaSetResource,
    { refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 5000 }
  );
  const resourceEvents = useResourceEvents('ReplicaSet', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const deleteReplicaSet = useDeleteK8sResource('replicasets');
  const updateReplicaSet = useUpdateK8sResource('replicasets');
  const patchReplicaSet = usePatchK8sResource('replicasets');

  const status: ResourceStatus = replicaSet.status?.readyReplicas === replicaSet.spec?.replicas ? 'Running' :
    replicaSet.status?.readyReplicas ? 'Pending' : 'Failed';

  const desired = replicaSet.spec?.replicas || 0;
  const ready = replicaSet.status?.readyReplicas || 0;
  const available = replicaSet.status?.availableReplicas || 0;
  const fullyLabeled = replicaSet.status?.fullyLabeledReplicas || 0;

  const containers: ContainerInfo[] = (replicaSet.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name,
    image: c.image,
    ready: true,
    restartCount: 0,
    state: 'running',
    ports: c.ports || [],
    resources: c.resources || {},
  }));

  const { data: podsList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string }; spec?: { nodeName?: string } }>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!replicaSet?.spec?.selector?.matchLabels, refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 30000 }
  );
  const rsMatchLabels = replicaSet.spec?.selector?.matchLabels ?? {};
  const rsPods = (podsList?.items ?? []).filter((pod) => {
    const labels = pod.metadata?.labels ?? {};
    return Object.entries(rsMatchLabels).every(([k, v]) => labels[k] === v);
  });

  const rsMetricsQuery = useQuery({
    queryKey: ['backend', 'replicaset-metrics', clusterId, namespace, name],
    queryFn: () => getReplicaSetMetrics(backendBaseUrl!, clusterId!, namespace!, name!),
    enabled: !!(isBackendConfigured() && backendBaseUrl && clusterId && namespace && name),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = rsMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => { map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' }; });
    return map;
  }, [rsMetricsQuery.data?.pods]);

  const rsPodsFiltered = useMemo(() => {
    if (!podsTabSearch.trim()) return rsPods;
    const q = podsTabSearch.trim().toLowerCase();
    return rsPods.filter((pod) => (pod.metadata?.name ?? '').toLowerCase().includes(q) || ((pod.spec as { nodeName?: string })?.nodeName ?? '').toLowerCase().includes(q));
  }, [rsPods, podsTabSearch]);

  // Local pagination for Pods tab
  const [podsPageSize, setPodsPageSize] = useState(10);
  const [podsPageIndex, setPodsPageIndex] = useState(0);

  const totalRsPods = rsPodsFiltered.length;
  const podsTotalPages = Math.max(1, Math.ceil(totalRsPods / podsPageSize));
  const safePodsPageIndex = Math.min(podsPageIndex, podsTotalPages - 1);
  const podsStart = safePodsPageIndex * podsPageSize;
  const rsPodsPage = useMemo(
    () => rsPodsFiltered.slice(podsStart, podsStart + podsPageSize),
    [rsPodsFiltered, podsStart, podsPageSize]
  );

  useEffect(() => {
    if (safePodsPageIndex !== podsPageIndex) setPodsPageIndex(safePodsPageIndex);
  }, [safePodsPageIndex, podsPageIndex]);

  const handlePodsPageSizeChange = (size: number) => {
    setPodsPageSize(size);
    setPodsPageIndex(0);
  };

  const podsPagination = {
    rangeLabel:
      totalRsPods > 0
        ? `Showing ${podsStart + 1}–${Math.min(podsStart + podsPageSize, totalRsPods)} of ${totalRsPods}`
        : 'No pods',
    hasPrev: safePodsPageIndex > 0,
    hasNext: podsStart + podsPageSize < totalRsPods,
    onPrev: () => setPodsPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPodsPageIndex((i) => Math.min(podsTotalPages - 1, i + 1)),
    currentPage: safePodsPageIndex + 1,
    totalPages: Math.max(1, podsTotalPages),
    onPageChange: (p: number) => setPodsPageIndex(Math.max(0, Math.min(p - 1, podsTotalPages - 1))),
  };

  const firstRsPodName = rsPods[0]?.metadata?.name ?? '';
  const logPod = selectedLogPod || firstRsPodName;
  const terminalPod = selectedTerminalPod || firstRsPodName;
  const logPodContainers = (rsPods.find((p) => p.metadata?.name === logPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);
  const terminalPodContainers = (rsPods.find((p) => p.metadata?.name === terminalPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);

  const ownerRef = replicaSet.metadata?.ownerReferences?.[0];


  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${replicaSet.metadata?.name || 'replicaset'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  }, [yaml, replicaSet.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(replicaSet, `${replicaSet.metadata?.name || 'replicaset'}.json`);
    toast.success('JSON downloaded');
  }, [replicaSet]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleScale = useCallback(async (replicas: number) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to scale ReplicaSet');
      return;
    }
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to scale.');
      return;
    }
    if (!clusterId) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    try {
      await patchReplicaSet.mutateAsync({ name, namespace, patch: { spec: { replicas } } });
      toast.success(`Scaled ${name} to ${replicas} replicas`);
      triggerFastPolling();
      setActiveTab('pods');
      setSearchParams({ tab: 'pods' });
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to scale');
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, patchReplicaSet, triggerFastPolling, setSearchParams]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update ReplicaSet');
      throw new Error('Not connected');
    }
    try {
      await updateReplicaSet.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('ReplicaSet updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateReplicaSet, refetch]);

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

  if (!replicaSet?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">ReplicaSet not found.</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4 press-effect" onClick={() => navigate('/replicasets')}>
              Back to ReplicaSets
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Ready', value: `${ready}/${desired}`, icon: Server, iconColor: ready === desired ? 'success' as const : 'warning' as const },
    { label: 'Available', value: available, icon: CheckCircle2, iconColor: 'success' as const },
    { label: 'Fully Labeled', value: fullyLabeled, icon: Activity, iconColor: 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'primary' as const },
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
                <CardTitle className="text-base">ReplicaSet Information</CardTitle>
                <CardDescription>Configuration and ownership details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Desired Replicas</p>
                    <p className="font-mono text-lg">{desired}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Current Replicas</p>
                    <p className="font-mono text-lg">{replicaSet.status?.replicas || 0}</p>
                  </div>
                  {ownerRef && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground mb-1">Owner</p>
                      <Button
                        variant="link"
                        className="h-auto p-0 font-medium press-effect"
                        onClick={() => navigate(`/deployments/${namespace}/${ownerRef.name}`)}
                      >
                        {ownerRef.kind}: {ownerRef.name}
                      </Button>
                    </div>
                  )}
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
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Fully Labeled</span>
                    <div className="flex items-center gap-2">
                      <Progress value={desired > 0 ? (fullyLabeled / desired) * 100 : 0} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{fullyLabeled}/{desired}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetadataCard title="Labels" items={replicaSet.metadata?.labels || {}} variant="badges" />
            <MetadataCard title="Selector" items={replicaSet.spec?.selector?.matchLabels || {}} variant="default" />
          </div>
        </div>
      ),
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: rsPods.length.toString(),
      content: (
        <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods managed by this ReplicaSet</p>}>
          <DetailPodTable pods={rsPods} namespace={namespace ?? ''} />
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
        <SectionCard icon={FileText} title="Logs" tooltip={<p className="text-xs text-muted-foreground">Stream logs from ReplicaSet pods</p>}>
          {rsPods.length === 0 ? (
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
                      {rsPods.map((p) => (
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
        <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into ReplicaSet pods</p>}>
          {rsPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods available to open a terminal.</p>
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
                      {rsPods.map((p) => (
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
      content: <MetricsDashboard resourceType="replicaset" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={replicaSet.metadata?.name || ''} editable onSave={handleSaveYaml} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="replicasets"
          resourceKind="ReplicaSet"
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
          kind={normalizeKindForTopology('ReplicaSet')}
          namespace={namespace || replicaSet?.metadata?.namespace || ''}
          name={name || replicaSet?.metadata?.name || ''}
          sourceResourceType="ReplicaSet"
          sourceResourceName={replicaSet?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          { icon: Scale, label: 'Scale ReplicaSet', description: 'Adjust the number of replicas', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
          { icon: Download, label: 'Download YAML', description: 'Export ReplicaSet definition', onClick: handleDownloadYaml, className: 'press-effect' },
          { icon: Download, label: 'Export as JSON', description: 'Export ReplicaSet as JSON', onClick: handleDownloadJson, className: 'press-effect' },
          { icon: Trash2, label: 'Delete ReplicaSet', description: 'Permanently remove this ReplicaSet', variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        role="main"
        aria-label="ReplicaSet Detail"
        resourceType="ReplicaSet"
        resourceIcon={Layers}
        name={replicaSet.metadata?.name || ''}
        namespace={replicaSet.metadata?.namespace}
        status={status}
        backLink="/replicasets"
        backLabel="ReplicaSets"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {age}
            {ownerRef && (
              <>
                <span className="mx-2">•</span>
                Owner: {ownerRef.kind}
              </>
            )}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
            {isFastPolling && (
              <Badge className="ml-2 text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Syncing
              </Badge>
            )}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml, className: 'press-effect' },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson, className: 'press-effect' },
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <ScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        resourceType="ReplicaSet"
        resourceName={replicaSet.metadata?.name || ''}
        namespace={replicaSet.metadata?.namespace}
        currentReplicas={desired}
        onScale={handleScale}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ReplicaSet"
        resourceName={replicaSet.metadata?.name || ''}
        namespace={replicaSet.metadata?.namespace}
        onConfirm={async () => {
          if (!isConnected || !name || !namespace) {
            toast.error('Connect cluster to delete ReplicaSet');
            return;
          }
          await deleteReplicaSet.mutateAsync({ name, namespace });
          toast.success(`ReplicaSet ${name} deleted`);
          navigate('/replicasets');
        }}
        requireNameConfirmation
      />
    </>
  );
}
