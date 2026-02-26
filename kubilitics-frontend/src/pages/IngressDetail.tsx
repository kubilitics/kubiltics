import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Globe, Clock, Download, Trash2, Lock, ExternalLink, Activity, Shield, Route, Server, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResourceDetailLayout,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  SectionCard,
  DetailRow,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
  type EventInfo,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useQuery } from '@tanstack/react-query';
import { getSecretTLSInfo } from '@/services/backendApiClient';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface IngressResource extends KubernetesResource {
  spec?: {
    ingressClassName?: string;
    rules?: Array<{
      host?: string;
      http?: {
        paths: Array<{
          path: string;
          pathType: string;
          backend: {
            service?: { name: string; port: { number?: number; name?: string } };
          };
        }>;
      };
    }>;
    tls?: Array<{ hosts?: string[]; secretName?: string }>;
    defaultBackend?: { service?: { name: string; port: { number?: number; name?: string } } };
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}


const VALID_TAB_IDS = new Set(['overview', 'routing', 'tls', 'traffic', 'backends', 'events', 'metrics', 'yaml', 'compare', 'controller', 'waf', 'actions']);

function daysRemainingColor(days: number): string {
  if (days < 0) return 'bg-red-900/30 text-red-900 dark:bg-red-950/50 dark:text-red-400';
  if (days <= 7) return 'bg-red-500/20 text-red-700 dark:text-red-400';
  if (days <= 30) return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-[hsl(142,76%,36%)]/20 text-[hsl(142,76%,36%)]';
}

function TLSCertCard({
  hosts,
  secretName,
  namespace,
  baseUrl,
  clusterId,
}: {
  hosts: string[];
  secretName: string;
  namespace: string;
  baseUrl: string | null;
  clusterId: string | null;
}) {
  const enabled = !!(baseUrl && clusterId && secretName);
  const { data: tlsInfo, isLoading, error } = useQuery({
    queryKey: ['secret-tls-info', clusterId, namespace, secretName],
    queryFn: () => getSecretTLSInfo(baseUrl!, clusterId!, namespace, secretName),
    enabled,
    staleTime: 60_000,
  });
  const hasCert = tlsInfo?.hasValidCert;
  const days = tlsInfo?.daysRemaining ?? 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Certificate — {(hosts.length ? hosts.join(', ') : '*') || '—'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow label="Hosts" value={hosts.length ? hosts.join(', ') : '—'} />
          <DetailRow
            label="Secret"
            value={
              secretName ? (
                <Link to={`/secrets/${namespace}/${secretName}`} className="text-primary hover:underline font-mono">
                  {secretName}
                </Link>
              ) : (
                '—'
              )
            }
          />
          {!enabled && <DetailRow label="Certificate status" value={<span className="text-muted-foreground text-sm">Connect to backend and select cluster to load certificate details.</span>} />}
          {enabled && isLoading && <DetailRow label="Certificate status" value={<span className="text-muted-foreground text-sm">Loading…</span>} />}
          {enabled && error && <DetailRow label="Certificate status" value={<span className="text-destructive text-sm">{error instanceof Error ? error.message : 'Failed to load'}</span>} />}
          {enabled && hasCert && tlsInfo && (
            <>
              <DetailRow label="Issuer" value={tlsInfo.issuer ?? '—'} />
              <DetailRow label="Subject" value={tlsInfo.subject ?? '—'} />
              <DetailRow label="Valid From" value={tlsInfo.validFrom ?? '—'} />
              <DetailRow label="Valid To" value={tlsInfo.validTo ?? '—'} />
              <DetailRow
                label="Days Remaining"
                value={
                  <Badge className={cn('font-mono', daysRemainingColor(days))}>
                    {days < 0 ? `Expired ${-days}d ago` : `${days} days`}
                  </Badge>
                }
              />
            </>
          )}
          {enabled && !isLoading && !error && !hasCert && tlsInfo?.error && <DetailRow label="Certificate status" value={<span className="text-muted-foreground text-sm">{tlsInfo.error}</span>} />}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {secretName && (
            <Link to={`/secrets/${namespace}/${secretName}`}>
              <Button variant="outline" size="sm">View Secret</Button>
            </Link>
          )}
          {hasCert && (
            <Badge className={cn('text-xs', daysRemainingColor(days))}>
              {days < 0 ? 'Expired' : days <= 7 ? 'Expires soon' : days <= 30 ? 'Expires in <30d' : 'Healthy'}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function IngressDetail() {
  const { namespace: nsParam, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') || 'overview';
  const initialTab = VALID_TAB_IDS.has(tabFromUrl) ? tabFromUrl : 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const namespace = nsParam ?? '';

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);

  const { resource: ing, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<IngressResource>(
    'ingresses',
    name,
    nsParam,
    undefined
  );
  const resourceEvents = useResourceEvents('Ingress', namespace, name ?? undefined);
  const events = resourceEvents.events;

  const deleteIngress = useDeleteK8sResource('ingresses');
  const updateIngress = useUpdateK8sResource('ingresses');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const ingName = ing.metadata?.name || '';
  const ingNamespace = ing.metadata?.namespace || '';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ingName || 'ingress'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, ingName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(ing, `${ingName || 'ingress'}.json`);
    toast.success('JSON downloaded');
  }, [ing, ingName]);

  const annotations = ing.metadata?.annotations || {};
  const ingressClassName = ing.spec?.ingressClassName || '-';
  const rules = ing.spec?.rules || [];
  const tls = ing.spec?.tls || [];
  const lbIngress = ing.status?.loadBalancer?.ingress || [];
  const address = lbIngress[0]?.ip || lbIngress[0]?.hostname || '-';
  const status: ResourceStatus = address !== '-' ? 'Healthy' : 'Warning';
  const tlsStatusLabel = tls.length > 0 ? 'Valid' : 'Disabled';

  // Mock YAML versions for comparison
  const yamlVersions: YamlVersion[] = [
    { id: 'current', label: 'Current Version', yaml, timestamp: 'now' },
    { id: 'previous', label: 'Previous Version', yaml: yaml.replace('app.example.com', 'old.example.com'), timestamp: '2 hours ago' },
    { id: 'initial', label: 'Initial Version', yaml: yaml.replace('/api', '/v1/api'), timestamp: '1 day ago' },
  ];

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update Ingress');
      throw new Error('Not connected');
    }
    try {
      await updateIngress.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('Ingress updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, namespace, updateIngress, refetch]);


  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === 'overview') next.delete('tab');
      else next.set('tab', tabId);
      return next;
    });
  }, [setSearchParams]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!ing?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'Ingress not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/ingresses')}>
              Back to Ingresses
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hostsCount = rules.reduce((acc, r) => acc + (r.host ? 1 : 0), 0) || rules.length;
  const rulesCount = rules.reduce((acc, r) => acc + (r.http?.paths?.length ?? 0), 0);
  const defaultBackendService = (ing.spec as { defaultBackend?: { service?: { name?: string; port?: { number?: number; name?: string } } } })?.defaultBackend?.service?.name;
  const defaultBackendPort = (ing.spec as { defaultBackend?: { service?: { port?: { number?: number; name?: string } } } })?.defaultBackend?.service?.port?.number ?? (ing.spec as { defaultBackend?: { service?: { port?: { name?: string } } } })?.defaultBackend?.service?.port?.name ?? '—';
  const statusCards = [
    { label: 'Status', value: status, icon: Globe, iconColor: 'primary' as const },
    { label: 'Hosts', value: String(hostsCount), icon: Globe, iconColor: 'info' as const },
    { label: 'TLS', value: tlsStatusLabel, icon: Lock, iconColor: tls.length > 0 ? 'success' as const : 'muted' as const },
    { label: 'Rules', value: String(rulesCount), icon: Route, iconColor: 'muted' as const },
    { label: 'Addresses', value: address !== '-' ? address : (lbIngress.length ? String(lbIngress.length) : '—'), icon: ExternalLink, iconColor: address !== '-' ? ('success' as const) : ('muted' as const) },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Ingress info" icon={Globe}>
            <DetailRow label="Class" value={ingressClassName} />
            <DetailRow label="Default backend" value={ing.spec?.defaultBackend ? `${(ing.spec as { defaultBackend?: { service?: { name: string } } }).defaultBackend?.service?.name ?? '—'}` : '—'} />
            <DetailRow label="Age" value={age} />
          </SectionCard>
          {rules.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
              <CardContent>
                {rules.map((rule, idx) => (
                  <div key={rule.host || idx} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      <span className="font-mono font-medium">{rule.host || '*'}</span>
                    </div>
                    <div className="ml-6 space-y-2">
                      {(rule.http?.paths || []).map((path, pIdx) => (
                        <div key={path.path || pIdx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline">{path.pathType}</Badge>
                            <span className="font-mono text-sm">{path.path}</span>
                          </div>
                          <div className="font-mono text-sm text-muted-foreground">
                            → {path.backend?.service?.name ?? '—'}:{path.backend?.service?.port?.number ?? path.backend?.service?.port?.name ?? '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {tls.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">TLS Configuration</CardTitle></CardHeader>
              <CardContent>
                {tls.map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-[hsl(var(--success))]" />
                      <span className="font-mono text-sm">{(t.hosts || []).join(', ')}</span>
                    </div>
                    <Link to={`/secrets/${namespace}/${t.secretName}`}><Badge variant="secondary">{t.secretName}</Badge></Link>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {Object.keys(annotations).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Annotations</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(annotations).map(([key, value]) => (
                    <div key={key} className="text-sm">
                      <p className="text-muted-foreground">{key}</p>
                      <p className="font-mono break-all">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'routing',
      label: 'Routing Rules',
      content: (
        <div className="space-y-6">
          {/* Visual routing diagram: Host → Path → Service:Port */}
          <SectionCard title="Visual Routing Diagram" icon={Route}>
            {rules.length === 0 ? (
              <p className="text-muted-foreground text-sm">No rules defined.</p>
            ) : (
              <div className="space-y-4">
                {rules.map((rule, idx) => (
                  <div key={rule.host || idx} className="rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex items-center gap-2 font-mono font-medium text-primary mb-3">
                      <Globe className="h-4 w-4" />
                      Host: {rule.host || '*'}
                      {(rule.host || '').includes('*') && <Badge variant="secondary" className="text-xs">Wildcard</Badge>}
                    </div>
                    <div className="ml-4 space-y-2">
                      {(rule.http?.paths || []).map((path, pIdx) => (
                        <div key={pIdx} className="flex items-center gap-3 flex-wrap text-sm">
                          <Badge variant="outline">{path.pathType}</Badge>
                          <span className="font-mono">{path.path}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono">
                            {path.backend?.service?.name ?? '—'}:{path.backend?.service?.port?.number ?? path.backend?.service?.port?.name ?? '—'}
                          </span>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toast.info('Test route: coming soon')}>Test</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          {/* Rules table: Host | Path | Path Type | Backend Service | Backend Port */}
          <SectionCard title="Routing table" icon={Route} tooltip={<p className="text-xs text-muted-foreground">Host, path, path type, and backend service per rule</p>}>
            {rules.length === 0 ? (
              <p className="text-muted-foreground text-sm">No routing rules.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Host</th>
                      <th className="text-left p-3 font-medium">Path</th>
                      <th className="text-left p-3 font-medium">Path Type</th>
                      <th className="text-left p-3 font-medium">Backend Service</th>
                      <th className="text-left p-3 font-medium">Backend Port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.flatMap((rule, rIdx) =>
                      (rule.http?.paths || []).map((path, pIdx) => {
                        const host = rule.host || '*';
                        const isWildcard = !rule.host || rule.host.includes('*');
                        const svcName = path.backend?.service?.name;
                        const portVal = path.backend?.service?.port?.number ?? path.backend?.service?.port?.name ?? '—';
                        const pathTypeLabel = `${path.pathType}: ${path.path}`;
                        return (
                          <tr key={`${rIdx}-${pIdx}`} className="border-b border-border/60 hover:bg-muted/20">
                            <td className={isWildcard ? 'p-3 font-mono italic text-muted-foreground' : 'p-3 font-mono'}>{host}</td>
                            <td className="p-3 font-mono">{path.path}</td>
                            <td className="p-3"><Badge variant="outline" className="font-normal">{pathTypeLabel}</Badge></td>
                            <td className="p-3">
                              {svcName ? (
                                <Link to={`/services/${ingNamespace}/${svcName}`} className="text-primary hover:underline font-mono">{svcName}</Link>
                              ) : (
                                <span className="font-mono text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="p-3 font-mono">{portVal}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          {/* Default backend */}
          {(defaultBackendService || defaultBackendPort !== '—') && (
            <SectionCard title="Default Backend" icon={Server}>
              <p className="text-sm text-muted-foreground">When no rule matches:</p>
              <p className="font-mono mt-1">
                {defaultBackendService ? (
                  <Link to={`/services/${ingNamespace}/${defaultBackendService}`} className="text-primary hover:underline">{defaultBackendService}</Link>
                ) : (
                  '—'
                )}:{defaultBackendPort}
              </p>
            </SectionCard>
          )}
          <SectionCard title="Path conflict detection" icon={Route}>
            <p className="text-muted-foreground text-sm">Overlapping path detection across ingresses requires cluster-wide analysis. No conflicts detected for this ingress.</p>
          </SectionCard>
        </div>
      ),
    },
    {
      id: 'tls',
      label: 'TLS/SSL',
      content: tls.length === 0 ? (
        <SectionCard title="TLS/SSL" icon={Lock}><p className="text-muted-foreground text-sm">No TLS configured</p></SectionCard>
      ) : (
        <div className="space-y-6">
          {tls.map((t, idx) => (
            <TLSCertCard
              key={idx}
              hosts={t.hosts ?? []}
              secretName={t.secretName ?? ''}
              namespace={ingNamespace}
              baseUrl={baseUrl}
              clusterId={clusterId ?? null}
            />
          ))}
          <p className="text-muted-foreground text-xs">Certificate details are loaded from the cluster via the backend. Days remaining: green &gt;30d, orange 7–30d, red &lt;7d, dark red expired.</p>
        </div>
      ),
    },
    {
      id: 'traffic',
      label: 'Traffic Analytics',
      content: (
        <SectionCard title="Traffic Analytics" icon={Activity}>
          <p className="text-muted-foreground text-sm mb-3">Requires metrics pipeline integration.</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Traffic by Host / Traffic by Path</li>
            <li>Status code distribution (2xx, 3xx, 4xx, 5xx)</li>
            <li>Latency by route (P50 / P95 / P99)</li>
            <li>Top clients (IP / User-Agent)</li>
            <li>Geographic distribution (GeoIP)</li>
            <li>Bandwidth (ingress/egress per host)</li>
          </ul>
        </SectionCard>
      ),
    },
    {
      id: 'backends',
      label: 'Backend Health',
      content: (
        <SectionCard title="Backend Health" icon={Server}>
          <p className="text-muted-foreground text-sm mb-2">Health status of each backend service and its endpoints.</p>
          {rules.length === 0 && !defaultBackendService ? (
            <p className="text-muted-foreground text-sm">No backends defined.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {defaultBackendService && <li className="font-mono">Default: {defaultBackendService} (endpoints: —)</li>}
              {Array.from(new Set(rules.flatMap((r) => (r.http?.paths || []).map((p) => p.backend?.service?.name).filter(Boolean) as string[]))).map((svc) => <li key={svc} className="font-mono">{svc} — endpoints: —</li>)}
            </ul>
          )}
        </SectionCard>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'metrics', label: 'Metrics', content: <SectionCard title="Metrics" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder until metrics pipeline.</p></SectionCard> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={ingName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="ingresses"
          resourceKind="Ingress"
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
          kind={normalizeKindForTopology('Ingress')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Ingress"
          sourceResourceName={ing?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    { id: 'controller', label: 'Controller Status', content: <SectionCard title="Controller status" icon={Globe}><p className="text-muted-foreground text-sm">Placeholder for ingress controller status.</p></SectionCard> },
    { id: 'waf', label: 'WAF & Security', content: <SectionCard title="WAF & Security" icon={Shield}><p className="text-muted-foreground text-sm">Annotations only when present.</p><div className="mt-2 text-sm">{Object.entries(annotations).filter(([k]) => k.toLowerCase().includes('waf') || k.toLowerCase().includes('auth')).length ? Object.entries(annotations).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>) : 'No WAF/security annotations'}</div></SectionCard> },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Route, label: 'Test All Routes', description: 'Test all route endpoints', onClick: () => toast.info('Test all routes: coming soon') },
          { icon: Lock, label: 'Refresh Certificate', description: 'Refresh TLS certificate (cert-manager)', onClick: () => toast.info('Requires cert-manager') },
          { icon: Lock, label: 'View Certificate', description: 'View TLS secret', onClick: () => tls[0]?.secretName ? navigate(`/secrets/${namespace}/${tls[0].secretName}`) : toast.info('No TLS configured') },
          { icon: ExternalLink, label: 'Open in Browser', description: 'Open external URL', onClick: () => { const u = lbIngress[0]?.hostname || lbIngress[0]?.ip; if (u) window.open(`http://${u}`, '_blank'); else toast.info('No address'); } },
          { icon: Download, label: 'Download YAML', description: 'Export Ingress definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Ingress as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Ingress', description: 'Remove this ingress', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Ingress"
        resourceIcon={Globe}
        name={ingName}
        namespace={ingNamespace}
        status={status}
        backLink="/ingresses"
        backLabel="Ingresses"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Ingress"
        resourceName={ingName}
        namespace={ingNamespace}
        onConfirm={async () => {
          if (isConnected && name && ingNamespace) {
            await deleteIngress.mutateAsync({ name, namespace: ingNamespace });
            navigate('/ingresses');
          } else {
            toast.success(`Ingress ${ingName} deleted (demo mode)`);
            navigate('/ingresses');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
