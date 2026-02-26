import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Workflow,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCw,
  Download,
  Trash2,
  Copy,
  Play,
  Activity,
  Timer,
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
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  LogViewer,
  TerminalViewer,
  DeleteConfirmDialog,
  SectionCard,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ContainerInfo,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useQuery } from '@tanstack/react-query';
import { postJobRetry, getJobMetrics } from '@/services/backendApiClient';
import { parseCpu, parseMemory } from '@/components/resources';

interface JobResource extends KubernetesResource {
  spec?: {
    completions?: number;
    parallelism?: number;
    backoffLimit?: number;
    activeDeadlineSeconds?: number;
    ttlSecondsAfterFinished?: number;
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          command?: string[];
          args?: string[];
          resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } };
        }>;
        restartPolicy?: string;
      };
    };
  };
  status?: {
    active?: number;
    succeeded?: number;
    failed?: number;
    startTime?: string;
    completionTime?: string;
    conditions?: Array<{ type: string; status: string; lastTransitionTime: string; reason?: string; message?: string }>;
  };
}

type PodContainerState = {
  running?: { startedAt?: string };
  terminated?: { exitCode?: number; finishedAt?: string; reason?: string };
};

type PodStatusWithContainers = {
  containerStatuses?: Array<{ state?: PodContainerState }>;
};

