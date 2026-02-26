import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Network, Clock, Download, Globe, Server, Trash2, Activity, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResourceDetailLayout,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  SectionCard,
  MetadataCard,
  ResourceTopologyView,
  type ResourceStatus,
  type EventInfo,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface EndpointSliceResource extends KubernetesResource {
  addressType?: string;
  endpoints?: Array<{
    addresses?: string[];
    conditions?: { ready?: boolean; serving?: boolean; terminating?: boolean };
    targetRef?: { kind: string; name: string; namespace: string };
    zone?: string;
  }>;
  ports?: Array<{ name?: string; port?: number; protocol?: string }>;
}


export default function EndpointSliceDetail() {
  const { namespace: nsParam, name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const namespace = nsParam ?? '';
  const baseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();

  const { resource: es, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<EndpointSliceResource>(
    'endpointslices',
    name,
    nsParam,
    undefined
  );
  const resourceEvents = useResourceEvents('EndpointSlice', namespace, name ?? undefined);
  const events = resourceEvents.events;

  const deleteEndpointSlice = useDeleteK8sResource('endpointslices');
  const updateEndpointSlice = useUpdateK8sResource('endpointslices');

  const esName = es.metadata?.name || '';
  const esNamespace = es.metadata?.namespace || '';
  const addressType = es.addressType ?? '—';
  const endpointsList = es.endpoints ?? [];
  const portsList = es.ports ?? [];
  const labels = es.metadata?.labels ?? {};
  const serviceName = labels['kubernetes.io/service-name'];
  const status: ResourceStatus = endpointsList.some((e) => e.conditions?.ready) ? 'Healthy' : 'Pending';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${esName || 'endpointslice'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, esName]);

  const handleDownloadJson = useCallback(() => {
    if (!es) return;
    downloadResourceJson(es, `${esName || 'endpointslice'}.json`);
    toast.success('JSON downloaded');
  }, [es, esName]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update EndpointSlice');
      throw new Error('Not connected');
    }
    try {
      await updateEndpointSlice.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('EndpointSlice updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, namespace, updateEndpointSlice, refetch]);


  const yamlVersions: YamlVersion[] = useMemo(() => [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }], [yaml]);

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

  if (!es?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'EndpointSlice not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/endpointslices')}>
              Back to EndpointSlices
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Address Type', value: addressType, icon: Network, iconColor: 'primary' as const },
    { label: 'Endpoints', value: String(endpointsList.length), icon: Server, iconColor: 'success' as const },
    { label: 'Ports', value: String(portsList.length), icon: Globe, iconColor: 'info' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="EndpointSlice info" icon={Network}>
            <p className="text-sm text-muted-foreground mb-2">Address type: {addressType}</p>
            {serviceName && <p className="text-sm">Service: <Link to={`/services/${namespace}/${serviceName}`} className="text-primary hover:underline">{serviceName}</Link></p>}
            <MetadataCard title="Labels" items={labels} variant="badges" />
          </SectionCard>
          <Card>
            <CardHeader><CardTitle className="text-base">Ports</CardTitle></CardHeader>
            <CardContent>
              {portsList.length === 0 ? <p className="text-muted-foreground text-sm">No ports</p> : portsList.map((port, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-2">
                  <div>
                    <p className="font-medium">{port.name || 'unnamed'}</p>
                    <p className="text-sm text-muted-foreground">{port.protocol ?? 'TCP'}</p>
                  </div>
                  <Badge variant="secondary" className="font-mono">{port.port}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Endpoints</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {endpointsList.map((ep, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono">{(ep.addresses ?? []).join(', ')}</span>
                      <Badge variant={ep.conditions?.ready ? 'default' : 'secondary'} className={ep.conditions?.ready ? 'bg-green-600' : ''}>{ep.conditions?.ready ? 'Ready' : 'Not Ready'}</Badge>
                    </div>
                    {ep.targetRef?.kind === 'Pod' && (
                      <Link to={`/pods/${ep.targetRef.namespace}/${ep.targetRef.name}`} className="text-xs text-primary hover:underline">
                        → Pod/{ep.targetRef.name}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: 'endpoints',
      label: 'Endpoint Details',
      content: (
        <SectionCard title="Endpoint details" icon={Server}>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Addresses</th><th className="text-left p-2">Ready</th><th className="text-left p-2">Serving</th><th className="text-left p-2">Terminating</th><th className="text-left p-2">Pod</th></tr></thead>
              <tbody>
                {endpointsList.map((ep, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-mono">{(ep.addresses ?? []).join(', ')}</td>
                    <td className="p-2">{ep.conditions?.ready != null ? (ep.conditions.ready ? 'Yes' : 'No') : '—'}</td>
                    <td className="p-2">{ep.conditions?.serving != null ? (ep.conditions.serving ? 'Yes' : 'No') : '—'}</td>
                    <td className="p-2">{ep.conditions?.terminating != null ? (ep.conditions.terminating ? 'Yes' : 'No') : '—'}</td>
                    <td className="p-2">{ep.targetRef?.kind === 'Pod' ? <Link to={`/pods/${ep.targetRef.namespace}/${ep.targetRef.name}`} className="text-primary hover:underline">{ep.targetRef.name}</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ),
    },
    {
      id: 'zones',
      label: 'Zone Topology',
      content: (
        <SectionCard title="Zone topology" icon={Globe}>
          {endpointsList.some((e) => e.zone) ? (
            <div className="space-y-2">
              {Array.from(new Set(endpointsList.map((e) => e.zone).filter(Boolean))).map((zone) => (
                <div key={zone} className="p-3 rounded-lg bg-muted/50">
                  <p className="font-medium">{zone}</p>
                  <p className="text-sm text-muted-foreground">{endpointsList.filter((e) => e.zone === zone).length} endpoint(s)</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No zone information.</p>
          )}
        </SectionCard>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'metrics', label: 'Metrics', content: <SectionCard title="Metrics" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder until metrics pipeline.</p></SectionCard> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={esName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="endpointslices"
          resourceKind="EndpointSlice"
          namespace={esNamespace}
          initialSelectedResources={esNamespace && esName ? [`${esNamespace}/${esName}`] : [esName]}
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
          kind={normalizeKindForTopology('EndpointSlice')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="EndpointSlice"
          sourceResourceName={es?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Globe, label: 'View Service', description: 'Navigate to the related service', onClick: () => serviceName && navigate(`/services/${namespace}/${serviceName}`) },
          { icon: Download, label: 'Download YAML', description: 'Export EndpointSlice definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export EndpointSlice as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete EndpointSlice', description: 'Remove this endpoint slice', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="EndpointSlice"
        resourceIcon={Network}
        name={esName}
        namespace={esNamespace}
        status={status}
        backLink="/endpointslices"
        backLabel="Endpoint Slices"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
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
        resourceType="EndpointSlice"
        resourceName={esName}
        namespace={esNamespace}
        onConfirm={async () => {
          if (isConnected && name && esNamespace) {
            await deleteEndpointSlice.mutateAsync({ name, namespace: esNamespace });
            navigate('/endpointslices');
          } else {
            toast.success(`EndpointSlice ${esName} deleted (demo mode)`);
            navigate('/endpointslices');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
