import { useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { diagnoseWorkload } from '@/lib/diagnose';
import type { DiagnoseAction } from '@/lib/diagnose/types';
import { DiagnosePanel } from '@/components/diagnose/DiagnosePanel';
import {
  Container,
  Clock,
  Server,
  RotateCcw,
  RefreshCw,
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
  BarChart2,
  Settings,
  Radio,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/sonner';
import {
  GenericResourceDetail,
  ContainersSection,
  LabelList,
  AnnotationList,
  MetricsDashboard,
  ScaleDialog,
  RolloutActionsDialog,
  SectionCard,
  DetailRow,
  MultiPodLogViewer,
  DetailPodTable,
  WorkloadLogsTab,
  type CustomTab,
  type ResourceContext,
  type ContainerInfo,
  type PodTarget,
} from '@/components/resources';
import { PodTerminal } from '@/components/resources/PodTerminal';
import { useK8sResourceList, usePatchK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useMutationPolling } from '@/hooks/useMutationPolling';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDeploymentRolloutHistory, postDeploymentRollback, BackendApiError, getResourceEvents, getDeploymentMetrics, type RolloutHistoryRevision, type BackendEvent } from '@/services/backendApiClient';
import { notifyError, notifySuccess } from '@/lib/notificationFormatter';

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

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ resource: deployment }: ResourceContext<DeploymentResource>) {
  const { namespace } = useParams();
  const [, setSearchParams] = useSearchParams();
  const desired = deployment.spec?.replicas || 0;
  const ready = deployment.status?.readyReplicas || 0;
  const updated = deployment.status?.updatedReplicas || 0;
  const available = deployment.status?.availableReplicas || 0;
  const conditions = deployment.status?.conditions || [];

  const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
  const labelSelector = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',');
  const { data: childPodsList } = useK8sResourceList<KubernetesResource>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace && !!labelSelector, staleTime: 30000 },
  );
  const childPods = (childPodsList?.items ?? []).filter((pod) => {
    const podLabels = pod.metadata?.labels ?? {};
    return Object.entries(matchLabels).every(([k, v]) => podLabels[k] === v);
  });

  const diagnosis = useMemo(
    () => diagnoseWorkload({ ...deployment, kind: 'Deployment' } as unknown as Parameters<typeof diagnoseWorkload>[0], { relatedPods: childPods }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployment?.metadata?.uid, deployment?.metadata?.resourceVersion, childPods],
  );

  const handleDiagnoseAction = (action: DiagnoseAction) => {
    if (action.type === 'jump_to_tab') setSearchParams({ tab: action.tab });
  };

  return (
    <div className="space-y-6">
      <DiagnosePanel diagnosis={diagnosis} resource={deployment} onAction={handleDiagnoseAction} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Info} title="Deployment Information" tooltip={<p className="text-xs text-muted-foreground">Configuration and status details</p>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Strategy" value={<Badge variant="outline">{deployment.spec?.strategy?.type || 'RollingUpdate'}</Badge>} />
            <DetailRow label="Min Ready Seconds" value={`${deployment.spec?.minReadySeconds || 0}s`} />
            <DetailRow label="Revision History Limit" value={String(deployment.spec?.revisionHistoryLimit || 10)} />
            <DetailRow label="Progress Deadline" value={`${deployment.spec?.progressDeadlineSeconds || 600}s`} />
            {deployment.spec?.strategy?.rollingUpdate && (
              <>
                <DetailRow label="Max Surge" value={String(deployment.spec.strategy.rollingUpdate.maxSurge || '25%')} />
                <DetailRow label="Max Unavailable" value={String(deployment.spec.strategy.rollingUpdate.maxUnavailable || '25%')} />
              </>
            )}
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

      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={deployment.metadata?.labels || {}} />
          <LabelList labels={deployment.spec?.selector?.matchLabels || {}} title="Selector" />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={deployment.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DeploymentDetail() {
  const { namespace, name } = useParams();
  const clusterId = useActiveClusterId();
  const queryClient = useQueryClient();
  const { isConnected } = useConnectionStatus();
  const [, setSearchParams] = useSearchParams();

  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [showRolloutDialog, setShowRolloutDialog] = useState(false);
  const [selectedTerminalPod, setSelectedTerminalPod] = useState<string>('');
  const [selectedTerminalContainer, setSelectedTerminalContainer] = useState<string>('');

  const { refetchInterval: fastPollInterval, isFastPolling, triggerFastPolling } = useMutationPolling({
    fastInterval: 2000,
    fastDuration: 30000,
    normalInterval: 60000,
  });

  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const patchDeployment = usePatchK8sResource('deployments');

  // Rollout history
  const rolloutHistoryQuery = useQuery({
    queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name],
    queryFn: () => getDeploymentRolloutHistory(backendBaseUrl!, clusterId!, namespace!, name!),
    enabled: !!(isBackendConfigured && clusterId && namespace && name),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const rolloutRevisions = useMemo(() => rolloutHistoryQuery.data?.revisions ?? [], [rolloutHistoryQuery.data?.revisions]);

  // Pods
  const { data: podsList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; labels?: Record<string, string>; ownerReferences?: Array<{ kind?: string; name?: string }> }; status?: { phase?: string }; spec?: { nodeName?: string } }>(
    'pods',
    namespace ?? undefined,
    { enabled: !!namespace, refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 30000 }
  );

  // HPA / VPA
  const { data: hpaList } = useK8sResourceList<HpaListItem>(
    'horizontalpodautoscalers',
    namespace ?? undefined,
    { enabled: !!namespace && !!name }
  );
  const { data: vpaList } = useK8sResourceList<VpaListItem>(
    'verticalpodautoscalers',
    namespace ?? undefined,
    { enabled: !!namespace && !!name }
  );

  // Scaling events
  const scalingEventsQuery = useQuery({
    queryKey: ['backend', 'resource-events', clusterId, namespace, 'Deployment', name],
    queryFn: () => getResourceEvents(backendBaseUrl!, clusterId!, namespace!, 'Deployment', name!, 100),
    enabled: !!(isBackendConfigured && backendBaseUrl && clusterId && namespace && name),
    staleTime: 30_000,
  });

  // Deployment metrics (for pod table)
  const deploymentMetricsQuery = useQuery({
    queryKey: ['backend', 'deployment-metrics', clusterId, namespace, name],
    queryFn: () => getDeploymentMetrics(backendBaseUrl!, clusterId!, namespace!, name!),
    enabled: !!(isBackendConfigured && backendBaseUrl && clusterId && namespace && name),
    staleTime: 15_000,
  });

  // Mutation handlers
  const handleScale = useCallback(async (replicas: number) => {
    if (!isConnected) { toast.error('Connect cluster to scale deployment'); return; }
    if (!name || !namespace) return;
    if (!isBackendConfigured) { toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.'); return; }
    if (!clusterId) { toast.error('Select a cluster from the cluster list to perform this action.'); return; }
    try {
      await patchDeployment.mutateAsync({ name, namespace, patch: { spec: { replicas } } });
      notifySuccess({ action: 'scale', resourceType: 'deployments', resourceName: name, namespace }, { description: `New replica count: ${replicas}. Watch the Pods tab for lifecycle updates.` });
      triggerFastPolling();
      setSearchParams({ tab: 'pods' });
      queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
    } catch (err: unknown) {
      notifyError(err, { action: 'scale', resourceType: 'deployments', resourceName: name, namespace });
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, patchDeployment, triggerFastPolling, setSearchParams, queryClient, isBackendConfigured]);

  const handleRestart = useCallback(async () => {
    if (!isConnected) { toast.error('Connect cluster to restart deployment'); return; }
    if (!name || !namespace) return;
    if (!isBackendConfigured) { toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.'); return; }
    if (!clusterId) { toast.error('Select a cluster from the cluster list to perform this action.'); return; }
    try {
      const patch = { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } };
      await patchDeployment.mutateAsync({ name, namespace, patch });
      notifySuccess({ action: 'restart', resourceType: 'deployments', resourceName: name, namespace });
      triggerFastPolling();
      setSearchParams({ tab: 'pods' });
      queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
    } catch (err: unknown) {
      notifyError(err, { action: 'restart', resourceType: 'deployments', resourceName: name, namespace });
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, patchDeployment, triggerFastPolling, setSearchParams, queryClient, isBackendConfigured]);

  const handleRollback = useCallback(async (revision: number) => {
    if (!isConnected) { toast.error('Connect cluster to rollback deployment'); return; }
    if (!name || !namespace) return;
    if (!isBackendConfigured) { toast.error('Connect to Kubilitics backend in Settings to scale, restart, or rollback.'); return; }
    if (!clusterId) { toast.error('Select a cluster from the cluster list to perform this action.'); return; }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postDeploymentRollback(backendBase, clusterId, namespace, name, { revision });
      notifySuccess({ action: 'rollback', resourceType: 'deployments', resourceName: name, namespace });
      triggerFastPolling();
      setSearchParams({ tab: 'pods' });
      queryClient.invalidateQueries({ queryKey: ['backend', 'deployment-rollout-history', clusterId, namespace, name] });
    } catch (err: unknown) {
      notifyError(err, { action: 'rollback', resourceType: 'deployments', resourceName: name, namespace });
      throw err;
    }
  }, [isConnected, name, namespace, clusterId, triggerFastPolling, setSearchParams, queryClient, isBackendConfigured]);

  const customTabs: CustomTab[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      render: (ctx) => <OverviewTab {...ctx} />,
    },
    {
      id: 'rollout-history',
      label: 'Rollout History',
      render: (ctx) => {
        const deployment = ctx.resource;
        const revisionLabel = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 'current';
        const currentRevisionStr = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'];
        const desired = deployment.spec?.replicas || 0;
        const ready = deployment.status?.readyReplicas || 0;
        const available = deployment.status?.availableReplicas || 0;

        return (
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
                  To change replicas or revert a scale change, use the <strong>Scale deployment</strong> button or the scaling controls in the <strong>Pods</strong> tab.
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
              ) : !isBackendConfigured || !clusterId ? (
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
                                <td className="p-3 font-mono text-xs align-top truncate max-w-[240px]" title={rev.name}>{rev.name}</td>
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
        );
      },
    },
    {
      id: 'pods',
      label: 'Pods',
      icon: Box,
      badge: (ctx) => ctx.resource?.status?.readyReplicas ?? ctx.resource?.spec?.replicas ?? undefined,
      render: (ctx) => {
        const deployment = ctx.resource;
        const deploymentName = deployment?.metadata?.name ?? name;
        const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
        const deploymentPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.keys(matchLabels).length > 0 &&
            Object.entries(matchLabels).every(([k, v]) => labels[k] === v);
        });
        const desired = deployment.spec?.replicas || 0;
        const ready = deployment.status?.readyReplicas || 0;
        const available = deployment.status?.availableReplicas || 0;

        const hpasForDeployment = (hpaList?.items ?? []).filter((h) => h.spec?.scaleTargetRef?.kind === 'Deployment' && h.spec?.scaleTargetRef?.name === deploymentName);
        const vpasForDeployment = (vpaList?.items ?? []).filter((v) => v.spec?.targetRef?.kind === 'Deployment' && v.spec?.targetRef?.name === deploymentName);

        const scalingHistoryEvents = (() => {
          const events = scalingEventsQuery.data ?? [];
          const scalingReasons = ['ScalingReplicaSet', 'HorizontalPodAutoscaler', 'Scale'];
          return events
            .filter((e) => scalingReasons.some((r) => (e.reason ?? '').includes(r)) || (e.message ?? '').toLowerCase().includes('scale'))
            .slice(0, 50)
            .sort((a, b) => new Date(b.last_timestamp || b.first_timestamp).getTime() - new Date(a.last_timestamp || a.first_timestamp).getTime());
        })();

        return (
          <div className="space-y-6">
            {/* Scaling controls */}
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
                  {!isBackendConfigured || !clusterId ? (
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

            {/* Pods table */}
            <SectionCard icon={Box} title="Pods" tooltip={<p className="text-xs text-muted-foreground">Pods managed by this deployment</p>}>
              <DetailPodTable pods={deploymentPods} namespace={namespace ?? ''} />
            </SectionCard>
          </div>
        );
      },
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Layers,
      render: (ctx) => {
        const containers: ContainerInfo[] = (ctx.resource.spec?.template?.spec?.containers || []).map(c => ({
          name: c.name, image: c.image, ready: true, restartCount: 0, state: 'running', ports: c.ports || [], resources: c.resources || {},
        }));
        return <ContainersSection containers={containers} />;
      },
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: FileText,
      render: (ctx) => {
        const deployment = ctx.resource;
        const deploymentName = deployment?.metadata?.name ?? name;
        const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
        const deploymentPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.keys(matchLabels).length > 0 &&
            Object.entries(matchLabels).every(([k, v]) => labels[k] === v);
        });
        const templateContainers = (deployment.spec?.template?.spec?.containers || []).map(c => c.name);

        return (
          <WorkloadLogsTab
            pods={deploymentPods}
            namespace={namespace ?? undefined}
            kindLabel="Deployment"
            templateContainers={templateContainers}
          />
        );
      },
    },
    {
      id: 'stream-logs',
      label: 'Stream Logs',
      icon: Radio,
      render: (ctx) => {
        const deployment = ctx.resource;
        const deploymentName = deployment?.metadata?.name ?? name;
        const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
        const deploymentPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.keys(matchLabels).length > 0 &&
            Object.entries(matchLabels).every(([k, v]) => labels[k] === v);
        });

        const podTargets: PodTarget[] = deploymentPods.map((pod) => {
          const containers = ((pod.spec as Record<string, unknown> | undefined)?.containers as Array<{ name: string }> | undefined)?.map((c) => c.name)
            ?? (deployment.spec?.template?.spec?.containers || []).map((c) => c.name);
          return {
            name: pod.metadata?.name ?? '',
            namespace: namespace ?? '',
            containers,
          };
        }).filter((p) => p.name);

        return (
          <SectionCard icon={Radio} title="Multi-Pod Log Stream" tooltip={<p className="text-xs text-muted-foreground">Stern-like streaming from all deployment pods simultaneously</p>}>
            {podTargets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods available. Deploy replicas to stream logs from multiple pods.</p>
            ) : (
              <MultiPodLogViewer pods={podTargets} />
            )}
          </SectionCard>
        );
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Terminal,
      render: (ctx) => {
        const deployment = ctx.resource;
        const deploymentName = deployment?.metadata?.name ?? name;
        const matchLabels = deployment.spec?.selector?.matchLabels ?? {};
        const deploymentPods = (podsList?.items ?? []).filter((pod) => {
          const labels = pod.metadata?.labels ?? {};
          return Object.keys(matchLabels).length > 0 &&
            Object.entries(matchLabels).every(([k, v]) => labels[k] === v);
        });
        const containers: ContainerInfo[] = (deployment.spec?.template?.spec?.containers || []).map(c => ({
          name: c.name, image: c.image, ready: true, restartCount: 0, state: 'running', ports: c.ports || [], resources: c.resources || {},
        }));
        const firstPodName = deploymentPods[0]?.metadata?.name ?? '';
        const terminalPod = selectedTerminalPod || firstPodName;
        const terminalPodContainers = (deploymentPods.find((p) => p.metadata?.name === terminalPod) as { spec?: { containers?: Array<{ name: string }> } } | undefined)?.spec?.containers?.map((c) => c.name) ?? containers.map((c) => c.name);

        return (
          <SectionCard icon={Terminal} title="Terminal" tooltip={<p className="text-xs text-muted-foreground">Exec into deployment pods</p>}>
            {deploymentPods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods available. Select a deployment with running pods to open a terminal.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-2">
                    <Label>Pod</Label>
                    <Select value={terminalPod} onValueChange={setSelectedTerminalPod}>
                      <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select pod" /></SelectTrigger>
                      <SelectContent>
                        {deploymentPods.map((p) => (<SelectItem key={p.metadata?.name} value={p.metadata?.name ?? ''}>{p.metadata?.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Container</Label>
                    <Select value={selectedTerminalContainer || terminalPodContainers[0]} onValueChange={setSelectedTerminalContainer}>
                      <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select container" /></SelectTrigger>
                      <SelectContent>
                        {terminalPodContainers.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <PodTerminal
                  key={`${terminalPod}-${selectedTerminalContainer || terminalPodContainers[0]}`}
                  podName={terminalPod}
                  namespace={namespace ?? undefined}
                  containerName={selectedTerminalContainer || terminalPodContainers[0]}
                  containers={terminalPodContainers}
                  onContainerChange={setSelectedTerminalContainer}
                />
              </div>
            )}
          </SectionCard>
        );
      },
    },
    {
      id: 'metrics',
      label: 'Metrics',
      icon: BarChart2,
      render: () => <MetricsDashboard resourceType="deployment" resourceName={name} namespace={namespace} clusterId={clusterId} />,
    },
  ];

  const rolloutRevisionsForDialog = useMemo(() => {
    const currentRevisionStr = undefined; // Will be derived from resource in extraDialogs
    return rolloutRevisions.map((r) => ({
      revision: r.revision,
      createdAt: r.creationTimestamp ? new Date(r.creationTimestamp).toLocaleString() : '—',
      current: false, // Will be set properly per resource
      changeReason: r.changeCause || undefined,
      image: r.images?.[0],
    }));
  }, [rolloutRevisions]);

  return (
    <>
      <GenericResourceDetail<DeploymentResource>
        resourceType="deployments"
        kind="Deployment"
        pluralLabel="Deployments"
        listPath="/deployments"
        resourceIcon={Container}
        loadingCardCount={6}
        detailOptions={{ refetchInterval: fastPollInterval, staleTime: isFastPolling ? 1000 : 5000 }}
        deriveStatus={(d) => d.status?.readyReplicas === d.spec?.replicas ? 'Running' : d.status?.readyReplicas ? 'Pending' : 'Failed'}
        customTabs={customTabs}
        buildStatusCards={(ctx) => {
          const deployment = ctx.resource;
          const desired = deployment.spec?.replicas || 0;
          const ready = deployment.status?.readyReplicas || 0;
          const updated = deployment.status?.updatedReplicas || 0;
          const available = deployment.status?.availableReplicas || 0;
          const revisionLabel = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 'current';
          const strategyLabel = deployment.spec?.strategy?.type === 'Recreate'
            ? 'Recreate'
            : `RollingUpdate (${deployment.spec?.strategy?.rollingUpdate?.maxSurge ?? '25%'} / ${deployment.spec?.strategy?.rollingUpdate?.maxUnavailable ?? '25%'})`;
          return [
            { label: 'Ready', value: `${ready}/${desired}`, icon: Server, iconColor: ready === desired ? 'success' as const : 'warning' as const },
            { label: 'Up-to-Date', value: updated, icon: RefreshCw, iconColor: 'info' as const },
            { label: 'Available', value: available, icon: CheckCircle2, iconColor: 'success' as const },
            { label: 'Revision', value: revisionLabel, icon: History, iconColor: 'primary' as const },
            { label: 'Strategy', value: strategyLabel, icon: Layers, iconColor: 'primary' as const },
            { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'primary' as const },
          ];
        }}
        headerMetadata={(ctx) => (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            {ctx.resource.spec?.strategy?.type || 'RollingUpdate'}
            {ctx.isConnected && !isFastPolling && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
            {isFastPolling && (
              <Badge className="ml-2 text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Syncing
              </Badge>
            )}
          </span>
        )}
        headerActions={() => [
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
          { label: 'Restart', icon: RotateCcw, variant: 'outline', onClick: () => setShowRolloutDialog(true), className: 'press-effect' },
        ]}
        extraActionItems={() => [
          { icon: Scale, label: 'Scale Deployment', description: 'Adjust the number of replicas', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
          { icon: RotateCcw, label: 'Rollout Restart', description: 'Trigger a rolling restart', onClick: () => setShowRolloutDialog(true), className: 'press-effect' },
          { icon: History, label: 'Rollout History', description: 'View and manage revisions', onClick: () => setShowRolloutDialog(true), className: 'press-effect' },
        ]}
        extraDialogs={(ctx) => {
          const currentRevisionStr = ctx.resource.metadata?.annotations?.['deployment.kubernetes.io/revision'];
          const revisionsForDialog = rolloutRevisions.map((r) => ({
            revision: r.revision,
            createdAt: r.creationTimestamp ? new Date(r.creationTimestamp).toLocaleString() : '—',
            current: currentRevisionStr != null && String(r.revision) === currentRevisionStr,
            changeReason: r.changeCause || undefined,
            image: r.images?.[0],
          }));
          return (
            <>
              <ScaleDialog
                open={showScaleDialog}
                onOpenChange={setShowScaleDialog}
                resourceType="Deployment"
                resourceName={ctx.name}
                namespace={ctx.namespace}
                currentReplicas={ctx.resource.spec?.replicas || 0}
                onScale={handleScale}
              />
              <RolloutActionsDialog
                open={showRolloutDialog}
                onOpenChange={setShowRolloutDialog}
                resourceType="Deployment"
                resourceName={ctx.name}
                namespace={ctx.namespace}
                revisions={revisionsForDialog}
                onRestart={handleRestart}
                onRollback={handleRollback}
              />
            </>
          );
        }}
      />
    </>
  );
}
