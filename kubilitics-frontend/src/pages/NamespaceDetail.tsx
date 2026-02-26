import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Folder, Clock, Download, Trash2, Box, Globe, Settings, Layers, Package, Database, Shield, Activity, Loader2, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  SectionCard,
  MetadataCard,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

interface NamespaceResource extends KubernetesResource {
  spec?: {
    finalizers?: string[];
  };
  status?: {
    phase?: string;
  };
}

export default function NamespaceDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [activeTab, setActiveTab] = useState('overview');

  const { resource: ns, isLoading, error: resourceError, age, yaml, isConnected: resourceConnected, refetch } = useResourceDetail<NamespaceResource>(
    'namespaces',
    name ?? undefined,
    undefined,
    {} as NamespaceResource
  );
  const { events } = useResourceEvents('Namespace', name ?? undefined, name ?? undefined);
  const deleteNamespace = useDeleteK8sResource('namespaces');
  const updateNamespace = useUpdateK8sResource('namespaces');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const nsName = ns?.metadata?.name ?? name ?? '';
  const labels = ns?.metadata?.labels || {};
  const annotations = ns?.metadata?.annotations || {};
  const phase = ns?.status?.phase || 'Active';
  const finalizers = ns?.spec?.finalizers || [];
  const status: ResourceStatus = phase === 'Active' ? 'Healthy' : phase === 'Terminating' ? 'Warning' : 'Unknown';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nsName || 'namespace'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, nsName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(ns, `${nsName || 'namespace'}.json`);
    toast.success('JSON downloaded');
  }, [ns, nsName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!nsName) return;
    try {
      await updateNamespace.mutateAsync({ name: nsName, yaml: newYaml });
      toast.success('Namespace updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update Namespace');
      throw e;
    }
  };

  const podsList = useK8sResourceList<KubernetesResource>('pods', nsName, { enabled: !!nsName && isConnected, limit: 5000 });
  const deploymentsList = useK8sResourceList<KubernetesResource>('deployments', nsName, { enabled: !!nsName && isConnected, limit: 500 });
  const servicesList = useK8sResourceList<KubernetesResource>('services', nsName, { enabled: !!nsName && isConnected, limit: 500 });
  const configMapsList = useK8sResourceList<KubernetesResource>('configmaps', nsName, { enabled: !!nsName && isConnected, limit: 500 });
  const secretsList = useK8sResourceList<KubernetesResource>('secrets', nsName, { enabled: !!nsName && isConnected, limit: 500 });
  const resourceQuotasList = useK8sResourceList<KubernetesResource>('resourcequotas', nsName, { enabled: !!nsName && isConnected, limit: 100 });

  const resourceCounts = useMemo(() => {
    if (!isConnected || !nsName) return { pods: '–', deployments: '–', services: '–', configmaps: '–', secrets: '–' };
    const pods = podsList.data?.items?.length ?? '–';
    const deployments = deploymentsList.data?.items?.length ?? '–';
    const services = servicesList.data?.items?.length ?? '–';
    const configmaps = configMapsList.data?.items?.length ?? '–';
    const secrets = secretsList.data?.items?.length ?? '–';
    return { pods, deployments, services, configmaps, secrets };
  }, [isConnected, nsName, podsList.data?.items?.length, deploymentsList.data?.items?.length, servicesList.data?.items?.length, configMapsList.data?.items?.length, secretsList.data?.items?.length]);

  const resourceQuotas = useMemo(() => resourceQuotasList.data?.items ?? [], [resourceQuotasList.data?.items]);
  const hasQuota = resourceQuotas.length > 0;


  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && (resourceError || !ns?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Folder className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Namespace not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No namespace named "${name}".` : 'Missing namespace name.'}</p>
        <Button variant="outline" onClick={() => navigate('/namespaces')}>Back to Namespaces</Button>
      </div>
    );
  }

  const statusCards = [
    { label: 'Status', value: phase, icon: Box, iconColor: (phase === 'Active' ? 'success' : 'warning') as any },
    { label: 'Pods', value: String(resourceCounts.pods), icon: Package, iconColor: 'primary' as any },
    { label: 'Deployments', value: String(resourceCounts.deployments), icon: Layers, iconColor: 'info' as any },
    { label: 'Services', value: String(resourceCounts.services), icon: Globe, iconColor: 'success' as any },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as any },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard icon={Folder} title="Namespace Info" tooltip="Phase, finalizers, labels, annotations">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Phase</p>
                  <Badge variant={phase === 'Active' ? 'default' : 'secondary'}>{phase}</Badge>
                </div>
                <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
                <div><p className="text-muted-foreground mb-1">Finalizers</p><p>{finalizers.length ? finalizers.join(', ') : 'None'}</p></div>
                <div><p className="text-muted-foreground mb-1">Labels</p><p>{Object.keys(labels).length} labels</p></div>
                <div><p className="text-muted-foreground mb-1">Annotations</p><p>{Object.keys(annotations).length} annotations</p></div>
              </div>
            </SectionCard>
            <MetadataCard title="Labels" items={labels} variant="badges" />
            <SectionCard icon={Package} title="Resource Summary" tooltip="Counts of resources in this namespace" className="lg:col-span-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Pods', value: resourceCounts.pods, icon: Package, path: '/pods' },
                  { label: 'Deployments', value: resourceCounts.deployments, icon: Layers, path: '/deployments' },
                  { label: 'Services', value: resourceCounts.services, icon: Globe, path: '/services' },
                  { label: 'ConfigMaps', value: resourceCounts.configmaps, icon: Database, path: '/configmaps' },
                  { label: 'Secrets', value: resourceCounts.secrets, icon: Shield, path: '/secrets' },
                ].map(({ label, value, icon: Icon, path }) => (
                  <div
                    key={label}
                    className="p-4 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => navigate(`${path}?namespace=${encodeURIComponent(nsName)}`)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <p className="text-2xl font-bold">{value}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      ),
    },
    {
      id: 'quotas',
      label: 'Quota Status',
      content: (
        <div className="space-y-6">
          {!hasQuota ? (
            <p className="text-muted-foreground">No resource quotas in this namespace.</p>
          ) : (
            resourceQuotas.map((rq: KubernetesResource) => (
              <Card key={rq.metadata?.uid}>
                <CardHeader>
                  <CardTitle className="text-base">Resource Quota: {rq.metadata?.name}</CardTitle>
                  <CardDescription>Resource usage limits for this namespace</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono bg-muted/50 p-4 rounded-lg overflow-auto">
                    {JSON.stringify((rq as any).status ?? (rq as any).spec ?? {}, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={nsName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="namespaces"
          resourceKind="Namespace"
          initialSelectedResources={[nsName]}
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
          kind={normalizeKindForTopology('Namespace')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="Namespace"
          sourceResourceName={ns?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export Namespace definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export Namespace as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete Namespace', description: 'Remove namespace and all resources', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Namespace"
        resourceIcon={Folder}
        name={nsName}
        status={status}
        backLink="/namespaces"
        backLabel="Namespaces"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {age}
            <span className="mx-2">•</span>
            <Badge variant={phase === 'Active' ? 'default' : 'secondary'}>{phase}</Badge>
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
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
        resourceType="Namespace"
        resourceName={nsName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteNamespace.mutateAsync({ name, namespace: undefined });
            navigate('/namespaces');
          } else {
            toast.success(`Namespace ${nsName} deleted`);
            navigate('/namespaces');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
