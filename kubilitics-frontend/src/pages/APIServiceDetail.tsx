import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileCode, Clock, Server, Download, Trash2, CheckCircle, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
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

interface APIServiceResource extends KubernetesResource {
  metadata: KubernetesResource['metadata'] & {
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
  spec?: {
    service?: { namespace?: string; name?: string };
    group?: string;
    version?: string;
    insecureSkipTLSVerify?: boolean;
    groupPriorityMinimum?: number;
    versionPriority?: number;
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}

export default function APIServiceDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: api, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<APIServiceResource>(
    'apiservices',
    name ?? undefined,
    undefined,
    undefined as unknown as APIServiceResource
  );
  const { events } = useResourceEvents('APIService', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('apiservices');

  const apiName = api?.metadata?.name ?? name ?? '';
  const condition = api?.status?.conditions?.find((c) => c.type === 'Available');
  const available = condition?.status === 'True';
  const status: ResourceStatus = available ? 'Healthy' : 'Failed';
  const serviceRef = api?.spec?.service
    ? `${api.spec.service.namespace}/${api.spec.service.name}`
    : 'Local';
  const group = api?.spec?.group ?? '–';
  const version = api?.spec?.version ?? '–';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${apiName || 'apiservice'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, apiName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(api, `${apiName || 'apiservice'}.json`);
    toast.success('JSON downloaded');
  }, [api, apiName]);

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

  if (isConnected && (resourceError || !api?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <FileCode className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">APIService not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No APIService named "${name}".` : 'Missing name.'}</p>
        <Button variant="outline" onClick={() => navigate('/apiservices')}>Back to API Services</Button>
      </div>
    );
  }

  const statusCards = [
    { label: 'Available', value: available ? 'Yes' : 'No', icon: CheckCircle, iconColor: (available ? 'success' : 'error') as 'success' | 'error' },
    { label: 'Group / Version', value: `${group} / ${version}`, icon: FileCode, iconColor: 'primary' as const },
    { label: 'Service', value: serviceRef, icon: Server, iconColor: 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const conditions = api?.status?.conditions ?? [];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata
            metadata={api?.metadata ?? { name: apiName }}
            createdLabel={age}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard icon={FileCode} title="API Service Info" tooltip="Group, version, service reference">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground mb-1">Group</p><p className="font-mono">{group}</p></div>
                <div><p className="text-muted-foreground mb-1">Version</p><Badge variant="secondary">{version}</Badge></div>
                <div><p className="text-muted-foreground mb-1">Service</p><p>{serviceRef}</p></div>
                <div><p className="text-muted-foreground mb-1">Insecure Skip TLS</p><p>{api?.spec?.insecureSkipTLSVerify ? 'Yes' : 'No'}</p></div>
                <div><p className="text-muted-foreground mb-1">Group Priority Minimum</p><p className="font-mono">{api?.spec?.groupPriorityMinimum ?? '–'}</p></div>
                <div><p className="text-muted-foreground mb-1">Version Priority</p><p className="font-mono">{api?.spec?.versionPriority ?? '–'}</p></div>
              </div>
            </SectionCard>
            <SectionCard icon={FileCode} title="Conditions" tooltip="Status conditions" className="lg:col-span-2">
              {conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conditions.</p>
              ) : (
                <div className="space-y-3">
                  {conditions.map((c) => (
                    <div key={c.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <Badge variant={c.status === 'True' ? 'default' : 'secondary'}>{c.type}</Badge>
                        <span className="text-sm text-muted-foreground">{c.reason ?? '–'}</span>
                      </div>
                      <p className="text-sm">{c.message ?? '–'}</p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={apiName} editable={false} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="apiservices"
          resourceKind="APIService"
          initialSelectedResources={[apiName]}
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
          kind={normalizeKindForTopology('APIService')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="APIService"
          sourceResourceName={api?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export API Service definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export API Service as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete API Service', description: 'Remove this API service', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="APIService"
        resourceIcon={FileCode}
        name={apiName}
        status={status}
        backLink="/apiservices"
        backLabel="API Services"
        createdLabel={age}
        createdAt={api?.metadata?.creationTimestamp}
        headerMetadata={
          isConnected ? (
            <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="text-xs">Live</Badge>
            </span>
          ) : undefined
        }
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
        resourceType="APIService"
        resourceName={apiName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteResource.mutateAsync({ name });
            navigate('/apiservices');
          } else {
            toast.success(`APIService ${apiName} deleted`);
            navigate('/apiservices');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
