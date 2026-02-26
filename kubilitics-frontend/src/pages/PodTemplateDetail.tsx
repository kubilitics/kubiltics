import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layers, Clock, Download, Trash2, Info, FileCode, GitCompare } from 'lucide-react';
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
import { NamespaceBadge } from '@/components/list';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sPodTemplate extends KubernetesResource {
  template?: {
    metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
    spec?: { containers?: Array<{ name: string; image?: string }> };
  };
}

export default function PodTemplateDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('PodTemplate', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: pt, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sPodTemplate>(
    'podtemplates',
    name ?? '',
    namespace ?? undefined,
    undefined as unknown as K8sPodTemplate
  );
  const { events, refetch: refetchEvents } = useResourceEvents('PodTemplate', namespace ?? '', name ?? undefined);
  const deletePT = useDeleteK8sResource('podtemplates');
  const updatePT = useUpdateK8sResource('podtemplates');

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/podtemplates', { replace: true });
  }, [name, namespace, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pt?.metadata?.name || 'podtemplate'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pt?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!pt) return;
    downloadResourceJson(pt, `${pt?.metadata?.name || 'podtemplate'}.json`);
    toast.success('JSON downloaded');
  }, [pt]);

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

  if (isConnected && name && namespace && !pt?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">PodTemplate not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/podtemplates')}>
            Back to Pod Templates
          </Button>
        </div>
      </div>
    );
  }

  const ptName = pt?.metadata?.name ?? '';
  const ptNamespace = pt?.metadata?.namespace ?? namespace ?? '';
  const status: ResourceStatus = 'Healthy';
  const template = pt?.template ?? {};
  const labels = template.metadata?.labels ?? pt?.metadata?.labels ?? {};
  const containers = template.spec?.containers ?? [];

  const statusCards = [
    { label: 'Namespace', value: ptNamespace, icon: Layers, iconColor: 'primary' as const },
    { label: 'Labels', value: Object.keys(labels).length > 0 ? `${Object.keys(labels).length} labels` : 'None', icon: Layers, iconColor: 'info' as const },
    { label: 'Containers', value: containers.length > 0 ? String(containers.length) : '0', icon: Layers, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name || !namespace) return;
    try {
      await updatePT.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('PodTemplate updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update PodTemplate');
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
            metadata={pt?.metadata ?? { name: ptName, namespace: ptNamespace }}
            createdLabel={age}
          />
          <SectionCard icon={Layers} title="Template Labels" tooltip={<p className="text-xs text-muted-foreground">Labels on the pod template</p>}>
            {Object.keys(labels).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(labels).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-xs">{k}={v}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No labels</p>
            )}
          </SectionCard>
          {containers.length > 0 && (
            <SectionCard icon={Layers} title="Containers" tooltip={<p className="text-xs text-muted-foreground">Containers in the pod template spec</p>}>
              <div className="space-y-2">
                {containers.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="font-mono text-sm">{c.name}</span>
                    <span className="text-muted-foreground text-sm">{(c as { image?: string }).image ?? '—'}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={ptName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="podtemplates"
          resourceKind="PodTemplate"
          namespace={ptNamespace}
          initialSelectedResources={ptNamespace && ptName ? [`${ptNamespace}/${ptName}`] : [ptName]}
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
          { icon: Download, label: 'Download YAML', description: 'Export PodTemplate definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export PodTemplate as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete PodTemplate', description: 'Remove this pod template', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="PodTemplate"
        resourceIcon={Layers}
        name={ptName}
        namespace={ptNamespace}
        status={status}
        backLink="/podtemplates"
        backLabel="Pod Templates"
        createdLabel={age}
        createdAt={pt?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            <NamespaceBadge namespace={ptNamespace} />
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
        resourceType="PodTemplate"
        resourceName={ptName}
        namespace={ptNamespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deletePT.mutateAsync({ name, namespace });
            navigate('/podtemplates');
          } else {
            toast.success(`PodTemplate ${ptName} deleted (demo mode)`);
            navigate('/podtemplates');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
