import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { History, Clock, Download, Trash2, Info, FileCode, GitCompare, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { NamespaceBadge } from '@/components/list';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sControllerRevision extends KubernetesResource {
  revision?: number;
  data?: unknown;
  metadata: KubernetesResource['metadata'] & {
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
}

export default function ControllerRevisionDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('ControllerRevision', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: cr, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sControllerRevision>(
    'controllerrevisions',
    name ?? '',
    namespace ?? undefined,
    undefined as unknown as K8sControllerRevision
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ControllerRevision', namespace ?? '', name ?? undefined);
  const deleteCR = useDeleteK8sResource('controllerrevisions');
  const updateCR = useUpdateK8sResource('controllerrevisions');

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/controllerrevisions', { replace: true });
  }, [name, namespace, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cr?.metadata?.name || 'controllerrevision'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, cr?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!cr) return;
    downloadResourceJson(cr, `${cr?.metadata?.name || 'controllerrevision'}.json`);
    toast.success('JSON downloaded');
  }, [cr]);

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

  if (isConnected && name && namespace && !cr?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">ControllerRevision not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/controllerrevisions')}>
            Back to Controller Revisions
          </Button>
        </div>
      </div>
    );
  }

  const crName = cr?.metadata?.name ?? '';
  const crNamespace = cr?.metadata?.namespace ?? namespace ?? '';
  const status: ResourceStatus = 'Healthy';
  const revision = (cr as K8sControllerRevision).revision ?? 0;
  const ownerRef = cr?.metadata?.ownerReferences?.find((r) => r.kind === 'StatefulSet' || r.kind === 'DaemonSet');
  const ownerKind = ownerRef?.kind ?? '—';
  const ownerName = ownerRef?.name ?? '—';
  const ownerLink = ownerKind === 'StatefulSet' && ownerName !== '—'
    ? `/statefulsets/${crNamespace}/${ownerName}`
    : ownerKind === 'DaemonSet' && ownerName !== '—'
      ? `/daemonsets/${crNamespace}/${ownerName}`
      : null;

  const statusCards = [
    { label: 'Namespace', value: crNamespace, icon: History, iconColor: 'primary' as const },
    { label: 'Owner', value: `${ownerKind}/${ownerName}`, icon: Layers, iconColor: 'info' as const },
    { label: 'Revision', value: String(revision), icon: History, iconColor: 'muted' as const },
  ];


  const handleSaveYaml = async (newYaml: string) => {
    if (!name || !namespace) return;
    try {
      await updateCR.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('ControllerRevision updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update ControllerRevision');
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
            metadata={cr?.metadata ?? { name: crName, namespace: crNamespace }}
            createdLabel={age}
          />
          <SectionCard icon={History} title="Revision Info" tooltip={<p className="text-xs text-muted-foreground">Controller revision metadata</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Revision</p><Badge variant="outline" className="font-mono">{revision}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Owner</p>{ownerLink ? <Link to={ownerLink} className="text-primary hover:underline font-mono text-sm">{ownerKind}/{ownerName}</Link> : <span>{ownerKind}/{ownerName}</span>}</div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
            </div>
          </SectionCard>
          {ownerLink && (
            <SectionCard icon={Layers} title="Parent Resource" tooltip={<p className="text-xs text-muted-foreground">The StatefulSet or DaemonSet this revision belongs to</p>}>
              <p className="text-sm text-muted-foreground mb-2">
                This ControllerRevision stores the template for revision {revision} of the {ownerKind}.
              </p>
              <Link to={ownerLink} className="text-primary hover:underline font-mono">
                {ownerKind}/{ownerName}
              </Link>
            </SectionCard>
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={crName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="controllerrevisions"
          resourceKind="ControllerRevision"
          namespace={crNamespace}
          initialSelectedResources={crNamespace && crName ? [`${crNamespace}/${crName}`] : [crName]}
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
          { icon: Download, label: 'Download YAML', description: 'Export ControllerRevision definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export ControllerRevision as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete ControllerRevision', description: 'Remove this revision (usually managed by the parent workload)', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ControllerRevision"
        resourceIcon={History}
        name={crName}
        namespace={crNamespace}
        status={status}
        backLink="/controllerrevisions"
        backLabel="Controller Revisions"
        createdLabel={age}
        createdAt={cr?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            <NamespaceBadge namespace={crNamespace} />
            <span className="mx-2">·</span>
            <Badge variant="secondary" className="font-mono">Rev {revision}</Badge>
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
        resourceType="ControllerRevision"
        resourceName={crName}
        namespace={crNamespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deleteCR.mutateAsync({ name, namespace });
            navigate('/controllerrevisions');
          } else {
            toast.success(`ControllerRevision ${crName} deleted (demo mode)`);
            navigate('/controllerrevisions');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
