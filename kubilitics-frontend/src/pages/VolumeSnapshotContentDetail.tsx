import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layers, Clock, Download, Trash2, Server, Settings, Info, FileCode, GitCompare, Camera } from 'lucide-react';
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

interface K8sVolumeSnapshotContent extends KubernetesResource {
  spec?: {
    source?: { volumeHandle?: string; snapshotHandle?: string };
    volumeSnapshotClassName?: string;
    deletionPolicy?: string;
    driver?: string;
    volumeSnapshotRef?: { namespace?: string; name?: string };
  };
  status?: {
    readyToUse?: boolean;
    restoreSize?: string;
    snapshotHandle?: string;
    error?: { message?: string };
  };
}

export default function VolumeSnapshotContentDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('VolumeSnapshotContent', name ?? undefined, undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: vsc, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sVolumeSnapshotContent>(
    'volumesnapshotcontents',
    name ?? '',
    undefined,
    undefined as unknown as K8sVolumeSnapshotContent
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VolumeSnapshotContent', '', name ?? undefined);
  const deleteVSC = useDeleteK8sResource('volumesnapshotcontents');
  const updateVSC = useUpdateK8sResource('volumesnapshotcontents');

  useEffect(() => {
    if (!name?.trim()) navigate('/volumesnapshotcontents', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vsc?.metadata?.name || 'volumesnapshotcontent'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, vsc?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!vsc) return;
    downloadResourceJson(vsc, `${vsc?.metadata?.name || 'volumesnapshotcontent'}.json`);
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
          <p className="text-muted-foreground">VolumeSnapshotContent not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/volumesnapshotcontents')}>
            Back to Volume Snapshot Contents
          </Button>
        </div>
      </div>
    );
  }

  const spec = vsc?.spec ?? {};
  const status = vsc?.status ?? {};
  const sourceSpec = spec.source ?? {};
  const vsRef = spec.volumeSnapshotRef ?? {};

  const driver = vsc?.spec?.driver ?? (vsc as any)?.driver ?? '—';
  const deletionPolicy = vsc?.spec?.deletionPolicy ?? (vsc as any)?.deletionPolicy ?? 'Delete';
  const snapshotClass = spec.volumeSnapshotClassName ?? '—';
  const restoreSize = status.restoreSize ?? '—';
  const readyToUse = status.readyToUse === true;
  const errorMsg = status.error?.message;

  let sourceLabel = '—';
  if (sourceSpec.snapshotHandle) sourceLabel = 'Pre-provisioned';
  else if (sourceSpec.volumeHandle) sourceLabel = 'Dynamic (from PVC)';

  const vscName = vsc?.metadata?.name ?? '';
  const k8sStatus: ResourceStatus = errorMsg ? 'Error' : readyToUse ? 'Healthy' : 'Warning';

  const statusCards = [
    { label: 'Status', value: readyToUse ? 'Ready' : (errorMsg ? 'Failed' : 'Pending'), icon: Camera, iconColor: 'primary' as const },
    { label: 'Source', value: sourceLabel, icon: Layers, iconColor: 'info' as const },
    { label: 'Snapshot Class', value: snapshotClass, icon: Settings, iconColor: 'muted' as const },
    { label: 'Restore Size', value: restoreSize, icon: Layers, iconColor: 'muted' as const },
    { label: 'Deletion Policy', value: deletionPolicy, icon: Settings, iconColor: 'muted' as const },
  ];


  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateVSC.mutateAsync({ name, namespace: '', yaml: newYaml });
      toast.success('VolumeSnapshotContent updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update VolumeSnapshotContent');
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
          <SectionCard icon={Layers} title="Volume Snapshot Content" tooltip={<p className="text-xs text-muted-foreground">Actual snapshot data binding</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Status</p><Badge variant={readyToUse ? 'default' : (errorMsg ? 'destructive' : 'secondary')}>{readyToUse ? 'Ready' : (errorMsg ? 'Failed' : 'Pending')}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Source</p><p>{sourceLabel}</p></div>
              <div><p className="text-muted-foreground mb-1">Driver</p><p className="font-mono text-xs">{driver}</p></div>
              <div><p className="text-muted-foreground mb-1">Snapshot Class</p>{snapshotClass !== '—' ? <Link to={`/volumesnapshotclasses/${snapshotClass}`} className="text-primary hover:underline font-mono text-xs">{snapshotClass}</Link> : <span>—</span>}</div>
              <div><p className="text-muted-foreground mb-1">Restore Size</p><p className="font-mono">{restoreSize}</p></div>
              <div><p className="text-muted-foreground mb-1">Deletion Policy</p><Badge variant="outline">{deletionPolicy}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
            {errorMsg && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <p className="font-medium">Error</p>
                <p className="font-mono text-xs mt-1">{errorMsg}</p>
              </div>
            )}
          </SectionCard>
          {vsRef.namespace && vsRef.name && (
            <SectionCard icon={Layers} title="Bound VolumeSnapshot" tooltip={<p className="text-xs text-muted-foreground">The VolumeSnapshot this content is bound to</p>}>
              <p className="text-sm text-muted-foreground mb-2">
                This VolumeSnapshotContent is bound to the following VolumeSnapshot:
              </p>
              <Link to={`/volumesnapshots/${vsRef.namespace}/${vsRef.name}`} className="text-primary hover:underline font-mono">
                {vsRef.namespace}/{vsRef.name}
              </Link>
            </SectionCard>
          )}
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
          resourceType="volumesnapshotcontents"
          resourceKind="VolumeSnapshotContent"
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
          { icon: Download, label: 'Download YAML', description: 'Export VolumeSnapshotContent definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export VolumeSnapshotContent as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete VolumeSnapshotContent', description: 'Remove this snapshot content (consider deleting the VolumeSnapshot first)', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="VolumeSnapshotContent"
        resourceIcon={Camera}
        name={vscName}
        status={k8sStatus}
        backLink="/volumesnapshotcontents"
        backLabel="Volume Snapshot Contents"
        createdLabel={age}
        createdAt={vsc?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            {readyToUse && <><span className="mx-2">•</span><span className="text-[hsl(142,76%,36%)]">Ready</span></>}
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
        resourceType="VolumeSnapshotContent"
        resourceName={vscName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteVSC.mutateAsync({ name, namespace: '' });
            navigate('/volumesnapshotcontents');
          } else {
            toast.success(`VolumeSnapshotContent ${vscName} deleted (demo mode)`);
            navigate('/volumesnapshotcontents');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
