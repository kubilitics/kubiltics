import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Database, Clock, Server, Download, Trash2, HardDrive, Info, Network, Loader2, Edit, FileCode, GitCompare } from 'lucide-react';
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

interface K8sVolumeAttachment extends KubernetesResource {
  spec?: {
    attacher?: string;
    nodeName?: string;
    source?: { persistentVolumeName?: string };
  };
  status?: {
    attached?: boolean;
    attachError?: { message?: string };
    detachError?: { message?: string };
    attachmentMetadata?: Record<string, string>;
  };
}

export default function VolumeAttachmentDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('VolumeAttachment', name ?? undefined, undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: va, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sVolumeAttachment>(
    'volumeattachments',
    name ?? '',
    undefined,
    undefined as unknown as K8sVolumeAttachment
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VolumeAttachment', '', name ?? undefined);
  const deleteVA = useDeleteK8sResource('volumeattachments');
  const updateVA = useUpdateK8sResource('volumeattachments');

  useEffect(() => {
    if (!name?.trim()) navigate('/volumeattachments', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${va?.metadata?.name || 'volumeattachment'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, va?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!va) return;
    downloadResourceJson(va, `${va?.metadata?.name || 'volumeattachment'}.json`);
    toast.success('JSON downloaded');
  }, [va]);

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

  if (isConnected && name && !va?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">VolumeAttachment not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/volumeattachments')}>
              Back to Volume Attachments
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const vaName = va?.metadata?.name ?? '';
  const attacher = va?.spec?.attacher ?? '—';
  const nodeName = va?.spec?.nodeName ?? '—';
  const pvName = va?.spec?.source?.persistentVolumeName ?? '—';
  const attached = !!va?.status?.attached;
  const status: ResourceStatus = attached ? 'Healthy' : 'Pending';
  const attachError = va?.status?.attachError?.message ?? va?.status?.detachError?.message ?? '—';
  const attachmentMetadata = va?.status?.attachmentMetadata ?? {};

  const statusCards = [
    { label: 'Status', value: attached ? 'Attached' : 'Detached', icon: Database, iconColor: 'success' as const },
    { label: 'Node', value: nodeName, icon: Server, iconColor: 'info' as const },
    { label: 'PV', value: pvName, icon: HardDrive, iconColor: 'primary' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateVA.mutateAsync({ name, yaml: newYaml });
      toast.success('VolumeAttachment updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update VolumeAttachment');
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
            metadata={va?.metadata ?? { name: vaName }}
            createdLabel={age}
          />
          <SectionCard icon={Database} title="Attachment information" tooltip={<p className="text-xs text-muted-foreground">Volume attachment status and references</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Attacher</p><p className="font-mono text-xs">{attacher}</p></div>
              <div><p className="text-muted-foreground mb-1">Status</p><Badge variant={attached ? 'default' : 'secondary'}>{attached ? 'Attached' : 'Detached'}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Node</p><button type="button" className="font-medium text-primary hover:underline" onClick={() => nodeName !== '—' && navigate(`/nodes/${nodeName}`)}>{nodeName}</button></div>
              <div><p className="text-muted-foreground mb-1">PersistentVolume</p><button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => pvName !== '—' && navigate(`/persistentvolumes/${pvName}`)}>{pvName}</button></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
              {attachError !== '—' && <div className="col-span-2 md:col-span-3"><p className="text-muted-foreground mb-1">Attach Error</p><p className="text-destructive text-sm">{attachError}</p></div>}
            </div>
          </SectionCard>
          {Object.keys(attachmentMetadata).length > 0 && (
            <SectionCard icon={Info} title="Attachment Metadata" tooltip={<p className="text-xs text-muted-foreground">Driver-specific metadata</p>}>
              <div className="space-y-2">
                {Object.entries(attachmentMetadata).map(([key, value]) => (
                  <div key={key} className="flex justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{key}</span>
                    <span className="font-mono text-sm">{value}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={vaName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="volumeattachments"
          resourceKind="VolumeAttachment"
          initialSelectedResources={[vaName]}
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
          kind={normalizeKindForTopology('VolumeAttachment')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="VolumeAttachment"
          sourceResourceName={va?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export VolumeAttachment definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export VolumeAttachment as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Attachment', description: 'Remove this volume attachment', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="VolumeAttachment"
        resourceIcon={Database}
        name={vaName}
        status={status}
        backLink="/volumeattachments"
        backLabel="Volume Attachments"
        createdLabel={age}
        createdAt={va?.metadata?.creationTimestamp}
        headerMetadata={isConnected ? <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Badge variant="outline" className="text-xs">Live</Badge></span> : undefined}
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
        resourceType="VolumeAttachment"
        resourceName={vaName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteVA.mutateAsync({ name });
            navigate('/volumeattachments');
          } else {
            toast.success(`VolumeAttachment ${vaName} deleted (demo mode)`);
            navigate('/volumeattachments');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
