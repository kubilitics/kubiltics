import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, Clock, CheckCircle, AlertTriangle, Download, Trash2, Network, Server, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface ComponentStatusResource extends KubernetesResource {
  conditions?: Array<{
    type: string;
    status: string;
    message?: string;
    error?: string;
  }>;
}

export default function ComponentStatusDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const clusterId = useActiveClusterId();

  const { resource: cs, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<ComponentStatusResource>(
    'componentstatuses',
    name,
    undefined, // cluster-scoped resource
    {} as ComponentStatusResource
  );
  const { events } = useResourceEvents('ComponentStatus', undefined, name ?? undefined);
  const deleteComponentStatus = useDeleteK8sResource('componentstatuses');

  const csName = cs?.metadata?.name || '';
  const conditions = cs?.conditions ?? [];
  const isHealthy = conditions.some(c => c.type === 'Healthy' && c.status === 'True');
  const status: ResourceStatus = isHealthy ? 'Healthy' : 'Unhealthy';

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csName || 'componentstatus'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, csName]);

  const handleDownloadJson = useCallback(() => {
    if (!cs?.metadata?.name) return;
    downloadResourceJson(cs, `${csName || 'componentstatus'}.json`);
    toast.success('JSON downloaded');
  }, [cs, csName]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!cs?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'ComponentStatus not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/componentstatuses')}>
              Back to Component Statuses
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Status', value: isHealthy ? 'Healthy' : 'Unhealthy', icon: isHealthy ? CheckCircle : AlertTriangle, iconColor: isHealthy ? 'success' as const : 'error' as const },
    { label: 'Component', value: csName, icon: Server, iconColor: 'primary' as const },
    { label: 'Conditions', value: conditions.length, icon: Activity, iconColor: 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata metadata={cs.metadata ?? { name: csName }} />
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Component Info</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-full ${isHealthy ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {isHealthy ? (
                      <CheckCircle className="h-8 w-8 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">{csName}</h3>
                    <p className="text-muted-foreground">
                      {isHealthy ? 'Component is healthy and responding normally' : 'Component is experiencing issues'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
              <CardContent>
                {conditions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No conditions reported.</p>
                ) : (
                  <div className="space-y-3">
                    {conditions.map((condition, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant={condition.status === 'True' ? 'default' : 'destructive'}>
                            {condition.type}
                          </Badge>
                          <Badge variant="outline">{condition.status}</Badge>
                        </div>
                        {condition.message && (
                          <p className="text-sm font-mono text-muted-foreground break-all">
                            {condition.message}
                          </p>
                        )}
                        {condition.error && (
                          <p className="text-sm text-destructive">
                            Error: {condition.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: Server, content: <YamlViewer yaml={yaml} resourceName={csName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="componentstatuses"
          resourceKind="ComponentStatus"
          initialSelectedResources={[csName]}
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
          kind={normalizeKindForTopology('ComponentStatus')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="ComponentStatus"
          sourceResourceName={csName ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export ComponentStatus definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export ComponentStatus as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete', description: 'Remove this component status', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ComponentStatus"
        resourceIcon={Activity}
        name={csName}
        status={status}
        backLink="/componentstatuses"
        backLabel="Component Statuses"
        createdLabel={age}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
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
        resourceType="ComponentStatus"
        resourceName={csName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteComponentStatus.mutateAsync({ name });
            navigate('/componentstatuses');
          } else {
            toast.error('Connect to a cluster to delete resources');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
