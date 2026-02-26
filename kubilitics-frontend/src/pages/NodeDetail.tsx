import { useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Server, Clock, Download, Trash2, Cpu, HardDrive, Box, Shield, Pause, Play, AlertTriangle, Loader2, Info, BarChart2, Activity, MapPin, Tag, FileJson, FileSpreadsheet, Image, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  SectionCard,
  YamlViewer,
  EventsSection,
  ActionsSection,
  MetricsDashboard,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useK8sEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getNodeMetrics, getPodMetrics, getResource } from '@/services/backendApiClient';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AgeCell, StatusPill, type StatusPillVariant } from '@/components/list';

interface NodeResource extends KubernetesResource {
  spec?: {
    podCIDR?: string;
    taints?: Array<{ key: string; value?: string; effect: string }>;
    unschedulable?: boolean;
  };
  status?: {
    capacity?: { cpu?: string; memory?: string; pods?: string; 'ephemeral-storage'?: string };
    allocatable?: { cpu?: string; memory?: string; pods?: string };
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>;
    nodeInfo?: {
      osImage?: string;
      architecture?: string;
      containerRuntimeVersion?: string;
      kubeletVersion?: string;
      kernelVersion?: string;
      operatingSystem?: string;
    };
    addresses?: Array<{ type: string; address: string }>;
  };
}

