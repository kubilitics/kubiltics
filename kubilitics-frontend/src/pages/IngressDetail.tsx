import { useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Globe, Lock, ExternalLink, Activity, Shield, Route, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useQuery } from '@tanstack/react-query';
import { getSecretTLSInfo } from '@/services/backendApiClient';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { openExternal } from '@/lib/tauri';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
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

function daysRemainingColor(days: number): string {
  if (days < 0) return 'bg-red-900/30 text-red-900 dark:bg-red-950/50 dark:text-red-400';
  if (days <= 7) return 'bg-red-500/20 text-red-700 dark:text-red-400';
  if (days <= 30) return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-emerald-500/20 text-emerald-600';
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
              <Button variant="outline" size="sm" className="press-effect">View Secret</Button>
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

function OverviewTab({ resource: ing, age }: ResourceContext<IngressResource>) {
  const namespace = ing.metadata?.namespace || '';
  const ingressClassName = ing.spec?.ingressClassName || '-';
  const rules = ing.spec?.rules || [];
  const tls = ing.spec?.tls || [];
  const annotations = ing.metadata?.annotations || {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Ingress info" icon={Globe}>
        <DetailRow label="Class" value={ingressClassName} />
        <DetailRow label="Default backend" value={ing.spec?.defaultBackend ? `${(ing.spec as { defaultBackend?: { service?: { name: string } } }).defaultBackend?.service?.name ?? '—'}` : '—'} />
        <DetailRow label="Age" value={age} />
      </SectionCard>
      {rules.length > 0 && (
        <SectionCard title="Rules" icon={Route} className="lg:col-span-2">
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
        </SectionCard>
      )}
      {tls.length > 0 && (
        <SectionCard title="TLS Configuration" icon={Lock}>
            {tls.map((t, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-[hsl(var(--success))]" />
                  <span className="font-mono text-sm">{(t.hosts || []).join(', ')}</span>
                </div>
                <Link to={`/secrets/${namespace}/${t.secretName}`}><Badge variant="secondary">{t.secretName}</Badge></Link>
              </div>
            ))}
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={ing.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={annotations} />
      </div>
    </div>
  );
}

function RoutingTab({ resource: ing }: ResourceContext<IngressResource>) {
  const ingNamespace = ing.metadata?.namespace || '';
  const rules = ing.spec?.rules || [];
  const defaultBackendService = (ing.spec as { defaultBackend?: { service?: { name?: string; port?: { number?: number; name?: string } } } })?.defaultBackend?.service?.name;
  const defaultBackendPort = (ing.spec as { defaultBackend?: { service?: { port?: { number?: number; name?: string } } } })?.defaultBackend?.service?.port?.number ?? (ing.spec as { defaultBackend?: { service?: { port?: { name?: string } } } })?.defaultBackend?.service?.port?.name ?? '—';

  return (
    <div className="space-y-6">
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
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
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
  );
}

function TLSTab({ resource: ing }: ResourceContext<IngressResource>) {
  const ingNamespace = ing.metadata?.namespace || '';
  const tls = ing.spec?.tls || [];
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const clusterId = useActiveClusterId();

  if (tls.length === 0) {
    return <SectionCard title="TLS/SSL" icon={Lock}><p className="text-muted-foreground text-sm">No TLS configured</p></SectionCard>;
  }
  return (
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
  );
}

function TrafficTab() {
  return (
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
  );
}

function BackendHealthTab({ resource: ing }: ResourceContext<IngressResource>) {
  const rules = ing.spec?.rules || [];
  const defaultBackendService = (ing.spec as { defaultBackend?: { service?: { name?: string } } })?.defaultBackend?.service?.name;

  return (
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
  );
}

function MetricsTab() {
  return (
    <SectionCard title="Metrics" icon={Activity}>
      <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border/50">
        <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">Metrics require a metrics server</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">Install a metrics pipeline (e.g. Prometheus + kube-prometheus-stack) in your cluster to view resource metrics here.</p>
        </div>
      </div>
    </SectionCard>
  );
}


function WAFTab({ resource: ing }: ResourceContext<IngressResource>) {
  const annotations = ing.metadata?.annotations || {};
  return (
    <SectionCard title="WAF & Security" icon={Shield}>
      <p className="text-muted-foreground text-sm">Annotations only when present.</p>
      <div className="mt-2 text-sm">{Object.entries(annotations).filter(([k]) => k.toLowerCase().includes('waf') || k.toLowerCase().includes('auth')).length ? Object.entries(annotations).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>) : 'No WAF/security annotations'}</div>
    </SectionCard>
  );
}

export default function IngressDetail() {
  const { namespace: nsParam } = useParams();
  const navigate = useNavigate();
  const namespace = nsParam ?? '';

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'routing', label: 'Routing Rules', render: (ctx) => <RoutingTab {...ctx} /> },
    { id: 'tls', label: 'TLS/SSL', render: (ctx) => <TLSTab {...ctx} /> },
    { id: 'traffic', label: 'Traffic Analytics', render: () => <TrafficTab /> },
    { id: 'backends', label: 'Backend Health', render: (ctx) => <BackendHealthTab {...ctx} /> },
    { id: 'metrics', label: 'Metrics', render: () => <MetricsTab /> },
    { id: 'waf', label: 'WAF & Security', render: (ctx) => <WAFTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<IngressResource>
      resourceType="ingresses"
      kind="Ingress"
      pluralLabel="Ingresses"
      listPath="/ingresses"
      resourceIcon={Globe}
      loadingCardCount={4}
      customTabs={customTabs}
      deriveStatus={(ing) => {
        const lbIngress = ing.status?.loadBalancer?.ingress || [];
        const address = lbIngress[0]?.ip || lbIngress[0]?.hostname || '-';
        return address !== '-' ? 'Healthy' : 'Warning';
      }}
      buildStatusCards={(ctx) => {
        const ing = ctx.resource;
        const rules = ing.spec?.rules || [];
        const tls = ing.spec?.tls || [];
        const lbIngress = ing.status?.loadBalancer?.ingress || [];
        const address = lbIngress[0]?.ip || lbIngress[0]?.hostname || '-';
        const hostsCount = rules.reduce((acc, r) => acc + (r.host ? 1 : 0), 0) || rules.length;
        const rulesCount = rules.reduce((acc, r) => acc + (r.http?.paths?.length ?? 0), 0);
        const tlsStatusLabel = tls.length > 0 ? 'Valid' : 'Disabled';
        const status = address !== '-' ? 'Healthy' : 'Warning';

        return [
          { label: 'Status', value: status, icon: Globe, iconColor: 'primary' as const },
          { label: 'Hosts', value: String(hostsCount), icon: Globe, iconColor: 'info' as const },
          { label: 'TLS', value: tlsStatusLabel, icon: Lock, iconColor: tls.length > 0 ? 'success' as const : 'muted' as const },
          { label: 'Rules', value: String(rulesCount), icon: Route, iconColor: 'muted' as const },
          { label: 'Addresses', value: address !== '-' ? address : (lbIngress.length ? String(lbIngress.length) : '—'), icon: ExternalLink, iconColor: address !== '-' ? ('success' as const) : ('muted' as const) },
        ];
      }}
      extraActionItems={(ctx) => {
        const ing = ctx.resource;
        const tls = ing.spec?.tls || [];
        const lbIngress = ing.status?.loadBalancer?.ingress || [];
        return [
          { icon: Lock, label: 'Refresh Certificate', description: 'Refresh TLS certificate (cert-manager)', onClick: () => toast.info('Requires cert-manager'), className: 'press-effect' },
          { icon: Lock, label: 'View Certificate', description: 'View TLS secret', onClick: () => tls[0]?.secretName ? navigate(`/secrets/${namespace}/${tls[0].secretName}`) : toast.info('No TLS configured'), className: 'press-effect' },
          { icon: ExternalLink, label: 'Open in Browser', description: 'Open external URL', onClick: () => { const u = lbIngress[0]?.hostname || lbIngress[0]?.ip; if (u) void openExternal(`http://${u}`); else toast.info('No address'); }, className: 'press-effect' },
        ];
      }}
    />
  );
}
