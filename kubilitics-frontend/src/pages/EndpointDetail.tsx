import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Network, Clock, Server, Download, Globe, Trash2, Activity, GitCompare } from 'lucide-react';
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
  DetailRow,
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

interface EndpointsResource extends KubernetesResource {
  subsets?: Array<{
    addresses?: Array<{ ip: string; hostname?: string; nodeName?: string; targetRef?: { kind: string; namespace: string; name: string } }>;
    notReadyAddresses?: Array<{ ip: string; targetRef?: { kind: string; name: string; namespace: string } }>;
    ports?: Array<{ name?: string; port: number; protocol?: string }>;
  }>;
}


export default function EndpointDetail() {
  const { namespace: nsParam, name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const namespace = nsParam ?? '';
  const baseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();

  const { resource: ep, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<EndpointsResource>(
    'endpoints',
    name,
    nsParam,
    undefined
  );
  const resourceEvents = useResourceEvents('Endpoints', namespace, name ?? undefined);
  const events = resourceEvents.events;

  const deleteEndpoints = useDeleteK8sResource('endpoints');
  const updateEndpoints = useUpdateK8sResource('endpoints');

  const epName = ep.metadata?.name || '';
  const epNamespace = ep.metadata?.namespace || '';
  const subsets = ep.subsets ?? [];
  const readyAddresses = subsets.reduce((acc, s) => acc + (s.addresses?.length ?? 0), 0);
  const notReadyAddresses = subsets.reduce((acc, s) => acc + (s.notReadyAddresses?.length ?? 0), 0);
  const totalAddresses = readyAddresses + notReadyAddresses;
  const status: ResourceStatus = readyAddresses > 0 ? 'Healthy' : 'Pending';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${epName || 'endpoints'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, epName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(ep, `${epName || 'endpoints'}.json`);
    toast.success('JSON downloaded');
  }, [ep, epName]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update Endpoints');
      throw new Error('Not connected');
    }
    try {
      await updateEndpoints.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('Endpoints updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, namespace, updateEndpoints, refetch]);


  const yamlVersions: YamlVersion[] = useMemo(() => [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }], [yaml]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!ep?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'Endpoints not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/endpoints')}>
              Back to Endpoints
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Ready', value: String(readyAddresses), icon: Server, iconColor: 'success' as const },
    { label: 'Not Ready', value: String(notReadyAddresses), icon: Server, iconColor: notReadyAddresses > 0 ? 'warning' as const : 'muted' as const },
    { label: 'Total', value: String(totalAddresses), icon: Network, iconColor: 'info' as const },
    { label: 'Subsets', value: String(subsets.length), icon: Network, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <SectionCard title="Metadata & Subsets" icon={Network}>
            <DetailRow label="Service (same name)" value={epName ? <Link to={`/services/${namespace}/${epName}`} className="text-primary hover:underline">{epName}</Link> : '—'} />
            <DetailRow label="Age" value={age} />
          </SectionCard>
          {subsets.map((subset, idx) => (
            <Card key={idx}>
              <CardHeader><CardTitle className="text-base">Subset {idx + 1}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Ports</h4>
                  <div className="flex gap-2">
                    {(subset.ports ?? []).map((port) => (
                      <Badge key={port.name || port.port} variant="secondary" className="font-mono">
                        {port.name ?? 'port'}: {port.port}/{port.protocol ?? 'TCP'}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Addresses</h4>
                  <div className="space-y-2">
                    {(subset.addresses ?? []).map((addr) => (
                      <div key={addr.ip} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm">{addr.ip}</span>
                          {addr.nodeName && <Badge variant="outline">{addr.nodeName}</Badge>}
                        </div>
                        <span className="text-sm text-muted-foreground">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : addr.targetRef?.name ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ),
    },
    {
      id: 'addresses',
      label: 'Address Details',
      content: (
        <SectionCard title="Address details" icon={Server}>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">IP</th><th className="text-left p-2">Hostname</th><th className="text-left p-2">Node</th><th className="text-left p-2">Target Pod</th><th className="text-left p-2">Ready</th></tr></thead>
              <tbody>
                {subsets.flatMap((s) => (s.addresses ?? []).map((addr) => (
                  <tr key={addr.ip} className="border-b">
                    <td className="p-2 font-mono">{addr.ip}</td>
                    <td className="p-2">{addr.hostname ?? '—'}</td>
                    <td className="p-2">{addr.nodeName ?? '—'}</td>
                    <td className="p-2">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : '—'}</td>
                    <td className="p-2"><Badge variant="default" className="bg-green-600">Ready</Badge></td>
                  </tr>
                )))}
                {subsets.flatMap((s) => (s.notReadyAddresses ?? []).map((addr) => (
                  <tr key={addr.ip} className="border-b">
                    <td className="p-2 font-mono">{addr.ip}</td>
                    <td className="p-2">—</td>
                    <td className="p-2">—</td>
                    <td className="p-2">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : '—'}</td>
                    <td className="p-2"><Badge variant="secondary">Not Ready</Badge></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ),
    },
    { id: 'health', label: 'Health Monitoring', content: <SectionCard title="Health monitoring" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder for health check results.</p></SectionCard> },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'metrics', label: 'Metrics', content: <SectionCard title="Metrics" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder until metrics pipeline.</p></SectionCard> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={epName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="endpoints"
          resourceKind="Endpoints"
          namespace={epNamespace}
          initialSelectedResources={epNamespace && epName ? [`${epNamespace}/${epName}`] : [epName]}
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
          kind={normalizeKindForTopology('Endpoints')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Endpoints"
          sourceResourceName={ep?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Globe, label: 'View Service', description: 'Navigate to the related service', onClick: () => navigate(`/services/${epNamespace}/${epName}`) },
          { icon: Download, label: 'Download YAML', description: 'Export Endpoints definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Endpoints as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Endpoints', description: 'Remove this endpoints resource', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Endpoints"
        resourceIcon={Network}
        name={epName}
        namespace={epNamespace}
        status={status}
        backLink="/endpoints"
        backLabel="Endpoints"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'View Service', icon: Globe, variant: 'outline', onClick: () => navigate(`/services/${epNamespace}/${epName}`) },
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
        resourceType="Endpoints"
        resourceName={epName}
        namespace={epNamespace}
        onConfirm={async () => {
          if (isConnected && name && epNamespace) {
            await deleteEndpoints.mutateAsync({ name, namespace: epNamespace });
            navigate('/endpoints');
          } else {
            toast.success(`Endpoints ${epName} deleted (demo mode)`);
            navigate('/endpoints');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
