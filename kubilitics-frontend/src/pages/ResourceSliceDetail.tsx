import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Cpu, Clock, Download, Trash2, Info, FileCode, GitCompare, Layers, Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  ResourceTopologyView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sResourceSlice extends KubernetesResource {
  driver?: string;
  nodeName?: string;
  pool?: { name?: string; generation?: number; resourceSliceCount?: number };
  namedResources?: unknown;
  structuredResources?: unknown;
}

function formatCapacity(rs: K8sResourceSlice): string {
  const raw = rs as any;
  const named = raw.namedResources as { entries?: Array<{ capacity?: Record<string, string> }> } | undefined;
  const structured = raw.structuredResources as { capacity?: Record<string, string> } | undefined;
  if (named?.entries?.length) {
    const caps = named.entries.flatMap((e) => e.capacity ? Object.values(e.capacity) : []);
    return caps.length ? caps.join(', ') : '—';
  }
  if (structured?.capacity && Object.keys(structured.capacity).length) {
    return Object.entries(structured.capacity).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return '—';
}

export default function ResourceSliceDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('ResourceSlice', name ?? undefined, undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: rs, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sResourceSlice>(
    'resourceslices',
    name ?? '',
    undefined,
    undefined as unknown as K8sResourceSlice
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ResourceSlice', '', name ?? undefined);
  const deleteRS = useDeleteK8sResource('resourceslices');
  const updateRS = useUpdateK8sResource('resourceslices');

  useEffect(() => {
    if (!name?.trim()) navigate('/resourceslices', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rs?.metadata?.name || 'resourceslice'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, rs?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!rs) return;
    downloadResourceJson(rs, `${rs?.metadata?.name || 'resourceslice'}.json`);
    toast.success('JSON downloaded');
  }, [rs]);

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

  if (isConnected && name && !rs?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">ResourceSlice not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/resourceslices')}>
            Back to Resource Slices
          </Button>
        </div>
      </div>
    );
  }

  const raw = rs as any;
  const driver = raw.driver ?? raw.spec?.driver ?? '—';
  const nodeName = raw.nodeName ?? raw.spec?.nodeName;
  const pool = raw.pool ?? raw.spec?.pool;
  const poolName = pool?.name ?? '—';
  const node = nodeName ?? poolName ?? '—';
  const capacity = formatCapacity(rs as K8sResourceSlice);

  const rsName = rs?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';

  const statusCards = [
    { label: 'Driver', value: driver, icon: Cpu, iconColor: 'primary' as const },
    { label: 'Node', value: node, icon: Layers, iconColor: 'info' as const },
    { label: 'Pool', value: poolName, icon: Layers, iconColor: 'muted' as const },
    { label: 'Capacity', value: capacity, icon: Cpu, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateRS.mutateAsync({ name, namespace: '', yaml: newYaml });
      toast.success('ResourceSlice updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update ResourceSlice');
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
            metadata={rs?.metadata ?? { name: rsName }}
            createdLabel={age}
          />
          <SectionCard icon={Cpu} title="Resource Slice" tooltip={<p className="text-xs text-muted-foreground">DRA capacity info</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Driver</p><p className="font-mono text-xs">{driver}</p></div>
              <div><p className="text-muted-foreground mb-1">Node</p>{node !== '—' ? <Link to={`/nodes/${node}`} className="text-primary hover:underline font-mono text-xs">{node}</Link> : <span>—</span>}</div>
              <div><p className="text-muted-foreground mb-1">Pool</p><p className="font-mono text-xs">{poolName}</p></div>
              {pool?.generation != null && <div><p className="text-muted-foreground mb-1">Generation</p><Badge variant="outline">{pool.generation}</Badge></div>}
              {pool?.resourceSliceCount != null && <div><p className="text-muted-foreground mb-1">Slices in Pool</p><p>{pool.resourceSliceCount}</p></div>}
              <div><p className="text-muted-foreground mb-1">Capacity</p><p className="font-mono text-xs">{capacity}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={rsName} editable onSave={handleSaveYaml} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind="ResourceSlice"
          namespace=""
          name={name ?? ''}
          sourceResourceType="ResourceSlice"
          sourceResourceName={rs?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="resourceslices"
          resourceKind="ResourceSlice"
          initialSelectedResources={[name || '']}
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
          { icon: Download, label: 'Download YAML', description: 'Export ResourceSlice definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export ResourceSlice as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete ResourceSlice', description: 'Remove this slice (usually managed by DRA driver)', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ResourceSlice"
        resourceIcon={Cpu}
        name={rsName}
        status={status}
        backLink="/resourceslices"
        backLabel="Resource Slices"
        createdLabel={age}
        createdAt={rs?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            <span className="font-mono text-xs">{driver}</span>
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
        resourceType="ResourceSlice"
        resourceName={rsName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteRS.mutateAsync({ name, namespace: '' });
            navigate('/resourceslices');
          } else {
            toast.success(`ResourceSlice ${rsName} deleted (demo mode)`);
            navigate('/resourceslices');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
