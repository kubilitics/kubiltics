import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Route, Clock, Download, Trash2, Star, Server, Activity, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResourceDetailLayout,
  MetadataCard,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  SectionCard,
  DetailRow,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
  type EventInfo,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface IngressClassResource extends KubernetesResource {
  spec?: {
    controller: string;
    parameters?: { apiGroup?: string; kind?: string; name?: string };
  };
}



export default function IngressClassDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const clusterId = useActiveClusterId();

  const { resource: icResource, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<IngressClassResource>(
    'ingressclasses',
    name,
    undefined,
    undefined
  );
  const resourceEvents = useResourceEvents('IngressClass', '', name ?? undefined);
  const events = resourceEvents.events;

  const deleteIngressClass = useDeleteK8sResource('ingressclasses');
  const updateIngressClass = useUpdateK8sResource('ingressclasses');

  const ingressesList = useK8sResourceList<KubernetesResource & { spec?: { ingressClassName?: string } }>('ingresses', undefined, { enabled: !!name });
  const ingressesUsingThisClass = useMemo(() => {
    if (!name || !ingressesList.data?.items?.length) return [];
    return (ingressesList.data.items as Array<{ metadata?: { name?: string; namespace?: string }; spec?: { ingressClassName?: string } }>).filter(
      (ing) => ing.spec?.ingressClassName === name
    );
  }, [name, ingressesList.data?.items]);

  const icName = icResource.metadata?.name || '';
  const controller = icResource.spec?.controller ?? '—';
  const isDefault = icResource.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true';
  const params = icResource.spec?.parameters;
  const labels = icResource.metadata?.labels ?? {};
  const status: ResourceStatus = 'Healthy';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${icName || 'ingressclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, icName]);

  const handleDownloadJson = useCallback(() => {
    if (!icResource) return;
    downloadResourceJson(icResource, `${icName || 'ingressclass'}.json`);
    toast.success('JSON downloaded');
  }, [icResource, icName]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name) {
      toast.error('Connect cluster to update IngressClass');
      throw new Error('Not connected');
    }
    try {
      await updateIngressClass.mutateAsync({ name, yaml: newYaml });
      toast.success('IngressClass updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, updateIngressClass, refetch]);

  const handleSetDefault = () => {
    toast.info('Set as default: patch annotation ingressclass.kubernetes.io/is-default-class');
  };


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

  if (!icResource?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'IngressClass not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/ingressclasses')}>
              Back to IngressClasses
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Controller', value: controller, icon: Server, iconColor: 'primary' as const },
    { label: 'Default', value: isDefault ? 'Yes' : 'No', icon: Star, iconColor: isDefault ? 'success' as const : 'muted' as const },
    { label: 'Ingresses Using', value: String(ingressesUsingThisClass.length), icon: Route, iconColor: 'info' as const },
    { label: 'Parameters', value: params ? `${params.kind ?? ''} ${params.name ?? ''}`.trim() || '—' : '—', icon: Server, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Ingress Class Info" icon={Route}>
            <DetailRow label="Controller" value={<span className="font-mono">{controller}</span>} />
            <DetailRow label="Default Class" value={<Badge variant={isDefault ? 'default' : 'secondary'}>{isDefault ? 'Yes' : 'No'}</Badge>} />
            <DetailRow label="Age" value={age} />
          </SectionCard>
          {params && (
            <Card>
              <CardHeader><CardTitle className="text-base">Parameters</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <DetailRow label="API Group" value={params.apiGroup ?? '—'} />
                  <DetailRow label="Kind" value={params.kind ?? '—'} />
                  <DetailRow label="Name" value={params.name ?? '—'} />
                </div>
              </CardContent>
            </Card>
          )}
          <MetadataCard title="Labels" items={labels} variant="badges" />
        </div>
      ),
    },
    {
      id: 'ingresses',
      label: 'Ingresses Using This Class',
      content: (
        <SectionCard title="Ingresses using this class" icon={Route}>
          {ingressesUsingThisClass.length === 0 ? (
            <p className="text-muted-foreground text-sm">No ingresses use this class.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Name</th><th className="text-left p-2">Namespace</th><th className="text-left p-2">Actions</th></tr></thead>
                <tbody>
                  {ingressesUsingThisClass.map((ing) => (
                    <tr key={`${ing.metadata?.namespace}-${ing.metadata?.name}`} className="border-b">
                      <td className="p-2 font-mono">{ing.metadata?.name}</td>
                      <td className="p-2">{ing.metadata?.namespace}</td>
                      <td className="p-2"><Link to={`/ingresses/${ing.metadata?.namespace}/${ing.metadata?.name}`} className="text-primary text-sm hover:underline">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ),
    },
    { id: 'controller', label: 'Controller Details', content: <SectionCard title="Controller details" icon={Server}><p className="text-muted-foreground text-sm">Controller: {controller}. Version placeholder.</p></SectionCard> },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'metrics', label: 'Metrics', content: <SectionCard title="Metrics" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder until metrics pipeline.</p></SectionCard> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={icName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="ingressclasses"
          resourceKind="IngressClass"
          initialSelectedResources={[icName]}
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
          kind={normalizeKindForTopology('IngressClass')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="IngressClass"
          sourceResourceName={icResource?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Star, label: 'Set as Default', description: 'Make this the default ingress class', onClick: handleSetDefault },
          { icon: Download, label: 'Download YAML', description: 'Export IngressClass definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export IngressClass as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete IngressClass', description: 'Remove this ingress class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="IngressClass"
        resourceIcon={Route}
        name={icName}
        status={status}
        backLink="/ingressclasses"
        backLabel="Ingress Classes"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {age}
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
            {isDefault && <><span className="mx-2">•</span><Star className="h-3.5 w-3.5 inline" />Default</>}
          </span>
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
        resourceType="IngressClass"
        resourceName={icName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteIngressClass.mutateAsync({ name });
            navigate('/ingressclasses');
          } else {
            toast.success(`IngressClass ${icName} deleted (demo mode)`);
            navigate('/ingressclasses');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
