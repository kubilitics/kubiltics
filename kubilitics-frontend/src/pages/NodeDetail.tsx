import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Server, Clock, Cpu, HardDrive, Box, Shield, Pause, Play, AlertTriangle, Info, BarChart2, Activity, MapPin, Tag, RefreshCw, Sparkles } from 'lucide-react';
import { useAIContext } from '@/hooks/useAIContext';
import { useChatStore } from '@/stores/chatStore';
import { useAIContextStore } from '@/stores/aiContextStore';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  MetricsDashboard,
  LabelList,
  AnnotationList,
  TaintsList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { DetailPodTable, type DetailPod } from '@/components/resources/DetailPodTable';
import { useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useMutationPolling } from '@/hooks/useMutationPolling';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getNodeMetrics, getPodMetrics, getResource, postNodeCordon, postNodeDrain } from '@/services/backendApiClient';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusPill, type StatusPillVariant } from '@/components/list';

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

// ---------------------------------------------------------------------------
// Custom tab components
// ---------------------------------------------------------------------------

function OverviewTab({ resource: n, age, isCordoned, handleCordon, runningPods, cpuUsagePercent, memoryUsagePercent, podUsagePercent }: ResourceContext<NodeResource> & {
  isCordoned: boolean;
  handleCordon: () => void;
  runningPods: Array<{ name: string; namespace: string; status: string; cpu: string; memory: string; age: string }>;
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  podUsagePercent: number;
}) {
  const labels = n?.metadata?.labels || {};
  const nodeInfo = n?.status?.nodeInfo;
  const conditions = n?.status?.conditions || [];
  const capacity = n?.status?.capacity || {};
  const allocatable = n?.status?.allocatable || {};
  const taints = n?.spec?.taints || [];
  const addresses = n?.status?.addresses || [];
  const podCIDR = n?.spec?.podCIDR || '-';
  const roles = Object.keys(labels)
    .filter(k => k.startsWith('node-role.kubernetes.io/'))
    .map(k => k.replace('node-role.kubernetes.io/', ''));

  return (
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
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="OS Image" value={nodeInfo?.osImage || '-'} />
            <DetailRow label="Architecture" value={nodeInfo?.architecture || '-'} />
            <DetailRow label="Kernel" value={<span className="font-mono text-xs">{nodeInfo?.kernelVersion || '-'}</span>} />
            <DetailRow label="Container Runtime" value={<span className="font-mono text-xs">{nodeInfo?.containerRuntimeVersion || '-'}</span>} />
            <DetailRow label="Kubelet" value={<Badge variant="secondary">{nodeInfo?.kubeletVersion || '-'}</Badge>} />
            <DetailRow label="Pod CIDR" value={<span className="font-mono text-xs">{podCIDR}</span>} />
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
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {addresses.map((addr) => (
              <DetailRow key={addr.type} label={addr.type} value={<span className="font-mono">{addr.address}</span>} />
            ))}
          </div>
        </SectionCard>

        {/* Taints */}
        <TaintsList taints={taints} />

        {/* Roles & Labels */}
        <div className="lg:col-span-2">
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
              <LabelList labels={labels} showCard={false} title={`Labels (${Object.keys(labels).length})`} />
            </div>
          </SectionCard>
        </div>

        {/* Annotations */}
        <div className="lg:col-span-2">
          <AnnotationList annotations={n?.metadata?.annotations ?? {}} />
        </div>
      </div>
    </div>
  );
}

function PodsTab({ runningPodsRaw, runningPods }: { runningPodsRaw: KubernetesResource[]; runningPods: Array<{ name: string; namespace: string; status: string; cpu: string; memory: string; age: string }> }) {
  return (
    <SectionCard icon={Box} title={`Pods on this node (${runningPods.length})`} tooltip={<p className="text-xs text-muted-foreground">Pods scheduled on this node (fieldSelector=spec.nodeName). Click a row to open pod detail.</p>}>
      <DetailPodTable pods={runningPodsRaw as unknown as DetailPod[]} namespace="" />
    </SectionCard>
  );
}

