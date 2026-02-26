import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileJson, Clock, Download, Trash2, Copy, Edit, Info, Network, Loader2, FileCode, GitCompare, Maximize2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { getConfigMapConsumers, BackendApiError } from '@/services/backendApiClient';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { downloadResourceJson } from '@/lib/exportUtils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ConfigMapResource extends KubernetesResource {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  immutable?: boolean;
}

const PREVIEW_LEN = 200;
const HEX_PREVIEW_BYTES = 32;

function detectValueFormat(value: string): 'json' | 'yaml' | 'properties' | 'text' {
  const t = value.trim();
  if (!t) return 'text';
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(value); return 'json'; } catch { /* fallback */ }
  }
  if (t.includes('\n') && /^[\w-]+:/.test(t)) return 'yaml';
  if (/^[\w.-]+=.*/m.test(t)) return 'properties';
  return 'text';
}

function getFileExtension(key: string, format: string): string {
  if (format === 'json') return key.endsWith('.json') ? '.json' : '.json';
  if (format === 'yaml') return key.endsWith('.yaml') || key.endsWith('.yml') ? '' : '.yaml';
  return '.txt';
}

export default function ConfigMapDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('ConfigMap', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: cm, isLoading, error: resourceError, age, yaml, isConnected, refetch } = useResourceDetail<ConfigMapResource>(
    'configmaps',
    name,
    namespace,
    undefined as unknown as ConfigMapResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ConfigMap', namespace, name ?? undefined);
  const deleteConfigMap = useDeleteK8sResource('configmaps');
  const updateConfigMap = useUpdateK8sResource('configmaps');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [expandKey, setExpandKey] = useState<string | null>(null);
  const [expandValue, setExpandValue] = useState<string>('');

  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const consumersQuery = useQuery({
    queryKey: ['configmap-consumers', clusterId, namespace, name],
    queryFn: () => getConfigMapConsumers(baseUrl!, clusterId!, namespace ?? '', name!),
    enabled: !!(isBackendConfigured() && clusterId && namespace && name),
    staleTime: 30_000,
  });
  const consumers = consumersQuery.data;

  const data = cm.data || {};
  const dataKeysCount = Object.keys(data).length + (cm.binaryData ? Object.keys(cm.binaryData).length : 0);
  const totalSizeBytes = useMemo(() => {
    let n = 0;
    if (cm.data) for (const v of Object.values(cm.data)) n += (v ?? '').length;
    if (cm.binaryData) for (const v of Object.values(cm.binaryData)) n += (typeof v === 'string' ? v.length : 0);
    return n;
  }, [cm.data, cm.binaryData]);

  const status: ResourceStatus = 'Healthy';
  const labels = cm.metadata?.labels || {};
  const cmName = cm.metadata?.name || '';
  const cmNamespace = cm.metadata?.namespace || '';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cmName || 'configmap'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, cmName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(cm, `${cmName || 'configmap'}.json`);
    toast.success('JSON downloaded');
  }, [cm, cmName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!namespace || !name) return;
    try {
      await updateConfigMap.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('ConfigMap updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update ConfigMap');
      throw e;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (resourceError) {
    const isBackend404 = resourceError instanceof BackendApiError && resourceError.status === 404;
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-muted-foreground font-medium">Could not load ConfigMap.</p>
            <p className="text-sm text-muted-foreground">
              {isBackend404
                ? 'The backend returned 404. Ensure the Kubilitics backend is running (e.g. port 819) and the cluster is registered in Settings.'
                : resourceError instanceof Error ? resourceError.message : String(resourceError)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
              <Button variant="outline" onClick={() => navigate('/configmaps')}>Back to ConfigMaps</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isConnected && name && !cm?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">ConfigMap not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/configmaps')}>
              Back to ConfigMaps
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalSizeHuman = totalSizeBytes >= 1024 * 1024
    ? `${(totalSizeBytes / (1024 * 1024)).toFixed(1)} MiB`
    : totalSizeBytes >= 1024
      ? `${(totalSizeBytes / 1024).toFixed(1)} KiB`
      : `${totalSizeBytes} B`;
  const usedByCount = consumers
    ? (consumers.pods?.length ?? 0) + (consumers.deployments?.length ?? 0) + (consumers.statefulSets?.length ?? 0) + (consumers.daemonSets?.length ?? 0) + (consumers.jobs?.length ?? 0) + (consumers.cronJobs?.length ?? 0)
    : 0;
  const statusCards = [
    { label: 'Keys', value: dataKeysCount, icon: FileJson, iconColor: 'primary' as const },
    { label: 'Total Size', value: totalSizeHuman, icon: FileJson, iconColor: 'muted' as const },
    { label: 'Used By', value: usedByCount, icon: FileJson, iconColor: 'primary' as const },
    { label: 'Immutable', value: cm.immutable ? 'Yes' : 'No', icon: FileJson, iconColor: 'muted' as const },
  ];


  const usedByRows = useMemo(() => {
    if (!consumers) return [];
    const rows: { type: string; namespace: string; name: string; path: string }[] = [];
    const add = (type: string, pathPrefix: string, items: { namespace: string; name: string }[] | undefined) => {
      (items ?? []).forEach((ref) => rows.push({ type, namespace: ref.namespace, name: ref.name, path: `${pathPrefix}/${ref.namespace}/${ref.name}` }));
    };
    add('Pod', '/pods', consumers.pods);
    add('Deployment', '/deployments', consumers.deployments);
    add('StatefulSet', '/statefulsets', consumers.statefulSets);
    add('DaemonSet', '/daemonsets', consumers.daemonSets);
    add('Job', '/jobs', consumers.jobs);
    add('CronJob', '/cronjobs', consumers.cronJobs);
    return rows;
  }, [consumers]);

  const usedByContent = !namespace || !name ? (
    <p className="text-muted-foreground text-sm">No resource selected.</p>
  ) : !isBackendConfigured() || !clusterId ? (
    <p className="text-muted-foreground text-sm">Connect to Kubilitics backend to see which Pods and workloads use this ConfigMap.</p>
  ) : consumersQuery.isLoading ? (
    <Skeleton className="h-32 w-full" />
  ) : consumers ? (
    <div className="space-y-4">
      {usedByRows.length > 0 && (
        <>
          <p className="text-muted-foreground text-sm">Resources that reference this ConfigMap (volume, env, or envFrom).</p>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50"><th className="text-left p-3 font-medium">Resource Type</th><th className="text-left p-3 font-medium">Resource Name</th><th className="text-left p-3 font-medium">How Used</th><th className="text-left p-3 font-medium">Mount Path / Prefix</th></tr></thead>
              <tbody>
                {usedByRows.map((row) => (
                  <tr key={`${row.type}-${row.namespace}/${row.name}`} className="border-b">
                    <td className="p-3">{row.type}</td>
                    <td className="p-3">
                      <button type="button" className="text-primary hover:underline font-mono text-sm" onClick={() => navigate(row.path)}>{row.name}</button>
                      <span className="text-muted-foreground text-xs ml-1">({row.namespace})</span>
                    </td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(consumers.pods?.length ?? 0) > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              Impact: Changing this ConfigMap will require restart of <strong>{consumers.pods?.length ?? 0} pod(s)</strong> to pick up changes (when mounted as volume or used in env).
            </p>
          )}
        </>
      )}
      {usedByRows.length === 0 && (
        <p className="text-muted-foreground text-sm">No consumers found.</p>
      )}
    </div>
  ) : (
    <p className="text-muted-foreground text-sm">Could not load consumers.</p>
  );

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: Info,
      content: (
        <div className="space-y-6">
          <SectionCard
            icon={Info}
            title="ConfigMap information"
            tooltip={<p className="text-xs text-muted-foreground">Identity and metadata for this ConfigMap</p>}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Name</p><p className="font-mono">{cmName}</p></div>
              <div><p className="text-muted-foreground mb-1">Namespace</p><p className="font-mono">{cmNamespace}</p></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
              <div><p className="text-muted-foreground mb-1">Data keys</p><p className="font-mono">{dataKeysCount}</p></div>
              <div><p className="text-muted-foreground mb-1">Immutable</p><Badge variant="outline">{cm.immutable ? 'Yes' : 'No'}</Badge></div>
            </div>
          </SectionCard>
          <SectionCard
            icon={FileJson}
            title="Data keys"
            tooltip={<p className="text-xs text-muted-foreground">Keys defined in this ConfigMap (see Data tab for values)</p>}
          >
            <div className="flex flex-wrap gap-2">
              {Object.keys(data).map((key) => (
                <Badge key={key} variant="secondary" className="font-mono">{key}</Badge>
              ))}
              {cm.binaryData && Object.keys(cm.binaryData).map((key) => (
                <Badge key={`binary-${key}`} variant="secondary" className="font-mono">{key} (binary)</Badge>
              ))}
              {dataKeysCount === 0 && <p className="text-muted-foreground text-sm">No keys</p>}
            </div>
          </SectionCard>
          <SectionCard icon={Info} title="Labels" tooltip={<p className="text-xs text-muted-foreground">Kubernetes labels on this ConfigMap</p>}>
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
    {
      id: 'data',
      label: 'Data',
      icon: FileJson,
      content: (
        <div className="space-y-6">
          {Object.entries(data).length > 0 && (
            <SectionCard title="Data keys" icon={FileJson} tooltip={<p className="text-xs text-muted-foreground">Per-key value preview, copy, and download</p>}>
              <div className="space-y-4">
                {Object.entries(data).map(([key, value]) => {
                  const size = (value ?? '').length;
                  const preview = (value ?? '').length <= PREVIEW_LEN ? (value ?? '') : (value ?? '').slice(0, PREVIEW_LEN) + '…';
                  const format = detectValueFormat(value ?? '');
                  const ext = getFileExtension(key, format);
                  return (
                    <Card key={key}>
                      <CardHeader className="flex flex-row items-center justify-between py-3 gap-2">
                        <CardTitle className="text-sm font-mono truncate">{key}</CardTitle>
                        <span className="text-xs text-muted-foreground shrink-0">{size} B</span>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <pre className="p-3 rounded-lg bg-muted/80 text-sm font-mono overflow-auto max-h-40 whitespace-pre-wrap break-words">{preview}</pre>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setExpandKey(key); setExpandValue(value ?? ''); }}>
                            <Maximize2 className="h-3.5 w-3.5" /> Expand
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(value ?? ''); toast.success('Value copied'); }}>
                            <Copy className="h-3.5 w-3.5" /> Copy Value
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { const blob = new Blob([value ?? ''], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${key}${ext}`; a.click(); URL.revokeObjectURL(url); toast.success('Downloaded'); }}>
                            <Download className="h-3.5 w-3.5" /> Download as File
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </SectionCard>
          )}
          {cm.binaryData && Object.keys(cm.binaryData).length > 0 && (
            <SectionCard title="Binary data" icon={FileJson} tooltip={<p className="text-xs text-muted-foreground">Base64-encoded keys with hex preview</p>}>
              <div className="space-y-3">
                {Object.entries(cm.binaryData).map(([key, b64]) => {
                  let decodedLength = 0;
                  let hexPreview = '—';
                  try {
                    const bin = atob(b64 ?? '');
                    decodedLength = bin.length;
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    hexPreview = Array.from(bytes.slice(0, HEX_PREVIEW_BYTES)).map((b) => b.toString(16).padStart(2, '0')).join(' ') + (bytes.length > HEX_PREVIEW_BYTES ? '…' : '');
                  } catch { /* ignore */ }
                  return (
                    <div key={key} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border bg-muted/30">
                      <span className="font-mono text-sm">{key}</span>
                      <span className="text-xs text-muted-foreground">{decodedLength} B</span>
                      <code className="text-xs font-mono text-muted-foreground break-all w-full">{hexPreview}</code>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { try { const bin = atob(b64 ?? ''); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const blob = new Blob([bytes]); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = key; a.click(); URL.revokeObjectURL(url); toast.success('Downloaded'); } catch { toast.error('Failed to decode'); } }}>
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
          {Object.keys(data).length === 0 && !(cm.binaryData && Object.keys(cm.binaryData).length > 0) && (
            <p className="text-muted-foreground text-sm">No data keys.</p>
          )}
          <Dialog open={!!expandKey} onOpenChange={(open) => { if (!open) setExpandKey(null); }}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">{expandKey ?? ''}</DialogTitle>
              </DialogHeader>
              <pre className="p-4 rounded-lg bg-muted text-sm font-mono overflow-auto flex-1 min-h-0 whitespace-pre-wrap break-words">{expandValue}</pre>
            </DialogContent>
          </Dialog>
        </div>
      ),
    },
    { id: 'used-by', label: 'Used By', icon: FileJson, content: usedByContent },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={cmName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="configmaps"
          resourceKind="ConfigMap"
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
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('ConfigMap')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="ConfigMap"
          sourceResourceName={cm?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Edit, label: 'Edit ConfigMap', description: 'Modify configuration data' },
          { icon: Copy, label: 'Duplicate', description: 'Create a copy of this ConfigMap' },
          { icon: Download, label: 'Download YAML', description: 'Export ConfigMap definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export ConfigMap as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete ConfigMap', description: 'Remove this ConfigMap', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ConfigMap"
        resourceIcon={FileJson}
        name={cmName}
        namespace={cmNamespace}
        status={status}
        backLink="/configmaps"
        backLabel="ConfigMaps"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
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
        resourceType="ConfigMap"
        resourceName={cmName}
        namespace={cmNamespace}
        onConfirm={async () => {
          if (isConnected && name && cmNamespace) {
            await deleteConfigMap.mutateAsync({ name, namespace: cmNamespace });
            navigate('/configmaps');
          } else {
            toast.success(`ConfigMap ${cmName} deleted (demo mode)`);
            navigate('/configmaps');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
