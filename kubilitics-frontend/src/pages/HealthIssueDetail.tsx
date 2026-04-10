/**
 * HealthIssueDetail — Full investigation page for a single active insight.
 * Route: /health/issues/:insightId
 *
 * Shows: issue summary + root cause, affected pods table,
 * and tabs for Logs, Events, and What Changed.
 */
import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Lightbulb,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Clock,
  RotateCcw,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout/PageLayout';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { useActiveInsights } from '@/hooks/useEventsIntelligence';
import { useInvestigateData, type PodInvestigateInfo } from '@/hooks/useInvestigateData';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { listResources, getPodLogsUrl } from '@/services/backendApiClient';
import { ERROR_KEYWORDS } from '@/lib/rootCauseHeuristic';
import type { Insight } from '@/services/api/eventsIntelligence';

/* ─── Severity helpers ──────────────────────────────────────────────────── */

function severityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical': return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'warning':  return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'info':     return <Info className="h-4 w-4 text-blue-500" />;
    default:         return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  }
}

function severityBadgeVariant(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return 'destructive';
    case 'warning':  return 'outline';
    case 'info':     return 'secondary';
    default:         return 'secondary';
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'warning':  return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
    case 'info':     return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
    default:         return '';
  }
}

function podStatusClass(phase: string): string {
  switch (phase.toLowerCase()) {
    case 'running':   return 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30';
    case 'pending':   return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
    case 'failed':    return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'unknown':   return 'bg-muted text-muted-foreground border-border';
    default:          return 'bg-muted text-muted-foreground border-border';
  }
}

/* ─── Log line highlighting ─────────────────────────────────────────────── */

function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  return ERROR_KEYWORDS.some((kw) => lower.includes(kw));
}

/* ─── Logs tab ──────────────────────────────────────────────────────────── */

interface LogsTabProps {
  pod: PodInvestigateInfo | null;
  clusterId: string | null;
  effectiveBaseUrl: string;
}

function LogsTab({ pod, clusterId, effectiveBaseUrl }: LogsTabProps) {
  const { data: logText, isLoading, error } = useQuery<string, Error>({
    queryKey: ['pod-logs', clusterId, pod?.namespace, pod?.name, pod?.containerName],
    queryFn: async () => {
      if (!pod || !clusterId) throw new Error('No pod selected');
      const url = getPodLogsUrl(effectiveBaseUrl, clusterId, pod.namespace, pod.name, {
        tail: 100,
        follow: false,
        container: pod.containerName ?? undefined,
      });
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    },
    enabled: !!pod && !!clusterId,
    staleTime: 15_000,
    retry: 1,
  });

  if (!pod) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Select a pod from the table above to view its logs.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    const isNotFound = error.message.includes('404') || error.message.includes('500');
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-medium">
          {isNotFound
            ? 'Pod no longer exists or has been recreated'
            : `Failed to fetch logs: ${error.message}`}
        </p>
        {isNotFound && (
          <p className="text-xs text-center max-w-md">
            Kubernetes has likely recreated this pod with a new name. Check the current pods in the namespace for the replacement.
          </p>
        )}
      </div>
    );
  }

  const lines = (logText ?? '').split('\n');

  return (
    <div className="font-mono text-xs overflow-auto max-h-[420px] p-4 rounded-md bg-background/60 border border-border/40">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'px-1 py-0.5 rounded leading-5 whitespace-pre-wrap break-all',
            isErrorLine(line) && 'text-destructive bg-destructive/5',
          )}
        >
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
}

/* ─── Events tab ────────────────────────────────────────────────────────── */

interface EventsTabProps {
  namespaces: string[];
  clusterId: string | null;
  effectiveBaseUrl: string;
}

interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  lastTimestamp: string | null;
  involvedObject: { kind: string; name: string; namespace: string };
}

