import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Container,
  Clock,
  Server,
  RotateCcw,
  RefreshCw,
  Download,
  Trash2,
  Copy,
  CheckCircle2,
  XCircle,
  Activity,
  Scale,
  History,
  Loader2,
  Info,
  Layers,
  FileText,
  Terminal,
  Box,
  LayoutDashboard,
  CalendarClock,
  BarChart2,
  FileCode,
  GitCompare,
  Network,
  Settings,
  Search,
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
  ResourceOverviewMetadata,
  SectionCard,
  ContainersSection,
  YamlViewer,
  EventsSection,
  MetadataCard,
  ActionsSection,
  MetricsDashboard,
  ScaleDialog,
  LogViewer,
  TerminalViewer,
  RolloutActionsDialog,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ContainerInfo,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, usePatchK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { AgeCell } from '@/components/list';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDeploymentRolloutHistory, postDeploymentRollback, BackendApiError, getResourceEvents, getDeploymentMetrics, type RolloutHistoryRevision, type BackendEvent } from '@/services/backendApiClient';

function formatRolloutDuration(seconds: number | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface DeploymentResource extends KubernetesResource {
  spec?: {
    replicas?: number;
    strategy?: { type: string; rollingUpdate?: { maxSurge?: string; maxUnavailable?: string } };
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol: string; name?: string }>;
          resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } };
          env?: Array<{ name: string; value?: string }>;
        }>;
      };
    };
    minReadySeconds?: number;
    revisionHistoryLimit?: number;
    progressDeadlineSeconds?: number;
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
    conditions?: Array<{ type: string; status: string; lastTransitionTime: string; reason?: string; message?: string }>;
    observedGeneration?: number;
  };
}

interface HpaListItem extends KubernetesResource {
  spec?: {
    scaleTargetRef?: { kind?: string; name?: string };
    minReplicas?: number;
    maxReplicas?: number;
    metrics?: Array<{ resource?: { name?: string; target?: { averageUtilization?: number } } }>;
  };
  status?: { currentReplicas?: number; desiredReplicas?: number };
}

interface VpaListItem extends KubernetesResource {
  spec?: {
    targetRef?: { kind?: string; name?: string };
    updatePolicy?: { updateMode?: string };
  };
  status?: { recommendation?: { containerRecommendations?: Array<{ target?: Record<string, string> }> } };
}

