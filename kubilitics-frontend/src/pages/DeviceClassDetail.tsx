import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Cpu, Clock, Download, Trash2, Info, FileCode, GitCompare, Network } from 'lucide-react';
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
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sDeviceClass extends KubernetesResource {
  spec?: {
    config?: Array<{ opaque?: { driver?: string; parameters?: unknown } }>;
    selectors?: Array<{ cel?: { expression?: string } }>;
    extendedResourceName?: string;
  };
}

function formatSelectors(dc: K8sDeviceClass): string {
  const sel = dc.spec?.selectors;
  if (!sel?.length) return '—';
  return sel.map((s) => s.cel?.expression ?? '—').filter((e) => e !== '—').join('\n\n') || '—';
}

function formatConfig(dc: K8sDeviceClass): string {
  const cfg = dc.spec?.config;
  if (!cfg?.length) return '—';
  return cfg.map((c) => c.opaque?.driver ?? '—').filter((d) => d !== '—').join(', ') || '—';
}

export default function DeviceClassDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('DeviceClass', name ?? undefined, undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: dc, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<K8sDeviceClass>(
    'deviceclasses',
    name ?? '',
    undefined,
    undefined as unknown as K8sDeviceClass
  );
  const { events, refetch: refetchEvents } = useResourceEvents('DeviceClass', '', name ?? undefined);
  const deleteDC = useDeleteK8sResource('deviceclasses');
  const updateDC = useUpdateK8sResource('deviceclasses');

  useEffect(() => {
    if (!name?.trim()) navigate('/deviceclasses', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dc?.metadata?.name || 'deviceclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, dc?.metadata?.name]);

  const handleDownloadJson = useCallback(() => {
    if (!dc) return;
    downloadResourceJson(dc, `${dc?.metadata?.name || 'deviceclass'}.json`);
    toast.success('JSON downloaded');
  }, [dc]);

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

  if (isConnected && name && !dc?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <div className="rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">DeviceClass not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/deviceclasses')}>
            Back to Device Classes
          </Button>
        </div>
      </div>
    );
  }

  const selectorsStr = formatSelectors(dc as K8sDeviceClass);
  const configStr = formatConfig(dc as K8sDeviceClass);
  const extendedName = dc?.spec?.extendedResourceName ?? '—';

  const dcName = dc?.metadata?.name ?? '';
  const status: ResourceStatus = 'Healthy';

  const statusCards = [
    { label: 'Extended Resource', value: extendedName, icon: Cpu, iconColor: 'primary' as const },
    { label: 'Config Drivers', value: configStr, icon: Cpu, iconColor: 'info' as const },
    { label: 'Selectors', value: selectorsStr.length > 40 ? `${selectorsStr.slice(0, 37)}…` : selectorsStr, icon: Cpu, iconColor: 'muted' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!name) return;
    try {
      await updateDC.mutateAsync({ name, namespace: '', yaml: newYaml });
      toast.success('DeviceClass updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update DeviceClass');
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
            metadata={dc?.metadata ?? { name: dcName }}
            createdLabel={age}
          />
          <SectionCard icon={Cpu} title="Device Class Spec" tooltip={<p className="text-xs text-muted-foreground">DRA device presets</p>}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Extended Resource Name</p><p className="font-mono text-xs">{extendedName}</p></div>
              <div><p className="text-muted-foreground mb-1">Config Drivers</p><p className="font-mono text-xs">{configStr}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
              {dc?.spec?.selectors?.length ? (
                <div className="col-span-full">
                  <p className="text-muted-foreground mb-1">CEL Selectors</p>
                  <div className="space-y-2">
                    {dc.spec.selectors.map((s, i) => (
                      <pre key={i} className="p-3 rounded-lg bg-muted/50 text-xs font-mono overflow-x-auto">{s.cel?.expression ?? '—'}</pre>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
      ),
    },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={dcName} editable onSave={handleSaveYaml} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind="DeviceClass"
          namespace=""
          name={name ?? ''}
          sourceResourceType="DeviceClass"
          sourceResourceName={dc?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="deviceclasses"
          resourceKind="DeviceClass"
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
          { icon: Download, label: 'Download YAML', description: 'Export DeviceClass definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export DeviceClass as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete DeviceClass', description: 'Remove this device class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="DeviceClass"
        resourceIcon={Cpu}
        name={dcName}
        status={status}
        backLink="/deviceclasses"
        backLabel="Device Classes"
        createdLabel={age}
        createdAt={dc?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            {extendedName !== '—' && <span className="font-mono text-xs">{extendedName}</span>}
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
        resourceType="DeviceClass"
        resourceName={dcName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteDC.mutateAsync({ name, namespace: '' });
            navigate('/deviceclasses');
          } else {
            toast.success(`DeviceClass ${dcName} deleted (demo mode)`);
            navigate('/deviceclasses');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
