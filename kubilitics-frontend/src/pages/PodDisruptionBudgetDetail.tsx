import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield, Clock, Download, Trash2, Server, AlertTriangle, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  YamlViewer,
  MetadataCard,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface PDBResource extends KubernetesResource {
  spec?: {
    minAvailable?: number | string;
    maxUnavailable?: number | string;
    selector?: { matchLabels?: Record<string, string> };
  };
  status?: {
    currentHealthy?: number;
    desiredHealthy?: number;
    disruptionsAllowed?: number;
    expectedPods?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

export default function PodDisruptionBudgetDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<PDBResource>(
    'poddisruptionbudgets',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as PDBResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('PodDisruptionBudget', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('poddisruptionbudgets');

  const pdbName = resource?.metadata?.name ?? name ?? '';
  const pdbNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const minAvailable = resource?.spec?.minAvailable;
  const maxUnavailable = resource?.spec?.maxUnavailable;
  const selector = resource?.spec?.selector?.matchLabels ?? {};
  const currentHealthy = resource?.status?.currentHealthy ?? 0;
  const desiredHealthy = resource?.status?.desiredHealthy ?? 0;
  const disruptionsAllowed = resource?.status?.disruptionsAllowed ?? 0;
  const expectedPods = resource?.status?.expectedPods ?? 0;
  const conditions = resource?.status?.conditions ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdbName || 'pdb'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pdbName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${pdbName || 'pdb'}.json`);
    toast.success('JSON downloaded');
  }, [resource, pdbName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Min Available', value: minAvailable != null && minAvailable !== '' ? String(minAvailable) : '–', icon: Server, iconColor: 'primary' as const },
    { label: 'Healthy Pods', value: `${currentHealthy}/${expectedPods > 0 ? expectedPods : desiredHealthy}`, icon: Server, iconColor: 'success' as const },
    { label: 'Disruptions Allowed', value: disruptionsAllowed, icon: AlertTriangle, iconColor: disruptionsAllowed > 0 ? 'info' as const : 'warning' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
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
        <Shield className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">PDB not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No PDB "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/poddisruptionbudgets')}>Back to PDBs</Button>
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
            <CardHeader><CardTitle className="text-base">Budget Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-muted-foreground text-sm mb-1">Min Available</p>
                  <p className="text-xl font-bold">{minAvailable != null && minAvailable !== '' ? String(minAvailable) : '–'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-muted-foreground text-sm mb-1">Max Unavailable</p>
                  <p className="text-xl font-bold">{maxUnavailable != null && maxUnavailable !== '' ? String(maxUnavailable) : '–'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Current Status</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xl font-bold">{expectedPods > 0 ? expectedPods : desiredHealthy}</p>
                  <p className="text-xs text-muted-foreground">Expected / Desired</p>
                </div>
                <div className="p-3 rounded-lg bg-[hsl(var(--success))]/10">
                  <p className="text-xl font-bold text-[hsl(var(--success))]">{currentHealthy}</p>
                  <p className="text-xs text-muted-foreground">Healthy</p>
                </div>
                <div className="p-3 rounded-lg bg-primary/10">
                  <p className="text-xl font-bold text-primary">{disruptionsAllowed}</p>
                  <p className="text-xs text-muted-foreground">Allowed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Pod Selector</CardTitle></CardHeader>
            <CardContent>
              {Object.keys(selector).length === 0 ? (
                <p className="text-muted-foreground text-sm">No selector.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(selector).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="font-mono text-xs">{k}={v}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
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
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={pdbName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="poddisruptionbudgets"
          resourceKind="PodDisruptionBudget"
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
          kind={normalizeKindForTopology('PodDisruptionBudget')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="PodDisruptionBudget"
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
            { icon: Download, label: 'Download YAML', description: 'Export PDB definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export PDB as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete PDB', description: 'Remove this disruption budget', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = disruptionsAllowed > 0 || currentHealthy >= desiredHealthy ? 'Healthy' : 'Warning';

  return (
    <>
      <ResourceDetailLayout
        resourceType="PodDisruptionBudget"
        resourceIcon={Shield}
        name={pdbName}
        namespace={pdbNamespace}
        status={status}
        backLink="/poddisruptionbudgets"
        backLabel="PDBs"
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
        resourceType="PodDisruptionBudget"
        resourceName={pdbName}
        namespace={pdbNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: pdbName, namespace: pdbNamespace });
          navigate('/poddisruptionbudgets');
        }}
        requireNameConfirmation
      />
    </>
  );
}
