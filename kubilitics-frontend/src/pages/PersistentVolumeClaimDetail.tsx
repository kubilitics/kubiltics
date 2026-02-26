import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Database, Clock, Download, Trash2, HardDrive, Server, Expand, Info, Network, Loader2, Edit, FileCode, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Button } from '@/components/ui/button';

interface K8sPVC extends KubernetesResource {
  spec?: {
    volumeName?: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    resources?: { requests?: { storage?: string } };
  };
  status?: {
    phase?: string;
    capacity?: { storage?: string };
    accessModes?: string[];
  };
}

export default function PersistentVolumeClaimDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('PersistentVolumeClaim', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: pvc, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sPVC>(
    'persistentvolumeclaims',
    name ?? '',
    namespace ?? undefined,
    undefined as unknown as K8sPVC
  );
  const { events, refetch: refetchEvents } = useResourceEvents('PersistentVolumeClaim', namespace, name ?? undefined);
  const deletePVC = useDeleteK8sResource('persistentvolumeclaims');
  const updatePVC = useUpdateK8sResource('persistentvolumeclaims');

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pvc?.metadata?.name || 'pvc'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pvc?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!pvc) return;
    downloadResourceJson(pvc, `${pvc?.metadata?.name || 'pvc'}.json`);
    toast.success('JSON downloaded');
  }, [pvc]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && name && !pvc?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">PersistentVolumeClaim not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/persistentvolumeclaims')}>
              Back to Persistent Volume Claims
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pvcName = pvc?.metadata?.name ?? '';
  const pvcNamespace = pvc?.metadata?.namespace ?? namespace ?? '';
  const status = (pvc?.status?.phase ?? 'Unknown') as ResourceStatus;
  const capacity = pvc?.status?.capacity?.storage ?? pvc?.spec?.resources?.requests?.storage ?? '—';
  const accessModes = pvc?.spec?.accessModes ?? [];
  const storageClass = pvc?.spec?.storageClassName ?? '—';
  const volumeMode = pvc?.spec?.volumeMode ?? 'Filesystem';
  const volumeName = pvc?.spec?.volumeName ?? '—';
  const labels = pvc?.metadata?.labels ?? {};

  const requestedCapacity = pvc?.spec?.resources?.requests?.storage ?? '—';
  const usedCapacity = pvc?.status?.capacity?.storage ?? '—';
  const statusCards = [
    { label: 'Status', value: pvc?.status?.phase ?? '—', icon: Database, iconColor: 'primary' as const },
    { label: 'Capacity', value: requestedCapacity, icon: HardDrive, iconColor: 'info' as const },
    { label: 'Used', value: usedCapacity, icon: HardDrive, iconColor: 'muted' as const },
    { label: 'Volume', value: volumeName, icon: Server, iconColor: 'muted' as const },
    { label: 'Used By', value: '—', icon: Database, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name || !pvcNamespace) return;
    try {
      await updatePVC.mutateAsync({ name, namespace: pvcNamespace, yaml: newYaml });
      toast.success('PersistentVolumeClaim updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update PersistentVolumeClaim');
      throw e;
    }
  };


  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: Info,
      content: (
        <div className="space-y-6">
          <SectionCard icon={Database} title="PVC information" tooltip={<p className="text-xs text-muted-foreground">Capacity, storage class, and access</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Status</p><Badge variant="outline">{pvc?.status?.phase ?? '—'}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Capacity</p><Badge variant="secondary" className="font-mono">{capacity}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Volume Mode</p><p>{volumeMode}</p></div>
              <div><p className="text-muted-foreground mb-1">Storage Class</p><Badge variant="outline">{storageClass}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Access Modes</p><p className="font-mono">{accessModes.join(', ') || '—'}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
          {volumeName !== '—' && (
            <SectionCard icon={HardDrive} title="Bound Volume" tooltip={<p className="text-xs text-muted-foreground">PersistentVolume bound to this claim</p>}>
              <button type="button" className="p-3 rounded-lg bg-muted/50 hover:bg-muted font-mono text-sm text-primary hover:underline w-full text-left" onClick={() => navigate(`/persistentvolumes/${volumeName}`)}>
                {volumeName}
              </button>
            </SectionCard>
          )}
          <SectionCard icon={Info} title="Labels" tooltip={<p className="text-xs text-muted-foreground">Kubernetes labels</p>}>
            {Object.keys(labels).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(labels).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-xs">{k}={v}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No labels</p>
            )}
          </SectionCard>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={pvcName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="persistentvolumeclaims"
          resourceKind="PersistentVolumeClaim"
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
          kind={normalizeKindForTopology('PersistentVolumeClaim')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="PersistentVolumeClaim"
          sourceResourceName={pvc?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Expand, label: 'Expand Volume', description: 'Increase the storage capacity', onClick: () => toast.info('Expand requires backend support') },
          { icon: Download, label: 'Download YAML', description: 'Export PVC definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export PVC as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete PVC', description: 'Remove this Persistent Volume Claim', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="PersistentVolumeClaim"
        resourceIcon={Database}
        name={pvcName}
        namespace={pvcNamespace}
        status={status}
        backLink="/persistentvolumeclaims"
        backLabel="Persistent Volume Claims"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: Edit, variant: 'outline', onClick: () => { setActiveTab('yaml'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'yaml'); return n; }, { replace: true }); } },
          { label: 'Expand', icon: Expand, variant: 'outline', onClick: () => toast.info('Expand requires backend support') },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (tabId === 'overview') next.delete('tab');
            else next.set('tab', tabId);
            return next;
          }, { replace: true });
        }}
      >
        {breadcrumbSegments.length > 0 && (
          <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        )}
      </ResourceDetailLayout>
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="PersistentVolumeClaim"
        resourceName={pvcName}
        namespace={pvcNamespace}
        onConfirm={async () => {
          if (isConnected && name && pvcNamespace) {
            await deletePVC.mutateAsync({ name, namespace: pvcNamespace });
            navigate('/persistentvolumeclaims');
          } else {
            toast.success(`PersistentVolumeClaim ${pvcName} deleted (demo mode)`);
            navigate('/persistentvolumeclaims');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