export default function JobDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedLogPod, setSelectedLogPod] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');

  const { isConnected } = useConnectionStatus();
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('Job', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const { resource: job, isLoading, error, age, yaml, refetch } = useResourceDetail<JobResource>(
    'jobs',
    name,
    namespace,
    {} as JobResource
  );
  const resourceEvents = useResourceEvents('Job', namespace ?? undefined, name ?? undefined);
  const displayEvents = resourceEvents.events;
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const deleteJob = useDeleteK8sResource('jobs');
  const updateJob = useUpdateK8sResource('jobs');

  const succeeded = job.status?.succeeded || 0;
  const failed = job.status?.failed || 0;
  const active = job.status?.active || 0;
  const completions = job.spec?.completions || 1;

  const status: ResourceStatus = succeeded >= completions ? 'Succeeded' :
    failed > 0 ? 'Failed' : active > 0 ? 'Running' : 'Pending';

  const duration = job.status?.startTime && job.status?.completionTime
    ? calculateAge(job.status.startTime).replace(/ ago$/, '')
    : job.status?.startTime
      ? 'Running...'
      : '-';

  const containers: ContainerInfo[] = (job.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name,
    image: c.image,
    ready: status === 'Succeeded',
    restartCount: 0,
    state: status === 'Succeeded' ? 'terminated' : status === 'Running' ? 'running' : 'waiting',
    stateReason: status === 'Succeeded' ? 'Completed' : undefined,
    ports: [],
    resources: c.resources || {},
  }));

  const conditions = job.status?.conditions || [];

  type PodLike = KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string }; spec?: { nodeName?: string; containers?: Array<{ name: string }> } };
  const { data: podsList } = useK8sResourceList<PodLike>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!name, limit: 5000 }
  );
  const jobPods = (podsList?.items ?? []).filter((pod) => (pod.metadata?.labels?.['job-name'] ?? '') === name);
  const firstJobPodName = jobPods[0]?.metadata?.name ?? '';

  const jobMetricsQuery = useQuery({
    queryKey: ['backend', 'job-metrics', clusterId, namespace, name],
    queryFn: () => getJobMetrics(backendBaseUrl!, clusterId!, namespace!, name!),
    enabled: !!(isBackendConfigured() && backendBaseUrl && clusterId && namespace && name),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = jobMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => { map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' }; });
    return map;
  }, [jobMetricsQuery.data?.pods]);

  const executionRows = useMemo(() => jobPods.map((pod) => {
    const podName = pod.metadata?.name ?? '';
    const podStatus = pod.status as PodStatusWithContainers | undefined;
    const firstContainer = podStatus?.containerStatuses?.[0];
    const startedAt = firstContainer?.state?.running?.startedAt ?? firstContainer?.state?.terminated?.finishedAt ?? pod.metadata?.creationTimestamp;
    const terminated = firstContainer?.state?.terminated;
    const phase = (pod.status as { phase?: string })?.phase ?? 'Unknown';
    const endAt = terminated?.finishedAt ?? (phase === 'Succeeded' || phase === 'Failed' ? startedAt : null);
    let durationSec = 0;
    if (startedAt && endAt) {
      durationSec = Math.max(0, (new Date(endAt).getTime() - new Date(startedAt).getTime()) / 1000);
    } else if (startedAt) {
      durationSec = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
    }
    const terminationReason = terminated?.reason ?? (phase === 'Failed' ? podStatus?.containerStatuses?.map((c) => c.state?.terminated?.reason).filter(Boolean).join(', ') || 'Error' : null);
    return {
      pod,
      podName,
      nodeName: (pod.spec as { nodeName?: string })?.nodeName ?? '–',
      startedAt,
      endAt,
      durationSec,
      exitCode: terminated?.exitCode ?? (terminated ? 0 : null),
      phase,
      terminationReason,
    };
  }), [jobPods]);

  const completedDurations = useMemo(() => executionRows.filter((r) => r.durationSec > 0 && (r.phase === 'Succeeded' || r.phase === 'Failed')).map((r) => r.durationSec), [executionRows]);
  const avgDurationSec = completedDurations.length > 0 ? completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length : 0;
  const remaining = Math.max(0, completions - succeeded);
  const etaSec = remaining > 0 && avgDurationSec > 0 ? remaining * avgDurationSec : 0;
  const totalDurationSec = useMemo(() => executionRows.reduce((sum, r) => sum + r.durationSec, 0), [executionRows]);
  const totalResourceEstimate = useMemo(() => {
    let cpuSec = 0;
    let memSec = 0;
    for (const r of executionRows) {
      const m = podMetricsByName[r.podName];
      if (m && r.durationSec > 0) {
        const cpu = parseCpu(m.cpu);
        const mem = parseMemory(m.memory);
        if (cpu != null) cpuSec += cpu * r.durationSec;
        if (mem != null) memSec += mem * r.durationSec;
      }
    }
    return { cpuSec, memSec };
  }, [executionRows, podMetricsByName]);

  const logPod = selectedLogPod || firstJobPodName;
  const terminalPod = selectedTerminalPod || firstJobPodName;
  const logPodContainers = jobPods.find((p) => p.metadata?.name === logPod)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);
  const terminalPodContainers = jobPods.find((p) => p.metadata?.name === terminalPod)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);


  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.metadata?.name || 'job'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }, [yaml, job.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(job, `${job.metadata?.name || 'job'}.json`);
    toast.success('JSON downloaded');
  }, [job]);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yaml);
    toast.success('YAML copied to clipboard');
  }, [yaml]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update Job');
      throw new Error('Not connected');
    }
    try {
      await updateJob.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('Job updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateJob, refetch]);

  const handleRetry = useCallback(async () => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to retry Job');
      return;
    }
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to retry Job.');
      return;
    }
    const cid = useBackendConfigStore.getState().currentClusterId;
    if (!cid) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postJobRetry(backendBase, cid, namespace, name);
      toast.success(`Created new Job from ${name} (retry)`);
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'Retry failed');
      throw e;
    }
  }, [isConnected, name, namespace, refetch, isBackendConfigured]);

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

  if (!job?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Job not found.</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/jobs')}>
              Back to Jobs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Status', value: status, icon: status === 'Succeeded' ? CheckCircle2 : status === 'Failed' ? XCircle : Activity, iconColor: status === 'Succeeded' ? 'success' as const : status === 'Failed' ? 'error' as const : 'warning' as const },
    { label: 'Completions', value: `${succeeded}/${completions}`, icon: CheckCircle2, iconColor: succeeded >= completions ? 'success' as const : 'warning' as const },
    { label: 'Active', value: active, icon: Activity, iconColor: 'muted' as const },
    { label: 'Succeeded', value: succeeded, icon: CheckCircle2, iconColor: 'success' as const },
    { label: 'Failed', value: failed, icon: XCircle, iconColor: failed > 0 ? 'error' as const : 'muted' as const },
    { label: 'Duration', value: duration, icon: Timer, iconColor: 'info' as const },
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
                <CardTitle className="text-base">Job Configuration</CardTitle>
                <CardDescription>Execution settings and limits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Completions</p>
                    <p className="font-mono text-lg">{completions}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Parallelism</p>
                    <p className="font-mono text-lg">{job.spec?.parallelism || 1}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Backoff Limit</p>
                    <p className="font-mono">{job.spec?.backoffLimit || 6}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Active Deadline</p>
                    <p className="font-mono">{job.spec?.activeDeadlineSeconds || '-'}s</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">TTL After Finished</p>
                    <p className="font-mono">{job.spec?.ttlSecondsAfterFinished || '-'}s</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Restart Policy</p>
                    <Badge variant="outline">{job.spec?.template?.spec?.restartPolicy || 'Never'}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Execution Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Succeeded</span>
                    <div className="flex items-center gap-2">
                      <Progress value={(succeeded / completions) * 100} className="w-32 h-2" />
                      <span className="font-mono text-sm w-12">{succeeded}/{completions}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Active</span>
                    <Badge variant={active > 0 ? 'default' : 'secondary'}>{active}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Failed</span>
                    <Badge variant={failed > 0 ? 'destructive' : 'secondary'}>{failed}</Badge>
                  </div>
                </div>
                {job.status?.startTime && (
                  <div className="pt-3 border-t space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Start Time</span>
                      <span className="font-mono text-xs">{new Date(job.status.startTime).toLocaleString()}</span>
                    </div>
                    {job.status.completionTime && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Completion Time</span>
                        <span className="font-mono text-xs">{new Date(job.status.completionTime).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {conditions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conditions</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}

          <MetadataCard title="Labels" items={job.metadata?.labels || {}} variant="badges" />
        </div>
      ),
    },
    {
      id: 'executionDetails',
      label: 'Execution Details',
      icon: Timer,
      content: (
        <SectionCard icon={Timer} title="Execution Details" tooltip={<p className="text-xs text-muted-foreground">Per-pod timeline, exit codes, and completion progress</p>}>
          {jobPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods for this Job yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Completion</span>
                  <span className="font-medium">{succeeded}/{completions}</span>
                </div>
                <Progress value={completions > 0 ? (succeeded / completions) * 100 : 0} className="h-2" />
                {etaSec > 0 && (
                  <p className="text-xs text-muted-foreground">ETA: ~{etaSec < 60 ? `${Math.round(etaSec)}s` : etaSec < 3600 ? `${Math.round(etaSec / 60)}m` : `${(etaSec / 3600).toFixed(1)}h`} (based on avg completed pod duration)</p>
                )}
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Pod Name</th>
                      <th className="text-left p-3 font-medium">Node</th>
                      <th className="text-left p-3 font-medium">Start Time</th>
                      <th className="text-left p-3 font-medium">End Time</th>
                      <th className="text-left p-3 font-medium">Duration</th>
                      <th className="text-left p-3 font-medium">Exit Code</th>
                      <th className="text-left p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionRows.map((r) => {
                      const podNs = r.pod.metadata?.namespace ?? namespace ?? '';
                      const durationStr = r.durationSec > 0
                        ? (r.durationSec < 60 ? `${Math.round(r.durationSec)}s` : r.durationSec < 3600 ? `${Math.floor(r.durationSec / 60)}m ${Math.round(r.durationSec % 60)}s` : `${Math.floor(r.durationSec / 3600)}h ${Math.floor((r.durationSec % 3600) / 60)}m`)
                        : (r.startedAt ? 'Running' : '–');
                      const statusLabel = r.phase === 'Failed' && r.terminationReason
                        ? `Failed (${r.terminationReason})`
                        : r.phase;
                      return (
                        <tr key={r.podName} className="border-t">
                          <td className="p-3">
                            <Link to={`/pods/${podNs}/${r.podName}`} className="text-primary hover:underline font-medium">{r.podName}</Link>
                          </td>
                          <td className="p-3 font-mono text-xs">{r.nodeName}</td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">{r.startedAt ? new Date(r.startedAt).toLocaleString() : '–'}</td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">{r.endAt ? new Date(r.endAt).toLocaleString() : '–'}</td>
                          <td className="p-3 font-mono">{durationStr}</td>
                          <td className="p-3 font-mono">{r.exitCode != null ? String(r.exitCode) : '–'}</td>
                          <td className="p-3">
                            <Badge variant={r.phase === 'Succeeded' ? 'default' : r.phase === 'Failed' ? 'destructive' : 'secondary'} className="text-xs" title={r.terminationReason ?? undefined}>
                              {statusLabel}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-6 text-sm border-t pt-3">
                <span className="text-muted-foreground">Total pod time: <span className="font-mono font-medium text-foreground">{totalDurationSec < 60 ? `${Math.round(totalDurationSec)}s` : totalDurationSec < 3600 ? `${(totalDurationSec / 60).toFixed(1)}m` : `${(totalDurationSec / 3600).toFixed(1)}h`}</span></span>
                {(totalResourceEstimate.cpuSec > 0 || totalResourceEstimate.memSec > 0) && (
                  <span className="text-muted-foreground">
                    Estimated usage (metrics × duration): <span className="font-mono text-foreground">{totalResourceEstimate.cpuSec > 0 ? ` CPU·s ${totalResourceEstimate.cpuSec.toFixed(1)}` : ''}{totalResourceEstimate.memSec > 0 ? ` Memory·s ${totalResourceEstimate.memSec.toFixed(0)}` : ''}</span>
                  </span>
                )}
              </div>
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
      badge: jobPods.length.toString(),
      content: (
        <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods created by this Job</p>}>
          {jobPods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pods for this Job yet.</p>
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
                  {jobPods.map((pod) => {
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
        <SectionCard icon={FileText} title="Logs" tooltip={<p className="text-xs text-muted-foreground">Stream logs from Job pods</p>}>
          {jobPods.length === 0 ? (
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
                      {jobPods.map((p) => (
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
        <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into Job pods (active only)</p>}>
          {jobPods.length === 0 ? (
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
                      {jobPods.map((p) => (
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
      content: <MetricsDashboard resourceType="job" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={job.metadata?.name || ''} editable onSave={handleSaveYaml} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="jobs"
          resourceKind="Job"
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
          kind={normalizeKindForTopology('Job')}
          namespace={namespace || job?.metadata?.namespace || ''}
          name={name || job?.metadata?.name || ''}
          sourceResourceType="Job"
          sourceResourceName={job?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Settings,
      content: (
        <ActionsSection actions={[
          { icon: RotateCw, label: 'Retry', description: 'Create a new Job with the same spec', onClick: handleRetry },
          { icon: Play, label: 'View Pod Logs', description: 'See logs from job pod', onClick: () => setActiveTab('logs') },
          { icon: Download, label: 'Download YAML', description: 'Export Job definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Job as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Job', description: 'Permanently remove this Job', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Job"
        resourceIcon={Workflow}
        name={job.metadata?.name || ''}
        namespace={job.metadata?.namespace}
        status={status}
        backLink="/jobs"
        backLabel="Jobs"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {age}
            <span className="mx-2">•</span>
            <Activity className="h-3.5 w-3.5" />
            {duration}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Retry', icon: RotateCw, variant: 'outline', onClick: handleRetry },
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
      </ResourceDetailLayout>

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Job"
        resourceName={job.metadata?.name || ''}
        namespace={job.metadata?.namespace}
        onConfirm={async () => {
          if (!isConnected || !name || !namespace) {
            toast.error('Connect cluster to delete Job');
            return;
          }
          await deleteJob.mutateAsync({ name, namespace });
          toast.success(`Job ${name} deleted`);
          navigate('/jobs');
        }}
        requireNameConfirmation
      />
    </>
  );
}
