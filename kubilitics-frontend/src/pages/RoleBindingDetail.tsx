import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Link2, Clock, Download, Trash2, Edit, Shield, UserCircle, Network, GitCompare } from 'lucide-react';
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

interface RoleBindingResource extends KubernetesResource {
  roleRef?: { kind?: string; name?: string; apiGroup?: string };
  subjects?: Subject[];
}

export default function RoleBindingDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<RoleBindingResource>(
    'rolebindings',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as RoleBindingResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('RoleBinding', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('rolebindings');

  const rbName = resource?.metadata?.name ?? name ?? '';
  const rbNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const roleRef = resource?.roleRef ?? {};
  const subjects = resource?.subjects ?? [];
  const roleKind = roleRef.kind === 'ClusterRole' ? 'ClusterRole' : 'Role';
  const roleName = roleRef.name ?? '–';
  const roleLink = roleKind === 'ClusterRole' ? `/clusterroles/${roleName}` : `/roles/${rbNamespace}/${roleName}`;
  const subjectKinds = [...new Set(subjects.map((s) => s.kind))];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rbName || 'rolebinding'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, rbName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(resource, `${rbName || 'rolebinding'}.json`);
    toast.success('JSON downloaded');
  }, [resource, rbName]);

  const statusCards = [
    { label: 'Role Reference', value: roleName, icon: Shield, iconColor: 'primary' as const },
    { label: 'Subject Count', value: subjects.length, icon: UserCircle, iconColor: 'info' as const },
    { label: 'Subject Types', value: subjectKinds.join(', ') || '–', icon: UserCircle, iconColor: 'muted' as const },
    { label: 'Namespace Scope', value: rbNamespace, icon: Link2, iconColor: 'muted' as const },
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
        <p className="text-lg font-medium">Role Binding not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No role binding "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/rolebindings')}>Back to Role Bindings</Button>
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
            <CardHeader><CardTitle className="text-base">Role Reference</CardTitle></CardHeader>
            <CardContent>
              <div
                className="p-4 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted"
                onClick={() => roleName !== '–' && navigate(roleLink)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary">{roleKind}</Badge>
                  <span className="font-medium">{roleName}</span>
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
      id: 'role-details',
      label: 'Role Details',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Referenced {roleKind}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-2">This binding references the following {roleKind.toLowerCase()}.</p>
            <Button variant="outline" onClick={() => roleName !== '–' && navigate(roleLink)}>
              View {roleKind}: {roleName}
            </Button>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={rbName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="rolebindings"
          resourceKind="RoleBinding"
          namespace={rbNamespace}
          initialSelectedResources={rbNamespace && rbName ? [`${rbNamespace}/${rbName}`] : [rbName]}
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
          kind={normalizeKindForTopology('RoleBinding')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="RoleBinding"
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
            { icon: Download, label: 'Download YAML', description: 'Export RoleBinding definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export RoleBinding as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete RoleBinding', description: 'Remove this role binding', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="RoleBinding"
        resourceIcon={Link2}
        name={rbName}
        namespace={rbNamespace}
        status={status}
        backLink="/rolebindings"
        backLabel="Role Bindings"
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
        resourceType="RoleBinding"
        resourceName={rbName}
        namespace={rbNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: rbName, namespace: rbNamespace });
          navigate('/rolebindings');
        }}
        requireNameConfirmation
      />
    </>
  );
}
