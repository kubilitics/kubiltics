import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Scale, Clock, Cpu, HardDrive, Download, Trash2, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
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
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface LimitRangeItemSpec {
  type: string;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  min?: Record<string, string>;
  max?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
}

interface LimitRangeResource extends KubernetesResource {
  spec?: { limits?: LimitRangeItemSpec[] };
}

export default function LimitRangeDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<LimitRangeResource>(
    'limitranges',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as LimitRangeResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('LimitRange', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('limitranges');
  const updateResource = useUpdateK8sResource('limitranges');

  const lrName = resource?.metadata?.name ?? name ?? '';
  const lrNamespace = resource?.metadata?.namespace ?? namespace ?? '';

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update resource');
      throw new Error('Not connected');
    }
    try {
      await updateResource.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('Resource updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateResource, refetch]);
  const limits = resource?.spec?.limits ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};
  const containerLimit = limits.find((l) => l.type === 'Container');
  const defaultCpu = containerLimit?.default?.cpu ?? containerLimit?.defaultRequest?.cpu ?? '–';
  const defaultMemory = containerLimit?.default?.memory ?? containerLimit?.defaultRequest?.memory ?? '–';
  const maxCpu = containerLimit?.max?.cpu ?? limits.find((l) => l.type === 'Pod')?.max?.cpu ?? '–';

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lrName || 'limitrange'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, lrName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${lrName || 'limitrange'}.json`);
    toast.success('JSON downloaded');
  }, [resource, lrName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Types Covered', value: limits.length, icon: Scale, iconColor: 'primary' as const },
    { label: 'Default CPU', value: defaultCpu, icon: Cpu, iconColor: 'muted' as const },
    { label: 'Default Memory', value: defaultMemory, icon: HardDrive, iconColor: 'muted' as const },
    { label: 'Max CPU', value: maxCpu, icon: Cpu, iconColor: 'info' as const },
  ];

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
        <p className="text-lg font-medium">Limit Range not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No limit range "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/limitranges')}>Back to Limit Ranges</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          {limits.map((limit, idx) => (
            <Card key={idx}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge variant="outline">{limit.type}</Badge>
                  Limits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {limit.default && Object.keys(limit.default).length > 0 && (
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Default</p>
                      <div className="space-y-1 text-sm font-mono">
                        {Object.entries(limit.default).map(([k, v]) => (
                          <p key={k}>{k}: {v}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {limit.defaultRequest && Object.keys(limit.defaultRequest).length > 0 && (
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Default Request</p>
                      <div className="space-y-1 text-sm font-mono">
                        {Object.entries(limit.defaultRequest).map(([k, v]) => (
                          <p key={k}>{k}: {v}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {limit.max && Object.keys(limit.max).length > 0 && (
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Max</p>
                      <div className="space-y-1 text-sm font-mono">
                        {Object.entries(limit.max).map(([k, v]) => (
                          <p key={k}>{k}: {v}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {limit.min && Object.keys(limit.min).length > 0 && (
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Min</p>
                      <div className="space-y-1 text-sm font-mono">
                        {Object.entries(limit.min).map(([k, v]) => (
                          <p key={k}>{k}: {v}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {limit.maxLimitRequestRatio && Object.keys(limit.maxLimitRequestRatio).length > 0 && (
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">Max Limit/Request Ratio</p>
                      <div className="space-y-1 text-sm font-mono">
                        {Object.entries(limit.maxLimitRequestRatio).map(([k, v]) => (
                          <p key={k}>{k}: {v}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {limits.length === 0 && <p className="text-muted-foreground text-sm">No limits defined.</p>}
          <MetadataCard title="Labels" items={labels} variant="badges" />
          {Object.keys(annotations).length > 0 && <MetadataCard title="Annotations" items={annotations} variant="badges" />}
        </div>
      ),
    },
    {
      id: 'limit-details',
      label: 'Limit Details',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Per-Type Limits</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Same as Overview — limits array with default, defaultRequest, min, max per type (Container, Pod, PVC).</p>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={lrName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="limitranges"
          resourceKind="LimitRange"
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
          kind={normalizeKindForTopology('LimitRange')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="LimitRange"
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
            { icon: Download, label: 'Download YAML', description: 'Export LimitRange definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export LimitRange as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete LimitRange', description: 'Remove this limit range', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="LimitRange"
        resourceIcon={Scale}
        name={lrName}
        namespace={lrNamespace}
        status={status}
        backLink="/limitranges"
        backLabel="Limit Ranges"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (tabId === 'overview') next.delete('tab');
            else next.set('tab', tabId);
            return next;
          }, { replace: true });
        }}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="LimitRange"
        resourceName={lrName}
        namespace={lrNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: lrName, namespace: lrNamespace });
          navigate('/limitranges');
        }}
        requireNameConfirmation
      />
    </>
  );
}
