import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Globe, Clock, Server, ExternalLink, Network, Loader2, Copy, Activity, Shield, Layers, Search, Terminal, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  PortForwardDialog,
  MetricsDashboard,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { useK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { Input } from '@/components/ui/input';
import { AgeCell } from '@/components/list/AgeCell';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery } from '@tanstack/react-query';
import { getServiceEndpoints, startPortForward } from '@/services/backendApiClient';
import { useClusterStore } from '@/stores/clusterStore';
import { usePortForwardStore } from '@/stores/portForwardStore';
import { openExternal } from '@/lib/tauri';
import { toast } from '@/components/ui/sonner';

interface ServiceResource extends KubernetesResource {
  spec?: {
    type?: string;
    clusterIP?: string;
    externalIPs?: string[];
    externalName?: string;
    ports?: Array<{ name?: string; port: number; targetPort?: number | string; protocol?: string; nodePort?: number }>;
    selector?: Record<string, string>;
    sessionAffinity?: string;
    externalTrafficPolicy?: string;
    internalTrafficPolicy?: string;
    ipFamilies?: string[];
    ipFamilyPolicy?: string;
    loadBalancerIP?: string;
    loadBalancerSourceRanges?: string[];
    allocateLoadBalancerNodePorts?: boolean;
    publishNotReadyAddresses?: boolean;
  };
  status?: {
    loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> };
  };
}

interface EndpointsResource extends KubernetesResource {
  subsets?: Array<{
    addresses?: Array<{ ip: string; hostname?: string; nodeName?: string; targetRef?: { kind: string; namespace: string; name: string } }>;
    notReadyAddresses?: Array<{ ip: string; hostname?: string; nodeName?: string; targetRef?: { kind: string; namespace: string; name: string } }>;
    ports?: Array<{ name?: string; port: number; protocol?: string }>;
  }>;
}

