import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Trash2, FileText, Link2, GitCompare, Clock, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  DetailRow,
  LabelList,
  AnnotationList,
  SectionCard,
  YamlViewer,
  EventsSection,
  DeleteConfirmDialog,
  ResourceComparisonView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface VolumeSnapshotResource extends KubernetesResource {
  spec?: {
    source?: { persistentVolumeClaimName?: string; volumeSnapshotContentName?: string };
    volumeSnapshotClassName?: string;
  };
  status?: {
    readyToUse?: boolean;
    boundVolumeSnapshotContentName?: string;
    restoreSize?: string;
    creationTime?: string;
    error?: { message?: string };
  };
}

export default function VolumeSnapshotDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('VolumeSnapshot', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { resource: vs, isLoading, yaml, isConnected, refetch } = useResourceDetail<VolumeSnapshotResource>(
    'volumesnapshots',
    name ?? '',
    namespace ?? 'default',
    undefined as unknown as VolumeSnapshotResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VolumeSnapshot', namespace ?? '', name ?? undefined);
  const deleteVS = useDeleteK8sResource('volumesnapshots');

  useEffect(() => {
    setActiveTab(searchParams.get('tab') || 'overview');
  }, [searchParams]);

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/volumesnapshots', { replace: true });
  }, [name, namespace, navigate]);

  const handleDelete = async () => {
    if (!namespace || !name) return;
    await deleteVS.mutateAsync({ name, namespace });
    navigate('/volumesnapshots');
  };

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vs?.metadata?.name || name || 'volumesnapshot'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  }, [yaml, vs?.metadata?.name, name]);

  const handleDownloadJson = useCallback(() => {
    if (!vs) return;
    downloadResourceJson(vs, `${vs?.metadata?.name || name || 'volumesnapshot'}.json`);
    toast.success('JSON downloaded');
  }, [vs, name]);

  if (!name?.trim() || !namespace?.trim()) return null;
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

  if (isConnected && name && !vs?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">VolumeSnapshot not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/volumesnapshots')}>
            Back to Volume Snapshots
          </Button>
        </div>
      </div>
    );
  }

  const spec = vs?.spec ?? {};
  const status = vs?.status ?? {};
  const source = spec.source ?? {};
  const sourcePVC = source.persistentVolumeClaimName ?? '-';
  const snapshotClass = spec.volumeSnapshotClassName ?? '-';
  const boundContent = status.boundVolumeSnapshotContentName ?? '-';
  const restoreSize = status.restoreSize ?? '-';
  const readyToUse = status.readyToUse === true;
  const errorMsg = status.error?.message;

  const statusCards = [
    { label: 'Status', value: readyToUse ? 'Ready' : errorMsg ? 'Failed' : 'Pending', icon: Camera, iconColor: (readyToUse ? 'success' : errorMsg ? 'destructive' : 'warning') as const },
    { label: 'Source PVC', value: sourcePVC, icon: Link2, iconColor: 'info' as const },
    { label: 'Snapshot Class', value: snapshotClass, icon: FileText, iconColor: 'muted' as const },
    { label: 'Restore Size', value: restoreSize, icon: Camera, iconColor: 'primary' as const },
  ];

  const restoreInstructions = readyToUse && sourcePVC !== '-' ? (
    <pre className="text-sm font-mono bg-muted/50 p-4 rounded-lg overflow-x-auto">
      {`# Restore from this snapshot to a new PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-restored-pvc
  namespace: ${namespace}
spec:
  storageClassName: ""  # Same as original or your choice
  dataSource:
    name: ${name}
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: ${restoreSize}`}
    </pre>
  ) : null;

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: FileText,
      content: (
        <div className="space-y-6">
          <SectionCard icon={Camera} title="Snapshot Details">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Status" value={<Badge variant={readyToUse ? 'default' : (errorMsg ? 'destructive' : 'secondary')}>{readyToUse ? 'Ready' : (errorMsg ? 'Failed' : 'Pending')}</Badge>} />
              <DetailRow label="Source PVC" value={
                <Button variant="link" className="h-auto p-0 font-normal" onClick={() => navigate(`/persistentvolumeclaims/${namespace}/${sourcePVC}`)}>
                  {sourcePVC}
                  <Link2 className="h-3 w-3 ml-1 inline" />
                </Button>
              } />
              <DetailRow label="Snapshot Class" value={<span className="font-mono text-sm">{snapshotClass}</span>} />
              <DetailRow label="Bound Content" value={<span className="font-mono text-sm">{boundContent}</span>} />
              <DetailRow label="Restore Size" value={<span className="font-mono">{restoreSize}</span>} />
              <DetailRow label="Created" value={vs?.metadata?.creationTimestamp ? new Date(vs.metadata.creationTimestamp).toLocaleString() : '—'} />
            </div>
          </SectionCard>
          {errorMsg && (
            <SectionCard icon={Camera} title="Error">
              <p className="text-destructive text-sm">{errorMsg}</p>
            </SectionCard>
          )}
          {restoreInstructions && (
            <SectionCard icon={Camera} title="Restore Instructions">
              <p className="text-sm text-muted-foreground mb-2">Use this YAML to create a new PVC from this snapshot:</p>
              {restoreInstructions}
            </SectionCard>
          )}
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LabelList labels={vs?.metadata?.labels ?? {}} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <AnnotationList annotations={vs?.metadata?.annotations ?? {}} />
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: FileText, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileText, content: <YamlViewer yaml={yaml} resourceName={name ?? ''} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="volumesnapshots"
          resourceKind="VolumeSnapshot"
          namespace={namespace}
          initialSelectedResources={namespace && name ? [`${namespace}/${name}`] : [name || '']}
          clusterId={clusterId ?? undefined}
          backendBaseUrl={baseUrl ?? ''}
          isConnected={isConnected}
          embedded
        />
      ),
    },
  ];

  const statusLabel: ResourceStatus = readyToUse ? 'Healthy' : errorMsg ? 'Failed' : 'Pending';

  return (
    <>
      <ResourceDetailLayout
        resourceType="VolumeSnapshot"
        resourceIcon={Camera}
        name={vs?.metadata?.name ?? name ?? ''}
        namespace={namespace}
        status={statusLabel}
        backLink="/volumesnapshots"
        backLabel="Volume Snapshots"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />{vs?.metadata?.creationTimestamp ? `Created ${new Date(vs.metadata.creationTimestamp).toLocaleString()}` : ''}</span>}
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
        resourceType="VolumeSnapshot"
        resourceName={name ?? ''}
        namespace={namespace}
        onConfirm={handleDelete}
      />
    </>
  );
}
