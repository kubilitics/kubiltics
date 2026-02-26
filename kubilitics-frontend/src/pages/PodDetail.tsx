import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Box,
  Clock,
  Server,
  RotateCcw,
  Download,
  Trash2,
  Terminal,
  FileText,
  ExternalLink,
  Loader2,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  Activity,
  Play,
  Pause,
  Settings,
  LayoutDashboard,
  Info,
  Shield,
  Tag,
  BarChart2,
  CalendarClock,
  FileCode,
  GitCompare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  ResourceDetailLayout,
  ResourceTabs,
  SectionCard,
  ContainersSection,
  DetailRow,
  YamlViewer,
  EventsSection,
  ActionsSection,
  LogViewer,
  TerminalViewer,
  DeleteConfirmDialog,
  PortForwardDialog,
  MetricsDashboard,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ContainerInfo,
} from '@/components/resources';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import {
  TOOLTIP_QOS,
  TOOLTIP_RESTART_POLICY,
  TOOLTIP_DNS_POLICY,
  TOOLTIP_TERMINATION_GRACE,
  TOOLTIP_PRIORITY,
  TOOLTIP_TOLERATION_EFFECT,
  TOOLTIP_TOLERATION_SECONDS,
  TOOLTIP_VOLUME_KIND,
  TOOLTIP_VOLUME_DEFAULT_MODE,
} from '@/lib/k8sTooltips';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useK8sResourceList, useDeleteK8sResource, useUpdateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useMetricsSummary } from '@/hooks/useMetricsSummary';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { cn } from '@/lib/utils';
import { downloadResourceJson } from '@/lib/exportUtils';

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
      env?: Array<{ name: string; value?: string; valueFrom?: any }>;
      volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }>;
      livenessProbe?: Record<string, unknown>;
      readinessProbe?: Record<string, unknown>;
    }>;
    volumes?: Array<{
      name: string;
      configMap?: { name: string };
      secret?: { secretName: string };
      emptyDir?: {};
      persistentVolumeClaim?: { claimName: string };
      projected?: {
        defaultMode?: number;
        sources?: Array<{ serviceAccountToken?: { audience?: string }; configMap?: { name: string }; downwardAPI?: {} }>;
      };
    }>;
    affinity?: any;
    tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string; tolerationSeconds?: number }>;
    nodeSelector?: Record<string, string>;
  };
}

