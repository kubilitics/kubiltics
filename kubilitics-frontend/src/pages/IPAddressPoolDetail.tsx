import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Network, Clock, Download, Trash2, Info, FileCode, GitCompare } from 'lucide-react';
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
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { Button } from '@/components/ui/button';
import { NamespaceBadge } from '@/components/list';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sIPAddressPool extends KubernetesResource {
  spec?: { addresses?: string[]; autoAssign?: boolean };
  status?: { assignedIPv4?: number; assignedIPv6?: number; availableIPv4?: number; availableIPv6?: number };
}

export default function IPAddressPoolDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('IPAddressPool', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: pool, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sIPAddressPool>(
    'ipaddresspools',
    name ?? '',
    namespace ?? undefined,
    undefined as unknown as K8sIPAddressPool
  );
  const { events, refetch: refetchEvents } = useResourceEvents('IPAddressPool', namespace ?? '', name ?? undefined);
  const deletePool = useDeleteK8sResource('ipaddresspools');
  const updatePool = useUpdateK8sResource('ipaddresspools');

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/ipaddresspools', { replace: true });
  }, [name, namespace, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pool?.metadata?.name || 'ipaddresspool'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pool?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!pool) return;
    downloadResourceJson(pool, `${pool?.metadata?.name || 'ipaddresspool'}.json`);
    toast.success('JSON downloaded');
  }, [pool]);

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

  if (isConnected && name && !pool?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">IPAddressPool not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/ipaddresspools')}>
            Back to IP Address Pools
          </Button>
        </div>
      </div>
    );
  }

  const addrs = pool?.spec?.addresses ?? [];
  const a4 = pool?.status?.assignedIPv4 ?? 0;
  const a6 = pool?.status?.assignedIPv6 ?? 0;
  const v4 = pool?.status?.availableIPv4 ?? 0;
  const v6 = pool?.status?.availableIPv6 ?? 0;

  const poolName = pool?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';

  const statusCards = [
    { label: 'Addresses', value: addrs.length ? addrs.join(', ') : '—', icon: Network, iconColor: 'primary' as const },
    { label: 'Assigned', value: `${a4 + a6}`, icon: Network, iconColor: 'info' as const },
    { label: 'Available', value: `${v4 + v6}`, icon: Network, iconColor: 'muted' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name || !namespace) return;
    try {
      await updatePool.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('IPAddressPool updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update IPAddressPool');
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
            metadata={pool?.metadata ?? { name: poolName, namespace: namespace ?? '' }}
            createdLabel={age}
          />
          <SectionCard icon={Network} title="IP Address Pool" tooltip={<p className="text-xs text-muted-foreground">MetalLB IP ranges</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Addresses</p><div className="font-mono text-xs space-y-1">{addrs.length ? addrs.map((a, i) => <div key={i}>{a}</div>) : '—'}</div></div>
              <div><p className="text-muted-foreground mb-1">Auto Assign</p><p>{pool?.spec?.autoAssign !== false ? 'Yes' : 'No'}</p></div>
              <div><p className="text-muted-foreground mb-1">Assigned IPv4</p><p>{a4}</p></div>
              <div><p className="text-muted-foreground mb-1">Assigned IPv6</p><p>{a6}</p></div>
              <div><p className="text-muted-foreground mb-1">Available IPv4</p><p>{v4}</p></div>
              <div><p className="text-muted-foreground mb-1">Available IPv6</p><p>{v6}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={poolName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="ipaddresspools"
          resourceKind="IPAddressPool"
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
      id: 'actions',
      label: 'Actions',
      icon: Download,
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export IPAddressPool definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export IPAddressPool as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete IPAddressPool', description: 'Remove this pool', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="IPAddressPool"
        resourceIcon={Network}
        name={poolName}
        status={status}
        backLink="/ipaddresspools"
        backLabel="IP Address Pools"
        createdLabel={age}
        createdAt={pool?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2">
            {namespace && <NamespaceBadge namespace={namespace} />}
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
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
        resourceType="IPAddressPool"
        resourceName={poolName}
        namespace={namespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deletePool.mutateAsync({ name, namespace });
            navigate('/ipaddresspools');
          } else {
            toast.success(`IPAddressPool ${poolName} deleted (demo mode)`);
            navigate('/ipaddresspools');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