function ConditionsTab({ resource: n }: ResourceContext<NodeResource>) {
  const conditions = n?.status?.conditions || [];

  return (
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
                        className={isGood ? 'bg-emerald-600 hover:bg-emerald-600' : isBad ? 'bg-rose-600 hover:bg-rose-600' : ''}
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
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function NodeDetail() {
  const { name } = useParams();
  const clusterId = useActiveClusterId();
  useAIContext(useMemo(() => ({
    type: 'node' as const,
    cluster: clusterId ?? '',
    name: name ?? undefined,
  }), [clusterId, name]));
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { refetchInterval: fastPollInterval, isFastPolling, triggerFastPolling } = useMutationPolling({
    fastInterval: 2000,
    fastDuration: 30000,
    normalInterval: 60000,
  });
  const [isCordoned, setIsCordoned] = useState(false);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);

  // Pods on this node
  const podsOnNodeQuery = useK8sResourceList<KubernetesResource>('pods', undefined, {
    fieldSelector: name ? `spec.nodeName=${name}` : '',
    enabled: !!name && isConnected,
    limit: 500,
    refetchInterval: fastPollInterval,
    staleTime: isFastPolling ? 1000 : 30000,
  });
  const runningPodsRaw = useMemo(() => (isConnected && podsOnNodeQuery.data?.items) ? (podsOnNodeQuery.data.items as KubernetesResource[]) : [], [isConnected, podsOnNodeQuery.data?.items]);
  const runningPodsBase = useMemo(() => runningPodsRaw.map((p) => {
    const r = p as KubernetesResource & { name?: string; namespace?: string; status?: string };
    const podName = r.metadata?.name ?? r.name ?? '';
    const namespace = r.metadata?.namespace ?? r.namespace ?? '';
    const status = (r.status && typeof r.status === 'object' && (r.status as { phase?: string }).phase) ? (r.status as { phase: string }).phase : (typeof r.status === 'string' ? r.status : 'Unknown');
    const creationTimestamp = r.metadata?.creationTimestamp;
    const age = creationTimestamp ? calculateAge(creationTimestamp) : '–';
    return { name: podName, namespace, status, cpu: '-', memory: '-', creationTimestamp, age };
  }), [runningPodsRaw]);

  // Node metrics
  const nodeMetricsQuery = useQuery({
    queryKey: ['node-metrics', clusterId, name],
    queryFn: () => getNodeMetrics(backendBaseUrl, clusterId!, name!),
    enabled: !!(isBackendConfigured && clusterId && name),
    staleTime: 15_000,
  });

  // Pod metrics for pods on this node
  const podMetricsQueries = useQueries({
    queries: runningPodsBase.slice(0, 50).map((pod) => ({
      queryKey: ['pod-metrics-node', clusterId, pod.namespace, pod.name],
      queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
      enabled: !!(isBackendConfigured && clusterId && pod.namespace && pod.name),
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

  // PVC + ReplicaSet owner resolution (needed by DetailPodTable implicitly through raw pods)
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
      enabled: !!(isBackendConfigured && clusterId && name),
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
      enabled: !!(isBackendConfigured && clusterId && name),
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

  // Cordon / Drain handlers
  const handleCordon = useCallback(async () => {
    if (!isConnected || !backendBaseUrl || !clusterId || !name) {
      toast.error('Connect to a cluster to cordon/uncordon nodes');
      return;
    }
    const newUnschedulable = !isCordoned;
    try {
      await postNodeCordon(backendBaseUrl, clusterId, name, newUnschedulable);
      setIsCordoned(newUnschedulable);
      toast.success(newUnschedulable ? `Node ${name} cordoned — no new pods will be scheduled` : `Node ${name} uncordoned`);
      triggerFastPolling();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cordon/uncordon node');
    }
  }, [isConnected, backendBaseUrl, clusterId, name, isCordoned, triggerFastPolling]);

  const handleDrain = useCallback(async () => {
    if (!isConnected || !backendBaseUrl || !clusterId || !name) {
      toast.error('Connect to a cluster to drain nodes');
      return;
    }
    toast.info(`Draining node ${name}…`);
    try {
      const result = await postNodeDrain(backendBaseUrl, clusterId, name, { ignoreDaemonSets: true });
      const evicted = result.evicted.length;
      const errs = result.errors.length;
      if (errs > 0) {
        toast.warning(`Drain complete: ${evicted} evicted, ${errs} errors`);
      } else {
        toast.success(`Drain complete: ${evicted} pod(s) evicted, ${result.skipped.length} skipped`);
      }
      triggerFastPolling();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to drain node');
    }
  }, [isConnected, backendBaseUrl, clusterId, name, triggerFastPolling]);

  // Metric calculations
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

  const customTabs: CustomTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      render: (ctx) => {
        const n = ctx.resource;
        const capacity = n?.status?.capacity || {};
        const allocatable = n?.status?.allocatable || {};
        const nodeMetrics = nodeMetricsQuery.data as { CPU?: string; Memory?: string } | undefined;
        const cpuCapMilli = parseCpuToMilli(allocatable.cpu || capacity.cpu || '');
        const memCapMi = parseMemoryToMi(allocatable.memory || capacity.memory || '');
        const cpuUsageMilli = nodeMetrics?.CPU ? parseCpuToMilli(nodeMetrics.CPU) : null;
        const memUsageMi = nodeMetrics?.Memory ? parseMemoryToMi(nodeMetrics.Memory) : null;
        const cpuUsagePercent = cpuCapMilli != null && cpuCapMilli > 0 && cpuUsageMilli != null
          ? Math.min(100, Math.round((cpuUsageMilli / cpuCapMilli) * 100)) : null;
        const memoryUsagePercent = memCapMi != null && memCapMi > 0 && memUsageMi != null
          ? Math.min(100, Math.round((memUsageMi / memCapMi) * 100)) : null;
        const capacityPods = parseInt(capacity.pods || '0', 10) || 110;
        const podUsagePercent = capacityPods > 0 ? Math.round((runningPods.length / capacityPods) * 100) : 0;

        return <OverviewTab {...ctx} isCordoned={isCordoned} handleCordon={handleCordon} runningPods={runningPods} cpuUsagePercent={cpuUsagePercent} memoryUsagePercent={memoryUsagePercent} podUsagePercent={podUsagePercent} />;
      },
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: runningPods.length.toString(),
      render: () => <PodsTab runningPodsRaw={runningPodsRaw} runningPods={runningPods} />,
    },
    {
      id: 'conditions',
      label: 'Conditions',
      render: (ctx) => <ConditionsTab {...ctx} />,
    },
    {
      id: 'performance',
      label: 'Performance',
      render: (ctx) => <MetricsDashboard resourceType="node" resourceName={ctx.name} clusterId={clusterId} />,
    },
  ];

  return (
    <GenericResourceDetail<NodeResource>
      resourceType="nodes"
      kind="Node"
      pluralLabel="Nodes"
      listPath="/nodes"
      resourceIcon={Server}
      loadingCardCount={4}
      customTabs={customTabs}
      detailOptions={{ refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 5000 }}
      deriveStatus={(n) => {
        const conditions = n?.status?.conditions || [];
        const isReady = conditions.some(c => c.type === 'Ready' && c.status === 'True');
        return isCordoned ? 'Warning' : isReady ? 'Running' : 'Failed';
      }}
      headerMetadata={(ctx) => {
        const labels = ctx.resource?.metadata?.labels || {};
        const roles = Object.keys(labels)
          .filter(k => k.startsWith('node-role.kubernetes.io/'))
          .map(k => k.replace('node-role.kubernetes.io/', ''));
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {ctx.age}
            <span className="mx-2">•</span>
            {roles.map((role) => <Badge key={role} variant="outline" className="text-xs ml-1">{role || 'control-plane'}</Badge>)}
            {isCordoned && <Badge variant="destructive" className="ml-2 text-xs">Cordoned</Badge>}
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
        { label: isCordoned ? 'Uncordon' : 'Cordon', icon: isCordoned ? Play : Pause, variant: 'outline', onClick: handleCordon, className: 'press-effect' },
        { label: 'Drain', icon: Shield, variant: 'outline', onClick: handleDrain, className: 'press-effect' },
        {
          label: 'Ask AI',
          icon: Sparkles,
          variant: 'outline',
          onClick: () => {
            useChatStore.getState().togglePanel(true);
            useAIContextStore.getState().setExplicit({ type: 'node', cluster: clusterId ?? '', name: name ?? undefined });
            useChatStore.getState().setPrefilled(`Summarize this node's health.`);
          },
          className: 'press-effect',
        },
      ]}
      extraActionItems={() => [
        {
          icon: isCordoned ? Play : Pause,
          label: isCordoned ? 'Uncordon Node' : 'Cordon Node',
          description: isCordoned ? 'Allow pods to be scheduled on this node' : 'Mark node as unschedulable',
          onClick: handleCordon,
        },
        { icon: Shield, label: 'Drain Node', description: 'Safely evict all pods from node', onClick: handleDrain },
      ]}
      buildStatusCards={(ctx) => {
        const n = ctx.resource;
        const labels = n?.metadata?.labels || {};
        const nodeInfo = n?.status?.nodeInfo;
        const conditions = n?.status?.conditions || [];
        const capacity = n?.status?.capacity || {};
        const allocatable = n?.status?.allocatable || {};
        const isReady = conditions.some(c => c.type === 'Ready' && c.status === 'True');
        const roles = Object.keys(labels)
          .filter(k => k.startsWith('node-role.kubernetes.io/'))
          .map(k => k.replace('node-role.kubernetes.io/', ''));

        const nodeMetrics = nodeMetricsQuery.data as { CPU?: string; Memory?: string } | undefined;
        const cpuCapMilli = parseCpuToMilli(allocatable.cpu || capacity.cpu || '');
        const memCapMi = parseMemoryToMi(allocatable.memory || capacity.memory || '');
        const cpuUsageMilli = nodeMetrics?.CPU ? parseCpuToMilli(nodeMetrics.CPU) : null;
        const memUsageMi = nodeMetrics?.Memory ? parseMemoryToMi(nodeMetrics.Memory) : null;
        const cpuUsagePercent = cpuCapMilli != null && cpuCapMilli > 0 && cpuUsageMilli != null
          ? Math.min(100, Math.round((cpuUsageMilli / cpuCapMilli) * 100)) : null;
        const memoryUsagePercent = memCapMi != null && memCapMi > 0 && memUsageMi != null
          ? Math.min(100, Math.round((memUsageMi / memCapMi) * 100)) : null;

        return [
          { label: 'Status', value: isReady ? 'Ready' : 'Not Ready', icon: Server, iconColor: (isReady ? 'success' : 'error') as "success" | "error" },
          { label: 'Role', value: roles.length ? roles.join(', ') || 'worker' : 'worker', icon: Activity, iconColor: 'muted' as const },
          { label: 'CPU', value: cpuUsagePercent != null ? `${cpuUsagePercent}%` : '–', icon: Cpu, iconColor: 'primary' as const },
          { label: 'Memory', value: memoryUsagePercent != null ? `${memoryUsagePercent}%` : '–', icon: HardDrive, iconColor: 'info' as const },
          { label: 'Pods', value: `${runningPods.length}/${capacity.pods || '–'}`, icon: Box, iconColor: 'success' as const },
          { label: 'Disk', value: '–', icon: HardDrive, iconColor: 'muted' as const },
          { label: 'Version', value: nodeInfo?.kubeletVersion || '–', icon: Info, iconColor: 'muted' as const },
          { label: 'Uptime', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
