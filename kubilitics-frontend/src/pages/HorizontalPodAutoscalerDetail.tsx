import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Scale, Clock, Download, Trash2, TrendingUp, TrendingDown, Server, Cpu, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  MetadataCard,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents, type EventInfo } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology, getDetailPath } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface HPAResource extends KubernetesResource {
  spec?: {
    scaleTargetRef?: { kind?: string; name?: string; apiVersion?: string };
    minReplicas?: number;
    maxReplicas?: number;
    metrics?: Array<{
      type?: string;
      resource?: { name?: string; target?: { type?: string; averageUtilization?: number } };
    }>;
  };
  status?: {
    currentReplicas?: number;
    desiredReplicas?: number;
    currentMetrics?: Array<{
      resource?: { name?: string; current?: { averageUtilization?: number } };
    }>;
    lastScaleTime?: string;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

/** Parse scaling-related events into direction, old→new, timestamp. */
function parseScalingEvents(events: EventInfo[]): Array<{ direction: 'up' | 'down'; from: number | null; to: number; time: string; reason: string; message: string }> {
  const scaling: Array<{ direction: 'up' | 'down'; from: number | null; to: number; time: string; reason: string; message: string }> = [];
  const scaleRe = /scale|replica|size|rescale/i;
  const fromToRe = /(?:from|:)\s*(\d+)\s*(?:to|->|→)\s*(\d+)/i;
  const arrowRe = /(\d+)\s*(?:->|→)\s*(\d+)/;
  const newSizeRe = /new size:\s*(\d+)/i;
  for (const e of events) {
    if (!scaleRe.test(e.reason) && !scaleRe.test(e.message)) continue;
    const fromTo = e.message.match(fromToRe) ?? e.message.match(arrowRe);
    const newSize = e.message.match(newSizeRe);
    const isUp = /up|increase|expand|above/i.test(e.reason) || /up|increase|above/i.test(e.message);
    if (fromTo) {
      const from = parseInt(fromTo[1], 10);
      const to = parseInt(fromTo[2], 10);
      scaling.push({
        direction: to >= from ? 'up' : 'down',
        from,
        to,
        time: e.time,
        reason: e.reason,
        message: e.message,
      });
    } else if (newSize) {
      const to = parseInt(newSize[1], 10);
      scaling.push({
        direction: isUp ? 'up' : 'down',
        from: null,
        to,
        time: e.time,
        reason: e.reason,
        message: e.message,
      });
    }
  }
  return scaling;
}

export default function HorizontalPodAutoscalerDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<HPAResource>(
    'horizontalpodautoscalers',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as HPAResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('HorizontalPodAutoscaler', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('horizontalpodautoscalers');

  const hpaName = resource?.metadata?.name ?? name ?? '';
  const hpaNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const ref = resource?.spec?.scaleTargetRef;
  const targetKind = ref?.kind ?? '–';
  const targetName = ref?.name ?? '–';
  const minReplicas = resource?.spec?.minReplicas ?? 1;
  const maxReplicas = resource?.spec?.maxReplicas ?? 1;
  const currentReplicas = resource?.status?.currentReplicas ?? 0;
  const desiredReplicas = resource?.status?.desiredReplicas ?? currentReplicas;
  const metrics = resource?.spec?.metrics ?? [];
  const currentMetrics = resource?.status?.currentMetrics ?? [];
  const conditions = resource?.status?.conditions ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const cpuTarget = metrics.find((m) => m.resource?.name === 'cpu')?.resource?.target?.averageUtilization;
  const cpuCurrent = currentMetrics.find((m) => m.resource?.name === 'cpu')?.resource?.current?.averageUtilization;

  const scalingEvents = useMemo(() => parseScalingEvents(events), [events]);

  const currentMetricsWithTarget = useMemo(() => {
    return currentMetrics.map((cm) => {
      const name = cm.resource?.name ?? 'resource';
      const current = cm.resource?.current?.averageUtilization;
      const target = metrics.find((m) => m.resource?.name === name)?.resource?.target?.averageUtilization;
      return { name, current, target };
    });
  }, [currentMetrics, metrics]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${hpaName || 'hpa'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, hpaName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${hpaName || 'hpa'}.json`);
    toast.success('JSON downloaded');
  }, [resource, hpaName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Current / Desired', value: `${currentReplicas} / ${desiredReplicas}`, icon: Server, iconColor: 'primary' as const },
    { label: 'Min / Max', value: `${minReplicas} / ${maxReplicas}`, icon: Scale, iconColor: 'muted' as const },
    { label: 'CPU', value: cpuCurrent != null && cpuTarget != null ? `${cpuCurrent}% / ${cpuTarget}%` : '–', icon: Cpu, iconColor: 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const targetLink = () => getDetailPath(targetKind, targetName, hpaNamespace) ?? '#';

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && (resourceError || !resource?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Scale className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">HPA not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No HPA "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/horizontalpodautoscalers')}>Back to HPAs</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Scale Target</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-muted-foreground text-sm mb-1">Reference</p>
                {targetName !== '–' ? (
                  <Button variant="link" className="p-0 h-auto font-mono text-primary" onClick={() => navigate(targetLink())}>{targetKind}/{targetName}</Button>
                ) : (
                  <p className="font-mono">–</p>
                )}
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">Min {minReplicas}</span>
                  <span className="font-mono font-medium text-foreground">Current {currentReplicas}</span>
                  <span className="font-mono">Max {maxReplicas}</span>
                </div>
                <div className="relative h-8 rounded-full bg-muted overflow-visible" role="slider" aria-valuemin={minReplicas} aria-valuemax={maxReplicas} aria-valuenow={currentReplicas}>
                  <div
                    className="absolute top-1/2 h-10 w-1 rounded-full bg-primary shadow-md border-2 border-background"
                    style={{
                      left: maxReplicas > minReplicas
                        ? `${Math.min(100, Math.max(0, ((currentReplicas - minReplicas) / (maxReplicas - minReplicas)) * 100))}%`
                        : '50%',
                      transform: 'translateY(-50%) translateX(-50%)',
                    }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">Desired replicas: <span className="font-mono font-medium">{desiredReplicas}</span></p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Current metrics</CardTitle></CardHeader>
            <CardContent>
              {currentMetricsWithTarget.length === 0 ? (
                <p className="text-muted-foreground text-sm">No current metrics reported yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="font-medium">Metric</TableHead>
                      <TableHead className="font-medium">Current</TableHead>
                      <TableHead className="font-medium">Target</TableHead>
                      <TableHead className="font-medium min-w-[120px]">Usage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentMetricsWithTarget.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium capitalize">{row.name}</TableCell>
                        <TableCell className="font-mono">{row.current != null ? `${row.current}%` : '–'}</TableCell>
                        <TableCell className="font-mono">{row.target != null ? `${row.target}%` : '–'}</TableCell>
                        <TableCell>
                          {row.target != null && row.current != null ? (
                            <Progress value={Math.min(Math.round((row.current / row.target) * 100), 100)} className="h-2" />
                          ) : (
                            <span className="text-muted-foreground text-sm">–</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
            <CardContent>
              {conditions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No conditions.</p>
              ) : (
                <div className="space-y-2">
                  {conditions.map((c, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <span className="font-medium">{c.type}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.status === 'True' ? 'default' : 'secondary'}>{c.status}</Badge>
                        {c.reason && <span className="text-sm text-muted-foreground">{c.reason}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <MetadataCard title="Labels" items={labels} variant="badges" />
          {Object.keys(annotations).length > 0 && <MetadataCard title="Annotations" items={annotations} variant="badges" />}
        </div>
      ),
    },
    {
      id: 'events',
      label: 'Events',
      content: (
        <div className="space-y-6">
          {scalingEvents.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Scaling events</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {scalingEvents.map((ev, i) => (
                    <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                      {ev.direction === 'up' ? (
                        <TrendingUp className="h-5 w-5 text-[hsl(142,76%,36%)] shrink-0" aria-hidden />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-sm font-medium">
                          {ev.from != null ? `${ev.from} → ${ev.to}` : `→ ${ev.to}`}
                        </span>
                        <span className="text-muted-foreground text-sm ml-2">{ev.time}</span>
                        {ev.reason && <Badge variant="secondary" className="ml-2 text-xs">{ev.reason}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <EventsSection events={events} />
        </div>
      ),
    },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={hpaName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="horizontalpodautoscalers"
          resourceKind="HorizontalPodAutoscaler"
          namespace={namespace}
          initialSelectedResources={namespace && name ? [`${namespace}/${name}`] : [name || '']}
          clusterId={clusterId ?? undefined}
          backendBaseUrl={baseUrl ?? ''}
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
          kind={normalizeKindForTopology('HorizontalPodAutoscaler')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="HorizontalPodAutoscaler"
          sourceResourceName={resource?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: TrendingUp, label: 'Edit Scaling', description: 'Modify min/max replicas and metrics', onClick: () => toast.info('Edit not implemented') },
            { icon: Download, label: 'Download YAML', description: 'Export HPA definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export HPA as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete HPA', description: 'Remove this autoscaler', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = currentReplicas === desiredReplicas ? 'Healthy' : 'Warning';

  return (
    <>
      <ResourceDetailLayout
        resourceType="HorizontalPodAutoscaler"
        resourceIcon={Scale}
        name={hpaName}
        namespace={hpaNamespace}
        status={status}
        backLink="/horizontalpodautoscalers"
        backLabel="HPAs"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: TrendingUp, variant: 'outline', onClick: () => toast.info('Edit not implemented') },
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
        resourceType="HorizontalPodAutoscaler"
        resourceName={hpaName}
        namespace={hpaNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: hpaName, namespace: hpaNamespace });
          navigate('/horizontalpodautoscalers');
        }}
        requireNameConfirmation
      />
    </>
  );
}
