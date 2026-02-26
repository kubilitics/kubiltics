import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileCode, Clock, Layers, Download, Trash2, Package, GitCompare, Network } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  MetadataCard,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface CRDResource extends KubernetesResource {
  spec?: {
    group: string;
    names: { kind: string; plural: string; singular: string; shortNames?: string[] };
    scope: string;
    versions: Array<{ name: string; served: boolean; storage: boolean }>;
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason: string; message?: string }>;
  };
}

export default function CustomResourceDefinitionDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: crd, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<CRDResource>(
    'customresourcedefinitions',
    name ?? undefined,
    undefined,
    undefined as unknown as CRDResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('CustomResourceDefinition', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('customresourcedefinitions');

  const crdName = crd?.metadata?.name ?? name ?? '';
  const spec = crd?.spec;
  const status = crd?.status;
  const group = spec?.group ?? '-';
  const scope = spec?.scope ?? '-';
  const kind = spec?.names?.kind ?? '-';
  const plural = spec?.names?.plural ?? '-';
  const singular = spec?.names?.singular ?? '-';
  const shortNames = spec?.names?.shortNames ?? [];
  const versions = spec?.versions ?? [];
  const conditions = status?.conditions ?? [];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${crdName || 'crd'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, crdName]);

  const handleDownloadJson = useCallback(() => {
    if (!crd) return;
    downloadResourceJson(crd, `${crdName || 'crd'}.json`);
    toast.success('JSON downloaded');
  }, [crd, crdName]);

  const statusCards = [
    { label: 'Group', value: group, icon: Package, iconColor: 'primary' as const },
    { label: 'Versions', value: versions.length, icon: Layers, iconColor: 'info' as const },
    { label: 'Scope', value: scope, icon: FileCode, iconColor: 'success' as const },
    { label: 'Age', value: age || '-', icon: Clock, iconColor: 'muted' as const },
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

  if (isConnected && (resourceError || !crd?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <FileCode className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">CRD not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No CRD "${name}".` : 'Missing name.'}</p>
        <Button variant="outline" onClick={() => navigate('/customresourcedefinitions')}>Back to CRDs</Button>
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
            <CardHeader><CardTitle className="text-base">CRD Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Group</p>
                  <p className="font-mono">{group}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Kind</p>
                  <Badge variant="default">{kind}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Plural</p>
                  <p className="font-mono">{plural}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Singular</p>
                  <p className="font-mono">{singular}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Scope</p>
                  <Badge variant="outline">{scope}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Short Names</p>
                  <div className="flex gap-1 flex-wrap">
                    {shortNames.map((sn) => (
                      <Badge key={sn} variant="secondary" className="font-mono text-xs">{sn}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Versions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {versions.map((ver) => (
                  <div key={ver.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Badge variant={ver.storage ? 'default' : 'secondary'}>{ver.name}</Badge>
                      {ver.storage && <Badge variant="outline" className="text-xs">Storage</Badge>}
                    </div>
                    <Badge variant={ver.served ? 'default' : 'secondary'}>
                      {ver.served ? 'Served' : 'Not Served'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {conditions.map((condition) => (
                  <div key={condition.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Badge variant={condition.status === 'True' ? 'default' : 'secondary'}>
                      {condition.type}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{condition.reason}</span>
                  </div>
                ))}
                {conditions.length === 0 && <p className="text-sm text-muted-foreground">No conditions</p>}
              </div>
            </CardContent>
          </Card>
          <MetadataCard title="Labels" items={crd?.metadata?.labels ?? {}} variant="badges" />
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={crdName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="customresourcedefinitions"
          resourceKind="CustomResourceDefinition"
          initialSelectedResources={[crdName]}
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
          kind={normalizeKindForTopology('CustomResourceDefinition')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="CustomResourceDefinition"
          sourceResourceName={crdName}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export CRD definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export CRD as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete CRD', description: 'Remove this custom resource definition', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  const statusLabel: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="CustomResourceDefinition"
        resourceIcon={FileCode}
        name={crdName}
        status={statusLabel}
        backLink="/customresourcedefinitions"
        backLabel="Custom Resource Definitions"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
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
        resourceType="CustomResourceDefinition"
        resourceName={crdName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: crdName });
          navigate('/customresourcedefinitions');
        }}
        requireNameConfirmation
      />
    </>
  );
}
