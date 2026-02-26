import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { HardDrive, Clock, Download, Trash2, Database, Server, Info, Network, Loader2, Edit, FileCode, GitCompare } from 'lucide-react';
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

interface K8sPV extends KubernetesResource {
  spec?: {
    capacity?: { storage?: string };
    accessModes?: string[];
    persistentVolumeReclaimPolicy?: string;
    storageClassName?: string;
    volumeMode?: string;
    claimRef?: { namespace?: string; name?: string };
    [key: string]: unknown;
  };
  status?: { phase?: string };
}

export default function PersistentVolumeDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('PersistentVolume', name ?? undefined, undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: pv, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sPV>(
    'persistentvolumes',
    name ?? '',
    undefined,
    undefined as unknown as K8sPV
  );
  const { events, refetch: refetchEvents } = useResourceEvents('PersistentVolume', '', name ?? undefined);
  const deletePV = useDeleteK8sResource('persistentvolumes');
  const updatePV = useUpdateK8sResource('persistentvolumes');

  useEffect(() => {
    if (!name?.trim()) navigate('/persistentvolumes', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pv?.metadata?.name || 'pv'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pv?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!pv) return;
    downloadResourceJson(pv, `${pv?.metadata?.name || 'pv'}.json`);
    toast.success('JSON downloaded');
  }, [pv]);

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

  if (isConnected && name && !pv?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">PersistentVolume not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/persistentvolumes')}>
              Back to Persistent Volumes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pvName = pv?.metadata?.name ?? '';
  const status = (pv?.status?.phase ?? 'Unknown') as ResourceStatus;
  const capacity = pv?.spec?.capacity?.storage ?? '—';
  const accessModes = pv?.spec?.accessModes ?? [];
  const reclaimPolicy = pv?.spec?.persistentVolumeReclaimPolicy ?? '—';
  const storageClass = pv?.spec?.storageClassName ?? '—';
  const volumeMode = pv?.spec?.volumeMode ?? 'Filesystem';
  const claimRef = pv?.spec?.claimRef;
  const claimNs = claimRef?.namespace;
  const claimName = claimRef?.name;
  const labels = pv?.metadata?.labels ?? {};

  const accessModesDisplay = accessModes.length ? accessModes.map((m: string) => (m === 'ReadWriteOnce' ? 'RWO' : m === 'ReadOnlyMany' ? 'ROX' : m === 'ReadWriteMany' ? 'RWX' : m === 'ReadWriteOncePod' ? 'RWOP' : m)).join(', ') : '—';
  const statusCards = [
    { label: 'Status', value: pv?.status?.phase ?? '—', icon: HardDrive, iconColor: 'primary' as const },
    { label: 'Capacity', value: capacity, icon: Database, iconColor: 'info' as const },
    { label: 'Access Modes', value: accessModesDisplay, icon: Server, iconColor: 'muted' as const },
    { label: 'Reclaim Policy', value: reclaimPolicy, icon: Server, iconColor: 'muted' as const },
    { label: 'Claim', value: claimRef ? `${claimNs}/${claimName}` : '—', icon: HardDrive, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];
  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updatePV.mutateAsync({ name, yaml: newYaml });
      toast.success('PersistentVolume updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update PersistentVolume');
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
          <SectionCard icon={HardDrive} title="PV information" tooltip={<p className="text-xs text-muted-foreground">Capacity, access, and storage class</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Capacity</p><Badge variant="secondary" className="font-mono">{capacity}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Volume Mode</p><p>{volumeMode}</p></div>
              <div><p className="text-muted-foreground mb-1">Storage Class</p><Badge variant="outline">{storageClass}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Reclaim Policy</p><p>{reclaimPolicy}</p></div>
              <div><p className="text-muted-foreground mb-1">Access Modes</p><p className="font-mono">{accessModes.join(', ') || '—'}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
          {claimRef && (
            <SectionCard icon={Database} title="Claim" tooltip={<p className="text-xs text-muted-foreground">PersistentVolumeClaim bound to this PV</p>}>
              <button type="button" className="p-3 rounded-lg bg-muted/50 hover:bg-muted font-mono text-sm text-primary hover:underline" onClick={() => claimNs && claimName && navigate(`/persistentvolumeclaims/${claimNs}/${claimName}`)}>
                {claimNs}/{claimName}
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
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={pvName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="persistentvolumes"
          resourceKind="PersistentVolume"
          initialSelectedResources={[pvName]}
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
          kind={normalizeKindForTopology('PersistentVolume')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="PersistentVolume"
          sourceResourceName={pv?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export PV definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export PV as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete PV', description: 'Remove this Persistent Volume', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="PersistentVolume"
        resourceIcon={HardDrive}
        name={pvName}
        status={status}
        backLink="/persistentvolumes"
        backLabel="Persistent Volumes"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
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
        resourceType="PersistentVolume"
        resourceName={pvName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deletePV.mutateAsync({ name });
            navigate('/persistentvolumes');
          } else {
            toast.success(`PersistentVolume ${pvName} deleted (demo mode)`);
            navigate('/persistentvolumes');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
