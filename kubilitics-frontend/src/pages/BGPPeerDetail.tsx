import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Network, Clock, Download, Trash2, Info, FileCode, GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  DetailRow,
  LabelList,
  AnnotationList,
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

interface K8sBGPPeer extends KubernetesResource {
  spec?: {
    peerAddress?: string;
    peerASN?: number;
    myASN?: number;
    holdTime?: string;
    keepaliveTime?: string;
    routerID?: string;
  };
}

export default function BGPPeerDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('BGPPeer', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: peer, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sBGPPeer>(
    'bgppeers',
    name ?? '',
    namespace ?? undefined,
    undefined as unknown as K8sBGPPeer
  );
  const { events, refetch: refetchEvents } = useResourceEvents('BGPPeer', namespace ?? '', name ?? undefined);
  const deletePeer = useDeleteK8sResource('bgppeers');
  const updatePeer = useUpdateK8sResource('bgppeers');

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/bgppeers', { replace: true });
  }, [name, namespace, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${peer?.metadata?.name || 'bgppeer'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [yaml, peer?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!peer) return;
    downloadResourceJson(peer, `${peer?.metadata?.name || 'bgppeer'}.json`);
    toast.success('JSON downloaded');
  }, [peer]);

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

  if (isConnected && name && !peer?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">BGPPeer not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/bgppeers')}>
            Back to BGP Peers
          </Button>
        </div>
      </div>
    );
  }

  const peerName = peer?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';

  const statusCards = [
    { label: 'Peer Address', value: peer?.spec?.peerAddress ?? '—', icon: Network, iconColor: 'primary' as const },
    { label: 'Peer ASN', value: peer?.spec?.peerASN != null ? String(peer.spec.peerASN) : '—', icon: Network, iconColor: 'info' as const },
    { label: 'My ASN', value: peer?.spec?.myASN != null ? String(peer.spec.myASN) : '—', icon: Network, iconColor: 'muted' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name || !namespace) return;
    try {
      await updatePeer.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('BGPPeer updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update BGPPeer');
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
          <SectionCard icon={Network} title="BGP Peer Spec" tooltip={<p className="text-xs text-muted-foreground">MetalLB BGP session config</p>}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Peer Address" value={<span className="font-mono text-xs">{peer?.spec?.peerAddress ?? '—'}</span>} />
              <DetailRow label="Peer ASN" value={peer?.spec?.peerASN ?? '—'} />
              <DetailRow label="My ASN" value={peer?.spec?.myASN ?? '—'} />
              <DetailRow label="Hold Time" value={peer?.spec?.holdTime ?? '—'} />
              <DetailRow label="Keepalive Time" value={peer?.spec?.keepaliveTime ?? '—'} />
              <DetailRow label="Router ID" value={<span className="font-mono text-xs">{peer?.spec?.routerID ?? '—'}</span>} />
              <DetailRow label="Age" value={age} />
            </div>
          </SectionCard>
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LabelList labels={peer?.metadata?.labels ?? {}} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <AnnotationList annotations={peer?.metadata?.annotations ?? {}} />
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={peerName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="bgppeers"
          resourceKind="BGPPeer"
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
          { icon: Download, label: 'Download YAML', description: 'Export BGPPeer definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export BGPPeer as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete BGPPeer', description: 'Remove this BGP peer', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="BGPPeer"
        resourceIcon={Network}
        name={peerName}
        status={status}
        backLink="/bgppeers"
        backLabel="BGP Peers"
        createdLabel={age}
        createdAt={peer?.metadata?.creationTimestamp}
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
        resourceType="BGPPeer"
        resourceName={peerName}
        namespace={namespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deletePeer.mutateAsync({ name, namespace });
            navigate('/bgppeers');
          } else {
            toast.success(`BGPPeer ${peerName} deleted (demo mode)`);
            navigate('/bgppeers');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
