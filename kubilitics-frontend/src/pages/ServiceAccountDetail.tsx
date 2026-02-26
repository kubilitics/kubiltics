import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { UserCircle, Clock, Download, Trash2, KeyRound, Shield, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
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
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface ServiceAccountResource extends KubernetesResource {
  secrets?: Array<{ name?: string }>;
  imagePullSecrets?: Array<{ name?: string }>;
  automountServiceAccountToken?: boolean;
}

export default function ServiceAccountDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<ServiceAccountResource>(
    'serviceaccounts',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as ServiceAccountResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ServiceAccount', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('serviceaccounts');

  useEffect(() => {
    setActiveTab(searchParams.get('tab') || 'overview');
  }, [searchParams.get('tab')]);

  const saName = resource?.metadata?.name ?? name ?? '';
  const saNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const secrets = resource?.secrets ?? [];
  const imagePullSecrets = resource?.imagePullSecrets ?? [];
  const automount = resource?.automountServiceAccountToken !== false;
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${saName || 'serviceaccount'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, saName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${saName || 'serviceaccount'}.json`);
    toast.success('JSON downloaded');
  }, [resource, saName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Secrets', value: secrets.length, icon: KeyRound, iconColor: 'primary' as const },
    { label: 'Pods Using', value: '–', icon: UserCircle, iconColor: 'muted' as const },
    { label: 'Roles Bound', value: '–', icon: Shield, iconColor: 'muted' as const },
    { label: 'Permission Level', value: '–', icon: Shield, iconColor: 'muted' as const },
    { label: 'Token Auto-Mount', value: automount ? 'Yes' : 'No', icon: KeyRound, iconColor: 'info' as const },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
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
        <UserCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Service Account not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No service account "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/serviceaccounts')}>Back to Service Accounts</Button>
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
            <CardHeader><CardTitle className="text-base">Service Account Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between p-2 rounded-lg bg-muted/50">
                <span>Automount Token</span>
                <Badge variant={automount ? 'default' : 'secondary'}>{automount ? 'Yes' : 'No'}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">Age: {age}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Secrets</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {secrets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No secrets</p>
                ) : (
                  secrets.map((s) => (
                    <div
                      key={s.name}
                      className="p-2 rounded-lg bg-muted/50 font-mono text-sm cursor-pointer hover:bg-muted"
                      onClick={() => navigate(`/secrets/${saNamespace}/${s.name}`)}
                    >
                      {s.name}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Image Pull Secrets</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {imagePullSecrets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">None</p>
                ) : (
                  imagePullSecrets.map((s) => (
                    <Badge key={s.name} variant="outline" className="font-mono cursor-pointer" onClick={() => navigate(`/secrets/${saNamespace}/${s.name}`)}>
                      {s.name}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <MetadataCard title="Labels" items={labels} variant="badges" />
          {Object.keys(annotations).length > 0 && <MetadataCard title="Annotations" items={annotations} variant="badges" />}
        </div>
      ),
    },
    {
      id: 'permissions',
      label: 'Permissions',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">RoleBindings / ClusterRoleBindings</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Bindings that reference this ServiceAccount would be listed here. Use the cluster RBAC APIs or list RoleBindings/ClusterRoleBindings and filter by subject to see them.</p>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'usedby',
      label: 'Used By',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Pods / Workloads</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Pods and workloads using this ServiceAccount (e.g. <code>spec.serviceAccountName</code>) can be listed when backend supports it or by listing pods in this namespace.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate(`/pods?namespace=${saNamespace}`)}>View Pods in {saNamespace}</Button>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={saName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="serviceaccounts"
          resourceKind="ServiceAccount"
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
          kind={normalizeKindForTopology('ServiceAccount')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="ServiceAccount"
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
            { icon: KeyRound, label: 'Create Token', description: 'Generate a new service account token', onClick: () => toast.info('Create token not implemented') },
            { icon: Download, label: 'Download YAML', description: 'Export ServiceAccount definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export ServiceAccount as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete ServiceAccount', description: 'Remove this service account', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="ServiceAccount"
        resourceIcon={UserCircle}
        name={saName}
        namespace={saNamespace}
        status={status}
        backLink="/serviceaccounts"
        backLabel="Service Accounts"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Create Token', icon: KeyRound, variant: 'outline', onClick: () => toast.info('Create token not implemented') },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSearchParams((p) => { p.set('tab', tab); return p; });
        }}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ServiceAccount"
        resourceName={saName}
        namespace={saNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: saName, namespace: saNamespace });
          navigate('/serviceaccounts');
        }}
        requireNameConfirmation
      />
    </>
  );
}
