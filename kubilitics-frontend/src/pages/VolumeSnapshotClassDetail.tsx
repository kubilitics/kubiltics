import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layers, Clock, Download, Trash2, Server, Settings, Star, Info, FileCode, GitCompare, Camera } from 'lucide-react';
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
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface K8sVolumeSnapshotClass extends KubernetesResource {
  driver?: string;
  deletionPolicy?: string;
}

export default function VolumeSnapshotClassDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('VolumeSnapshotClass', name ?? undefined, undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: vsc, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sVolumeSnapshotClass>(
    'volumesnapshotclasses',
    name ?? '',
    undefined,
    undefined as unknown as K8sVolumeSnapshotClass
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VolumeSnapshotClass', '', name ?? undefined);
  const deleteVSC = useDeleteK8sResource('volumesnapshotclasses');
  const updateVSC = useUpdateK8sResource('volumesnapshotclasses');

  useEffect(() => {
    if (!name?.trim()) navigate('/volumesnapshotclasses', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vsc?.metadata?.name || 'volumesnapshotclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, vsc?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!vsc) return;
    downloadResourceJson(vsc, `${vsc?.metadata?.name || 'volumesnapshotclass'}.json`);
    toast.success('JSON downloaded');
  }, [vsc]);

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

  if (isConnected && name && !vsc?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">VolumeSnapshotClass not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/volumesnapshotclasses')}>
            Back to Volume Snapshot Classes
          </Button>
        </div>
      </div>
    );
  }

  const vscName = vsc?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';
  const driver = (vsc as K8sVolumeSnapshotClass & { spec?: { driver?: string } })?.driver ?? (vsc as any)?.spec?.driver ?? '—';
  const deletionPolicy = (vsc as K8sVolumeSnapshotClass & { spec?: { deletionPolicy?: string } })?.deletionPolicy ?? (vsc as any)?.spec?.deletionPolicy ?? 'Delete';
  const isDefault = vsc?.metadata?.annotations?.['snapshot.storage.kubernetes.io/is-default-class'] === 'true';

  const statusCards = [
    { label: 'Driver', value: driver, icon: Server, iconColor: 'primary' as const },
    { label: 'Deletion Policy', value: deletionPolicy, icon: Settings, iconColor: 'info' as const },
    { label: 'Default Class', value: isDefault ? 'Yes' : 'No', icon: Star, iconColor: 'muted' as const },
  ];


  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateVSC.mutateAsync({ name, namespace: '', yaml: newYaml });
      toast.success('VolumeSnapshotClass updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update VolumeSnapshotClass');
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
            metadata={vsc?.metadata ?? { name: vscName }}
            createdLabel={age}
          />
          <SectionCard icon={Layers} title="Volume Snapshot Class" tooltip={<p className="text-xs text-muted-foreground">CSI snapshot parameters</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Driver</p><p className="font-mono text-xs">{driver}</p></div>
              <div><p className="text-muted-foreground mb-1">Deletion Policy</p><Badge variant="outline">{deletionPolicy}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Default Class</p><Badge variant={isDefault ? 'default' : 'secondary'}>{isDefault ? 'Yes' : 'No'}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
          <SectionCard icon={Layers} title="Usage" tooltip={<p className="text-xs text-muted-foreground">VolumeSnapshots using this class</p>}>
            <p className="text-sm text-muted-foreground">
              VolumeSnapshots reference this class via <code className="bg-muted px-1 rounded">spec.volumeSnapshotClassName: {vscName}</code>.
              View <Link to="/volumesnapshots" className="text-primary hover:underline">Volume Snapshots</Link> and filter by snapshot class to see usage.
            </p>
          </SectionCard>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={vscName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="volumesnapshotclasses"
          resourceKind="VolumeSnapshotClass"
          initialSelectedResources={[vscName]}
          clusterId={clusterId ?? undefined}
          backendBaseUrl={baseUrl ?? ''}
          isConnected={isConnected}
          embedded
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Download,
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export VolumeSnapshotClass definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export VolumeSnapshotClass as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete VolumeSnapshotClass', description: 'Remove this snapshot class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="VolumeSnapshotClass"
        resourceIcon={Camera}
        name={vscName}
        status={status}
        backLink="/volumesnapshotclasses"
        backLabel="Volume Snapshot Classes"
        createdLabel={age}
        createdAt={vsc?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            {isDefault && <><span className="mx-2">•</span><Star className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />Default</>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: FileCode, variant: 'outline', onClick: () => { setActiveTab('yaml'); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'yaml'); return n; }, { replace: true }); } },
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
        resourceType="VolumeSnapshotClass"
        resourceName={vscName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteVSC.mutateAsync({ name, namespace: '' });
            navigate('/volumesnapshotclasses');
          } else {
            toast.success(`VolumeSnapshotClass ${vscName} deleted (demo mode)`);
            navigate('/volumesnapshotclasses');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
