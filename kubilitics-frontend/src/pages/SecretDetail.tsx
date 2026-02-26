import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Clock, Download, Trash2, Eye, EyeOff, Edit, Copy, Info, Network, Loader2, FileCode, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { getSecretConsumers, getSecretTLSInfo } from '@/services/backendApiClient';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DetailRow } from '@/components/resources';

interface SecretResource extends KubernetesResource {
  type?: string;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  immutable?: boolean;
}

function daysRemainingColor(days: number): string {
  if (days < 0) return 'bg-red-900/30 text-red-900 dark:bg-red-950/50 dark:text-red-400';
  if (days <= 7) return 'bg-red-500/20 text-red-700 dark:text-red-400';
  if (days <= 30) return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-[hsl(142,76%,36%)]/20 text-[hsl(142,76%,36%)]';
}

export default function SecretDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('Secret', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { resource: s, isLoading, age, yaml, isConnected, refetch } = useResourceDetail<SecretResource>(
    'secrets',
    name,
    namespace,
    undefined as unknown as SecretResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('Secret', namespace, name ?? undefined);
  const deleteSecret = useDeleteK8sResource('secrets');
  const updateSecret = useUpdateK8sResource('secrets');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const consumersQuery = useQuery({
    queryKey: ['secret-consumers', clusterId, namespace, name],
    queryFn: () => getSecretConsumers(baseUrl!, clusterId!, namespace ?? '', name!),
    enabled: !!(isBackendConfigured() && clusterId && namespace && name),
    staleTime: 30_000,
  });
  const consumers = consumersQuery.data;

  const tlsInfoQuery = useQuery({
    queryKey: ['secret-tls-info', clusterId, namespace, name],
    queryFn: () => getSecretTLSInfo(baseUrl!, clusterId!, namespace ?? '', name!),
    enabled: !!(isBackendConfigured() && clusterId && namespace && name && (s?.type === 'kubernetes.io/tls')),
    staleTime: 60_000,
  });
  const tlsInfo = tlsInfoQuery.data;

  const toggleShow = (key: string) => setShowValues(prev => ({ ...prev, [key]: !prev[key] }));

  const decodeValue = useCallback((b64: string): string => {
    try {
      return atob(b64);
    } catch {
      return b64;
    }
  }, []);

  const copyDecoded = useCallback((key: string) => {
    const raw = data[key];
    if (raw == null) return;
    const decoded = decodeValue(raw);
    navigator.clipboard.writeText(decoded).then(
      () => toast.success(`Copied value of "${key}"`),
      () => toast.error('Copy failed')
    );
  }, [s.data, decodeValue]);

  const decodedSize = useCallback((b64: string): number => Math.round((b64?.length ?? 0) * 0.75), []);

  const data = s.data || {};
  const secretType = s.type || 'Opaque';
  const status: ResourceStatus = 'Healthy';
  const labels = s.metadata?.labels || {};
  const sName = s.metadata?.name || '';
  const sNamespace = s.metadata?.namespace || '';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sName || 'secret'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, sName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(s, `${sName || 'secret'}.json`);
    toast.success('JSON downloaded');
  }, [s, sName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!namespace || !name) return;
    try {
      await updateSecret.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('Secret updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update Secret');
      throw e;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && name && !s?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Secret not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/secrets')}>
              Back to Secrets
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalSizeBytes = Object.values(data).reduce((acc, v) => acc + (typeof v === 'string' ? v.length : 0), 0);
  const totalSizeHuman = totalSizeBytes >= 1024 * 1024 ? `${(totalSizeBytes / (1024 * 1024)).toFixed(1)} MiB` : totalSizeBytes >= 1024 ? `${(totalSizeBytes / 1024).toFixed(1)} KiB` : `${totalSizeBytes} B`;
  const usedByCount = consumers ? (consumers.pods?.length ?? 0) + (consumers.deployments?.length ?? 0) + (consumers.statefulSets?.length ?? 0) + (consumers.daemonSets?.length ?? 0) + (consumers.jobs?.length ?? 0) + (consumers.cronJobs?.length ?? 0) : 0;
  const statusCards = [
    { label: 'Type', value: secretType, icon: KeyRound, iconColor: 'primary' as const },
    { label: 'Keys', value: Object.keys(data).length, icon: KeyRound, iconColor: 'info' as const },
    { label: 'Size', value: totalSizeHuman, icon: KeyRound, iconColor: 'muted' as const },
    { label: 'Used By', value: usedByCount, icon: KeyRound, iconColor: 'primary' as const },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as const },
  ];


  const usedByContent = !namespace || !name ? (
    <p className="text-muted-foreground text-sm">No resource selected.</p>
  ) : !isBackendConfigured() || !clusterId ? (
    <p className="text-muted-foreground text-sm">Connect to Kubilitics backend to see which Pods and workloads use this Secret.</p>
  ) : consumersQuery.isLoading ? (
    <Skeleton className="h-32 w-full" />
  ) : consumers ? (
    <div className="space-y-4">
      {[
        { label: 'Pods', items: consumers.pods, path: (ns: string, n: string) => `/pods/${ns}/${n}` },
        { label: 'Deployments', items: consumers.deployments, path: (ns: string, n: string) => `/deployments/${ns}/${n}` },
        { label: 'StatefulSets', items: consumers.statefulSets, path: (ns: string, n: string) => `/statefulsets/${ns}/${n}` },
        { label: 'DaemonSets', items: consumers.daemonSets, path: (ns: string, n: string) => `/daemonsets/${ns}/${n}` },
        { label: 'Jobs', items: consumers.jobs, path: (ns: string, n: string) => `/jobs/${ns}/${n}` },
        { label: 'CronJobs', items: consumers.cronJobs, path: (ns: string, n: string) => `/cronjobs/${ns}/${n}` },
      ].filter((s) => (s.items?.length ?? 0) > 0).map((section) => (
        <Card key={section.label}>
          <CardHeader><CardTitle className="text-base">{section.label}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {(section.items ?? []).map((ref) => (
                <li key={`${ref.namespace}/${ref.name}`}>
                  <button type="button" className="text-primary hover:underline font-mono text-sm" onClick={() => navigate(section.path(ref.namespace, ref.name))}>
                    {ref.namespace}/{ref.name}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {!(consumers.pods?.length || consumers.deployments?.length || consumers.statefulSets?.length || consumers.daemonSets?.length || consumers.jobs?.length || consumers.cronJobs?.length) && (
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
            title="Secret information"
            tooltip={<p className="text-xs text-muted-foreground">Identity and metadata for this Secret</p>}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground mb-1">Name</p><p className="font-mono">{sName}</p></div>
              <div><p className="text-muted-foreground mb-1">Namespace</p><p className="font-mono">{sNamespace}</p></div>
              <div><p className="text-muted-foreground mb-1">Type</p><Badge variant="secondary">{secretType}</Badge></div>
              <div><p className="text-muted-foreground mb-1">Age</p><p>{age}</p></div>
              <div><p className="text-muted-foreground mb-1">Data keys</p><p className="font-mono">{Object.keys(data).length}</p></div>
              <div><p className="text-muted-foreground mb-1">Immutable</p><Badge variant="outline">{s.immutable ? 'Yes' : 'No'}</Badge></div>
            </div>
          </SectionCard>
          <SectionCard
            icon={KeyRound}
            title="Data keys"
            tooltip={<p className="text-xs text-muted-foreground">Keys defined in this Secret (see Data tab for values)</p>}
          >
            <div className="flex flex-wrap gap-2">
              {Object.keys(data).map((key) => (
                <Badge key={key} variant="secondary" className="font-mono">{key}</Badge>
              ))}
              {Object.keys(data).length === 0 && <p className="text-muted-foreground text-sm">No keys</p>}
            </div>
          </SectionCard>
          <SectionCard icon={Info} title="Labels" tooltip={<p className="text-xs text-muted-foreground">Kubernetes labels on this Secret</p>}>
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
      icon: KeyRound,
      content: (
        <div className="space-y-6">
          {/* TLS certificate section */}
          {secretType === 'kubernetes.io/tls' && (
            <SectionCard icon={KeyRound} title="TLS certificate" tooltip={<p className="text-xs text-muted-foreground">Parsed certificate info (raw cert data is not shown)</p>}>
              {!baseUrl || !clusterId ? (
                <p className="text-muted-foreground text-sm">Connect to backend and select cluster to load certificate details.</p>
              ) : tlsInfoQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : tlsInfo?.hasValidCert && tlsInfo ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <DetailRow label="Issuer" value={tlsInfo.issuer ?? '—'} />
                  <DetailRow label="Subject" value={tlsInfo.subject ?? '—'} />
                  <DetailRow label="Valid From" value={tlsInfo.validFrom ?? '—'} />
                  <DetailRow label="Valid To" value={tlsInfo.validTo ?? '—'} />
                  <DetailRow
                    label="Days Remaining"
                    value={
                      <Badge className={cn('font-mono', daysRemainingColor(tlsInfo.daysRemaining ?? 0))}>
                        {(tlsInfo.daysRemaining ?? 0) < 0 ? `Expired ${-(tlsInfo.daysRemaining ?? 0)}d ago` : `${tlsInfo.daysRemaining} days`}
                      </Badge>
                    }
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{tlsInfo?.error ?? 'No valid certificate in tls.crt'}</p>
              )}
            </SectionCard>
          )}

          {/* Docker config section */}
          {secretType === 'kubernetes.io/dockerconfigjson' && data['.dockerconfigjson'] && (() => {
            try {
              const decoded = decodeValue(data['.dockerconfigjson']);
              const parsed = JSON.parse(decoded) as { auths?: Record<string, { username?: string; password?: string; auth?: string }> };
              const auths = parsed?.auths ?? {};
              const entries = Object.entries(auths);
              if (entries.length === 0) return null;
              return (
                <SectionCard icon={KeyRound} title="Docker registries" tooltip={<p className="text-xs text-muted-foreground">Registry URLs and usernames (passwords masked)</p>}>
                  <div className="space-y-3">
                    {entries.map(([registry, cred]) => (
                      <div key={registry} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="font-mono text-primary">{registry}</span>
                        <span className="text-muted-foreground">username: {cred?.username ?? '—'}</span>
                        <span className="text-muted-foreground">password: ••••••••</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              );
            } catch {
              return null;
            }
          })()}

          {/* Per-key data table */}
          <SectionCard icon={KeyRound} title="Keys and values" tooltip={<p className="text-xs text-muted-foreground">Reveal or copy decoded values</p>}>
            {Object.keys(data).length === 0 ? (
              <p className="text-muted-foreground text-sm">No keys</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-medium">Key</TableHead>
                    <TableHead className="font-medium">Value</TableHead>
                    <TableHead className="font-medium w-20">Size</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-sm">{key}</TableCell>
                      <TableCell>
                        <pre className={cn("p-2 rounded bg-muted text-sm font-mono overflow-x-auto max-w-md", !showValues[key] && "select-none")}>
                          {showValues[key] ? decodeValue(value) : '••••••••••••'}
                        </pre>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{decodedSize(value)} B</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => toggleShow(key)} aria-label={showValues[key] ? 'Hide value' : 'Reveal value'}>
                            {showValues[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => copyDecoded(key)} aria-label="Copy value">
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      ),
    },
    { id: 'used-by', label: 'Used By', icon: KeyRound, content: usedByContent },
    { id: 'events', label: 'Events', icon: Clock, content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: FileCode, content: <YamlViewer yaml={yaml} resourceName={sName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="secrets"
          resourceKind="Secret"
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
          kind={normalizeKindForTopology('Secret')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Secret"
          sourceResourceName={s?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Edit, label: 'Edit Secret', description: 'Modify secret data' },
          { icon: Copy, label: 'Duplicate', description: 'Create a copy of this Secret' },
          { icon: Download, label: 'Download YAML', description: 'Export Secret definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Secret as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Secret', description: 'Remove this Secret', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Secret"
        resourceIcon={KeyRound}
        name={sName}
        namespace={sNamespace}
        status={status}
        backLink="/secrets"
        backLabel="Secrets"
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
        resourceType="Secret"
        resourceName={sName}
        namespace={sNamespace}
        onConfirm={async () => {
          if (isConnected && name && sNamespace) {
            await deleteSecret.mutateAsync({ name, namespace: sNamespace });
            navigate('/secrets');
          } else {
            toast.success(`Secret ${sName} deleted (demo mode)`);
            navigate('/secrets');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
