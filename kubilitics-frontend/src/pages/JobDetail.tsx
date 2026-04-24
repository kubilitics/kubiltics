import { useState, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { diagnoseWorkload } from '@/lib/diagnose';
import type { DiagnoseAction } from '@/lib/diagnose/types';
import { DiagnosePanel } from '@/components/diagnose/DiagnosePanel';
import {
  Workflow,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCw,
  Activity,
  Timer,
  Box,
  FileText,
  Terminal,
  LayoutDashboard,
  Layers,
  BarChart2,
  Settings,
  Play,
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
  SectionCard,
  DetailRow,
  parseCpu,
  parseMemory,
  WorkloadLogsTab,
  type CustomTab,
  type ResourceContext,
  type ContainerInfo,
} from '@/components/resources';
import { WorkloadTerminalTab } from '@/components/resources/WorkloadTerminalTab';
import { useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery } from '@tanstack/react-query';
import { postJobRetry, getJobMetrics } from '@/services/backendApiClient';

import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
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

type PodLike = KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string }; spec?: { nodeName?: string; containers?: Array<{ name: string }> } };

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ resource: job }: ResourceContext<JobResource>) {
  const { namespace } = useParams();
  const [, setSearchParams] = useSearchParams();
  const succeeded = job.status?.succeeded || 0;
  const failed = job.status?.failed || 0;
  const active = job.status?.active || 0;
  const completions = job.spec?.completions || 1;
  const conditions = job.status?.conditions || [];

  const jobName = job.metadata?.name;
  const { data: podsList } = useK8sResourceList<PodLike>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!jobName, staleTime: 30000 },
  );
  const jobPods = (podsList?.items ?? []).filter(
    (pod) => (pod.metadata?.labels?.['job-name'] ?? '') === jobName,
  );

  const diagnosis = useMemo(
    () => diagnoseWorkload({ ...job, kind: 'Job' } as unknown as Parameters<typeof diagnoseWorkload>[0], { relatedPods: jobPods }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job?.metadata?.uid, job?.metadata?.resourceVersion, jobPods],
  );

  const handleDiagnoseAction = (action: DiagnoseAction) => {
    if (action.type === 'jump_to_tab') setSearchParams({ tab: action.tab });
  };

  return (
    <div className="space-y-6">
      <DiagnosePanel diagnosis={diagnosis} resource={job} onAction={handleDiagnoseAction} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Settings} title="Job Configuration" tooltip={<p className="text-xs text-muted-foreground">Execution settings and limits</p>}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Completions" value={String(completions)} />
              <DetailRow label="Parallelism" value={String(job.spec?.parallelism || 1)} />
              <DetailRow label="Backoff Limit" value={String(job.spec?.backoffLimit || 6)} />
              <DetailRow label="Active Deadline" value={`${job.spec?.activeDeadlineSeconds || '-'}s`} />
              <DetailRow label="TTL After Finished" value={`${job.spec?.ttlSecondsAfterFinished || '-'}s`} />
              <DetailRow label="Restart Policy" value={<Badge variant="outline">{job.spec?.template?.spec?.restartPolicy || 'Never'}</Badge>} />
            </div>
        </SectionCard>

        <SectionCard icon={Activity} title="Execution Status">
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
        </SectionCard>
      </div>

      {conditions.length > 0 && (
        <SectionCard icon={Activity} title="Conditions">
            <div className="space-y-3">
              {conditions.map((condition) => {
                const isTrue = condition.status === 'True';
                return (
                  <div key={condition.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      {isTrue ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-rose-600" />
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
      )}

      {/* Metadata */}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={job.metadata?.labels || {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={job.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function JobDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const { isConnected } = useConnectionStatus();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());


  // Pod list for all tabs
  const { data: podsList } = useK8sResourceList<PodLike>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!name, limit: 5000 }
  );
  const jobPods = (podsList?.items ?? []).filter((pod) => (pod.metadata?.labels?.['job-name'] ?? '') === name);

  const jobMetricsQuery = useQuery({
    queryKey: ['backend', 'job-metrics', clusterId, namespace, name],
    queryFn: () => getJobMetrics(backendBaseUrl!, clusterId!, namespace!, name!),
    // '' backendBaseUrl = same-origin (dev proxy / in-cluster nginx); do not gate on truthy.
    enabled: !!(isBackendConfigured && clusterId && namespace && name),
    staleTime: 15_000,
  });
  const podMetricsByName = useMemo(() => {
    const pods = jobMetricsQuery.data?.pods ?? [];
    const map: Record<string, { cpu: string; memory: string }> = {};
    pods.forEach((p) => { map[p.name] = { cpu: p.CPU ?? '–', memory: p.Memory ?? '–' }; });
    return map;
  }, [jobMetricsQuery.data?.pods]);

  const handleRetry = useCallback(async () => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to retry Job');
      return;
    }
    if (!isBackendConfigured) {
      toast.error('Connect to Kubilitics backend in Settings to retry Job.');
      return;
    }
    const cid = useClusterPresenceStore.getState().activeCluster()?.session_id ?? null;
    if (!cid) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postJobRetry(backendBase, cid, namespace, name);
      toast.success(`Created new Job from ${name} (retry)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'Retry failed');
      throw e;
    }
  }, [isConnected, name, namespace, isBackendConfigured]);

  const customTabs: CustomTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      render: (ctx) => <OverviewTab {...ctx} />,
    },
    {
      id: 'executionDetails',
      label: 'Execution Details',
      icon: Timer,
      render: (ctx) => {
        const job = ctx.resource;
        const succeeded = job.status?.succeeded || 0;
        const completions = job.spec?.completions || 1;

        const executionRows = jobPods.map((pod) => {
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
          return { pod, podName, nodeName: (pod.spec as { nodeName?: string })?.nodeName ?? '–', startedAt, endAt, durationSec, exitCode: terminated?.exitCode ?? (terminated ? 0 : null), phase, terminationReason };
        });

        const completedDurations = executionRows.filter((r) => r.durationSec > 0 && (r.phase === 'Succeeded' || r.phase === 'Failed')).map((r) => r.durationSec);
        const avgDurationSec = completedDurations.length > 0 ? completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length : 0;
        const remaining = Math.max(0, completions - succeeded);
        const etaSec = remaining > 0 && avgDurationSec > 0 ? remaining * avgDurationSec : 0;
        const totalDurationSec = executionRows.reduce((sum, r) => sum + r.durationSec, 0);
        const totalResourceEstimate = (() => {
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
        })();

        return (
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
        );
      },
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Layers,
      render: (ctx) => {
        const job = ctx.resource;
        const status = (job.status?.succeeded || 0) >= (job.spec?.completions || 1) ? 'Succeeded' :
          (job.status?.failed || 0) > 0 ? 'Failed' : (job.status?.active || 0) > 0 ? 'Running' : 'Pending';
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
        return <ContainersSection containers={containers} />;
      },
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: jobPods.length.toString(),
      render: () => (
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
      render: (ctx) => {
        const templateContainers = (ctx.resource.spec?.template?.spec?.containers || []).map(c => c.name);

        return (
          <WorkloadLogsTab
            pods={jobPods}
            namespace={namespace ?? undefined}
            kindLabel="Job"
            templateContainers={templateContainers}
          />
        );
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      render: () => (
        <WorkloadTerminalTab
          matchLabels={{ 'job-name': name ?? '' }}
          namespace={namespace ?? undefined}
          tooltip="Exec into job pods"
        />
      ),
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      render: () => <MetricsDashboard resourceType="job" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
  ];

  return (
    <GenericResourceDetail<JobResource>
      resourceType="jobs"
      kind="Job"
      pluralLabel="Jobs"
      listPath="/jobs"
      resourceIcon={Workflow}
      loadingCardCount={6}
      deriveStatus={(job) => {
        const succeeded = job.status?.succeeded || 0;
        const completions = job.spec?.completions || 1;
        return succeeded >= completions ? 'Succeeded' : (job.status?.failed || 0) > 0 ? 'Failed' : (job.status?.active || 0) > 0 ? 'Running' : 'Pending';
      }}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const job = ctx.resource;
        const succeeded = job.status?.succeeded || 0;
        const failed = job.status?.failed || 0;
        const active = job.status?.active || 0;
        const completions = job.spec?.completions || 1;
        const status = succeeded >= completions ? 'Succeeded' : failed > 0 ? 'Failed' : active > 0 ? 'Running' : 'Pending';
        const duration = job.status?.startTime && job.status?.completionTime
          ? calculateAge(job.status.startTime).replace(/ ago$/, '')
          : job.status?.startTime
            ? 'Running...'
            : '-';
        return [
          { label: 'Status', value: status, icon: status === 'Succeeded' ? CheckCircle2 : status === 'Failed' ? XCircle : Activity, iconColor: status === 'Succeeded' ? 'success' as const : status === 'Failed' ? 'error' as const : 'warning' as const },
          { label: 'Completions', value: `${succeeded}/${completions}`, icon: CheckCircle2, iconColor: succeeded >= completions ? 'success' as const : 'warning' as const },
          { label: 'Active', value: active, icon: Activity, iconColor: 'muted' as const },
          { label: 'Succeeded', value: succeeded, icon: CheckCircle2, iconColor: 'success' as const },
          { label: 'Failed', value: failed, icon: XCircle, iconColor: failed > 0 ? 'error' as const : 'muted' as const },
          { label: 'Duration', value: duration, icon: Timer, iconColor: 'info' as const },
        ];
      }}
      headerMetadata={(ctx) => {
        const job = ctx.resource;
        const duration = job.status?.startTime && job.status?.completionTime
          ? calculateAge(job.status.startTime).replace(/ ago$/, '')
          : job.status?.startTime
            ? 'Running...'
            : '-';
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {ctx.age}
            <span className="mx-2">&bull;</span>
            <Activity className="h-3.5 w-3.5" />
            {duration}
            {ctx.isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        );
      }}
      headerActions={(ctx) => [
        { label: 'Retry', icon: RotateCw, variant: 'outline', onClick: handleRetry, className: 'press-effect' },
      ]}
      extraActionItems={() => [
        { icon: RotateCw, label: 'Retry', description: 'Create a new Job with the same spec', className: 'press-effect', onClick: handleRetry },
        { icon: Play, label: 'View Pod Logs', description: 'See logs from job pod', className: 'press-effect' },
      ]}
    />
  );
}
