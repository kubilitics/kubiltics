import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layers, Clock, Download, Trash2, Server, Settings, Star, Info, Network, Loader2, Edit, FileCode, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Button } from '@/components/ui/button';

interface K8sStorageClass extends KubernetesResource {
  provisioner?: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
}

export default function StorageClassDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('StorageClass', name ?? undefined, undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: sc, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sStorageClass>(
    'storageclasses',
    name ?? '',
    undefined,
    undefined as unknown as K8sStorageClass
  );
  const { events, refetch: refetchEvents } = useResourceEvents('StorageClass', '', name ?? undefined);
  const deleteSC = useDeleteK8sResource('storageclasses');
  const updateSC = useUpdateK8sResource('storageclasses');

  useEffect(() => {
    if (!name?.trim()) navigate('/storageclasses', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sc?.metadata?.name || 'storageclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, sc?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!sc) return;
    downloadResourceJson(sc, `${sc?.metadata?.name || 'storageclass'}.json`);
    toast.success('JSON downloaded');
  }, [sc]);

  if (!name?.trim()) return null;
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

  if (isConnected && name && !sc?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">StorageClass not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/storageclasses')}>
              Back to Storage Classes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const scName = sc?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';
  const provisioner = sc?.provisioner ?? '—';
  const reclaimPolicy = sc?.reclaimPolicy ?? 'Delete';
  const volumeBindingMode = sc?.volumeBindingMode ?? 'Immediate';
  const allowVolumeExpansion = sc?.allowVolumeExpansion ?? false;
  const isDefault = sc?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
  const parameters = sc?.parameters ?? {};

  const statusCards = [
    { label: 'Provisioner', value: provisioner, icon: Server, iconColor: 'primary' as const },
    { label: 'Reclaim Policy', value: reclaimPolicy, icon: Settings, iconColor: 'info' as const },
    { label: 'Binding Mode', value: volumeBindingMode, icon: Layers, iconColor: 'muted' as const },
    { label: 'PVs/PVCs', value: '—', icon: Layers, iconColor: 'muted' as const },
  ];


  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateSC.mutateAsync({ name, yaml: newYaml });
      toast.success('StorageClass updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update StorageClass');
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
          <ResourceOverviewMetadata
            metadata={sc?.metadata ?? { name: scName }}
            createdLabel={age}
          />
          <SectionCard icon={Layers} title="Storage Class information" tooltip={<p className="text-xs text-muted-foreground">Provisioner and volume behavior</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Provisioner</p><p className="font-mono text-xs">{provisioner}</p></div>
              <div><p className="text-muted-foreground mb-1">Reclaim Policy</p><Badge variant="outline">{reclaimPolicy}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Volume Binding</p><p>{volumeBindingMode}</p></div>
              <div><p className="text-muted-foreground mb-1">Volume Expansion</p><Badge variant={allowVolumeExpansion ? 'default' : 'secondary'}>{allowVolumeExpansion ? 'Allowed' : 'Disabled'}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
          {Object.keys(parameters).length > 0 && (
            <SectionCard icon={Settings} title="Parameters" tooltip={<p className="text-xs text-muted-foreground">Storage class parameters</p>}>
              <div className="space-y-2">
                {Object.entries(parameters).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="font-mono text-sm">{key}</span>
                    <Badge variant="secondary" className="font-mono">{String(value)}</Badge>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={scName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="storageclasses"
          resourceKind="StorageClass"
          initialSelectedResources={[scName]}
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
          kind={normalizeKindForTopology('StorageClass')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="StorageClass"
          sourceResourceName={sc?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Star, label: 'Set as Default', description: 'Make this the default storage class', onClick: () => toast.info('Requires backend support') },
          { icon: Download, label: 'Download YAML', description: 'Export StorageClass definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export StorageClass as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete StorageClass', description: 'Remove this Storage Class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="StorageClass"
        resourceIcon={Layers}
        name={scName}
        status={status}
        backLink="/storageclasses"
        backLabel="Storage Classes"
        createdLabel={age}
        createdAt={sc?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            {isDefault && <><span className="mx-2">•</span><Star className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />Default</>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: Edit, variant: 'outline', onClick: () => { setActiveTab('yaml'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'yaml'); return n; }, { replace: true }); } },
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
        resourceType="StorageClass"
        resourceName={scName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteSC.mutateAsync({ name });
            navigate('/storageclasses');
          } else {
            toast.success(`StorageClass ${scName} deleted (demo mode)`);
            navigate('/storageclasses');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
