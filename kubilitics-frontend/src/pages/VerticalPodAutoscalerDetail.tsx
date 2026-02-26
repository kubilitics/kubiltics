import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Scale, Clock, Download, Trash2, Cpu, MemoryStick, TrendingUp, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  MetadataCard,
  ResourceTopologyView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface VPAResource extends KubernetesResource {
  spec?: {
    targetRef?: { kind?: string; name?: string; apiVersion?: string };
    updatePolicy?: { updateMode?: string };
    resourcePolicy?: { containerPolicies?: Array<{ containerName?: string }> };
  };
  status?: {
    recommendation?: {
      containerRecommendations?: Array<{
        containerName?: string;
        lowerBound?: Record<string, string>;
        target?: Record<string, string>;
        upperBound?: Record<string, string>;
        uncappedTarget?: Record<string, string>;
      }>;
    };
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export default function VerticalPodAutoscalerDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<VPAResource>(
    'verticalpodautoscalers',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as VPAResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VerticalPodAutoscaler', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('verticalpodautoscalers');

  const vpaName = resource?.metadata?.name ?? name ?? '';
  const vpaNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const ref = resource?.spec?.targetRef;
  const targetKind = ref?.kind ?? '–';
  const targetName = ref?.name ?? '–';
  const updateMode = resource?.spec?.updatePolicy?.updateMode ?? 'Auto';
  const recommendations = resource?.status?.recommendation?.containerRecommendations ?? [];
  const conditions = resource?.status?.conditions ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vpaName || 'vpa'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, vpaName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${vpaName || 'vpa'}.json`);
    toast.success('JSON downloaded');
  }, [resource, vpaName]);

  const firstRec = recommendations[0];
  const statusCards = [
    { label: 'Update Mode', value: updateMode, icon: TrendingUp, iconColor: 'primary' as const },
    { label: 'Target CPU', value: firstRec?.target?.cpu ?? '–', icon: Cpu, iconColor: 'info' as const },
    { label: 'Target Memory', value: firstRec?.target?.memory ?? '–', icon: MemoryStick, iconColor: 'success' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const targetLink = () => {
    const kind = (targetKind || '').toLowerCase();
    if (kind === 'deployment') return `/deployments/${vpaNamespace}/${targetName}`;
    if (kind === 'statefulset') return `/statefulsets/${vpaNamespace}/${targetName}`;
    return '#';
  };

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
        <p className="text-lg font-medium">VPA not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No VPA "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/verticalpodautoscalers')}>Back to VPAs</Button>
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
            <CardHeader><CardTitle className="text-base">Target Reference</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-muted-foreground text-sm mb-1">Reference</p>
                {targetName !== '–' ? (
                  <Button variant="link" className="p-0 h-auto font-mono text-primary" onClick={() => navigate(targetLink())}>{targetKind}/{targetName}</Button>
                ) : (
                  <p className="font-mono">–</p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-muted-foreground text-sm mb-1">Update Mode</p>
                <Badge variant={updateMode === 'Auto' ? 'default' : 'secondary'}>{updateMode}</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Recommendations</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {recommendations.length === 0 ? (
                <p className="text-muted-foreground text-sm">No recommendations yet.</p>
              ) : (
                recommendations.map((cr) => (
                  <div key={cr.containerName ?? 'default'} className="space-y-3">
                    <p className="font-medium">{cr.containerName ?? 'default'}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-xs text-muted-foreground">CPU Target</p>
                        <p className="font-mono">{cr.target?.cpu ?? '–'}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-xs text-muted-foreground">Memory Target</p>
                        <p className="font-mono">{cr.target?.memory ?? '–'}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-xs text-muted-foreground">CPU Range</p>
                        <p className="font-mono text-sm">{cr.lowerBound?.cpu ?? '–'} – {cr.upperBound?.cpu ?? '–'}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-xs text-muted-foreground">Memory Range</p>
                        <p className="font-mono text-sm">{cr.lowerBound?.memory ?? '–'} – {cr.upperBound?.memory ?? '–'}</p>
                      </div>
                    </div>
                  </div>
                ))
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
      id: 'recommendations',
      label: 'Recommendations',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Container Recommendations</CardTitle></CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No recommendations available.</p>
            ) : (
              <div className="space-y-4">
                {recommendations.map((cr) => (
                  <div key={cr.containerName ?? 'default'} className="p-4 rounded-lg border bg-muted/30 space-y-2">
                    <p className="font-medium">{cr.containerName ?? 'default'}</p>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Lower:</span> <span className="font-mono">{cr.lowerBound?.cpu ?? '–'} / {cr.lowerBound?.memory ?? '–'}</span></div>
                      <div><span className="text-muted-foreground">Target:</span> <span className="font-mono">{cr.target?.cpu ?? '–'} / {cr.target?.memory ?? '–'}</span></div>
                      <div><span className="text-muted-foreground">Upper:</span> <span className="font-mono">{cr.upperBound?.cpu ?? '–'} / {cr.upperBound?.memory ?? '–'}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={vpaName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="verticalpodautoscalers"
          resourceKind="VerticalPodAutoscaler"
          namespace={vpaNamespace}
          initialSelectedResources={vpaNamespace && vpaName ? [`${vpaNamespace}/${vpaName}`] : [vpaName]}
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
          kind={normalizeKindForTopology('VerticalPodAutoscaler')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="VerticalPodAutoscaler"
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
            { icon: TrendingUp, label: 'Edit VPA', description: 'Modify resource policies', onClick: () => toast.info('Edit not implemented') },
            { icon: Download, label: 'Download YAML', description: 'Export VPA definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export VPA as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete VPA', description: 'Remove this autoscaler', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status = (recommendations.length > 0 ? 'Healthy' : 'Progressing') as ResourceStatus;

  return (
    <>
      <ResourceDetailLayout
        resourceType="VerticalPodAutoscaler"
        resourceIcon={Scale}
        name={vpaName}
        namespace={vpaNamespace}
        status={status}
        backLink="/verticalpodautoscalers"
        backLabel="VPAs"
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
        resourceType="VerticalPodAutoscaler"
        resourceName={vpaName}
        namespace={vpaNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: vpaName, namespace: vpaNamespace });
          navigate('/verticalpodautoscalers');
        }}
        requireNameConfirmation
      />
    </>
  );
}
