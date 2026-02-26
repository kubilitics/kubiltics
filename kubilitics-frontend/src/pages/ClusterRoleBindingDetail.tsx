import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Link2, Clock, Download, Trash2, Edit, ShieldCheck, UserCircle, Globe, Network, GitCompare } from 'lucide-react';
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
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface Subject {
  kind: string;
  name: string;
  namespace?: string;
  apiGroup?: string;
}

interface ClusterRoleBindingResource extends KubernetesResource {
  roleRef?: { kind?: string; name?: string; apiGroup?: string };
  subjects?: Subject[];
}

export default function ClusterRoleBindingDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<ClusterRoleBindingResource>(
    'clusterrolebindings',
    name ?? undefined,
    undefined,
    undefined as unknown as ClusterRoleBindingResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ClusterRoleBinding', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('clusterrolebindings');

  const crbName = resource?.metadata?.name ?? name ?? '';
  const roleRef = resource?.roleRef ?? {};
  const subjects = resource?.subjects ?? [];
  const clusterRoleName = roleRef.name ?? '–';
  const subjectKinds = [...new Set(subjects.map((s) => s.kind))];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${crbName || 'clusterrolebinding'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, crbName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(resource, `${crbName || 'clusterrolebinding'}.json`);
    toast.success('JSON downloaded');
  }, [resource, crbName]);

  const statusCards = [
    { label: 'ClusterRole', value: clusterRoleName, icon: ShieldCheck, iconColor: 'primary' as const },
    { label: 'Subject Count', value: subjects.length, icon: UserCircle, iconColor: 'info' as const },
    { label: 'Subject Types', value: subjectKinds.join(', ') || '–', icon: UserCircle, iconColor: 'muted' as const },
    { label: 'Scope', value: 'Cluster-wide', icon: Globe, iconColor: 'muted' as const },
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
        <Link2 className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Cluster Role Binding not found</p>
        <p className="text-sm text-muted-foreground">
          {name ? `No cluster role binding "${name}".` : 'Missing name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/clusterrolebindings')}>Back to Cluster Role Bindings</Button>
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
            <CardHeader><CardTitle className="text-base">Cluster Role Reference</CardTitle></CardHeader>
            <CardContent>
              <div
                className="p-4 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted"
                onClick={() => clusterRoleName !== '–' && navigate(`/clusterroles/${clusterRoleName}`)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary">ClusterRole</Badge>
                  <span className="font-medium">{clusterRoleName}</span>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{roleRef.apiGroup ?? 'rbac.authorization.k8s.io'}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Subjects</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {subjects.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No subjects</p>
                ) : (
                  subjects.map((subject, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{subject.kind}</Badge>
                        <span className="font-medium">{subject.name}</span>
                      </div>
                      {subject.namespace && <p className="text-xs text-muted-foreground">Namespace: {subject.namespace}</p>}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: 'subjects',
      label: 'Subjects',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Subject Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {subjects.length === 0 ? (
                <p className="text-muted-foreground text-sm">No subjects</p>
              ) : (
                subjects.map((subject, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <Badge variant="outline" className="mr-2">{subject.kind}</Badge>
                      <span className="font-mono">{subject.name}</span>
                      {subject.namespace && <span className="text-muted-foreground text-sm ml-2">({subject.namespace})</span>}
                    </div>
                    {subject.kind === 'ServiceAccount' && subject.namespace && (
                      <Button variant="link" size="sm" onClick={() => navigate(`/serviceaccounts/${subject.namespace}/${subject.name}`)}>
                        View Service Account
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'clusterrole-details',
      label: 'ClusterRole Details',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Referenced ClusterRole</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-2">This binding references the following ClusterRole.</p>
            <Button variant="outline" onClick={() => clusterRoleName !== '–' && navigate(`/clusterroles/${clusterRoleName}`)}>
              View ClusterRole: {clusterRoleName}
            </Button>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={crbName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="clusterrolebindings"
          resourceKind="ClusterRoleBinding"
          initialSelectedResources={[crbName]}
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
          kind={normalizeKindForTopology('ClusterRoleBinding')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="ClusterRoleBinding"
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
            { icon: Edit, label: 'Edit Binding', description: 'Modify subjects or role reference', onClick: () => toast.info('Edit not implemented') },
            { icon: Download, label: 'Download YAML', description: 'Export ClusterRoleBinding definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export ClusterRoleBinding as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete ClusterRoleBinding', description: 'Remove this cluster role binding', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="ClusterRoleBinding"
        resourceIcon={Link2}
        name={crbName}
        status={status}
        backLink="/clusterrolebindings"
        backLabel="Cluster Role Bindings"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: Edit, variant: 'outline', onClick: () => toast.info('Edit not implemented') },
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
        resourceType="ClusterRoleBinding"
        resourceName={crbName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: crbName });
          navigate('/clusterrolebindings');
        }}
        requireNameConfirmation
      />
    </>
  );
}