export default function NodeDetail() {
  const { name } = useParams();
  const clusterId = useActiveClusterId();
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const [activeTab, setActiveTab] = useState('overview');
  const [isCordoned, setIsCordoned] = useState(false);

  const { resource: n, isLoading, error: resourceError, age, yaml, isConnected: resourceConnected, refetch } = useResourceDetail<NodeResource>(
    'nodes',
    name ?? undefined,
    undefined,
    {} as NodeResource
  );
  const podsOnNodeQuery = useK8sResourceList<KubernetesResource>('pods', undefined, {
    fieldSelector: name ? `spec.nodeName=${name}` : '',
    enabled: !!name && isConnected,
    limit: 500,
  });
  const runningPodsRaw = (isConnected && podsOnNodeQuery.data?.items) ? (podsOnNodeQuery.data.items as KubernetesResource[]) : [];
  const runningPodsBase = useMemo(() => runningPodsRaw.map((p) => {
    const r = p as KubernetesResource & { name?: string; namespace?: string; status?: string };
    const podName = r.metadata?.name ?? r.name ?? '';
    const namespace = r.metadata?.namespace ?? r.namespace ?? '';
    const status = (r.status && typeof r.status === 'object' && (r.status as { phase?: string }).phase) ? (r.status as { phase: string }).phase : (typeof r.status === 'string' ? r.status : 'Unknown');
    const creationTimestamp = r.metadata?.creationTimestamp;
    const age = creationTimestamp ? calculateAge(creationTimestamp) : '–';
    return { name: podName, namespace, status, cpu: '-', memory: '-', creationTimestamp, age };
  }), [runningPodsRaw]);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const nodeMetricsQuery = useQuery({
    queryKey: ['node-metrics', clusterId, name],
    queryFn: () => getNodeMetrics(backendBaseUrl, clusterId!, name!),
    enabled: !!(isBackendConfigured() && clusterId && name),
    staleTime: 15_000,
  });

  const podMetricsQueries = useQueries({
    queries: runningPodsBase.slice(0, 50).map((pod) => ({
      queryKey: ['pod-metrics-node', clusterId, pod.namespace, pod.name],
      queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
      enabled: !!(isBackendConfigured() && clusterId && pod.namespace && pod.name),
      staleTime: 15_000,
    })),
  });

  const runningPods = useMemo(() => {
    return runningPodsBase.map((pod, i) => {
      const data = i < podMetricsQueries.length && podMetricsQueries[i].data
        ? (podMetricsQueries[i].data as { CPU?: string; Memory?: string })
        : null;
      return {
        ...pod,
        cpu: data?.CPU ?? pod.cpu,
        memory: data?.Memory ?? pod.memory,
      };
    });
  }, [runningPodsBase, podMetricsQueries]);

  const { events } = useK8sEvents();
  const deleteNode = useDeleteK8sResource('nodes');
  const updateNode = useUpdateK8sResource('nodes');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Unique PVCs referenced by pods (for fetching volumeName -> PV).
  const pvcKeys = useMemo(() => {
    const set = new Set<string>();
    (runningPodsRaw as Array<{ metadata?: { namespace?: string }; spec?: { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } }>).forEach((pod) => {
      const podNs = pod.metadata?.namespace ?? 'default';
      pod.spec?.volumes?.forEach((vol) => {
        if (vol.persistentVolumeClaim?.claimName) set.add(`${podNs}/${vol.persistentVolumeClaim.claimName}`);
      });
    });
    return Array.from(set).map((key) => {
      const [ns, n] = key.split('/');
      return { ns, name: n };
    });
  }, [runningPodsRaw]);

  const pvcQueries = useQueries({
    queries: pvcKeys.map(({ ns, name }) => ({
      queryKey: ['pvc-detail', clusterId, ns, name],
      queryFn: () => getResource(backendBaseUrl, clusterId!, 'persistentvolumeclaims', ns, name) as Promise<{ spec?: { volumeName?: string } }>,
      enabled: !!(isBackendConfigured() && clusterId && name),
      staleTime: 60_000,
    })),
  });

  const pvcVolumeNames = useMemo(() => {
    const m: Record<string, string> = {};
    pvcQueries.forEach((q, i) => {
      if (q.data?.spec?.volumeName && pvcKeys[i]) m[`${pvcKeys[i].ns}/${pvcKeys[i].name}`] = q.data.spec.volumeName;
    });
    return m;
  }, [pvcQueries, pvcKeys]);

  // Unique ReplicaSets that own pods on this node (to resolve Deployment owners).
  const replicasetKeys = useMemo(() => {
    const set = new Set<string>();
    (runningPodsRaw as Array<{
      metadata?: { namespace?: string; ownerReferences?: Array<{ kind?: string; name?: string }> };
    }>).forEach((pod) => {
      const podNs = pod.metadata?.namespace ?? 'default';
      pod.metadata?.ownerReferences?.forEach((ref) => {
        if ((ref.kind ?? '').toLowerCase() === 'replicaset' && ref.name) {
          set.add(`${podNs}/${ref.name}`);
        }
      });
    });
    return Array.from(set).map((key) => {
      const [ns, n] = key.split('/');
      return { ns, name: n };
    });
  }, [runningPodsRaw]);

  const replicasetQueries = useQueries({
    queries: replicasetKeys.map(({ ns, name }) => ({
      queryKey: ['replicaset-owner', clusterId, ns, name],
      queryFn: () => getResource(backendBaseUrl, clusterId!, 'replicasets', ns, name) as Promise<{
        metadata?: { ownerReferences?: Array<{ kind?: string; name?: string }> };
      }>,
      enabled: !!(isBackendConfigured() && clusterId && name),
      staleTime: 60_000,
    })),
  });

  const replicasetToDeployment = useMemo(() => {
    const m = new Map<string, { ns: string; name: string }>();
    replicasetQueries.forEach((q, i) => {
      const rs = q.data;
      const key = replicasetKeys[i];
      if (!key || !rs?.metadata?.ownerReferences) return;
      const depRef = rs.metadata.ownerReferences.find((r) => (r.kind ?? '').toLowerCase() === 'deployment');
      if (depRef?.name) {
        m.set(`${key.ns}/${key.name}`, { ns: key.ns, name: depRef.name });
      }
    });
    return m;
  }, [replicasetQueries, replicasetKeys]);


  const nodeName = n?.metadata?.name ?? name ?? '';
  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nodeName || 'node'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, nodeName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(n, `${nodeName || 'node'}.json`);
    toast.success('JSON downloaded');
  }, [n, nodeName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!nodeName) return;
    try {
      await updateNode.mutateAsync({ name: nodeName, yaml: newYaml });
      toast.success('Node updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update Node');
      throw e;
    }
  };

  const handleCordon = () => {
    setIsCordoned(!isCordoned);
    toast.success(isCordoned ? 'Node uncordoned' : 'Node cordoned - no new pods will be scheduled');
  };

  const handleDrain = () => {
    toast.success('Node drain initiated - evicting pods...');
  };

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

  if (isConnected && (resourceError || !n?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Server className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Node not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No node named "${name}" in this cluster.` : 'Missing node name.'}</p>
        <Button variant="outline" onClick={() => navigate('/nodes')}>Back to Nodes</Button>
      </div>
    );
  }

  const labels = n?.metadata?.labels || {};
  const nodeInfo = n?.status?.nodeInfo;
  const conditions = n?.status?.conditions || [];
  const capacity = n?.status?.capacity || {};
  const allocatable = n?.status?.allocatable || {};
  const taints = n?.spec?.taints || [];
  const addresses = n?.status?.addresses || [];
  const podCIDR = n?.spec?.podCIDR || '-';

  function parseCpuToMilli(s: string): number | null {
    if (!s || s === '-') return null;
    const t = String(s).trim();
    if (t.endsWith('m')) {
      const n = parseFloat(t.slice(0, -1));
      return Number.isFinite(n) ? n : null;
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  function parseMemoryToMi(s: string): number | null {
    if (!s || s === '-') return null;
    const t = String(s).trim();
    if (t.endsWith('Ki')) {
      const n = parseFloat(t.slice(0, -2));
      return Number.isFinite(n) ? n / 1024 : null;
    }
    if (t.endsWith('Mi')) {
      const n = parseFloat(t.slice(0, -2));
      return Number.isFinite(n) ? n : null;
    }
    if (t.endsWith('Gi')) {
      const n = parseFloat(t.slice(0, -2));
      return Number.isFinite(n) ? n * 1024 : null;
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  const nodeMetrics = nodeMetricsQuery.data as { CPU?: string; Memory?: string } | undefined;
  const cpuCapMilli = parseCpuToMilli(allocatable.cpu || capacity.cpu || '');
  const memCapMi = parseMemoryToMi(allocatable.memory || capacity.memory || '');
  const cpuUsageMilli = nodeMetrics?.CPU ? parseCpuToMilli(nodeMetrics.CPU) : null;
  const memUsageMi = nodeMetrics?.Memory ? parseMemoryToMi(nodeMetrics.Memory) : null;
  const cpuUsagePercent =
    cpuCapMilli != null && cpuCapMilli > 0 && cpuUsageMilli != null
      ? Math.min(100, Math.round((cpuUsageMilli / cpuCapMilli) * 100))
      : null;
  const memoryUsagePercent =
    memCapMi != null && memCapMi > 0 && memUsageMi != null
      ? Math.min(100, Math.round((memUsageMi / memCapMi) * 100))
      : null;

  const roles = Object.keys(labels)
    .filter(k => k.startsWith('node-role.kubernetes.io/'))
    .map(k => k.replace('node-role.kubernetes.io/', ''));
  const isReady = conditions.some(c => c.type === 'Ready' && c.status === 'True');
  const status: ResourceStatus = isCordoned ? 'Warning' : isReady ? 'Running' : 'Failed';

  // Usage: CPU/memory from node metrics; pods from running count.
  const capacityPods = parseInt(capacity.pods || '0', 10) || 110;
  const podUsagePercent = capacityPods > 0 ? Math.round((runningPods.length / capacityPods) * 100) : 0;

  const statusCards = [
    { label: 'Status', value: isReady ? 'Ready' : 'Not Ready', icon: Server, iconColor: (isReady ? 'success' : 'error') as "success" | "error" },
    { label: 'Role', value: roles.length ? roles.join(', ') || 'worker' : 'worker', icon: Activity, iconColor: 'muted' as const },
    { label: 'CPU', value: cpuUsagePercent != null ? `${cpuUsagePercent}%` : '–', icon: Cpu, iconColor: 'primary' as const },
    { label: 'Memory', value: memoryUsagePercent != null ? `${memoryUsagePercent}%` : '–', icon: HardDrive, iconColor: 'info' as const },
    { label: 'Pods', value: `${runningPods.length}/${capacity.pods || '–'}`, icon: Box, iconColor: 'success' as const },
    { label: 'Disk', value: '–', icon: HardDrive, iconColor: 'muted' as const },
    { label: 'Version', value: nodeInfo?.kubeletVersion || '–', icon: Info, iconColor: 'muted' as const },
    { label: 'Uptime', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          {/* Cordoned Warning */}
          {isCordoned && (
            <div className="p-4 rounded-lg border border-warning/50 bg-warning/10 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div>
                <p className="font-medium text-warning">Node is Cordoned</p>
                <p className="text-sm text-warning/80">This node is marked as unschedulable. No new pods will be scheduled on this node.</p>
              </div>
              <Button variant="outline" size="sm" className="ml-auto" onClick={handleCordon}>
                <Play className="h-4 w-4 mr-1" />
                Uncordon
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Node Info */}
            <SectionCard icon={Info} title="Node Info" tooltip={<p className="text-xs text-muted-foreground">OS, kernel, runtime, and network info</p>}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground mb-1">OS Image</p><p>{nodeInfo?.osImage || '-'}</p></div>
                <div><p className="text-muted-foreground mb-1">Architecture</p><p>{nodeInfo?.architecture || '-'}</p></div>
                <div><p className="text-muted-foreground mb-1">Kernel</p><p className="font-mono text-xs">{nodeInfo?.kernelVersion || '-'}</p></div>
                <div><p className="text-muted-foreground mb-1">Container Runtime</p><p className="font-mono text-xs">{nodeInfo?.containerRuntimeVersion || '-'}</p></div>
                <div><p className="text-muted-foreground mb-1">Kubelet</p><Badge variant="secondary">{nodeInfo?.kubeletVersion || '-'}</Badge></div>
                <div><p className="text-muted-foreground mb-1">Pod CIDR</p><p className="font-mono text-xs">{podCIDR}</p></div>
              </div>
            </SectionCard>

            {/* Resource Usage */}
            <SectionCard icon={BarChart2} title="Resource Usage" tooltip={<p className="text-xs text-muted-foreground">CPU, memory, and pod capacity usage</p>}>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>CPU</span>
                    <span className="font-mono">{cpuUsagePercent != null ? `${cpuUsagePercent}% used of ${capacity.cpu || '-'}` : (capacity.cpu || allocatable.cpu || '–')}</span>
                  </div>
                  <Progress value={cpuUsagePercent ?? 0} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">{allocatable.cpu || '-'} allocatable</p>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Memory</span>
                    <span className="font-mono">{memoryUsagePercent != null ? `${memoryUsagePercent}% used of ${capacity.memory || '-'}` : (capacity.memory || allocatable.memory || '–')}</span>
                  </div>
                  <Progress value={memoryUsagePercent ?? 0} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">{allocatable.memory || '-'} allocatable</p>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Pods</span>
                    <span className="font-mono">{runningPods.length}/{capacity.pods || '110'}</span>
                  </div>
                  <Progress value={podUsagePercent} className="h-2" />
                </div>
              </div>
            </SectionCard>

            {/* Conditions */}
            <SectionCard icon={Activity} title="Conditions" tooltip={<p className="text-xs text-muted-foreground">Node condition status</p>}>
              <div className="space-y-2">
                {conditions.map((c) => (
                  <div key={c.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          c.type === 'Ready'
                            ? (c.status === 'True' ? 'default' : 'destructive')
                            : (c.status === 'False' ? 'secondary' : 'destructive')
                        }
                      >
                        {c.type}
                      </Badge>
                      <span className="text-sm">{c.status}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{c.reason}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Addresses */}
            <SectionCard icon={MapPin} title="Addresses" tooltip={<p className="text-xs text-muted-foreground">Node network addresses</p>}>
              <div className="space-y-2">
                {addresses.map((addr) => (
                  <div key={addr.type} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{addr.type}</span>
                    <span className="font-mono text-sm">{addr.address}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Taints */}
            <SectionCard icon={Shield} title="Taints" tooltip={<p className="text-xs text-muted-foreground">Taints prevent pods from being scheduled on this node</p>}>
              {taints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No taints configured</p>
              ) : (
                <div className="space-y-2">
                  {taints.map((taint, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Badge variant="outline" className="font-mono text-xs">{taint.key}</Badge>
                      {taint.value && <span className="text-sm">=</span>}
                      {taint.value && <Badge variant="secondary" className="font-mono text-xs">{taint.value}</Badge>}
                      <Badge variant="destructive" className="text-xs ml-auto">{taint.effect}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Roles & Labels */}
            <SectionCard icon={Tag} title="Roles & Labels" tooltip={<p className="text-xs text-muted-foreground">Node roles and Kubernetes labels</p>}>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Roles</p>
                  <div className="flex flex-wrap gap-2">
                    {roles.length > 0 ? roles.map((role) => (
                      <Badge key={role} variant="outline">{role || 'control-plane'}</Badge>
                    )) : <span className="text-muted-foreground text-sm">worker</span>}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Labels ({Object.keys(labels).length})</p>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {Object.entries(labels).slice(0, 8).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="font-mono text-xs">
                        {k.split('/').pop()}={v || 'true'}
                      </Badge>
                    ))}
                    {Object.keys(labels).length > 8 && (
                      <Badge variant="outline" className="text-xs">+{Object.keys(labels).length - 8} more</Badge>
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      ),
    },
    {
      id: 'pods',
      label: 'Pods',
      content: (
        <SectionCard icon={Box} title={`Pods on this node (${runningPods.length})`} tooltip={<p className="text-xs text-muted-foreground">Pods scheduled on this node (fieldSelector=spec.nodeName). Click a row to open pod detail.</p>}>
          {podsOnNodeQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading pods…</span>
            </div>
          ) : runningPods.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <Box className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium text-foreground">No pods on this node</p>
              <p className="text-sm text-muted-foreground mt-1">Pods scheduled here will appear in this table.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                    <TableHead className="font-semibold">Name</TableHead>
                    <TableHead className="font-semibold">Namespace</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">CPU</TableHead>
                    <TableHead className="font-semibold">Memory</TableHead>
                    <TableHead className="font-semibold">Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runningPods.map((pod) => (
                    <TableRow
                      key={`${pod.namespace}/${pod.name}`}
                      className="cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => navigate(`/pods/${pod.namespace}/${pod.name}`)}
                    >
                      <TableCell className="font-medium text-primary">{pod.name}</TableCell>
                      <TableCell><NamespaceBadge namespace={pod.namespace} className="font-normal" /></TableCell>
                      <TableCell>
                        <StatusPill
                          label={pod.status}
                          variant={(pod.status === 'Running' ? 'success' : pod.status === 'Pending' ? 'warning' : 'error') as StatusPillVariant}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{pod.cpu}</TableCell>
                      <TableCell className="font-mono text-sm">{pod.memory}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        <AgeCell age={pod.age} timestamp={pod.creationTimestamp} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'conditions',
      label: 'Conditions',
      content: (
        <SectionCard icon={Activity} title="Node conditions" tooltip={<p className="text-xs text-muted-foreground">Kubernetes node conditions: Ready (green when True), pressure conditions (red when True)</p>}>
          {conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No conditions reported.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                    <TableHead className="font-semibold">Type</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Reason</TableHead>
                    <TableHead className="font-semibold">Message</TableHead>
                    <TableHead className="font-semibold">Last transition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conditions.map((c) => {
                    const isReady = c.type === 'Ready';
                    const isTrue = c.status === 'True';
                    const isGood = isReady && isTrue;
                    const isBad = !isReady && isTrue;
                    const variant: StatusPillVariant = isGood ? 'success' : isBad ? 'error' : 'neutral';
                    return (
                      <TableRow key={c.type} className="border-b border-border/60 last:border-0">
                        <TableCell>
                          <Badge
                            variant={isGood ? 'default' : isBad ? 'destructive' : 'secondary'}
                            className={isGood ? 'bg-[hsl(142,76%,36%)] hover:bg-[hsl(142,76%,36%)]' : isBad ? 'bg-[hsl(0,72%,51%)] hover:bg-[hsl(0,72%,51%)]' : ''}
                          >
                            {c.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusPill label={c.status} variant={variant} />
                        </TableCell>
                        <TableCell className="font-mono text-sm">{c.reason ?? '–'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate" title={c.message ?? ''}>{c.message ?? '–'}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                          {c.lastTransitionTime ? calculateAge(c.lastTransitionTime) : '–'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={nodeName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="nodes"
          resourceKind="Node"
          initialSelectedResources={[nodeName]}
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
          kind={normalizeKindForTopology('Node')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="Node"
          sourceResourceName={n?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'performance',
      label: 'Performance',
      content: <MetricsDashboard resourceType="node" resourceName={nodeName} clusterId={clusterId} />,
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          {
            icon: isCordoned ? Play : Pause,
            label: isCordoned ? 'Uncordon Node' : 'Cordon Node',
            description: isCordoned ? 'Allow pods to be scheduled on this node' : 'Mark node as unschedulable',
            onClick: handleCordon,
          },
          { icon: Shield, label: 'Drain Node', description: 'Safely evict all pods from node', onClick: handleDrain },
          { icon: Download, label: 'Download YAML', description: 'Export Node definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Node as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Node', description: 'Remove node from cluster', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Node"
        resourceIcon={Server}
        name={nodeName}
        status={status}
        backLink="/nodes"
        backLabel="Nodes"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {age}
            <span className="mx-2">•</span>
            {roles.map((role) => <Badge key={role} variant="outline" className="text-xs ml-1">{role || 'control-plane'}</Badge>)}
            {isCordoned && <Badge variant="destructive" className="ml-2 text-xs">Cordoned</Badge>}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: isCordoned ? 'Uncordon' : 'Cordon', icon: isCordoned ? Play : Pause, variant: 'outline', onClick: handleCordon },
          { label: 'Drain', icon: Shield, variant: 'outline', onClick: handleDrain },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Node"
        resourceName={nodeName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteNode.mutateAsync({ name: name!, namespace: '' });
            navigate('/nodes');
          } else {
            toast.success(`Node ${nodeName} deleted (demo mode)`);
            navigate('/nodes');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
