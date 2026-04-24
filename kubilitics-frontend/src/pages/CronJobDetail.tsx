import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { diagnoseWorkload } from '@/lib/diagnose';
import type { DiagnoseAction } from '@/lib/diagnose/types';
import { DiagnosePanel } from '@/components/diagnose/DiagnosePanel';
import {
  Clock,
  Play,
  Pause,
  Download,
  CheckCircle2,
  Calendar,
  History,
  Box,
  FileText,
  Terminal,
  Workflow,
  LayoutDashboard,
  Layers,
  CalendarClock,
  BarChart2,
  Settings,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  GenericResourceDetail,
  ContainersSection,
  LabelList,
  AnnotationList,
  MetricsDashboard,
  SectionCard,
  DetailRow,
  WorkloadLogsTab,
  type CustomTab,
  type ResourceContext,
  type ContainerInfo,
} from '@/components/resources';
import { PodTerminal } from '@/components/resources/PodTerminal';
import { useK8sResourceList, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { postCronJobTrigger } from '@/services/backendApiClient';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
interface CronJobResource extends KubernetesResource {
  spec?: {
    schedule?: string;
    suspend?: boolean;
    concurrencyPolicy?: string;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    startingDeadlineSeconds?: number;
    jobTemplate?: {
      spec?: {
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
        backoffLimit?: number;
        activeDeadlineSeconds?: number;
      };
    };
  };
  status?: {
    active?: Array<{ name: string; namespace: string }>;
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
  };
}

function parseCronFields(schedule: string): { minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string } | null {
  if (!schedule?.trim()) return null;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return null;
  return { minute: parts[0], hour: parts[1], dayOfMonth: parts[2], month: parts[3], dayOfWeek: parts[4] };
}

function cronToHuman(schedule: string): string {
  if (!schedule || schedule === '-') return '—';
  const p = parseCronFields(schedule);
  if (!p) return schedule;
  const { minute, hour, dayOfMonth, month, dayOfWeek } = p;
  const allStar = dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  if (minute.startsWith('*/') && hour === '*' && allStar) {
    const n = parseInt(minute.slice(2), 10);
    if (n === 1) return 'Every minute';
    if (Number.isFinite(n) && n <= 60) return `Every ${n} minutes`;
  }
  if (minute === '0' && hour === '*' && allStar) return 'Every hour';
  if (minute === '0' && hour.startsWith('*/') && allStar) {
    const n = parseInt(hour.slice(2), 10);
    if (n === 1) return 'Every hour';
    if (Number.isFinite(n)) return `Every ${n} hours`;
  }
  if (minute === '0' && hour !== '*' && allStar) {
    const h = parseInt(hour, 10);
    if (Number.isFinite(h)) {
      if (h === 0) return 'Every day at midnight';
      return `Every day at ${h}:00`;
    }
  }
  if (minute !== '*' && !minute.startsWith('*/') && hour !== '*' && allStar) {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const h12 = h % 12 || 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      return `Every day at ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    }
  }
  return schedule;
}

function getNextRunTimes(schedule: string, count: number): Date[] {
  if (!schedule?.trim() || count < 1) return [];
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return [];
  const [minPart, hourPart, dayOfMonth, month, dayOfWeek] = parts;
  const allStar = dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  const result: Date[] = [];
  const t = new Date();
  t.setSeconds(0, 0);

  if (minPart.startsWith('*/') && hourPart === '*' && allStar) {
    const n = parseInt(minPart.slice(2), 10);
    if (!Number.isFinite(n) || n < 1) return [];
    const currMin = t.getMinutes();
    const nextMin = Math.ceil((currMin + 1) / n) * n;
    if (nextMin >= 60) { t.setMinutes(0); t.setHours(t.getHours() + 1); } else { t.setMinutes(nextMin); }
    for (let i = 0; i < count; i++) { result.push(new Date(t)); t.setMinutes(t.getMinutes() + n); if (t.getMinutes() < n) t.setHours(t.getHours() + 1); }
    return result;
  }
  if (minPart === '0' && hourPart === '*' && allStar) {
    t.setMinutes(0, 0, 0); if (t.getTime() <= Date.now()) t.setHours(t.getHours() + 1);
    for (let i = 0; i < count; i++) { result.push(new Date(t)); t.setHours(t.getHours() + 1); }
    return result;
  }
  if (minPart === '0' && hourPart.startsWith('*/') && allStar) {
    const n = parseInt(hourPart.slice(2), 10);
    if (!Number.isFinite(n) || n < 1) return [];
    t.setMinutes(0); const currH = t.getHours(); const nextH = Math.ceil((currH + 1) / n) * n;
    if (nextH >= 24) { t.setDate(t.getDate() + 1); t.setHours(nextH % 24); } else { t.setHours(nextH); }
    t.setMinutes(0);
    for (let i = 0; i < count; i++) { result.push(new Date(t)); t.setHours(t.getHours() + n); if (t.getHours() < 24) continue; t.setHours(t.getHours() % 24); t.setDate(t.getDate() + 1); }
    return result;
  }
  if (minPart === '0' && hourPart !== '*' && allStar) {
    const h = parseInt(hourPart, 10);
    if (!Number.isFinite(h) || h < 0 || h > 23) return [];
    t.setMinutes(0); t.setHours(h); if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    for (let i = 0; i < count; i++) { result.push(new Date(t)); t.setDate(t.getDate() + 1); }
    return result;
  }
  if (hourPart !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const h = parseInt(hourPart, 10); const m = parseInt(minPart, 10);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      t.setMinutes(m); t.setHours(h); if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
      for (let i = 0; i < count; i++) { result.push(new Date(t)); t.setDate(t.getDate() + 1); }
      return result;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Tab Components
// ---------------------------------------------------------------------------

function OverviewTab({ resource: cronJob, age }: ResourceContext<CronJobResource>) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const isSuspended = cronJob.spec?.suspend || false;
  const containers: ContainerInfo[] = (cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name, image: c.image, ready: true, restartCount: 0, state: 'running', ports: [], resources: c.resources || {},
  }));

  const { childJobsSorted } = useChildJobs(cronJob.metadata?.namespace, cronJob.metadata?.name);

  const diagnosis = useMemo(
    () => diagnoseWorkload({ ...cronJob, kind: 'CronJob' } as unknown as Parameters<typeof diagnoseWorkload>[0], { relatedJobs: childJobsSorted }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cronJob?.metadata?.uid, cronJob?.metadata?.resourceVersion, childJobsSorted],
  );

  const handleDiagnoseAction = (action: DiagnoseAction) => {
    if (action.type === 'jump_to_tab') setSearchParams({ tab: action.tab });
  };

  return (
    <div className="space-y-6">
      <DiagnosePanel diagnosis={diagnosis} resource={cronJob} onAction={handleDiagnoseAction} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Workflow} title="CronJob Configuration" tooltip={<p className="text-xs text-muted-foreground">Schedule and execution settings</p>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Schedule" value={<Badge variant="outline" className="font-mono">{cronJob.spec?.schedule || '-'}</Badge>} />
            <DetailRow label="Status" value={<Badge variant={isSuspended ? 'secondary' : 'default'}>{isSuspended ? 'Suspended' : 'Active'}</Badge>} />
            <DetailRow label="Concurrency Policy" value={cronJob.spec?.concurrencyPolicy || 'Allow'} />
            <DetailRow label="Starting Deadline" value={`${cronJob.spec?.startingDeadlineSeconds || '-'}s`} />
            <DetailRow label="Successful History" value={String(cronJob.spec?.successfulJobsHistoryLimit || 3)} />
            <DetailRow label="Failed History" value={String(cronJob.spec?.failedJobsHistoryLimit || 1)} />
          </div>
        </SectionCard>

        <SectionCard icon={Layers} title="Job Template" tooltip={<p className="text-xs text-muted-foreground">Template for spawned jobs</p>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Backoff Limit" value={String(cronJob.spec?.jobTemplate?.spec?.backoffLimit || 6)} />
            <DetailRow label="Active Deadline" value={`${cronJob.spec?.jobTemplate?.spec?.activeDeadlineSeconds || '-'}s`} />
            <DetailRow label="Restart Policy" value={cronJob.spec?.jobTemplate?.spec?.template?.spec?.restartPolicy || 'Never'} />
            <DetailRow label="Containers" value={String(containers.length)} />
          </div>
        </SectionCard>
      </div>

      {cronJob.status?.active && cronJob.status.active.length > 0 && (
        <SectionCard icon={Play} title="Active Jobs">
          <div className="space-y-2">
            {cronJob.status.active.map((job, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Play className="h-4 w-4 text-[hsl(var(--warning))]" />
                  <Button variant="link" className="h-auto p-0 press-effect" onClick={() => navigate(`/jobs/${job.namespace}/${job.name}`)} aria-label={`View job ${job.name}`}>
                    {job.name}
                  </Button>
                </div>
                <Badge>Running</Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={cronJob.metadata?.labels || {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={cronJob.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

function useChildJobs(namespace: string | undefined, name: string | undefined) {
  type JobLike = KubernetesResource & { metadata?: { name?: string; ownerReferences?: Array<{ kind?: string; name?: string }> } };
  const { data: jobsList } = useK8sResourceList<JobLike>('jobs', namespace ?? undefined, { enabled: !!namespace && !!name, limit: 5000 });
  const childJobs = (jobsList?.items ?? []).filter((job) => job.metadata?.ownerReferences?.some((ref) => ref.kind === 'CronJob' && ref.name === name));
  const childJobsSorted = useMemo(() => {
    return [...childJobs].sort((a, b) => {
      const aStart = (a.status as { startTime?: string })?.startTime ?? a.metadata?.creationTimestamp ?? '';
      const bStart = (b.status as { startTime?: string })?.startTime ?? b.metadata?.creationTimestamp ?? '';
      return new Date(bStart).getTime() - new Date(aStart).getTime();
    });
  }, [childJobs]);
  return { childJobs, childJobsSorted };
}

function useCjPods(namespace: string | undefined, childJobNames: Set<string>) {
  type PodLike = KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string> }; status?: { phase?: string }; spec?: { nodeName?: string; containers?: Array<{ name: string }> } };
  const { data: podsList } = useK8sResourceList<PodLike>('pods', namespace ?? undefined, { enabled: !!namespace && childJobNames.size > 0, limit: 5000 });
  return (podsList?.items ?? []).filter((pod) => {
    const jobName = pod.metadata?.labels?.['job-name'];
    return !!jobName && childJobNames.has(jobName);
  });
}

function ScheduleDetailsTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const scheduleStr = cronJob.spec?.schedule || '-';
  const isSuspended = cronJob.spec?.suspend || false;
  const cronFields = useMemo(() => parseCronFields(scheduleStr), [scheduleStr]);
  const scheduleHumanLabel = useMemo(() => cronToHuman(scheduleStr), [scheduleStr]);
  const next10Runs = useMemo(() => (isSuspended ? [] : getNextRunTimes(scheduleStr, 10)), [scheduleStr, isSuspended]);

  return (
    <SectionCard icon={Calendar} title="Schedule Details" tooltip={<p className="text-xs text-muted-foreground">Cron expression breakdown and next runs</p>}>
      <div className="space-y-6">
        <div>
          <p className="text-muted-foreground text-sm mb-2">Cron expression (minute hour day-of-month month day-of-week)</p>
          <Badge variant="outline" className="font-mono text-sm">{scheduleStr}</Badge>
        </div>
        {cronFields && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div><p className="text-muted-foreground mb-0.5">minute</p><p className="font-mono">{cronFields.minute}</p></div>
            <div><p className="text-muted-foreground mb-0.5">hour</p><p className="font-mono">{cronFields.hour}</p></div>
            <div><p className="text-muted-foreground mb-0.5">day-of-month</p><p className="font-mono">{cronFields.dayOfMonth}</p></div>
            <div><p className="text-muted-foreground mb-0.5">month</p><p className="font-mono">{cronFields.month}</p></div>
            <div><p className="text-muted-foreground mb-0.5">day-of-week</p><p className="font-mono">{cronFields.dayOfWeek}</p></div>
          </div>
        )}
        <div>
          <p className="text-muted-foreground text-sm mb-1">Human-readable</p>
          <p className="font-medium">{scheduleHumanLabel}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm mb-2">Next 10 runs</p>
          {isSuspended ? (
            <p className="text-sm text-muted-foreground">CronJob is suspended; no upcoming runs.</p>
          ) : next10Runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Unable to compute next runs for this expression (only */n min, hourly, daily patterns supported).</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="text-left p-3 font-medium">#</th><th className="text-left p-3 font-medium">Scheduled time</th></tr></thead>
                <tbody>
                  {next10Runs.map((d, i) => (
                    <tr key={i} className="border-t"><td className="p-3 font-mono">{i + 1}</td><td className="p-3 font-mono text-muted-foreground">{d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function JobsHistoryTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const navigate = useNavigate();
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs, childJobsSorted } = useChildJobs(namespace, name);

  const childJobsLast30 = useMemo(() => childJobsSorted.slice(0, 30), [childJobsSorted]);
  const jobsHistorySuccessRate = useMemo(() => {
    if (childJobsLast30.length === 0) return null;
    const completed = childJobsLast30.filter((job) => (job.status as { completionTime?: string } | undefined)?.completionTime != null);
    if (completed.length === 0) return null;
    const succeeded = completed.filter((job) => {
      const jStatus = job.status as { succeeded?: number } | undefined;
      const completions = (job.spec as { completions?: number } | undefined)?.completions ?? 1;
      return (jStatus?.succeeded ?? 0) >= completions;
    });
    return Math.round((succeeded.length / completed.length) * 100);
  }, [childJobsLast30]);
  const jobsHistoryChartData = useMemo(() => {
    return childJobsLast30.map((job) => {
      const jStatus = job.status as { succeeded?: number; failed?: number; startTime?: string } | undefined;
      const completions = (job.spec as { completions?: number } | undefined)?.completions ?? 1;
      const succeeded = jStatus?.succeeded ?? 0;
      const statusStr = succeeded >= completions ? 'Succeeded' : jStatus?.failed ? 'Failed' : 'Running';
      return { name: (job.metadata?.name ?? '').slice(-12), fullName: job.metadata?.name ?? '', Succeeded: statusStr === 'Succeeded' ? 1 : 0, Failed: statusStr === 'Failed' ? 1 : 0, Running: statusStr === 'Running' ? 1 : 0, status: statusStr };
    }).reverse();
  }, [childJobsLast30]);

  return (
    <SectionCard icon={History} title="Jobs History" tooltip={<p className="text-xs text-muted-foreground">Child jobs with status, duration, and success rate</p>}>
      {childJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs created by this CronJob yet.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-6">
            <div><p className="text-xs text-muted-foreground mb-0.5">Success rate (last 30 runs)</p><p className="text-2xl font-semibold tabular-nums">{jobsHistorySuccessRate != null ? `${jobsHistorySuccessRate}%` : '—'}</p></div>
          </div>
          {jobsHistoryChartData.length > 0 && (
            <div className="h-[240px] w-full">
              <p className="text-xs text-muted-foreground mb-2">Last 30 runs — Success (green) / Failed (red) / Running (gray)</p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobsHistoryChartData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <XAxis type="number" domain={[0, 1]} hide />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                  <Tooltip content={({ active, payload }) => { if (!active || !payload?.[0]) return null; const d = payload[0].payload; return (<div className="rounded-md border bg-background px-3 py-2 text-xs shadow"><p className="font-mono font-medium">{d.fullName}</p><p className="text-muted-foreground">Status: {d.status}</p></div>); }} />
                  <Bar dataKey="Succeeded" stackId="a" fill="hsl(142,76%,36%)" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="Failed" stackId="a" fill="hsl(0,72%,51%)" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="Running" stackId="a" fill="hsl(var(--muted-foreground))" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-muted/50"><tr><th className="text-left p-3 font-medium">Job Name</th><th className="text-left p-3 font-medium">Status</th><th className="text-left p-3 font-medium">Start Time</th><th className="text-left p-3 font-medium">Duration</th><th className="text-left p-3 font-medium">Completions</th><th className="text-left p-3 font-medium">Age</th></tr></thead>
              <tbody>
                {childJobsSorted.slice(0, 50).map((job) => {
                  const jobName = job.metadata?.name ?? '';
                  const jobNs = job.metadata?.namespace ?? namespace ?? '';
                  const jStatus = job.status as { succeeded?: number; failed?: number; startTime?: string; completionTime?: string } | undefined;
                  const succeeded = jStatus?.succeeded ?? 0;
                  const completions = (job.spec as { completions?: number } | undefined)?.completions ?? 1;
                  const statusStr = succeeded >= completions ? 'Succeeded' : jStatus?.failed ? 'Failed' : 'Running';
                  const startTime = jStatus?.startTime;
                  const endTime = jStatus?.completionTime;
                  let durationStr = '–';
                  if (startTime && endTime) { const sec = Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000); durationStr = sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`; } else if (startTime) durationStr = 'Running';
                  const ageStr = job.metadata?.creationTimestamp ? calculateAge(job.metadata.creationTimestamp) : '–';
                  return (
                    <tr key={jobName} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => navigate(`/jobs/${jobNs}/${jobName}`)}>
                      <td className="p-3"><Link to={`/jobs/${jobNs}/${jobName}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>{jobName}</Link></td>
                      <td className="p-3"><Badge variant={statusStr === 'Succeeded' ? 'default' : statusStr === 'Failed' ? 'destructive' : 'secondary'} className="text-xs">{statusStr}</Badge></td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{startTime ? new Date(startTime).toLocaleString() : '–'}</td>
                      <td className="p-3 font-mono">{durationStr}</td>
                      <td className="p-3 font-mono">{succeeded}/{completions}</td>
                      <td className="p-3 text-muted-foreground">{ageStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {childJobsSorted.length > 50 && <p className="p-3 text-xs text-muted-foreground">Showing first 50 of {childJobsSorted.length} jobs.</p>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function ExecutionTimelineTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs } = useChildJobs(namespace, name);

  return (
    <SectionCard icon={Clock} title="Execution Timeline" tooltip={<p className="text-xs text-muted-foreground">Runs over time</p>}>
      {childJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No job runs to display.</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {childJobs.slice(0, 30).map((job) => {
            const jobName = job.metadata?.name ?? '';
            const jobNs = job.metadata?.namespace ?? namespace ?? '';
            const jStatus = job.status as { succeeded?: number; startTime?: string; completionTime?: string } | undefined;
            const startTime = jStatus?.startTime;
            const endTime = jStatus?.completionTime;
            const result = (job.spec as { completions?: number } | undefined)?.completions && jStatus?.succeeded >= ((job.spec as { completions?: number }).completions ?? 1) ? 'Success' : endTime ? 'Failed' : 'Running';
            return (
              <div key={jobName} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                <span className="text-xs font-mono text-muted-foreground w-32 shrink-0">{startTime ? new Date(startTime).toLocaleTimeString() : '-'}</span>
                <div className="flex-1 min-w-0"><Link to={`/jobs/${jobNs}/${jobName}`} className="text-primary hover:underline font-medium truncate block">{jobName}</Link></div>
                <Badge variant={result === 'Success' ? 'default' : result === 'Failed' ? 'destructive' : 'secondary'} className="shrink-0">{result}</Badge>
              </div>
            );
          })}
          {childJobs.length > 30 && <p className="text-xs text-muted-foreground">Showing last 30 runs.</p>}
        </div>
      )}
    </SectionCard>
  );
}

function ConcurrencyPolicyTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  return (
    <SectionCard icon={Settings} title="Concurrency Policy" tooltip={<p className="text-xs text-muted-foreground">How overlapping runs are handled</p>}>
      <div className="space-y-3">
        <Badge variant="outline" className="text-base">{cronJob.spec?.concurrencyPolicy || 'Allow'}</Badge>
        <p className="text-sm text-muted-foreground">
          <strong>Allow</strong>: New job runs even if the previous run has not finished.
          <br /><strong>Forbid</strong>: Skip the new run if the previous run is still active.
          <br /><strong>Replace</strong>: Cancel the current run and start a new one.
        </p>
      </div>
    </SectionCard>
  );
}

function AlertsTab() {
  return (
    <SectionCard icon={CalendarClock} title="Alerts & Notifications" tooltip={<p className="text-xs text-muted-foreground">Configure later when backend supports it</p>}>
      <p className="text-sm text-muted-foreground">Configure alerts and notifications when backend support is available.</p>
    </SectionCard>
  );
}

function ContainersTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const containers: ContainerInfo[] = (cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map(c => ({
    name: c.name, image: c.image, ready: true, restartCount: 0, state: 'running', ports: [], resources: c.resources || {},
  }));
  return <ContainersSection containers={containers} />;
}

function JobsTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs } = useChildJobs(namespace, name);

  return (
    <SectionCard icon={Workflow} title="Jobs" tooltip={<p className="text-xs text-muted-foreground">Jobs created by this CronJob</p>}>
      {childJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Jobs created by this CronJob yet.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-3 font-medium">Name</th><th className="text-left p-3 font-medium">Age</th><th className="text-left p-3 font-medium">Actions</th></tr></thead>
            <tbody>
              {childJobs.map((job) => {
                const jobName = job.metadata?.name ?? '';
                const jobNs = job.metadata?.namespace ?? namespace ?? '';
                const created = job.metadata?.creationTimestamp ? calculateAge(job.metadata.creationTimestamp) : '-';
                return (
                  <tr key={jobName} className="border-t">
                    <td className="p-3"><Link to={`/jobs/${jobNs}/${jobName}`} className="text-primary hover:underline font-medium">{jobName}</Link></td>
                    <td className="p-3">{created}</td>
                    <td className="p-3"><Button variant="ghost" size="sm" asChild className="press-effect" aria-label={`View job ${jobName}`}><Link to={`/jobs/${jobNs}/${jobName}`}>View</Link></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function PodsTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs } = useChildJobs(namespace, name);
  const childJobNames = new Set(childJobs.map((j) => j.metadata?.name).filter(Boolean) as string[]);
  const cjPods = useCjPods(namespace, childJobNames);

  return (
    <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods from Jobs created by this CronJob</p>}>
      {cjPods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pods from CronJob Jobs yet.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-3 font-medium">Name</th><th className="text-left p-3 font-medium">Status</th><th className="text-left p-3 font-medium">Node</th><th className="text-left p-3 font-medium">Age</th></tr></thead>
            <tbody>
              {cjPods.map((pod) => {
                const podName = pod.metadata?.name ?? '';
                const podNs = pod.metadata?.namespace ?? namespace ?? '';
                const phase = (pod.status as { phase?: string } | undefined)?.phase ?? '-';
                const nodeName = (pod.spec as { nodeName?: string } | undefined)?.nodeName ?? '-';
                const created = pod.metadata?.creationTimestamp ? calculateAge(pod.metadata.creationTimestamp) : '-';
                return (
                  <tr key={podName} className="border-t">
                    <td className="p-3"><Link to={`/pods/${podNs}/${podName}`} className="text-primary hover:underline font-medium">{podName}</Link></td>
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
  );
}

function LogsTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs } = useChildJobs(namespace, name);
  const childJobNames = new Set(childJobs.map((j) => j.metadata?.name).filter(Boolean) as string[]);
  const cjPods = useCjPods(namespace, childJobNames);
  const containers = (cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map(c => c.name);

  return (
    <WorkloadLogsTab
      pods={cjPods}
      namespace={namespace ?? undefined}
      kindLabel="CronJob"
      templateContainers={containers}
    />
  );
}

/**
 * Cannot use WorkloadTerminalTab here: CronJob pods are discovered via an
 * ownerReferences chain (CronJob → child Jobs → Pods) rather than a simple
 * matchLabels selector. The `useChildJobs` + `useCjPods` hooks implement
 * this chain. WorkloadTerminalTab only supports a flat label-selector query
 * (spec.selector.matchLabels or job-name), which would miss pods created by
 * older or renamed child jobs. Keeping inline logic until WorkloadTerminalTab
 * gains ownerReferences-chain support.
 */
function TerminalTab({ resource: cronJob }: ResourceContext<CronJobResource>) {
  const namespace = cronJob.metadata?.namespace;
  const name = cronJob.metadata?.name;
  const { childJobs } = useChildJobs(namespace, name);
  const childJobNames = new Set(childJobs.map((j) => j.metadata?.name).filter(Boolean) as string[]);
  const cjPods = useCjPods(namespace, childJobNames);
  const containers = (cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map(c => c.name);

  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');
  const firstCjPodName = cjPods[0]?.metadata?.name ?? '';
  const terminalPod = selectedTerminalPod || firstCjPodName;
  const terminalPodContainers = cjPods.find((p) => p.metadata?.name === terminalPod)?.spec?.containers?.map((c) => c.name) ?? containers;

  return (
    <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into CronJob Job pods</p>}>
      {cjPods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pods available for terminal.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Pod</Label>
              <Select value={terminalPod} onValueChange={setSelectedTerminalPod}>
                <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select pod" /></SelectTrigger>
                <SelectContent>{cjPods.map((p) => (<SelectItem key={p.metadata?.name} value={p.metadata?.name ?? ''}>{p.metadata?.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Container</Label>
              <Select value={selectedTerminalContainer || terminalPodContainers[0]} onValueChange={setSelectedTerminalContainer}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select container" /></SelectTrigger>
                <SelectContent>{terminalPodContainers.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </div>
          <PodTerminal key={`${terminalPod}-${selectedTerminalContainer || terminalPodContainers[0]}`} podName={terminalPod} namespace={namespace ?? undefined} containerName={selectedTerminalContainer || terminalPodContainers[0]} containers={terminalPodContainers} onContainerChange={setSelectedTerminalContainer} />
        </div>
      )}
    </SectionCard>
  );
}

function CronJobMetricsTab({ namespace, name, clusterId }: { namespace?: string; name?: string; clusterId: string | null }) {
  return <MetricsDashboard resourceType="cronjob" resourceName={name} namespace={namespace} clusterId={clusterId} />;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function CronJobDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const clusterId = useActiveClusterId();
  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const patchCronJob = usePatchK8sResource('cronjobs');

  // Pre-fetch child jobs for status cards (badge counts etc.)
  type JobLike = KubernetesResource & { metadata?: { name?: string; ownerReferences?: Array<{ kind?: string; name?: string }> } };
  const { data: jobsList } = useK8sResourceList<JobLike>('jobs', namespace ?? undefined, { enabled: !!namespace && !!name, limit: 5000 });
  const childJobs = (jobsList?.items ?? []).filter((job) => job.metadata?.ownerReferences?.some((ref) => ref.kind === 'CronJob' && ref.name === name));

  const handleTriggerNow = useCallback(async () => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to trigger CronJob'); return; }
    if (!isBackendConfigured) {
      toast.error('Connect to Kubilitics backend and select a cluster to trigger CronJob.');
      return;
    }
    const cid = useClusterPresenceStore.getState().activeCluster()?.session_id ?? null;
    if (!cid) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postCronJobTrigger(backendBase, cid, namespace, name);
      toast.success(`Triggered Job from CronJob ${name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'Trigger failed');
      throw e;
    }
  }, [isConnected, isBackendConfigured, name, namespace]);

  const handleToggleSuspend = useCallback(async (isSuspended: boolean) => {
    if (!isConnected || !name || !namespace) { toast.error('Connect cluster to suspend/resume CronJob'); return; }
    try {
      await patchCronJob.mutateAsync({ name, namespace, patch: { spec: { suspend: !isSuspended } } });
      toast.success(isSuspended ? `Resumed ${name}` : `Suspended ${name}`);
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) ?? 'Failed to update');
      throw err;
    }
  }, [isConnected, name, namespace, patchCronJob]);

  const containers = useMemo((): ContainerInfo[] => [], []);

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'scheduleDetails', label: 'Schedule Details', icon: Calendar, render: (ctx) => <ScheduleDetailsTab {...ctx} /> },
    { id: 'jobsHistory', label: 'Jobs History', icon: History, badge: childJobs.length.toString(), render: (ctx) => <JobsHistoryTab {...ctx} /> },
    { id: 'executionTimeline', label: 'Execution Timeline', icon: Clock, render: (ctx) => <ExecutionTimelineTab {...ctx} /> },
    { id: 'concurrencyPolicy', label: 'Concurrency Policy', icon: Settings, render: (ctx) => <ConcurrencyPolicyTab {...ctx} /> },
    { id: 'alerts', label: 'Alerts & Notifications', icon: CalendarClock, render: () => <AlertsTab /> },
    { id: 'containers', label: 'Containers', icon: Layers, render: (ctx) => <ContainersTab {...ctx} /> },
    { id: 'jobs', label: 'Jobs', icon: Workflow, badge: childJobs.length.toString(), render: (ctx) => <JobsTab {...ctx} /> },
    { id: 'pods', label: 'Pods', icon: Box, render: (ctx) => <PodsTab {...ctx} /> },
    { id: 'logs', label: 'Logs', icon: FileText, render: (ctx) => <LogsTab {...ctx} /> },
    { id: 'terminal', label: 'Terminal', icon: Terminal, render: (ctx) => <TerminalTab {...ctx} /> },
    { id: 'metrics', label: 'Metrics', icon: BarChart2, render: () => <CronJobMetricsTab namespace={namespace} name={name} clusterId={clusterId} /> },
  ];

  return (
    <GenericResourceDetail<CronJobResource>
      resourceType="cronjobs"
      kind="CronJob"
      pluralLabel="CronJobs"
      listPath="/cronjobs"
      resourceIcon={Clock}
      loadingCardCount={4}
      customTabs={customTabs}
      deriveStatus={(cj) => cj.spec?.suspend ? 'Pending' : 'Running'}
      headerMetadata={(ctx) => {
        const cj = ctx.resource;
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Created {ctx.age}
            <span className="mx-2">•</span>
            <Calendar className="h-3.5 w-3.5" />
            {cj.spec?.schedule}
            {ctx.isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        );
      }}
      buildStatusCards={(ctx) => {
        const cj = ctx.resource;
        const isSuspended = cj.spec?.suspend || false;
        const activeJobCount = cj.status?.active?.length || 0;
        const lastSchedule = cj.status?.lastScheduleTime ? calculateAge(cj.status.lastScheduleTime) + ' ago' : 'Never';
        const lastSuccess = cj.status?.lastSuccessfulTime ? calculateAge(cj.status.lastSuccessfulTime) + ' ago' : 'Never';
        const lastResult = cj.status?.lastSuccessfulTime ? 'Success' : activeJobCount > 0 ? 'Running' : '-';
        const scheduleStr = cj.spec?.schedule || '-';
        const scheduleHuman = scheduleStr !== '-' && /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(scheduleStr)
          ? (scheduleStr.startsWith('*/') ? `Every ${scheduleStr.slice(2).split(' ')[0]} min` : scheduleStr)
          : scheduleStr;
        const nextRunStr = scheduleStr !== '-' ? (() => {
          const parts = scheduleStr.trim().split(/\s+/);
          if (parts.length < 5 || !parts[0].startsWith('*/')) return '-';
          const n = parseInt(parts[0].slice(2), 10);
          if (!Number.isFinite(n) || n < 1) return '-';
          const now = new Date();
          const currMin = now.getMinutes();
          const nextMin = Math.ceil((currMin + 1) / n) * n;
          const next = new Date(now);
          if (nextMin >= 60) { next.setMinutes(0); next.setHours(next.getHours() + 1); } else { next.setMinutes(nextMin); }
          const secs = Math.round((next.getTime() - now.getTime()) / 1000);
          return secs < 60 ? 'in <1m' : secs < 3600 ? `in ${Math.floor(secs / 60)}m` : next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        })() : '-';

        return [
          { label: 'Status', value: isSuspended ? 'Suspended' : 'Active', icon: isSuspended ? Pause : Play, iconColor: isSuspended ? 'warning' as const : 'success' as const },
          { label: 'Schedule', value: scheduleHuman, icon: Calendar, iconColor: 'primary' as const },
          { label: 'Next run', value: nextRunStr, icon: Clock, iconColor: 'info' as const },
          { label: 'Last run', value: lastSchedule + (lastResult !== '-' ? ` (${lastResult})` : ''), icon: History, iconColor: 'muted' as const },
          { label: 'Active jobs', value: activeJobCount, icon: Play, iconColor: activeJobCount > 0 ? 'warning' as const : 'muted' as const },
          { label: 'Success rate (7d)', value: '-', icon: CheckCircle2, iconColor: 'muted' as const },
        ];
      }}
      extraHeaderActions={(ctx) => {
        const isSuspended = ctx.resource.spec?.suspend || false;
        return [
          { label: 'Trigger', icon: Play, variant: 'outline', onClick: handleTriggerNow, className: 'press-effect' },
          { label: isSuspended ? 'Resume' : 'Suspend', icon: isSuspended ? Play : Pause, variant: 'outline', onClick: () => handleToggleSuspend(isSuspended), className: 'press-effect' },
        ];
      }}
      extraActionItems={(ctx) => {
        const isSuspended = ctx.resource.spec?.suspend || false;
        return [
          { icon: Play, label: 'Trigger Now', description: 'Manually trigger a job run', className: 'press-effect', onClick: handleTriggerNow },
          { icon: isSuspended ? Play : Pause, label: isSuspended ? 'Resume' : 'Suspend', description: isSuspended ? 'Resume scheduled runs' : 'Pause scheduled runs', className: 'press-effect', onClick: () => handleToggleSuspend(isSuspended) },
          { icon: History, label: 'View Job History', description: 'See all spawned jobs', onClick: () => navigate(`/jobs?cronjob=${name}`), className: 'press-effect' },
        ];
      }}
    />
  );
}