/** Inline port forward form — no popup, lives inside the Port Forward tab */
function InlinePortForward({
  ports,
  resourceName,
  namespace,
  resourceType,
  baseUrl,
}: {
  ports: Array<{ name?: string; port: number; targetPort?: number | string; protocol?: string; nodePort?: number }>;
  resourceName: string;
  namespace: string;
  resourceType: 'pod' | 'service';
  baseUrl: string;
}) {
  const [selectedPort, setSelectedPort] = useState<number>(ports[0]?.port ?? 0);
  const [localPort, setLocalPort] = useState(String(ports[0]?.port ?? ''));
  const [isStarting, setIsStarting] = useState(false);
  const addForward = usePortForwardStore((s) => s.add);
  const forwards = usePortForwardStore((s) => s.forwards);
  const stopAndRemove = usePortForwardStore((s) => s.stopAndRemove);
  const clusterName = useClusterStore((s) => s.activeCluster?.name ?? 'cluster');
  const clusterId = useClusterStore((s) => s.activeCluster?.id) ?? null;

  const activeForwards = forwards.filter(
    (f) => f.resourceName === resourceName && f.namespace === namespace
  );

  const handleStart = async () => {
    if (isStarting) return;
    if (!selectedPort || !localPort) {
      toast.error('Please select a port and local port');
      return;
    }
    const resolvedClusterId = clusterId
      || useBackendConfigStore.getState().currentClusterId
      || useClusterStore.getState().activeCluster?.id
      || null;
    if (baseUrl == null) {
      toast.error('Backend URL not configured');
      return;
    }
    if (!resolvedClusterId) {
      toast.error('No cluster connected. Select a cluster first.');
      return;
    }
    setIsStarting(true);
    try {
      const resp = await startPortForward(baseUrl, resolvedClusterId, {
        resourceType,
        name: resourceName,
        namespace,
        localPort: Number(localPort),
        remotePort: selectedPort,
      });
      addForward({
        sessionId: resp.sessionId,
        clusterId: resolvedClusterId,
        clusterName,
        resourceType,
        resourceName,
        namespace,
        localPort: Number(localPort),
        remotePort: selectedPort,
        baseUrl,
        startedAt: Date.now(),
      });
      toast.success('Port forwarding active', {
        description: `Click "Open" to access http://localhost:${localPort}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Port forward failed', { description: msg });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async (sessionId: string) => {
    await stopAndRemove(sessionId);
    toast.info('Port forwarding stopped');
  };

  const target = resourceType === 'service' ? `svc/${resourceName}` : `pod/${resourceName}`;
  const kubectlCmd = `kubectl port-forward ${target} ${localPort}:${selectedPort} -n ${namespace}`;

  return (
    <div className="space-y-6">
      {activeForwards.length > 0 && (
        <SectionCard title="Active Forwards" icon={Activity}>
          <div className="space-y-2">
            {activeForwards.map((fwd) => (
              <div key={fwd.sessionId} className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <div>
                    <p className="font-medium text-sm">
                      localhost:<span className="text-primary font-semibold">{fwd.localPort}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      {fwd.resourceName}:<span className="font-semibold">{fwd.remotePort}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started {new Date(fwd.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openExternal(`http://localhost:${fwd.localPort}`)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleStop(fwd.sessionId)}
                  >
                    Stop
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Create Port Forward" icon={ExternalLink}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[180px]">
              <label className="text-sm font-medium mb-1.5 block">Container Port</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedPort}
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setSelectedPort(p);
                  setLocalPort(String(p));
                }}
              >
                {ports.map((p, i) => (
                  <option key={p.name || i} value={p.port}>
                    {p.port} ({p.name || p.protocol || 'TCP'})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-sm font-medium mb-1.5 block">Local Port</label>
              <Input
                type="number"
                value={localPort}
                onChange={(e) => setLocalPort(e.target.value)}
                placeholder="e.g. 8080"
                className="h-10"
              />
            </div>
            <div>
              <Button
                type="button"
                onClick={handleStart}
                disabled={isStarting || !selectedPort || !localPort}
                className="h-10 px-6"
              >
                {isStarting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting...</>
                ) : (
                  <><ExternalLink className="h-4 w-4 mr-2" />Start Forwarding</>
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 p-4 rounded-lg bg-muted/50 border border-border/50">
            <div className="flex flex-col items-center gap-1">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <span className="text-xs font-medium">localhost:{localPort || '?'}</span>
              <span className="text-[10px] text-muted-foreground">Your browser</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <div className="w-8 h-px bg-border" />
              <span className="text-xs">→</span>
              <div className="w-8 h-px bg-border" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Server className="h-5 w-5 text-blue-500" />
              </div>
              <span className="text-xs font-medium">:{selectedPort}</span>
              <span className="text-[10px] text-muted-foreground">{resourceName}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-sm">
            <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
            <code className="flex-1 truncate">{kubectlCmd}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(kubectlCmd); toast.success('Command copied'); }}
              className="text-muted-foreground hover:text-white shrink-0"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tab Components
// ---------------------------------------------------------------------------

function OverviewTab({ resource: svc, age, isConnected }: ResourceContext<ServiceResource>) {
  const namespace = svc.metadata?.namespace || '';
  const svcName = svc.metadata?.name || '';
  const serviceType = svc.spec?.type || 'ClusterIP';
  const clusterIP = svc.spec?.clusterIP ?? (serviceType === 'ExternalName' ? '-' : 'None');
  const externalIP = useMemo(() => {
    if (svc.spec?.externalIPs?.length) return svc.spec.externalIPs.join(', ');
    if (serviceType === 'LoadBalancer' && svc.status?.loadBalancer?.ingress?.length)
      return svc.status.loadBalancer.ingress.map((i) => i.hostname || i.ip).filter(Boolean).join(', ');
    return null;
  }, [svc.spec?.externalIPs, serviceType, svc.status?.loadBalancer]);
  const ports = svc.spec?.ports || [];
  const selector = svc.spec?.selector || {};
  const sessionAffinity = svc.spec?.sessionAffinity || 'None';
  const dnsName = namespace && svcName ? `${svcName}.${namespace}.svc.cluster.local` : '';

  const copyDns = () => {
    if (dnsName) {
      navigator.clipboard.writeText(dnsName);
      toast.success('DNS name copied');
    }
  };

  return (
    <div className="space-y-6">
      {/* Network Identity — hero row */}
      <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
        <div className="relative overflow-hidden rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="h-6 w-6 rounded-md bg-blue-500/10 flex items-center justify-center">
              <Network className="h-3 w-3 text-blue-500" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cluster IP</span>
          </div>
          {clusterIP !== '—' && clusterIP !== 'None' ? (
            <div className="flex items-center gap-1.5">
              <code className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">{clusterIP}</code>
              <button onClick={() => { navigator.clipboard.writeText(clusterIP); toast.success('IP copied'); }} className="text-muted-foreground/50 hover:text-blue-500 transition-colors" title="Copy IP"><Copy className="h-3 w-3" /></button>
            </div>
          ) : (
            <p className="text-sm font-mono font-bold text-muted-foreground">{clusterIP}</p>
          )}
        </div>
        <div className="relative overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="h-6 w-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
              <Globe className="h-3 w-3 text-emerald-500" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">External IP</span>
          </div>
          <p className="text-sm font-mono font-bold text-foreground">{externalIP ?? '—'}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="h-6 w-6 rounded-md bg-violet-500/10 flex items-center justify-center">
              <Globe className="h-3 w-3 text-violet-500" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">DNS Name</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <code className="text-xs font-mono font-semibold text-violet-600 dark:text-violet-400 truncate min-w-0" title={dnsName || '—'}>{dnsName || '—'}</code>
            {dnsName && <button onClick={copyDns} className="text-muted-foreground/50 hover:text-violet-500 transition-colors shrink-0" title="Copy DNS"><Copy className="h-3 w-3" /></button>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Configuration" icon={Globe}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Service Type" value={<Badge variant="outline" className="font-semibold text-xs border bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{serviceType}</Badge>} />
            <DetailRow label="Session Affinity" value={sessionAffinity === 'None' ? sessionAffinity : <Badge variant="outline" className="font-semibold text-xs border bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{sessionAffinity}</Badge>} />
            <DetailRow label="External Traffic" value={<Badge variant="outline" className="font-semibold text-xs border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">{svc.spec?.externalTrafficPolicy ?? 'Cluster'}</Badge>} />
            <DetailRow label="Internal Traffic" value={<Badge variant="outline" className="font-semibold text-xs border bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20">{svc.spec?.internalTrafficPolicy ?? 'Cluster'}</Badge>} />
            <DetailRow label="IP Family Policy" value={svc.spec?.ipFamilyPolicy ?? '—'} />
            <DetailRow label="IP Families" value={<span className="font-mono">{svc.spec?.ipFamilies?.join(', ') ?? '—'}</span>} />
            <DetailRow label="Publish Not Ready" value={svc.spec?.publishNotReadyAddresses ? <Badge variant="outline" className="font-semibold text-xs border bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20">Yes</Badge> : 'No'} />
          </div>
        </SectionCard>

        <SectionCard title="Ports" icon={Layers}>
          <div className="space-y-2">
            {ports.length === 0 ? <p className="text-muted-foreground text-sm">No ports configured</p> : ports.map((port, idx) => (
              <div key={port.name || idx} className="group relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-r from-card to-transparent p-4 hover:border-primary/30 transition-all duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                      <Layers className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{port.name || `port-${idx}`}</p>
                      <Badge variant="outline" className="text-[10px] h-5 mt-0.5 font-mono">{port.protocol || 'TCP'}</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-lg font-bold text-primary">{port.port}</span>
                      <span className="text-muted-foreground text-sm">→</span>
                      <span className="text-lg font-bold">{port.targetPort ?? '—'}</span>
                    </div>
                    {port.nodePort != null && (
                      <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">nodePort</span>
                        <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">{port.nodePort}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Selector" icon={Server}>
          {Object.keys(selector).length === 0 ? <p className="text-muted-foreground text-sm">No selector defined</p> : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(selector).map(([key, value]) => (
                <Badge key={key} variant="outline" className="font-mono text-xs bg-cyan-500/5 border-cyan-500/20 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10 transition-colors cursor-default">
                  <span className="opacity-60">{key}=</span>{value}
                </Badge>
              ))}
            </div>
          )}
        </SectionCard>

        <LabelList labels={svc.metadata?.labels ?? {}} />
      </div>

      <AnnotationList annotations={svc.metadata?.annotations ?? {}} />
    </div>
  );
}

function EndpointsTab({ resource: svc, isConnected }: ResourceContext<ServiceResource>) {
  const namespace = svc.metadata?.namespace || '';
  const svcName = svc.metadata?.name || '';
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const clusterId = useActiveClusterId();
  const name = svc.metadata?.name;

  const useBackendEndpoints = !!(isBackendConfigured && clusterId && baseUrl && namespace && name);
  const endpointsQuery = useQuery({
    queryKey: ['service-endpoints', clusterId, namespace, name],
    queryFn: () => getServiceEndpoints(baseUrl!, clusterId!, namespace, name!),
    enabled: useBackendEndpoints,
  });
  const endpointsFromK8s = useK8sResource<EndpointsResource>(
    'endpoints',
    name ?? '',
    namespace,
    { enabled: !!(name && namespace && !useBackendEndpoints) }
  );
  const endpointsResource = useBackendEndpoints ? endpointsQuery.data : endpointsFromK8s.data;
  const endpointsLoading = useBackendEndpoints ? endpointsQuery.isLoading : endpointsFromK8s.isLoading;
  const endpointsError = useBackendEndpoints ? endpointsQuery.error : endpointsFromK8s.error;

  const { endpointsReady, endpointsTotal, endpointRows } = useMemo(() => {
    const ep = endpointsResource as EndpointsResource | undefined;
    if (!ep?.subsets?.length) return { endpointsReady: 0, endpointsTotal: 0, endpointRows: [] as { address: string; port: string; protocol: string; ready: boolean; hostname?: string; nodeName?: string; podRef?: { ns: string; name: string } }[] };
    let ready = 0;
    const rows: { address: string; port: string; protocol: string; ready: boolean; hostname?: string; nodeName?: string; podRef?: { ns: string; name: string } }[] = [];
    for (const sub of ep.subsets) {
      const ports = sub.ports ?? [];
      const portStr = ports.map((p) => `${p.port}/${p.protocol || 'TCP'}`).join(', ') || '—';
      for (const addr of sub.addresses ?? []) {
        ready++;
        rows.push({ address: addr.ip, port: portStr, protocol: ports[0]?.protocol ?? 'TCP', ready: true, hostname: addr.hostname, nodeName: addr.nodeName, podRef: addr.targetRef?.kind === 'Pod' ? { ns: addr.targetRef.namespace, name: addr.targetRef.name } : undefined });
      }
      for (const addr of sub.notReadyAddresses ?? []) {
        rows.push({ address: addr.ip, port: portStr, protocol: ports[0]?.protocol ?? 'TCP', ready: false, hostname: addr.hostname, nodeName: addr.nodeName, podRef: addr.targetRef?.kind === 'Pod' ? { ns: addr.targetRef.namespace, name: addr.targetRef.name } : undefined });
      }
    }
    return { endpointsReady: ready, endpointsTotal: rows.length, endpointRows: rows };
  }, [endpointsResource]);

  return (
    <div className="space-y-6">
      <SectionCard title="Endpoints" icon={Server}>
        {!useBackendEndpoints && !isConnected ? (
          <p className="text-muted-foreground text-sm">Connect to a cluster (or the Kubilitics backend) to view endpoint details for this service.</p>
        ) : endpointsLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : endpointsError ? (
          <p className="text-destructive text-sm">Failed to load endpoints: {endpointsError instanceof Error ? endpointsError.message : String(endpointsError)}</p>
        ) : endpointRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No endpoints. Ensure pods match the service selector.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Health:</span>
                <span className={cn('text-sm font-mono', endpointsReady === endpointsTotal ? 'text-green-600' : endpointsReady > 0 ? 'text-amber-600' : 'text-destructive')}>
                  {endpointsReady} ready / {endpointsTotal} total
                </span>
              </div>
              <Progress
                value={endpointsTotal > 0 ? (endpointsReady / endpointsTotal) * 100 : 0}
                className="h-2 w-32 max-w-[200px]"
              />
              <Link to={`/endpoints/${namespace}/${svcName}`} className="text-primary text-sm hover:underline ml-auto">View Endpoints resource</Link>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40"><th className="text-left p-3 font-medium">IP Address</th><th className="text-left p-3 font-medium">Port</th><th className="text-left p-3 font-medium">Protocol</th><th className="text-left p-3 font-medium">Ready</th><th className="text-left p-3 font-medium">Hostname</th><th className="text-left p-3 font-medium">Node Name</th><th className="text-left p-3 font-medium">Pod</th></tr></thead>
                <tbody>
                  {endpointRows.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        'border-b',
                        row.ready ? 'bg-emerald-600/5 border-l-4 border-l-[hsl(142,76%,36%)]' : 'bg-destructive/5 border-l-4 border-l-destructive'
                      )}
                    >
                      <td className="p-3 font-mono text-xs">{row.address}</td>
                      <td className="p-3 font-mono text-xs">{row.port}</td>
                      <td className="p-3 font-mono text-xs">{row.protocol}</td>
                      <td className="p-3">
                        {row.ready ? <Badge variant="default" className="bg-emerald-600 text-white border-0">Yes</Badge> : <Badge variant="destructive" className="border-0">No</Badge>}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{row.hostname ?? '—'}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{row.nodeName ?? '—'}</td>
                      <td className="p-3">{row.podRef ? <Link to={`/pods/${row.podRef.ns}/${row.podRef.name}`} className="text-primary hover:underline text-sm">{row.podRef.name}</Link> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

function TrafficTab({ resource: svc }: ResourceContext<ServiceResource>) {
  return (
    <SectionCard title="Traffic flow" icon={Activity}>
      <p className="text-muted-foreground text-sm mb-4">External → Load Balancer → Service → Endpoints → Pods. Metrics (request rate, latency, error rate) require a metrics pipeline.</p>
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm font-medium">Request rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm font-medium">Latency</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm font-medium">Error rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
      </div>
    </SectionCard>
  );
}

function DNSTab({ resource: svc }: ResourceContext<ServiceResource>) {
  const namespace = svc.metadata?.namespace || '';
  const svcName = svc.metadata?.name || '';
  const serviceType = svc.spec?.type || 'ClusterIP';
  const clusterIP = svc.spec?.clusterIP ?? (serviceType === 'ExternalName' ? '-' : 'None');
  const ports = svc.spec?.ports || [];
  const dnsName = namespace && svcName ? `${svcName}.${namespace}.svc.cluster.local` : '';

  // Need endpoint rows for headless DNS
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const clusterId = useActiveClusterId();
  const useBackendEndpoints = !!(isBackendConfigured && clusterId && baseUrl && namespace && svcName);
  const endpointsQuery = useQuery({
    queryKey: ['service-endpoints', clusterId, namespace, svcName],
    queryFn: () => getServiceEndpoints(baseUrl!, clusterId!, namespace, svcName),
    enabled: useBackendEndpoints,
  });
  const endpointsFromK8s = useK8sResource<EndpointsResource>(
    'endpoints',
    svcName,
    namespace,
    { enabled: !!(svcName && namespace && !useBackendEndpoints) }
  );
  const endpointsResource = useBackendEndpoints ? endpointsQuery.data : endpointsFromK8s.data;

  const endpointRows = useMemo(() => {
    const ep = endpointsResource as EndpointsResource | undefined;
    if (!ep?.subsets?.length) return [];
    const rows: { podRef?: { ns: string; name: string } }[] = [];
    for (const sub of ep.subsets) {
      for (const addr of sub.addresses ?? []) {
        rows.push({ podRef: addr.targetRef?.kind === 'Pod' ? { ns: addr.targetRef.namespace, name: addr.targetRef.name } : undefined });
      }
    }
    return rows;
  }, [endpointsResource]);

  const copyDns = () => {
    if (dnsName) {
      navigator.clipboard.writeText(dnsName);
      toast.success('DNS name copied');
    }
  };

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-teal-500/3 to-transparent p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center border border-emerald-500/10">
              <Globe className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Service DNS</h3>
              <p className="text-xs text-muted-foreground">Fully qualified domain name within the cluster</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-card/80 backdrop-blur-sm border border-emerald-500/10 shadow-sm">
            <code className="flex-1 font-mono text-base font-bold select-all break-all text-emerald-600 dark:text-emerald-400">
              {dnsName || '—'}
            </code>
            <Button size="sm" variant="outline" onClick={copyDns} disabled={!dnsName} className="shrink-0 border-emerald-500/20 hover:bg-emerald-500/10 hover:text-emerald-600">
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card/60 border border-border/30 text-xs">
              <span className="text-muted-foreground">Short:</span>
              <code className="font-semibold text-foreground">{svcName}</code>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card/60 border border-border/30 text-xs">
              <span className="text-muted-foreground">Namespace:</span>
              <code className="font-semibold text-foreground">{namespace}</code>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card/60 border border-border/30 text-xs">
              <span className="text-muted-foreground">Type:</span>
              <code className="font-semibold text-foreground">{serviceType}</code>
            </span>
          </div>
        </div>
      </div>

      {clusterIP === 'None' && (
        <SectionCard title="Headless Service — Per-Pod DNS" icon={Server}>
          <p className="text-xs text-muted-foreground mb-3">Each pod gets its own DNS record that resolves to the pod&apos;s IP address:</p>
          {endpointRows.some((r) => r.podRef) ? (
            <div className="space-y-1.5">
              {endpointRows.filter((r) => r.podRef).map((row, i) => {
                const podDns = `${row.podRef!.name}.${svcName}.${namespace}.svc.cluster.local`;
                return (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/30">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <code className="flex-1 min-w-0 font-mono text-xs break-all">{podDns}</code>
                    <button
                      className="text-muted-foreground hover:text-primary shrink-0"
                      onClick={() => { navigator.clipboard.writeText(podDns); toast.success('Copied'); }}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <code className="block font-mono text-xs bg-muted rounded px-3 py-2 break-all">
              &lt;pod-name&gt;.{svcName}.{namespace}.svc.cluster.local
            </code>
          )}
        </SectionCard>
      )}

      {ports.length > 0 && (
        <div className="rounded-xl border border-blue-500/20 overflow-hidden">
          <div className="flex items-center gap-2 p-4 bg-gradient-to-r from-blue-500/5 to-transparent border-b border-blue-500/10">
            <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Layers className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold">SRV Records</h3>
              <p className="text-[10px] text-muted-foreground">Port-specific DNS for service discovery</p>
            </div>
          </div>
          {ports.map((port, idx) => {
            const portName = port.name || `port-${idx}`;
            const protocol = (port.protocol || 'TCP').toLowerCase();
            const srvRecord = `_${portName}._${protocol}.${svcName}.${namespace}.svc.cluster.local`;
            return (
              <div key={port.name || idx} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/10 last:border-0 hover:bg-blue-500/3 transition-colors group">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-xs break-all text-blue-600 dark:text-blue-400">{srvRecord}</code>
                  <button
                    className="text-muted-foreground/40 hover:text-blue-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { navigator.clipboard.writeText(srvRecord); toast.success('Copied'); }}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <Badge className="font-mono text-xs shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">{port.port}</Badge>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-amber-500/20 overflow-hidden">
        <div className="flex items-center gap-2 p-4 bg-gradient-to-r from-amber-500/5 to-transparent border-b border-amber-500/10">
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Activity className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold">DNS Resolution Guide</h3>
            <p className="text-[10px] text-muted-foreground">How to reach this service from different locations</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/20">
          <div className="p-4 hover:bg-amber-500/3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-5 w-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-emerald-500">1</span>
              </div>
              <p className="text-xs font-bold">Same Namespace</p>
            </div>
            <code className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400">{svcName}</code>
            <p className="text-[10px] text-muted-foreground mt-1.5">Simplest — just the service name</p>
          </div>
          <div className="p-4 hover:bg-amber-500/3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-5 w-5 rounded-full bg-blue-500/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-blue-500">2</span>
              </div>
              <p className="text-xs font-bold">Cross Namespace</p>
            </div>
            <code className="text-sm font-mono font-semibold text-blue-600 dark:text-blue-400">{svcName}.{namespace}</code>
            <p className="text-[10px] text-muted-foreground mt-1.5">Include namespace for cross-ns access</p>
          </div>
          <div className="p-4 hover:bg-amber-500/3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-5 w-5 rounded-full bg-violet-500/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-violet-500">3</span>
              </div>
              <p className="text-xs font-bold">Full FQDN</p>
            </div>
            <code className="text-xs font-mono font-semibold text-violet-600 dark:text-violet-400 break-all">{dnsName}</code>
            <p className="text-[10px] text-muted-foreground mt-1.5">Fully qualified — works everywhere</p>
          </div>
        </div>
        {serviceType === 'ExternalName' && svc.spec?.externalName && (
          <div className="mx-4 mb-4 p-3 rounded-xl bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400">ExternalName Service</p>
            <p className="text-xs text-muted-foreground mt-1">Creates a CNAME record → <code className="bg-muted px-1.5 py-0.5 rounded font-mono font-semibold">{svc.spec.externalName}</code></p>
          </div>
        )}
      </div>
    </div>
  );
}

function PortForwardTab({ resource: svc }: ResourceContext<ServiceResource>) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  return (
    <InlinePortForward
      ports={svc.spec?.ports || []}
      resourceName={svc.metadata?.name || ''}
      namespace={svc.metadata?.namespace || ''}
      resourceType="service"
      baseUrl={baseUrl}
    />
  );
}

function PodsTab({ resource: svc }: ResourceContext<ServiceResource>) {
  const navigate = useNavigate();
  const namespace = svc.metadata?.namespace || '';
  const [podsTabSearch, setPodsTabSearch] = useState('');

  const podsInNs = useK8sResourceList<KubernetesResource & { spec?: { containers?: { name: string }[] }; metadata?: { name: string } }>(
    'pods',
    namespace,
    { enabled: !!namespace && !!svc.spec?.selector && Object.keys(svc.spec.selector).length > 0 }
  );
  const selectorPods = useMemo(() => {
    const sel = svc.spec?.selector;
    const items = podsInNs.data?.items ?? [];
    if (!sel || !items.length) return [];
    return items.filter((p: KubernetesResource) => {
      const labels = p.metadata?.labels ?? {};
      return Object.entries(sel).every(([k, v]) => labels[k] === v);
    });
  }, [podsInNs.data?.items, svc.spec?.selector]);

  const selectorPodsFiltered = useMemo(() => {
    if (!podsTabSearch.trim()) return selectorPods;
    const q = podsTabSearch.trim().toLowerCase();
    return selectorPods.filter((p: KubernetesResource & { spec?: { nodeName?: string } }) =>
      (p.metadata?.name ?? '').toLowerCase().includes(q) ||
      ((p.spec as { nodeName?: string })?.nodeName ?? '').toLowerCase().includes(q)
    );
  }, [selectorPods, podsTabSearch]);

  return (
    <SectionCard title="Pods (selector match)" icon={Server} tooltip={<p className="text-xs text-muted-foreground">Pods matching this service&apos;s selector</p>}>
      <div className="space-y-3">
        {selectorPods.length > 0 && (
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by pod name or node..."
              value={podsTabSearch}
              onChange={(e) => setPodsTabSearch(e.target.value)}
              className="pl-9 h-10 text-sm"
              aria-label="Search pods"
            />
          </div>
        )}
        {selectorPods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pods match the service selector.</p>
        ) : selectorPodsFiltered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pods match the search.</p>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Ready</th>
                  <th className="text-left p-3 font-medium">Restarts</th>
                  <th className="text-left p-3 font-medium">Node</th>
                  <th className="text-left p-3 font-medium">CPU</th>
                  <th className="text-left p-3 font-medium">Memory</th>
                  <th className="text-left p-3 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {selectorPodsFiltered.map((p: KubernetesResource & { status?: { phase?: string; containerStatuses?: Array<{ ready?: boolean; restartCount?: number }> }; spec?: { nodeName?: string } }) => {
                  const podName = p.metadata?.name ?? '';
                  const podNs = p.metadata?.namespace ?? namespace ?? '';
                  const status = p.status;
                  const phase = status?.phase ?? '–';
                  const containerStatuses = status?.containerStatuses ?? [];
                  const readyCount = containerStatuses.filter((c) => c.ready).length;
                  const totalContainers = containerStatuses.length || 1;
                  const readyStr = `${readyCount}/${totalContainers}`;
                  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
                  const nodeName = p.spec?.nodeName ?? '–';
                  return (
                    <tr
                      key={podName}
                      className="border-t hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/pods/${podNs}/${podName}`)}
                    >
                      <td className="p-3">
                        <Link to={`/pods/${podNs}/${podName}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                          {podName}
                        </Link>
                      </td>
                      <td className="p-3"><Badge variant={phase === 'Running' ? 'default' : 'secondary'} className="text-xs">{phase}</Badge></td>
                      <td className="p-3 font-mono text-xs">{readyStr}</td>
                      <td className="p-3 font-mono text-xs">{restarts}</td>
                      <td className="p-3 font-mono text-xs truncate max-w-[140px]" title={nodeName}>{nodeName}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">–</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">–</td>
                      <td className="p-3"><AgeCell age={p.metadata?.creationTimestamp ? calculateAge(p.metadata.creationTimestamp) : '–'} timestamp={p.metadata?.creationTimestamp} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function MetricsTab({ resource: svc }: ResourceContext<ServiceResource>) {
  return (
    <MetricsDashboard
      resourceType="service"
      resourceName={svc.metadata?.name}
      namespace={svc.metadata?.namespace}
    />
  );
}

function NetworkPoliciesTab({ resource: svc }: ResourceContext<ServiceResource>) {
  const namespace = svc.metadata?.namespace || '';
  const networkPoliciesInNs = useK8sResourceList<KubernetesResource & { spec?: { podSelector?: { matchLabels?: Record<string, string> }; policyTypes?: string[] } }>(
    'networkpolicies',
    namespace,
    { enabled: !!namespace }
  );
  const networkPoliciesList = networkPoliciesInNs.data?.items ?? [];

  return (
    <SectionCard title="Network policies in this namespace" icon={Shield}>
      {networkPoliciesInNs.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : networkPoliciesList.length === 0 ? (
        <p className="text-muted-foreground text-sm">No NetworkPolicies in this namespace.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Name</th><th className="text-left p-2">Policy Types</th><th className="text-left p-2">Pod Selector</th><th className="text-left p-2">Actions</th></tr></thead>
            <tbody>
              {networkPoliciesList.map((np) => (
                <tr key={np.metadata?.name} className="border-b">
                  <td className="p-2 font-mono">{np.metadata?.name}</td>
                  <td className="p-2">{(np.spec?.policyTypes ?? []).join(', ') || '—'}</td>
                  <td className="p-2 font-mono text-xs">{np.spec?.podSelector?.matchLabels ? Object.entries(np.spec.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ') : 'All pods'}</td>
                  <td className="p-2"><Link to={`/networkpolicies/${namespace}/${np.metadata?.name}`} className="text-primary text-sm hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs mt-3">Pods backing this service may be affected by these policies depending on selector overlap.</p>
    </SectionCard>
  );
}

function LoadBalancerTab({ resource: svc }: ResourceContext<ServiceResource>) {
  return (
    <SectionCard title="Load balancer status" icon={Globe}>
      <DetailRow label="Ingress" value={svc.status?.loadBalancer?.ingress?.map((i) => i.ip || i.hostname).join(', ') ?? '—'} />
      <p className="text-muted-foreground text-sm mt-2">Annotations and provisioning events depend on the cloud provider.</p>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ServiceDetail() {
  const [showPortForwardDialog, setShowPortForwardDialog] = useState(false);

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'endpoints', label: 'Endpoints & Health', render: (ctx) => <EndpointsTab {...ctx} /> },
    { id: 'traffic', label: 'Traffic Flow', render: (ctx) => <TrafficTab {...ctx} /> },
    { id: 'dns', label: 'DNS', render: (ctx) => <DNSTab {...ctx} /> },
    { id: 'portforward', label: 'Port Forward', render: (ctx) => <PortForwardTab {...ctx} /> },
    { id: 'pods', label: 'Pods', render: (ctx) => <PodsTab {...ctx} /> },
    { id: 'metrics', label: 'Metrics', render: (ctx) => <MetricsTab {...ctx} /> },
    { id: 'networkpolicies', label: 'Network Policies', render: (ctx) => <NetworkPoliciesTab {...ctx} /> },
  ];

  return (
    <>
      <GenericResourceDetail<ServiceResource>
        resourceType="services"
        kind="Service"
        pluralLabel="Services"
        listPath="/services"
        resourceIcon={Globe}
        loadingCardCount={4}
        customTabs={customTabs}
        deriveStatus={() => 'Healthy' as const}
        buildStatusCards={(ctx) => {
          const svc = ctx.resource;
          const serviceType = svc.spec?.type || 'ClusterIP';
          const clusterIP = svc.spec?.clusterIP ?? (serviceType === 'ExternalName' ? '-' : 'None');
          const externalIP = (() => {
            if (svc.spec?.externalIPs?.length) return svc.spec.externalIPs.join(', ');
            if (serviceType === 'LoadBalancer' && svc.status?.loadBalancer?.ingress?.length)
              return svc.status.loadBalancer.ingress.map((i) => i.hostname || i.ip).filter(Boolean).join(', ');
            return null;
          })();
          const ports = svc.spec?.ports || [];
          const sessionAffinity = svc.spec?.sessionAffinity || 'None';

          return [
            { label: 'Type', value: serviceType, icon: Globe, iconColor: 'primary' as const },
            { label: 'Cluster IP', value: clusterIP, icon: Network, iconColor: 'info' as const },
            { label: 'External IP', value: externalIP ?? '—', icon: Globe, iconColor: 'muted' as const },
            { label: 'Endpoints', value: '—', icon: Server, iconColor: 'success' as const },
            { label: 'Ports', value: String(ports.length), icon: Layers, iconColor: 'muted' as const },
            { label: 'Session Affinity', value: sessionAffinity, icon: Clock, iconColor: 'muted' as const },
          ];
        }}
        extraHeaderActions={() => [
          { label: 'Port Forward', icon: ExternalLink, variant: 'outline', onClick: () => {/* handled by tab change */}, className: 'press-effect' },
        ]}
        extraActionItems={(ctx) => {
          const svc = ctx.resource;
          const selectorPodsList = useK8sResourceList<KubernetesResource>('pods', namespace, { enabled: false });
          // We can't reliably compute backingDeployment in a callback, so provide static actions
          return [
            { icon: ExternalLink, label: 'Port Forward', description: 'Forward local port to this service', onClick: () => {/* tab switch */} },
            { icon: Globe, label: 'Test Connectivity', description: 'Simple connectivity check', onClick: () => toast.info('Test connectivity: requires backend support (design 3.1)') },
          ];
        }}
        extraDialogs={(ctx) => (
          <PortForwardDialog
            open={showPortForwardDialog}
            onOpenChange={setShowPortForwardDialog}
            podName={ctx.name}
            namespace={ctx.namespace}
            baseUrl={baseUrl ?? ''}
            clusterId={clusterId ?? ''}
            resourceType="service"
            servicePorts={ctx.resource.spec?.ports ?? []}
          />
        )}
      />
    </>
  );
}