export default function PodDetail() {
  const { namespace, name } = useParams();
  const { activeCluster } = useClusterStore();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const breadcrumbSegments = useDetailBreadcrumbs(
    'Pod',
    name ?? undefined,
    namespace ?? undefined,
    activeCluster?.name
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const containerFilterFromUrl = searchParams.get('container');

  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedContainerFilter, setSelectedContainerFilter] = useState<string | null>(() => {
    return containerFilterFromUrl === '' || containerFilterFromUrl === 'all' ? null : containerFilterFromUrl;
  });
  useEffect(() => {
    const c = searchParams.get('container');
    setSelectedContainerFilter(c === '' || c === 'all' || !c ? null : c);
  }, [searchParams]);
  const [selectedLogContainer, setSelectedLogContainer] = useState<string | undefined>(undefined);
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string | undefined>(undefined);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPortForwardDialog, setShowPortForwardDialog] = useState(false);
  const [portForwardInitial, setPortForwardInitial] = useState<{ containerName: string; port: number } | null>(null);

  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const { resource: pod, isLoading, error, age, yaml, refetch } = useResourceDetail<PodResource>(
    'pods',
    name,
    namespace,
    {} as PodResource
  );
  const resourceEvents = useResourceEvents('Pod', namespace ?? undefined, name ?? undefined);
  const events = resourceEvents.events;
  const eventsLoading = resourceEvents.isLoading;
  const { data: metricsResult } = useMetricsSummary('pod', namespace ?? undefined, name ?? undefined, { enabled: !!namespace && !!name });
  const podMetrics = useMemo(() => {
    const summary = metricsResult?.summary;
    const p = summary?.pods?.[0];
    if (!p) return undefined;
    return { CPU: p.cpu, Memory: p.memory, containers: p.containers ?? [] };
  }, [metricsResult?.summary]);
  const deletePod = useDeleteK8sResource('pods');
  const updatePod = useUpdateK8sResource('pods');

  // Pods in same namespace for Compare tab (embedded ResourceComparisonView)
  const { data: namespacePodsData } = useK8sResourceList<PodResource>('pods', namespace ?? undefined, {
    limit: 500,
    enabled: !!namespace,
  });
  const namespacePods = useMemo(() => {
    if (!namespacePodsData?.items) return [];
    return namespacePodsData.items.map((item: PodResource) => {
      const statusPhase = item.status?.phase;
      const containerStatuses = item.status?.containerStatuses || [];
      let status: string = (statusPhase as string) || 'Unknown';
      if ((item.metadata as { deletionTimestamp?: string }).deletionTimestamp) {
        status = 'Terminating';
      } else {
        for (const c of containerStatuses) {
          if (c.state?.waiting?.reason === 'CrashLoopBackOff') {
            status = 'CrashLoopBackOff';
            break;
          }
          if (c.state?.waiting?.reason === 'ContainerCreating') {
            status = 'ContainerCreating';
            break;
          }
        }
      }
      return {
        name: item.metadata.name,
        namespace: item.metadata.namespace || 'default',
        status,
      };
    });
  }, [namespacePodsData?.items, namespace]);

  const status = pod.status?.phase as ResourceStatus || 'Unknown';
  const conditions = pod.status?.conditions || [];
  const containerStatuses = pod.status?.containerStatuses || [];
  const readyContainers = containerStatuses.filter(c => c.ready).length;
  const totalRestarts = containerStatuses.reduce((sum, c) => sum + c.restartCount, 0);

  const containers: ContainerInfo[] = useMemo(() => {
    const specContainers = pod.spec?.containers || [];
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
      const cpuPct = limitCpuMc > 0 ? Math.min(100, Math.round((usageCpuMc / limitCpuMc) * 100)) : 0;
      const memPct = limitMemBytes > 0 ? Math.min(100, Math.round((usageMemBytes / limitMemBytes) * 100)) : 0;

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
        currentUsage: { cpu: cpuPct, memory: memPct },
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
  }, [pod.spec?.containers, containerStatuses, podMetrics]);

  const filteredContainers = useMemo(() => {
    if (!selectedContainerFilter || selectedContainerFilter === 'all') return containers;
    return containers.filter((c) => c.name === selectedContainerFilter);
  }, [containers, selectedContainerFilter]);


  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pod.metadata?.name || 'pod'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }, [yaml, pod.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(pod, `${pod.metadata?.name || 'pod'}.json`);
    toast.success('JSON downloaded');
  }, [pod]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleRestartPod = useCallback(async () => {
    if (isConnected && name && namespace) {
      try {
        await deletePod.mutateAsync({ name, namespace });
        toast.success('Pod restarted (deleted for recreation by controller)');
      } catch (error: any) {
        toast.error(`Failed to restart: ${error.message}`);
      }
    } else {
      toast.success('Pod restart initiated (demo mode)');
    }
  }, [isConnected, name, namespace, deletePod]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (isConnected && name && namespace) {
      try {
        await updatePod.mutateAsync({ name, yaml: newYaml, namespace });
        toast.success('Pod updated successfully');
        refetch();
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        const isPodImmutable =
          msg.includes('pod updates may not change') ||
          (msg.includes('is invalid') && msg.includes('Pod'));
        if (isPodImmutable) {
          toast.error('Pod spec is mostly immutable', {
            description:
              'Only container image, activeDeadlineSeconds, tolerations (additions), and terminationGracePeriodSeconds can be updated. To change env, volumes, or other fields, edit the owning Deployment or ReplicaSet.',
            duration: 8000,
          });
        } else {
          toast.error(`Failed to update: ${msg}`);
        }
        throw error;
      }
    } else {
      toast.success('Pod updated (demo mode)');
    }
  }, [isConnected, name, namespace, updatePod, refetch]);

  const hasResource = !!pod?.metadata?.name;

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

  if (!hasResource || error) {
    return (
      <div className="space-y-6 flex flex-col items-center justify-center min-h-[400px] text-center">
        <Box className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">Pod not found</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error?.message ?? `Pod ${namespace}/${name} could not be loaded. Check cluster connection and permissions.`}
        </p>
        <Button variant="outline" onClick={() => navigate('/pods')}>
          Back to Pods
        </Button>
      </div>
    );
  }

  const statusCards = [
    { label: 'Ready', value: `${readyContainers}/${containers.length}`, icon: Server, iconColor: 'success' as const },
    { label: 'Restarts', value: totalRestarts, icon: RotateCcw, iconColor: totalRestarts > 0 ? 'warning' as const : 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'primary' as const },
    { label: 'QoS Class', value: pod.status?.qosClass || 'Unknown', icon: Activity, iconColor: 'muted' as const },
  ];

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
      name: v.name,
      kind,
      source,
      defaultMode: v.projected?.defaultMode,
      projectedSources: projectedSources?.join(', ') || undefined,
    };
  });

  const podName = pod.metadata?.name || '';


  const displayEvents = events ?? [];

  const podIPsList = (pod.status?.podIPs?.map((p) => p.ip).filter(Boolean) as string[]) ?? (pod.status?.podIP ? [pod.status.podIP] : []);
  const hostIPsList = pod.status?.hostIP ? [pod.status.hostIP] : [];
  const ownerRef = pod.metadata?.ownerReferences?.[0];
  const ownerKindToPath: Record<string, string> = {
    ReplicaSet: 'replicasets',
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    Job: 'jobs',
    CronJob: 'cronjobs',
  };
  const ownerPath = ownerRef ? ownerKindToPath[ownerRef.kind] : null;
  const creationTimestamp = pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp).toLocaleString() : '';

  const podYamlWarning = (
    <>
      Pod spec is mostly immutable. You can only update: container image, activeDeadlineSeconds, tolerations (additions), terminationGracePeriodSeconds.
      To change env, volumes, or other fields, edit the owning workload.
      {ownerPath && ownerRef?.name && namespace && (
        <Button
          variant="link"
          className="h-auto p-0 text-primary ml-1 font-medium"
          onClick={() => navigate(`/${ownerPath}/${namespace}/${ownerRef.name}`)}
        >
          Edit {ownerRef.kind} →
        </Button>
      )}
    </>
  );

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <div className="space-y-6">
          {/* Pod overview */}
          <SectionCard
            icon={LayoutDashboard}
            title="Pod overview"
            tooltip={
              <>
                <p className="font-medium">Pod overview</p>
                <p className="mt-1 text-muted-foreground text-xs">Identity, state, and key networking</p>
              </>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <DetailRow label="Name" value={<span className="font-mono">{pod.metadata?.name || '-'}</span>} />
                <DetailRow
                  label="Namespace"
                  value={
                    pod.metadata?.namespace ? (
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => navigate(`/namespaces/${pod.metadata?.namespace}`)}>
                        {pod.metadata.namespace}
                      </Button>
                    ) : (
                      '-'
                    )
                  }
                />
                <DetailRow
                  label="Creation"
                  value={age}
                  tooltip={creationTimestamp ? `Created: ${creationTimestamp}` : undefined}
                />
                {ownerRef && ownerPath && (
                  <DetailRow
                    label="Controlled by"
                    value={
                      <Button
                        variant="link"
                        className="h-auto p-0 font-mono text-left"
                        onClick={() => navigate(`/${ownerPath}/${ownerRef.name}${namespace ? `?namespace=${namespace}` : ''}`)}
                      >
                        {ownerRef.kind}: {ownerRef.name}
                      </Button>
                    }
                  />
                )}
                <div className="flex items-center justify-between gap-4 text-sm md:col-span-2 lg:col-span-1">
                  <span className="flex items-center gap-2 text-muted-foreground shrink-0">State</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      status === 'Running' && 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
                      status === 'Pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
                      (status === 'Failed' || status === 'Unknown') && 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
                      status === 'Succeeded' && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {status}
                  </Badge>
                </div>
                <DetailRow
                  label="Node"
                  value={
                    pod.spec?.nodeName ? (
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => navigate(`/nodes/${pod.spec.nodeName}`)}>
                        {pod.spec.nodeName}
                      </Button>
                    ) : (
                      '-'
                    )
                  }
                />
                <DetailRow
                  label="Service Account"
                  value={<span className="font-mono text-xs">{pod.spec?.serviceAccountName || 'default'}</span>}
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(ip);
                                  toast.success('Copied');
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </span>
                          ))}
                        </span>
                      ) : (
                        '-'
                      )
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(ip);
                                  toast.success('Copied');
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </span>
                          ))}
                        </span>
                      ) : (
                        '-'
                      )
                    }
                  />
                </div>
                <DetailRow
                  label="QoS Class"
                  value={<Badge variant="outline">{pod.status?.qosClass || '-'}</Badge>}
                  tooltip={pod.status?.qosClass ? TOOLTIP_QOS[pod.status.qosClass] ?? undefined : undefined}
                />
                <DetailRow
                  label="Priority"
                  value={pod.spec?.priority ?? 0}
                  tooltip={TOOLTIP_PRIORITY}
                />
              </div>
              {pod.metadata?.labels && Object.keys(pod.metadata.labels).length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground mb-2">Labels</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pod.metadata.labels).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="font-mono text-xs">
                        {k}={v}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pod Information */}
            <SectionCard
              icon={Info}
              title="Pod Information"
              tooltip={
                <>
                  <p className="font-medium">Pod Information</p>
                  <p className="mt-1 text-muted-foreground text-xs">Basic details about this pod</p>
                </>
              }
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Pod IP</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {podIPsList.length > 0 ? (
                        podIPsList.map((ip) => (
                          <span key={ip} className="flex items-center gap-1 font-mono">
                            {ip}
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(ip); toast.success('Copied'); }}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </span>
                        ))
                      ) : (
                        <span className="font-mono">-</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Host IP</p>
                    <p className="font-mono">{pod.status?.hostIP || '-'}</p>
                  </div>
                  <DetailRow label="Node" value={pod.spec?.nodeName ? <Button variant="link" className="h-auto p-0 font-mono" onClick={() => navigate(`/nodes/${pod.spec?.nodeName}`)}>{pod.spec?.nodeName}</Button> : '-'} />
                  <DetailRow label="QoS Class" value={<Badge variant="outline">{pod.status?.qosClass || '-'}</Badge>} tooltip={pod.status?.qosClass ? TOOLTIP_QOS[pod.status.qosClass] ?? undefined : undefined} />
                  <DetailRow label="Service Account" value={<span className="font-mono text-xs">{pod.spec?.serviceAccountName || 'default'}</span>} />
                  <DetailRow label="Restart Policy" value={pod.spec?.restartPolicy || 'Always'} tooltip={TOOLTIP_RESTART_POLICY} />
                  <DetailRow label="DNS Policy" value={pod.spec?.dnsPolicy || 'ClusterFirst'} tooltip={TOOLTIP_DNS_POLICY} />
                  <DetailRow label="Termination Grace" value={`${pod.spec?.terminationGracePeriodSeconds ?? 30}s`} tooltip={TOOLTIP_TERMINATION_GRACE} />
                </div>
              </div>
            </SectionCard>

            {/* Conditions */}
            <SectionCard
              icon={Activity}
              title="Conditions"
              tooltip={
                <>
                  <p className="font-medium">Conditions</p>
                  <p className="mt-1 text-muted-foreground text-xs">Current pod condition status</p>
                </>
              }
            >
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
                        <Badge variant="secondary" className="font-medium text-xs bg-background">
                          {condition.type}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            isTrue && 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
                            !isTrue && 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
                          )}
                        >
                          {condition.status}
                        </Badge>
                        {condition.message && (
                          <p className="text-xs text-muted-foreground">{condition.message}</p>
                        )}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2 shrink-0">
                            {transitionRelative}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs whitespace-pre-line">
                          {tooltipContent}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          {/* Tolerations */}
          {pod.spec?.tolerations && pod.spec.tolerations.length > 0 && (
            <SectionCard
              icon={Shield}
              title="Tolerations"
              tooltip={
                <>
                  <p className="font-medium">Tolerations</p>
                  <p className="mt-1 text-muted-foreground text-xs">Taints this pod tolerates</p>
                </>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Key</th>
                      <th className="text-left py-2 font-medium">Value</th>
                      <th className="text-left py-2 font-medium">Operator</th>
                      <th className="text-left py-2 font-medium">Effect</th>
                      <th className="text-left py-2 font-medium">Seconds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pod.spec.tolerations.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{t.key ?? '-'}</td>
                        <td className="py-2 font-mono text-xs">{t.value ?? '-'}</td>
                        <td className="py-2">{t.operator ?? '-'}</td>
                        <td className="py-2">
                          {t.effect ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2">
                                  {t.effect}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                {TOOLTIP_TOLERATION_EFFECT[t.effect] ?? t.effect}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-2">
                          {t.tolerationSeconds != null ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2">
                                  {t.tolerationSeconds}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                {TOOLTIP_TOLERATION_SECONDS}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Labels */}
            <SectionCard
              icon={Tag}
              title="Labels"
              tooltip={
                <p className="text-xs text-muted-foreground">Kubernetes labels on this pod</p>
              }
            >
              {pod.metadata?.labels && Object.keys(pod.metadata.labels).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(pod.metadata.labels).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="font-mono text-xs">
                      {k}={v}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No labels</p>
              )}
            </SectionCard>

            {/* Volumes */}
            <SectionCard
              icon={HardDrive}
              title="Volumes"
              tooltip={
                <p className="text-xs text-muted-foreground">Volume definitions for this pod</p>
              }
            >
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
                            <Badge variant="secondary" className="text-xs cursor-help">
                              {volume.kind}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            {TOOLTIP_VOLUME_KIND[volume.kind] ?? volume.kind}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Source: <span className="font-mono">{volume.source}</span>
                      </p>
                      {volume.projectedSources && (
                        <p className="text-xs text-muted-foreground">
                          Sources: <span className="font-mono">{volume.projectedSources}</span>
                        </p>
                      )}
                      {volume.defaultMode != null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs text-muted-foreground cursor-help">
                              defaultMode: <span className="font-mono">{volume.defaultMode}</span>
                            </p>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            {TOOLTIP_VOLUME_DEFAULT_MODE}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Annotations */}
          {pod.metadata?.annotations && Object.keys(pod.metadata.annotations).length > 0 && (
            <SectionCard
              icon={FileCode}
              title="Annotations"
              tooltip={<p className="text-xs text-muted-foreground">Custom metadata annotations on this pod</p>}
            >
              <div className="space-y-2">
                {Object.entries(pod.metadata.annotations).slice(0, 5).map(([key, value]) => (
                  <div key={key} className="p-3 rounded-lg bg-muted/50">
                    <p className="font-mono text-xs text-primary break-all">{key}</p>
                    <p className="text-xs text-muted-foreground mt-1 break-all">
                      {typeof value === 'string' && value.length > 200 ? `${value.substring(0, 200)}...` : value}
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      ),
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Box,
      badge: containers.length,
      content: (
        <div className="space-y-4">
          {containers.length > 1 && (
            <div className="flex items-center gap-3">
              <Label htmlFor="container-filter" className="text-sm font-medium text-muted-foreground shrink-0">
                Container
              </Label>
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
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ContainersSection
            containers={filteredContainers}
            onForwardPort={(containerName, port) => {
              setPortForwardInitial({ containerName, port });
              setShowPortForwardDialog(true);
            }}
          />
        </div>
      ),
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      content: (
        <LogViewer
          podName={name}
          namespace={namespace}
          containerName={selectedLogContainer || containers[0]?.name}
          containers={containers.map(c => c.name)}
          onContainerChange={setSelectedLogContainer}
        />
      ),
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      content: (
        <TerminalViewer
          podName={name}
          namespace={namespace}
          containerName={selectedTerminalContainer || containers[0]?.name}
          containers={containers.map(c => c.name)}
          onContainerChange={setSelectedTerminalContainer}
        />
      ),
    },
    {
      id: 'events',
      label: 'Events',
      icon: CalendarClock,
      badge: displayEvents.length,
      content: <EventsSection events={displayEvents} isLoading={eventsLoading} />,
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      content: <MetricsDashboard resourceType="pod" resourceName={name} namespace={namespace} podResource={pod} clusterId={clusterId} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: (
        <YamlViewer
          yaml={yaml}
          resourceName={podName}
          editable
          onSave={handleSaveYaml}
          warning={podYamlWarning}
        />
      ),
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="pods"
          resourceKind="Pod"
          namespace={namespace}
          initialSelectedResources={namespace && name ? [`${namespace}/${name}`] : []}
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
          kind={normalizeKindForTopology('Pod')}
          namespace={namespace || pod?.metadata?.namespace || ''}
          name={name || pod?.metadata?.name || ''}
          sourceResourceType="Pod"
          sourceResourceName={pod?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          {
            icon: Terminal,
            label: 'Execute Shell',
            description: 'Open interactive terminal in container',
            onClick: () => setActiveTab('terminal'),
          },
          {
            icon: FileText,
            label: 'View Logs',
            description: 'Stream logs from container',
            onClick: () => setActiveTab('logs'),
          },
          {
            icon: ExternalLink,
            label: 'Port Forward',
            description: 'Forward local port to container',
            onClick: () => setShowPortForwardDialog(true),
          },
          {
            icon: RotateCcw,
            label: 'Restart Pod',
            description: 'Delete and recreate the pod',
            onClick: handleRestartPod,
          },
          {
            icon: Download,
            label: 'Download YAML',
            description: 'Export pod definition',
            onClick: handleDownloadYaml,
          },
          {
            icon: Download,
            label: 'Export as JSON',
            description: 'Export pod as JSON',
            onClick: handleDownloadJson,
          },
          {
            icon: Trash2,
            label: 'Delete Pod',
            description: 'Permanently remove this pod',
            variant: 'destructive',
            onClick: () => setShowDeleteDialog(true),
          },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Pod"
        resourceIcon={Box}
        name={pod.metadata?.name || ''}
        namespace={pod.metadata?.namespace}
        status={status}
        backLink="/pods"
        backLabel="Pods"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {age}
            <span className="mx-2">•</span>
            <Server className="h-3.5 w-3.5" />
            {pod.spec?.nodeName || '-'}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Port Forward', icon: ExternalLink, variant: 'outline', onClick: () => setShowPortForwardDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {breadcrumbSegments.length > 0 && (
          <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        )}
      </ResourceDetailLayout>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Pod"
        resourceName={pod.metadata?.name || ''}
        namespace={pod.metadata?.namespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deletePod.mutateAsync({ name, namespace });
            navigate('/pods');
          } else {
            toast.success(`Pod ${name} deleted (demo mode)`);
            navigate('/pods');
          }
        }}
      />

      {/* Port Forward Dialog */}
      <PortForwardDialog
        open={showPortForwardDialog}
        onOpenChange={(open) => {
          setShowPortForwardDialog(open);
          if (!open) setPortForwardInitial(null);
        }}
        podName={pod.metadata?.name || ''}
        namespace={pod.metadata?.namespace || ''}
        containers={(pod.spec?.containers || []).map(c => ({
          name: c.name,
          ports: c.ports,
        }))}
        initialContainer={portForwardInitial?.containerName}
        initialPort={portForwardInitial?.port}
      />
    </>
  );
}