function EventsTab({ namespaces, clusterId, effectiveBaseUrl }: EventsTabProps) {
  const { data: events, isLoading, error } = useQuery<K8sEvent[], Error>({
    queryKey: ['k8s-events', clusterId, namespaces],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster');
      const allEvents: K8sEvent[] = [];
      for (const ns of namespaces) {
        try {
          const result = await listResources(effectiveBaseUrl, clusterId, 'events', {
            namespace: ns,
            limit: 20,
          });
          for (const item of result.items) {
            const ev = item as Record<string, unknown>;
            const involvedObject = (ev.involvedObject ?? {}) as Record<string, unknown>;
            allEvents.push({
              type: (ev.type as string) ?? 'Normal',
              reason: (ev.reason as string) ?? '',
              message: (ev.message as string) ?? '',
              lastTimestamp: (ev.lastTimestamp as string) ?? null,
              involvedObject: {
                kind: (involvedObject.kind as string) ?? '',
                name: (involvedObject.name as string) ?? '',
                namespace: (involvedObject.namespace as string) ?? ns,
              },
            });
          }
        } catch {
          // Namespace may not exist, skip
        }
      }
      allEvents.sort((a, b) => {
        const ta = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
        const tb = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
        return tb - ta;
      });
      return allEvents;
    },
    enabled: !!clusterId && namespaces.length > 0,
    staleTime: 15_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to fetch events: {error.message}
      </div>
    );
  }

  if (!events?.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No events found for the affected namespaces.
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-[420px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card border-b border-border/40">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium w-24">Type</th>
            <th className="px-3 py-2 font-medium w-36">Reason</th>
            <th className="px-3 py-2 font-medium">Message</th>
            <th className="px-3 py-2 font-medium w-48">Object</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {events.map((ev, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    ev.type === 'Warning'
                      ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                      : 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30',
                  )}
                >
                  {ev.type}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ev.reason}</td>
              <td className="px-3 py-2 text-xs max-w-xs truncate" title={ev.message}>
                {ev.message}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {ev.involvedObject.kind}/{ev.involvedObject.name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── What Changed tab ──────────────────────────────────────────────────── */

interface WhatChangedTabProps {
  namespaces: string[];
  clusterId: string | null;
  effectiveBaseUrl: string;
}

interface DeploymentChange {
  name: string;
  namespace: string;
  image: string;
  updateTime: string;
}

function WhatChangedTab({ namespaces, clusterId, effectiveBaseUrl }: WhatChangedTabProps) {
  const ONE_HOUR_MS = 60 * 60 * 1000;

  const { data: changes, isLoading, error } = useQuery<DeploymentChange[], Error>({
    queryKey: ['k8s-deployments-changed', clusterId, namespaces],
    queryFn: async () => {
      if (!clusterId) throw new Error('No cluster');
      const recentChanges: DeploymentChange[] = [];
      const now = Date.now();

      for (const ns of namespaces) {
        try {
          const result = await listResources(effectiveBaseUrl, clusterId, 'deployments', {
            namespace: ns,
          });
          for (const item of result.items) {
            const dep = item as Record<string, unknown>;
            const metadata = (dep.metadata ?? {}) as Record<string, unknown>;
            const status = (dep.status ?? {}) as Record<string, unknown>;
            const spec = (dep.spec ?? {}) as Record<string, unknown>;
            const conditions = (status.conditions ?? []) as Array<Record<string, unknown>>;

            const progressingCondition = conditions.find(
              (c) => (c.type as string) === 'Progressing',
            );
            if (!progressingCondition) continue;

            const updateTimeStr = progressingCondition.lastUpdateTime as string | undefined;
            if (!updateTimeStr) continue;

            const updateTime = new Date(updateTimeStr).getTime();
            if (now - updateTime > ONE_HOUR_MS) continue;

            // Extract primary container image
            const template = (spec.template ?? {}) as Record<string, unknown>;
            const podSpec = (template.spec ?? {}) as Record<string, unknown>;
            const containers = (podSpec.containers ?? []) as Array<Record<string, unknown>>;
            const image = (containers[0]?.image as string) ?? 'unknown';

            recentChanges.push({
              name: (metadata.name as string) ?? '',
              namespace: (metadata.namespace as string) ?? ns,
              image,
              updateTime: updateTimeStr,
            });
          }
        } catch {
          // Skip namespace
        }
      }

      recentChanges.sort(
        (a, b) => new Date(b.updateTime).getTime() - new Date(a.updateTime).getTime(),
      );
      return recentChanges;
    },
    enabled: !!clusterId && namespaces.length > 0,
    staleTime: 30_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to fetch deployments: {error.message}
      </div>
    );
  }

  if (!changes?.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No deployment changes detected in the last hour.
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-[420px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card border-b border-border/40">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Deployment</th>
            <th className="px-3 py-2 font-medium">Namespace</th>
            <th className="px-3 py-2 font-medium">Image</th>
            <th className="px-3 py-2 font-medium w-40">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {changes.map((c, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{c.namespace}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-xs truncate" title={c.image}>
                {c.image}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {new Date(c.updateTime).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */

export default function HealthIssueDetail() {
  const { insightId } = useParams<{ insightId: string }>();
  const navigate = useNavigate();

  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const [selectedPod, setSelectedPod] = useState<PodInvestigateInfo | null>(null);
  const [activeTab, setActiveTab] = useState('logs');

  // Find insight from active list
  const { data: insights, isLoading: insightsLoading } = useActiveInsights();
  const insight: Insight | null = useMemo(
    () => insights?.find((i) => i.insight_id === insightId) ?? null,
    [insights, insightId],
  );

  // Fetch investigation data
  const { data: investigateData, isLoading: investigateLoading } = useInvestigateData(
    insight,
    !!insight,
  );

  const affectedNamespaces = useMemo(() => {
    if (!investigateData?.pods.length) return [];
    return [...new Set(investigateData.pods.map((p) => p.namespace))];
  }, [investigateData]);

  // Auto-select first pod when data loads
  const pods = investigateData?.pods ?? [];
  useEffect(() => {
    if (pods.length > 0 && !selectedPod) {
      setSelectedPod(pods[0]);
    }
  }, [pods]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Loading state */
  if (insightsLoading) {
    return (
      <PageLayout label="Issue Investigation">
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageLayout>
    );
  }

  /* Not found state */
  if (!insightsLoading && !insight) {
    return (
      <PageLayout label="Issue Investigation">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex flex-col items-center justify-center gap-4 py-24"
        >
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-muted-foreground text-sm">
            This insight may have been resolved or does not exist.
          </p>
          <Button variant="outline" onClick={() => navigate('/health')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Health Dashboard
          </Button>
        </motion.div>
      </PageLayout>
    );
  }

  const rootCause = investigateData?.rootCause;

  return (
    <PageLayout label="Issue Investigation">
      {/* Back button */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
      >
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground -ml-1"
          onClick={() => navigate('/health')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Health Dashboard
        </Button>
      </motion.div>

      <SectionOverviewHeader
        title={insight?.title ?? 'Issue Investigation'}
        description={insight?.detail ?? ''}
        icon={AlertTriangle}
        iconClassName="from-amber-500/20 to-amber-500/5 text-amber-500 border-amber-500/10"
        showAiButton={false}
        extraActions={
          insight && (
            <Badge
              variant="outline"
              className={cn('gap-1.5 text-sm px-3 py-1', severityBadgeClass(insight.severity))}
            >
              {severityIcon(insight.severity)}
              {insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1)}
            </Badge>
          )
        }
      />

      {/* Issue Summary Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
      >
        <Card className="border-none soft-shadow glass-panel">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Issue Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Time context row */}
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              {investigateData?.startedAgo && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  <span>Started <span className="text-foreground font-medium">{investigateData.startedAgo}</span></span>
                </div>
              )}
              {investigateData?.lastRestartAgo && (
                <div className="flex items-center gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  <span>Last restart <span className="text-foreground font-medium">{investigateData.lastRestartAgo}</span></span>
                </div>
              )}
              {investigateData && (
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  <span><span className="text-foreground font-medium">{investigateData.totalAffected}</span> affected pod{investigateData.totalAffected !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            {/* Root cause hint */}
            {investigateLoading && (
              <Skeleton className="h-14 w-full" />
            )}
            {rootCause && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    Root Cause Hint
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
                    {rootCause.cause}
                    {rootCause.keyword && (
                      <span className="ml-2 font-mono text-xs bg-amber-500/20 rounded px-1 py-0.5">
                        {rootCause.keyword}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Affected Pods Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
      >
        <Card className="border-none soft-shadow glass-panel">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Affected Pods</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {investigateLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : pods.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                No affected pods identified.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Pod</th>
                      <th className="px-4 py-3 font-medium">Namespace</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium w-24">Restarts</th>
                      <th className="px-4 py-3 font-medium">Last Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {pods.map((pod) => {
                      const isSelected =
                        selectedPod?.name === pod.name &&
                        selectedPod?.namespace === pod.namespace;
                      return (
                        <tr
                          key={`${pod.namespace}/${pod.name}`}
                          className={cn(
                            'cursor-pointer transition-colors',
                            isSelected
                              ? 'bg-primary/8 hover:bg-primary/10'
                              : 'hover:bg-muted/40',
                          )}
                          onClick={() => {
                            setSelectedPod(pod);
                            setActiveTab('logs');
                          }}
                        >
                          <td className="px-4 py-3 font-mono text-xs">
                            {pod.phase !== 'Unknown' ? (
                              <Link
                                to={`/pods/${pod.namespace}/${pod.name}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {pod.name}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground" title="Pod no longer exists">
                                {pod.name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{pod.namespace}</td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={cn('text-xs', podStatusClass(pod.phase))}
                            >
                              {pod.reason || pod.phase}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={cn(
                                'font-semibold',
                                pod.restartCount > 0 ? 'text-destructive' : 'text-muted-foreground',
                              )}
                            >
                              {pod.restartCount}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-xs truncate">
                            {pod.errorSnippet ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Tabs: Logs / Events / What Changed */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.15 }}
      >
        <Card className="border-none soft-shadow glass-panel">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader className="pb-0">
              <TabsList className="h-9">
                <TabsTrigger value="logs" className="text-xs px-4">Logs</TabsTrigger>
                <TabsTrigger value="events" className="text-xs px-4">Events</TabsTrigger>
                <TabsTrigger value="changed" className="text-xs px-4">What Changed</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="pt-4">
              <TabsContent value="logs" className="mt-0">
                <LogsTab
                  pod={selectedPod}
                  clusterId={clusterId}
                  effectiveBaseUrl={effectiveBaseUrl}
                />
              </TabsContent>
              <TabsContent value="events" className="mt-0">
                <EventsTab
                  namespaces={affectedNamespaces}
                  clusterId={clusterId}
                  effectiveBaseUrl={effectiveBaseUrl}
                />
              </TabsContent>
              <TabsContent value="changed" className="mt-0">
                <WhatChangedTab
                  namespaces={affectedNamespaces}
                  clusterId={clusterId}
                  effectiveBaseUrl={effectiveBaseUrl}
                />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </motion.div>
    </PageLayout>
  );
}