export default function DeploymentDetail() {
  const { namespace, name } = useParams();
  const { activeCluster } = useClusterStore();
  const clusterId = useActiveClusterId();
  const breadcrumbSegments = useDetailBreadcrumbs(
    'Deployment',
    name ?? undefined,
    namespace ?? undefined,
    activeCluster?.name
  );
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [showRolloutDialog, setShowRolloutDialog] = useState(false);

  useEffect(() => {
    if (initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [selectedLogPod, setSelectedLogPod] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');
  const [podsTabSearch, setPodsTabSearch] = useState('');

  const { isConnected } = useConnectionStatus();
  const { resource: deployment, isLoading, error, age, yaml, refetch } = useResourceDetail<DeploymentResource>(
    'deployments',
    name,
    namespace,
    {} as DeploymentResource
  );
  const resourceEvents = useResourceEvents('Deployment', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const queryClient = useQueryClient();
  const rolloutHistoryQuery = useQuery({
    queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name],
    queryFn: () => getDeploymentRolloutHistory(backendBaseUrl!, clusterId!, namespace!, name!),
    enabled: !!(isBackendConfigured() && clusterId && namespace && name),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const rolloutRevisions = rolloutHistoryQuery.data?.revisions ?? [];
  const currentRevisionStr = deployment?.metadata?.annotations?.['deployment.kubernetes.io/revision'];
  const rolloutRevisionsForDialog = useMemo(() => {
    return rolloutRevisions.map((r) => ({
      revision: r.revision,
      createdAt: r.creationTimestamp ? new Date(r.creationTimestamp).toLocaleString() : '—',
      current: currentRevisionStr != null && String(r.revision) === currentRevisionStr,
      changeReason: r.changeCause || undefined,
      image: r.images?.[0],
    }));
  }, [rolloutRevisions, currentRevisionStr]);
  const deleteDeployment = useDeleteK8sResource('deployments');
  const updateDeployment = useUpdateK8sResource('deployments');
  const patchDeployment = usePatchK8sResource('deployments');


  const status: ResourceStatus = deployment.status?.readyReplicas === deployment.spec?.replicas ? 'Running' :
    deployment.status?.readyReplicas ? 'Pending' : 'Failed';

  const conditions = deployment.status?.conditions || [];
  const desired = deployment.spec?.replicas || 0;
  const ready = deployment.status?.readyReplicas || 0;
  const updated = deployment.status?.updatedReplicas || 0;
  const available = deployment.status?.availableReplicas || 0;

  const containers: ContainerInfo[] = (deployment.spec?.template?.spec?.containers || []).map(c => ({
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
    { enabled: !!namespace && !!deployment?.spec?.selector?.matchLabels }
  );
  const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
  const deploymentPods = (podsList?.items ?? []).filter((pod) => {
    const labels = pod.metadata?.labels ?? {};
    return Object.entries(matchLabels).every(([k, v]) => labels[k] === v);
  });

  const deploymentName = deployment?.metadata?.name ?? name;
  const { data: hpaList } = useK8sResourceList<HpaListItem>(
    'horizontalpodautoscalers',
    namespace ?? undefined,
    { enabled: !!namespace && !!deploymentName }
  );
  const hpasForDeployment = useMemo(() => {
    const items = hpaList?.items ?? [];
    return items.filter((h) => h.spec?.scaleTargetRef?.kind === 'Deployment' && h.spec?.scaleTargetRef?.name === deploymentName);
  }, [hpaList?.items, deploymentName]);

  const { data: vpaList } = useK8sResourceList<VpaListItem>(
    'verticalpodautoscalers',
    namespace ?? undefined,
    { enabled: !!namespace && !!deploymentName }
  );
  const vpasForDeployment = useMemo(() => {
    const items = vpaList?.items ?? [];
    return items.filter((v) => v.spec?.targetRef?.kind === 'Deployment' && v.spec?.targetRef?.name === deploymentName);
  }, [vpaList?.items, deploymentName]);

  const scalingEventsQuery = useQuery({
    queryKey: ['backend', 'resource-events', clusterId, namespace, 'Deployment', name],
    queryFn: () => getResourceEvents(backendBaseUrl!, clusterId!, namespace!, 'Deployment', name!, 100),
    enabled: !!(isBackendConfigured() && backendBaseUrl && clusterId && namespace && name),
    staleTime: 30_000,
  });
  const scalingHistoryEvents = useMemo(() => {
    const events = scalingEventsQuery.data ?? [];
    const scalingReasons = ['ScalingReplicaSet', 'HorizontalPodAutoscaler', 'Scale'];
    return events
      .filter((e) => scalingReasons.some((r) => (e.reason ?? '').includes(r)) || (e.message ?? '').toLowerCase().includes('scale'))
      .slice(0, 50)
      .sort((a, b) => new Date(b.last_timestamp || b.first_timestamp).getTime() - new Date(a.last_timestamp || a.first_timestamp).getTime());
  }, [scalingEventsQuery.data]);

  const deploymentMetricsQuery = useQuery({
    queryKey: ['backend', 'deployment-metrics', clusterId, namespace, deploymentName],
    queryFn: () => getDeploymentMetrics(backendBaseUrl!, clusterId!, namespace!, deploymentName!),
    enabled: !!(isBackendConfigured() && backendBaseUrl && clusterId && namespace && deploymentName),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = deploymentMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => {
      map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' };
    });
    return map;
  }, [deploymentMetricsQuery.data?.pods]);

  const deploymentPodsFiltered = useMemo(() => {
    if (!podsTabSearch.trim()) return deploymentPods;
    const q = podsTabSearch.trim().toLowerCase();
    return deploymentPods.filter((pod) => (pod.metadata?.name ?? '').toLowerCase().includes(q) || ((pod.spec as { nodeName?: string })?.nodeName ?? '').toLowerCase().includes(q));
  }, [deploymentPods, podsTabSearch]);

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deployment.metadata?.name || 'deployment'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }, [yaml, deployment.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(deployment, `${deployment.metadata?.name || 'deployment'}.json`);
    toast.success('JSON downloaded');
  }, [deployment]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleScale = useCallback(async (replicas: number) => {
    if (!isConnected) {
      toast.error('Connect cluster to scale deployment');
      return;
    }
    if (!name || !namespace) return;
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.');
      return;
    }
    if (!clusterId) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    try {
      await patchDeployment.mutateAsync({ name, namespace, patch: { spec: { replicas } } });
      toast.success(`Scaled ${name} to ${replicas} replicas`);
      refetch();
      if (clusterId && namespace && name) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to scale');
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, patchDeployment, refetch, queryClient]);

  const handleRestart = useCallback(async () => {
    if (!isConnected) {
      toast.error('Connect cluster to restart deployment');
      return;
    }
    if (!name || !namespace) return;
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.');
      return;
    }
    if (!clusterId) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    try {
      const patch = {
        spec: {
          template: {
            metadata: {
              annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() },
            },
          },
        },
      };
      await patchDeployment.mutateAsync({ name, namespace, patch });
      toast.success(`Rollout restart initiated for ${name}`);
      refetch();
      if (clusterId && namespace && name) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to restart');
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, patchDeployment, refetch, queryClient]);

  const handleRollback = useCallback(async (revision: number) => {
    if (!isConnected) {
      toast.error('Connect cluster to rollback deployment');
      return;
    }
    if (!name || !namespace) return;
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.');
      return;
    }
    if (!clusterId) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postDeploymentRollback(backendBase, clusterId, namespace, name, { revision });
      toast.success(`Rolled back ${name} to revision ${revision}`);
      refetch();
      if (clusterId && namespace && name) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message ?? 'Failed to rollback');
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, refetch, queryClient]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update deployment');
      throw new Error('Not connected');
    }
    try {
      await updateDeployment.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('Deployment updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateDeployment, refetch]);

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

  if (!deployment?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Deployment not found.</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/deployments')}>
              Back to Deployments
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const revisionLabel = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 'current';
  const strategyLabel = deployment.spec?.strategy?.type === 'Recreate'
    ? 'Recreate'
    : `RollingUpdate (${deployment.spec?.strategy?.rollingUpdate?.maxSurge ?? '25%'} / ${deployment.spec?.strategy?.rollingUpdate?.maxUnavailable ?? '25%'})`;
  const statusCards = [
    { label: 'Ready', value: `${ready}/${desired}`, icon: Server, iconColor: ready === desired ? 'success' as const : 'warning' as const },
    { label: 'Up-to-Date', value: updated, icon: RefreshCw, iconColor: 'info' as const },
    { label: 'Available', value: available, icon: CheckCircle2, iconColor: 'success' as const },
    { label: 'Revision', value: revisionLabel, icon: History, iconColor: 'primary' as const },
    { label: 'Strategy', value: strategyLabel, icon: Layers, iconColor: 'primary' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'primary' as const },
  ];
  const yamlVersions: YamlVersion[] = [
    { id: 'current', label: `Current (Revision ${revisionLabel})`, yaml, timestamp: 'now' },
  ];

  const firstPodName = deploymentPods[0]?.metadata?.name ?? '';
  const logPod = selectedLogPod || firstPodName;
  const terminalPod = selectedTerminalPod || firstPodName;
  const logPodContainers = (deploymentPods.find((p) => p.metadata?.name === logPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);
  const terminalPodContainers = (deploymentPods.find((p) => p.metadata?.name === terminalPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata
            metadata={deployment.metadata}
            createdLabel={age}
            namespace={deployment.metadata?.namespace}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard icon={Info} title="Deployment Information" tooltip={<p className="text-xs text-muted-foreground">Configuration and status details</p>}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Strategy</p>
                    <Badge variant="outline">{deployment.spec?.strategy?.type || 'RollingUpdate'}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Min Ready Seconds</p>
                    <p className="font-mono">{deployment.spec?.minReadySeconds || 0}s</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Revision History Limit</p>
                    <p className="font-mono">{deployment.spec?.revisionHistoryLimit || 10}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Progress Deadline</p>
                    <p className="font-mono">{deployment.spec?.progressDeadlineSeconds || 600}s</p>
                  </div>
                  {deployment.spec?.strategy?.rollingUpdate && (
                    <>
                      <div>
                        <p className="text-muted-foreground mb-1">Max Surge</p>
                        <p className="font-mono">{deployment.spec.strategy.rollingUpdate.maxSurge || '25%'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">Max Unavailable</p>
                        <p className="font-mono">{deployment.spec.strategy.rollingUpdate.maxUnavailable || '25%'}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={Layers} title="Replica Status" tooltip={<p className="text-xs text-muted-foreground">Current replica distribution</p>}>
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Ready</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(ready / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{ready}/{desired}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Updated</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(updated / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{updated}/{desired}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Available</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(available / desired) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{available}/{desired}</span>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard icon={Activity} title="Conditions" tooltip={<p className="text-xs text-muted-foreground">Deployment condition status</p>}>
            <div className="space-y-3">
              {conditions.map((condition) => {
                const isTrue = condition.status === 'True';
                return (
                  <div key={condition.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      {isTrue ? (
                        <CheckCircle2 className="h-5 w-5 text-[hsl(142,76%,36%)]" />
                      ) : (
                        <XCircle className="h-5 w-5 text-[hsl(0,72%,51%)]" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{condition.type}</p>
                        <p className="text-xs text-muted-foreground">{condition.reason}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(condition.lastTransitionTime).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetadataCard title="Selector" items={deployment.spec?.selector?.matchLabels || {}} variant="default" />
          </div>
        </div>
      ),
    },
    {
      id: 'rollout-history',
      label: 'Rollout History',
      content: (
        <SectionCard icon={History} title="Rollout History" tooltip={<p className="text-xs text-muted-foreground">Revisions and rollback</p>}>
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-muted-foreground">Revisions for this deployment. Roll back to a previous revision or trigger a restart.</p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">About revisions</p>
              <p>
                A new revision is created only when the <strong>pod template</strong> changes (e.g. image, env, resources).
                Changing replica count (e.g. 5 → 6) does <strong>not</strong> create a new revision — the same ReplicaSet scales.
                To change replicas or revert a scale change, use the <strong>Scale deployment</strong> button or the <strong>Scaling</strong> tab.
              </p>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Button variant="default" size="sm" onClick={() => setShowScaleDialog(true)} className="gap-2 shadow-sm">
                <Scale className="h-4 w-4" />
                Scale deployment
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => rolloutHistoryQuery.refetch()} disabled={rolloutHistoryQuery.isLoading} className="gap-2">
                  <RefreshCw className={rolloutHistoryQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowRolloutDialog(true)} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Restart / Rollback
                </Button>
              </div>
            </div>
            {rolloutHistoryQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading revision history…
              </div>
            ) : rolloutHistoryQuery.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  {rolloutHistoryQuery.error instanceof Error
                    ? rolloutHistoryQuery.error.message
                    : 'Failed to load rollout history.'}
                </p>
                {rolloutHistoryQuery.error instanceof BackendApiError && rolloutHistoryQuery.error.status === 404 && (
                  <p className="text-xs text-muted-foreground">
                    Your cluster is connected (the metrics and resources above come from it). Rollout History is loaded from the Kubilitics backend. Ensure the backend is running and has this cluster added via Settings → Connect, then select this cluster from the header dropdown.
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={() => rolloutHistoryQuery.refetch()} className="mt-2">
                  Try again
                </Button>
              </div>
            ) : !isBackendConfigured() || !clusterId ? (
              <p className="text-sm text-muted-foreground">Rollout History is provided by the Kubilitics backend. Configure the backend (Settings → Connect) and select this cluster to view revisions and rollback.</p>
            ) : rolloutRevisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revision history yet, or no ReplicaSets owned by this deployment.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-2">
                  Showing <strong>{rolloutRevisions.length}</strong> revision(s) from cluster. Select a revision and use Rollback to revert the deployment to that configuration (pod template).
                </p>
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Revision</th>
                        <th className="text-left p-3 font-medium">Created</th>
                        <th className="text-left p-3 font-medium">Change cause</th>
                        <th className="text-left p-3 font-medium">Images</th>
                        <th className="text-left p-3 font-medium">Image changes</th>
                        <th className="text-left p-3 font-medium">Duration</th>
                        <th className="text-left p-3 font-medium">Ready / Desired</th>
                        <th className="text-left p-3 font-medium">ReplicaSet</th>
                        <th className="text-right p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const newestFirst: RolloutHistoryRevision[] = [...rolloutRevisions].reverse();
                        return newestFirst.map((rev, idx) => {
                          const isCurrent = String(rev.revision) === revisionLabel;
                          const nextRev = idx > 0 ? newestFirst[idx - 1] : null;
                          const images = rev.images ?? [];
                          const imageDiffs = nextRev?.images
                            ? images
                              .map((img, i) => (nextRev.images![i] !== undefined && nextRev.images![i] !== img ? { old: img, new: nextRev.images![i] } : null))
                              .filter((x): x is { old: string; new: string } => x != null)
                            : [];
                          return (
                            <tr key={rev.revision} className="border-t hover:bg-muted/20">
                              <td className="p-3 font-mono align-top">
                                <span className="font-semibold">{rev.revision}</span>
                                {isCurrent && (
                                  <Badge variant="default" className="ml-2 text-xs">Active</Badge>
                                )}
                              </td>
                              <td className="p-3 text-muted-foreground align-top whitespace-nowrap">
                                {rev.creationTimestamp ? new Date(rev.creationTimestamp).toLocaleString() : '—'}
                              </td>
                              <td className="p-3 text-muted-foreground align-top max-w-[180px]">
                                <span className="line-clamp-2" title={rev.changeCause || undefined}>{rev.changeCause || '—'}</span>
                              </td>
                              <td className="p-3 align-top max-w-[200px]">
                                {images.length > 0 ? (
                                  <ul className="list-disc list-inside text-xs space-y-0.5">
                                    {images.map((img, i) => (
                                      <li key={i} className="truncate font-mono" title={img}>{img}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="p-3 align-top max-w-[220px]">
                                {imageDiffs.length > 0 ? (
                                  <ul className="text-xs space-y-1">
                                    {imageDiffs.map((d, i) => (
                                      <li key={i} className="text-amber-600 dark:text-amber-400">
                                        <span className="line-through opacity-80">{d.old}</span>
                                        <span className="mx-1">→</span>
                                        <span className="font-medium">{d.new}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="p-3 font-mono text-muted-foreground align-top whitespace-nowrap">
                                {formatRolloutDuration(rev.durationSeconds)}
                              </td>
                              <td className="p-3 font-mono align-top">{rev.ready} / {rev.desired}</td>
                              <td className="p-3 font-mono text-xs align-top truncate max-w-[120px]" title={rev.name}>{rev.name}</td>
                              <td className="p-3 text-right align-top">
                                {!isCurrent && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRollback(rev.revision)}
                                  >
                                    Rollback
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </SectionCard>
      ),
    },
    {
      id: 'scaling',
      label: 'Scaling',
      icon: Scale,
      content: (
        <SectionCard icon={Scale} title="Scaling" tooltip={<p className="text-xs text-muted-foreground">Replica count, HPA/VPA binding, scaling history</p>}>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-foreground">Desired</p>
                  <p className="text-2xl font-semibold">{desired}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-foreground">Ready</p>
                  <p className="text-2xl font-semibold">{ready}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-foreground">Available</p>
                  <p className="text-2xl font-semibold">{available}</p>
                </CardContent>
              </Card>
            </div>

            {hpasForDeployment.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">HPA binding</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {hpasForDeployment.map((hpa) => {
                    const ref = hpa.spec?.scaleTargetRef;
                    const minR = hpa.spec?.minReplicas ?? 0;
                    const maxR = hpa.spec?.maxReplicas ?? 0;
                    const currentR = (hpa as { status?: { currentReplicas?: number; desiredReplicas?: number } }).status?.currentReplicas ?? 0;
                    const desiredR = (hpa as { status?: { desiredReplicas?: number } }).status?.desiredReplicas ?? currentR;
                    const cpuMetric = (hpa.spec as { metrics?: Array<{ resource?: { name?: string; target?: { averageUtilization?: number } } }> })?.metrics?.find((m) => m.resource?.name === 'cpu')?.resource?.target?.averageUtilization;
                    const hpaName = (hpa.metadata as { name?: string })?.name ?? '';
                    const hpaNs = (hpa.metadata as { namespace?: string })?.namespace ?? namespace ?? '';
                    return (
                      <Card key={`${hpaNs}/${hpaName}`} className="overflow-hidden">
                        <CardHeader className="pb-2 pt-4 px-4">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">HorizontalPodAutoscaler</CardTitle>
                            <Link to={`/horizontalpodautoscalers/${hpaNs}/${hpaName}`} className="text-xs text-primary hover:underline">View HPA</Link>
                          </div>
                          <CardDescription className="text-xs font-mono">{hpaName}</CardDescription>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0 text-sm space-y-1">
                          <p className="flex justify-between"><span className="text-muted-foreground">Current / Desired</span><span className="font-mono">{currentR} / {desiredR}</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Min / Max replicas</span><span className="font-mono">{minR} / {maxR}</span></p>
                          {cpuMetric != null && <p className="flex justify-between"><span className="text-muted-foreground">Target CPU</span><span className="font-mono">{cpuMetric}%</span></p>}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {vpasForDeployment.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">VPA binding</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {vpasForDeployment.map((vpa) => {
                    const vpaName = (vpa.metadata as { name?: string })?.name ?? '';
                    const vpaNs = (vpa.metadata as { namespace?: string })?.namespace ?? namespace ?? '';
                    const mode = (vpa.spec as { updatePolicy?: { updateMode?: string } })?.updatePolicy?.updateMode ?? 'Auto';
                    const rec = (vpa.status as { recommendation?: { containerRecommendations?: Array<{ target?: Record<string, string> }> } })?.recommendation?.containerRecommendations?.[0]?.target;
                    const cpuRec = rec?.cpu ?? '–';
                    const memRec = rec?.memory ?? '–';
                    return (
                      <Card key={`${vpaNs}/${vpaName}`} className="overflow-hidden">
                        <CardHeader className="pb-2 pt-4 px-4">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">VerticalPodAutoscaler</CardTitle>
                            <Link to={`/verticalpodautoscalers/${vpaNs}/${vpaName}`} className="text-xs text-primary hover:underline">View VPA</Link>
                          </div>
                          <CardDescription className="text-xs font-mono">{vpaName}</CardDescription>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0 text-sm space-y-1">
                          <p className="flex justify-between"><span className="text-muted-foreground">Update mode</span><span className="font-mono">{mode}</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">CPU recommendation</span><span className="font-mono">{cpuRec}</span></p>
                          <p className="flex justify-between"><span className="text-muted-foreground">Memory recommendation</span><span className="font-mono">{memRec}</span></p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Set a new replica count for this deployment. Changes apply immediately.
              </p>
              <Button variant="default" size="sm" onClick={() => setShowScaleDialog(true)} className="gap-2 shadow-sm">
                <Scale className="h-4 w-4" />
                Change replica count
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Scaling history</h4>
              <p className="text-xs text-muted-foreground">Replica scale events for this deployment (from cluster events).</p>
              {!isBackendConfigured() || !clusterId ? (
                <p className="text-sm text-muted-foreground">Configure the backend and select a cluster to load scaling history.</p>
              ) : scalingEventsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading events…</div>
              ) : scalingHistoryEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scaling events found for this deployment.</p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Time</th>
                        <th className="text-left p-3 font-medium">Reason</th>
                        <th className="text-left p-3 font-medium">Message</th>
                        <th className="text-left p-3 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scalingHistoryEvents.map((e: BackendEvent, idx: number) => (
                        <tr key={e.id ?? idx} className="border-t hover:bg-muted/20">
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {e.last_timestamp ? new Date(e.last_timestamp).toLocaleString() : e.first_timestamp ? new Date(e.first_timestamp).toLocaleString() : '—'}
                          </td>
                          <td className="p-3 font-mono text-xs">{e.reason ?? '—'}</td>
                          <td className="p-3 max-w-[320px] truncate" title={e.message}>{e.message ?? '—'}</td>
                          <td className="p-3"><Badge variant={e.type === 'Warning' ? 'destructive' : 'secondary'} className="text-xs">{e.type ?? 'Normal'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      ),
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: deploymentPods.length.toString(),
      content: (
        <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods managed by this deployment</p>}>
          <div className="space-y-3">
            {deploymentPods.length > 0 && (
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by pod name or node..."
                  value={podsTabSearch}
                  onChange={(e) => setPodsTabSearch(e.target.value)}
                  className="pl-9 h-10 text-sm"
                  aria-label="Search pods"
                />
              </div>
            )}
            {deploymentPods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods match this deployment&apos;s selector yet.</p>
            ) : deploymentPodsFiltered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods match the search.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Name</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Ready</th>
                      <th className="text-left p-3 font-medium">Restarts</th>
                      <th className="text-left p-3 font-medium">Node</th>
                      <th className="text-left p-3 font-medium">CPU</th>
                      <th className="text-left p-3 font-medium">Memory</th>
                      <th className="text-left p-3 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deploymentPodsFiltered.map((pod) => {
                      const podName = pod.metadata?.name ?? '';
                      const podNs = pod.metadata?.namespace ?? namespace ?? '';
                      const status = pod.status as { phase?: string; containerStatuses?: Array<{ ready?: boolean; restartCount?: number }> } | undefined;
                      const phase = status?.phase ?? '–';
                      const containerStatuses = status?.containerStatuses ?? [];
                      const readyCount = containerStatuses.filter((c) => c.ready).length;
                      const totalContainers = containerStatuses.length || 1;
                      const readyStr = `${readyCount}/${totalContainers}`;
                      const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
                      const nodeName = (pod.spec as { nodeName?: string } | undefined)?.nodeName ?? '–';
                      const metrics = podMetricsByName[podName];
                      return (
                        <tr
                          key={podName}
                          className="border-t hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/pods/${podNs}/${podName}`)}
                        >
                          <td className="p-3">
                            <Link to={`/pods/${podNs}/${podName}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                              {podName}
                            </Link>
                          </td>
                          <td className="p-3"><Badge variant={phase === 'Running' ? 'default' : 'secondary'} className="text-xs">{phase}</Badge></td>
                          <td className="p-3 font-mono text-xs">{readyStr}</td>
                          <td className="p-3 font-mono text-xs">{restarts}</td>
                          <td className="p-3 font-mono text-xs truncate max-w-[140px]" title={nodeName}>{nodeName}</td>
                          <td className="p-3 font-mono text-xs text-muted-foreground">{metrics?.cpu ?? '–'}</td>
                          <td className="p-3 font-mono text-xs text-muted-foreground">{metrics?.memory ?? '–'}</td>
                          <td className="p-3"><AgeCell age={pod.metadata?.creationTimestamp ? calculateAge(pod.metadata.creationTimestamp) : '–'} timestamp={pod.metadata?.creationTimestamp} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
        <SectionCard icon={FileText} title="Logs" tooltip={<p className="text-xs text-muted-foreground">Stream logs from deployment pods</p>}>
          {deploymentPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods available. Select a deployment with running pods to view logs.</p>
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
                      {deploymentPods.map((p) => (
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
              <LogViewer
                podName={logPod}
                namespace={namespace ?? undefined}
                containerName={selectedLogContainer || logPodContainers[0]}
                containers={logPodContainers}
                onContainerChange={setSelectedLogContainer}
              />
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
        <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into deployment pods</p>}>
          {deploymentPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods available. Select a deployment with running pods to open a terminal.</p>
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
                      {deploymentPods.map((p) => (
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
              <TerminalViewer
                podName={terminalPod}
                namespace={namespace ?? undefined}
                containerName={selectedTerminalContainer || terminalPodContainers[0]}
                containers={terminalPodContainers}
                onContainerChange={setSelectedTerminalContainer}
              />
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
      content: <MetricsDashboard resourceType="deployment" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="deployments"
          resourceKind="Deployment"
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
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={deploymentName || ''} editable onSave={handleSaveYaml} />,
    },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('Deployment')}
          namespace={namespace || deployment?.metadata?.namespace || ''}
          name={name || deployment?.metadata?.name || ''}
          sourceResourceType="Deployment"
          sourceResourceName={deployment?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          { icon: Scale, label: 'Scale Deployment', description: 'Adjust the number of replicas', onClick: () => setShowScaleDialog(true) },
          { icon: RotateCcw, label: 'Rollout Restart', description: 'Trigger a rolling restart', onClick: () => setShowRolloutDialog(true) },
          { icon: History, label: 'Rollout History', description: 'View and manage revisions', onClick: () => setShowRolloutDialog(true) },
          { icon: Download, label: 'Download YAML', description: 'Export deployment definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export deployment as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Deployment', description: 'Permanently remove this deployment', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Deployment"
        resourceIcon={Container}
        name={deployment.metadata?.name || ''}
        namespace={deployment.metadata?.namespace}
        status={status}
        backLink="/deployments"
        backLabel="Deployments"
        createdLabel={age}
        createdAt={deployment.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            {deployment.spec?.strategy?.type || 'RollingUpdate'}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true) },
          { label: 'Restart', icon: RotateCcw, variant: 'outline', onClick: () => setShowRolloutDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (tabId === 'overview') next.delete('tab');
            else next.set('tab', tabId);
            return next;
          }, { replace: true });
        }}
      >
        {breadcrumbSegments.length > 0 && (
          <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        )}
      </ResourceDetailLayout>

      <ScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        resourceType="Deployment"
        resourceName={deployment.metadata?.name || ''}
        namespace={deployment.metadata?.namespace}
        currentReplicas={desired}
        onScale={handleScale}
      />

      <RolloutActionsDialog
        open={showRolloutDialog}
        onOpenChange={setShowRolloutDialog}
        resourceType="Deployment"
        resourceName={deployment.metadata?.name || ''}
        namespace={deployment.metadata?.namespace}
        revisions={rolloutRevisionsForDialog}
        onRestart={handleRestart}
        onRollback={handleRollback}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Deployment"
        resourceName={deployment.metadata?.name || ''}
        namespace={deployment.metadata?.namespace}
        onConfirm={async () => {
          if (!isConnected || !name || !namespace) {
            toast.error('Connect cluster to delete deployment');
            return;
          }
          await deleteDeployment.mutateAsync({ name, namespace });
          toast.success(`Deployment ${name} deleted`);
          navigate('/deployments');
        }}
        requireNameConfirmation
      />
    </>
  );
}
