import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Globe, Clock, Server, Download, Trash2, ExternalLink, Network, Loader2, Copy, Activity, Shield, Layers, Search, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { downloadResourceJson } from '@/lib/exportUtils';
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
import { useResourceDetail, useResourceEvents, resourceToYaml } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { Input } from '@/components/ui/input';
import { AgeCell } from '@/components/list/AgeCell';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useQuery } from '@tanstack/react-query';
import { getServiceEndpoints, getResource } from '@/services/backendApiClient';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';
import { toast } from 'sonner';

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

export default function ServiceDetail() {
  const { namespace: nsParam, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [podsTabSearch, setPodsTabSearch] = useState('');

  const namespace = nsParam ?? '';
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const breadcrumbSegments = useDetailBreadcrumbs('Service', name ?? undefined, nsParam ?? undefined, activeCluster?.name);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const { resource: svc, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<ServiceResource>(
    'services',
    name,
    nsParam,
    {} as ServiceResource
  );
  const resourceEvents = useResourceEvents('Service', namespace, name ?? undefined);
  const events = resourceEvents.events;
  const eventsLoading = resourceEvents.isLoading;
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

  const deleteService = useDeleteK8sResource('services');
  const updateService = useUpdateK8sResource('services');

  const servicesInNs = useK8sResourceList<KubernetesResource>('services', namespace, { limit: 100, enabled: !!namespace });
  const networkPoliciesInNs = useK8sResourceList<KubernetesResource & { spec?: { podSelector?: { matchLabels?: Record<string, string> }; policyTypes?: string[] } }>(
    'networkpolicies',
    namespace,
    { enabled: !!namespace }
  );
  const networkPoliciesList = networkPoliciesInNs.data?.items ?? [];

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

  const backingDeployment = useMemo(() => {
    const ref = selectorPods.find((p: KubernetesResource & { metadata?: { ownerReferences?: Array<{ kind: string; name: string }> } }) =>
      p.metadata?.ownerReferences?.some((r) => r.kind === 'Deployment')
    )?.metadata?.ownerReferences?.find((r) => r.kind === 'Deployment');
    return ref ? { name: ref.name, namespace } : null;
  }, [selectorPods, namespace]);

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
        rows.push({
          address: addr.ip,
          port: portStr,
          protocol: ports[0]?.protocol ?? 'TCP',
          ready: true,
          hostname: addr.hostname,
          nodeName: addr.nodeName,
          podRef: addr.targetRef?.kind === 'Pod' ? { ns: addr.targetRef.namespace, name: addr.targetRef.name } : undefined,
        });
      }
      for (const addr of sub.notReadyAddresses ?? []) {
        rows.push({
          address: addr.ip,
          port: portStr,
          protocol: ports[0]?.protocol ?? 'TCP',
          ready: false,
          hostname: addr.hostname,
          nodeName: addr.nodeName,
          podRef: addr.targetRef?.kind === 'Pod' ? { ns: addr.targetRef.namespace, name: addr.targetRef.name } : undefined,
        });
      }
    }
    return { endpointsReady: ready, endpointsTotal: rows.length, endpointRows: rows };
  }, [endpointsResource]);

  const status: ResourceStatus = (endpointsTotal > 0 && endpointsReady === 0) ? 'Degraded' as ResourceStatus : 'Healthy' as ResourceStatus;
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
  const svcName = svc.metadata?.name || '';
  const svcNamespace = svc.metadata?.namespace || '';
  const dnsName = namespace && svcName ? `${svcName}.${namespace}.svc.cluster.local` : '';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${svcName || 'service'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, svcName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(svc, `${svcName || 'service'}.json`);
    toast.success('JSON downloaded');
  }, [svc, svcName]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update Service');
      throw new Error('Not connected');
    }
    try {
      await updateService.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('Service updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, namespace, updateService, refetch]);


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

  if (!svc?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'Service not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/services')}>
              Back to Services
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Type', value: serviceType, icon: Globe, iconColor: 'primary' as const },
    { label: 'Cluster IP', value: clusterIP, icon: Network, iconColor: 'info' as const },
    { label: 'External IP', value: externalIP ?? '—', icon: Globe, iconColor: 'muted' as const },
    { label: 'Endpoints', value: endpointsTotal > 0 ? `${endpointsReady}/${endpointsTotal}` : '—', icon: Server, iconColor: 'success' as const },
    { label: 'Ports', value: String(ports.length), icon: Layers, iconColor: 'muted' as const },
    { label: 'Session Affinity', value: sessionAffinity, icon: Clock, iconColor: 'muted' as const },
  ];

  const copyDns = () => {
    if (dnsName) {
      navigator.clipboard.writeText(dnsName);
      toast.success('DNS name copied');
    }
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Service info" icon={Globe}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <DetailRow label="Type" value={<Badge variant="secondary">{serviceType}</Badge>} />
              <DetailRow label="Cluster IP" value={<span className="font-mono">{clusterIP}</span>} />
              {svc.spec?.externalName != null && <DetailRow label="External Name" value={svc.spec.externalName} />}
              <DetailRow label="Session Affinity" value={sessionAffinity} />
              <DetailRow label="External Traffic Policy" value={svc.spec?.externalTrafficPolicy ?? '—'} />
              <DetailRow label="Internal Traffic Policy" value={svc.spec?.internalTrafficPolicy ?? '—'} />
              <DetailRow label="IP Families" value={svc.spec?.ipFamilies?.join(', ') ?? '—'} />
              <DetailRow label="IP Family Policy" value={svc.spec?.ipFamilyPolicy ?? '—'} />
              <DetailRow label="Publish Not Ready Addresses" value={svc.spec?.publishNotReadyAddresses ? 'true' : 'false'} />
              <DetailRow label="Age" value={age} />
            </div>
          </SectionCard>
          <SectionCard title="Ports" icon={Layers}>
            <div className="space-y-3">
              {ports.length === 0 ? <p className="text-muted-foreground text-sm">No ports</p> : ports.map((port, idx) => (
                <div key={port.name || idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium">{port.name || `port-${idx}`}</p>
                    <p className="text-sm text-muted-foreground">{port.protocol || 'TCP'}</p>
                  </div>
                  <div className="text-right font-mono text-sm">
                    <p>{port.port} → {port.targetPort ?? '—'}{port.nodePort != null ? ` (nodePort: ${port.nodePort})` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Selector" icon={Server}>
            {Object.keys(selector).length === 0 ? <p className="text-muted-foreground text-sm">No selector</p> : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(selector).map(([key, value]) => (
                  <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title="Metadata" icon={Clock}>
            <div className="space-y-2 text-sm">
              {svc.metadata?.labels && Object.keys(svc.metadata.labels).length > 0 && (
                <DetailRow label="Labels" value={<div className="flex flex-wrap gap-1">{Object.entries(svc.metadata.labels).map(([k, v]) => <Badge key={k} variant="outline" className="text-xs">{k}={v}</Badge>)}</div>} />
              )}
              {svc.metadata?.annotations && Object.keys(svc.metadata.annotations).length > 0 && (
                <DetailRow label="Annotations" value={<div className="flex flex-wrap gap-1">{Object.entries(svc.metadata.annotations).map(([k, v]) => <Badge key={k} variant="outline" className="text-xs">{k}={String(v).slice(0, 20)}</Badge>)}</div>} />
              )}
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: 'endpoints',
      label: 'Endpoints & Health',
      content: (
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
                            row.ready ? 'bg-[hsl(142,76%,36%)]/5 border-l-4 border-l-[hsl(142,76%,36%)]' : 'bg-destructive/5 border-l-4 border-l-destructive'
                          )}
                        >
                          <td className="p-3 font-mono text-xs">{row.address}</td>
                          <td className="p-3 font-mono text-xs">{row.port}</td>
                          <td className="p-3 font-mono text-xs">{row.protocol}</td>
                          <td className="p-3">
                            {row.ready ? <Badge variant="default" className="bg-[hsl(142,76%,36%)] text-white border-0">Yes</Badge> : <Badge variant="destructive" className="border-0">No</Badge>}
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
      ),
    },
    {
      id: 'traffic',
      label: 'Traffic Flow',
      content: (
        <SectionCard title="Traffic flow" icon={Activity}>
          <p className="text-muted-foreground text-sm mb-4">External → Load Balancer → Service → Endpoints → Pods. Metrics (request rate, latency, error rate) require a metrics pipeline.</p>
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Request rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Latency</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Error rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
          </div>
        </SectionCard>
      ),
    },
    {
      id: 'dns',
      label: 'DNS',
      content: (
        <div className="space-y-4">
          <SectionCard title="Primary DNS Name" icon={Globe}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Full DNS name for this service within the cluster:</p>
              <code className="block w-full rounded-md bg-muted px-4 py-2 font-mono text-sm select-all break-all">
                {dnsName || '—'}
              </code>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyDns} disabled={!dnsName}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy DNS name
                </Button>
              </div>
              {clusterIP === 'None' && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Headless service</p>
                  <p className="text-xs text-muted-foreground">Per-pod DNS entries (resolve to individual pod IPs):</p>
                  {endpointRows.some((r) => r.podRef) ? (
                    <div className="space-y-1.5">
                      {endpointRows.filter((r) => r.podRef).map((row, i) => {
                        const podDns = `${row.podRef!.name}.${svcName}.${namespace}.svc.cluster.local`;
                        return (
                          <div key={i} className="flex items-center gap-2 flex-wrap">
                            <code className="flex-1 min-w-0 font-mono text-xs bg-muted rounded px-2 py-1.5 break-all">{podDns}</code>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0"
                              onClick={() => {
                                navigator.clipboard.writeText(podDns);
                                toast.success('DNS name copied');
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <code className="block font-mono text-xs bg-muted rounded px-2 py-1 break-all">
                      &lt;pod-name&gt;.{svcName}.{namespace}.svc.cluster.local
                    </code>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
          {ports.length > 0 && (
            <SectionCard title="Port-Specific DNS (SRV Records)" icon={Globe}>
              <p className="text-sm text-muted-foreground mb-3">SRV records are generated per port for service discovery:</p>
              <div className="space-y-2">
                {ports.map((port, idx) => {
                  const portName = port.name || `port-${idx}`;
                  const protocol = (port.protocol || 'TCP').toLowerCase();
                  const srvRecord = `_${portName}._${protocol}.${svcName}.${namespace}.svc.cluster.local`;
                  return (
                    <div key={port.name || idx} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <div className="min-w-0 flex-1">
                        <code className="font-mono text-xs break-all">{srvRecord}</code>
                      </div>
                      <Badge variant="outline" className="ml-2 shrink-0 font-mono text-xs">{port.port}</Badge>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
          <SectionCard title="DNS Notes" icon={Globe}>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>A/AAAA records are created automatically for this service in the cluster DNS.</li>
              <li>Short name <code className="text-xs bg-muted px-1 rounded">{svcName}</code> resolves within the same namespace.</li>
              <li>Cross-namespace access requires the full FQDN: <code className="text-xs bg-muted px-1 rounded">{dnsName}</code></li>
              {serviceType === 'ExternalName' && svc.spec?.externalName && (
                <li>ExternalName services create a CNAME record pointing to <code className="text-xs bg-muted px-1 rounded">{svc.spec.externalName}</code></li>
              )}
            </ul>
          </SectionCard>
        </div>
      ),
    },
    {
      id: 'portforward',
      label: 'Port Forward',
      content: (
        <SectionCard title="Port forward" icon={ExternalLink}>
          <p className="text-muted-foreground text-sm mb-4">Forward a local port to this service (e.g. <code className="text-xs bg-muted px-1 rounded">kubectl port-forward svc/{svcName} 8080:80</code>). For pod-level port forward, use the Pod detail page.</p>
          <Button onClick={() => toast.info(`Use: kubectl port-forward svc/${svcName} -n ${namespace} <localPort>:<servicePort>`)}>Create port forward</Button>
        </SectionCard>
      ),
    },
    {
      id: 'pods',
      label: 'Pods',
      content: (
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
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} isLoading={eventsLoading} /> },
    {
      id: 'metrics',
      label: 'Metrics',
      content: (
        <SectionCard title="Metrics" icon={Activity}>
          <p className="text-muted-foreground text-sm mb-4">Traffic, latency, and error rate for services require a metrics pipeline (e.g. Prometheus). Placeholder until integration.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Request rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Latency</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Error rate</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm font-medium">Connections</p><p className="text-muted-foreground text-xs">—</p></CardContent></Card>
          </div>
        </SectionCard>
      ),
    },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={svcName} editable onSave={handleSaveYaml} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('Service')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Service"
          sourceResourceName={svc?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="services"
          resourceKind="Service"
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
      id: 'networkpolicies',
      label: 'Network Policies',
      content: (
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
      ),
    },
    ...(serviceType === 'LoadBalancer' ? [{
      id: 'loadbalancer',
      label: 'Load Balancer',
      content: (
        <SectionCard title="Load balancer status" icon={Globe}>
          <DetailRow label="Ingress" value={svc.status?.loadBalancer?.ingress?.map((i) => i.ip || i.hostname).join(', ') ?? '—'} />
          <p className="text-muted-foreground text-sm mt-2">Annotations and provisioning events depend on the cloud provider.</p>
        </SectionCard>
      ),
    }] : []),
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: ExternalLink, label: 'Port Forward', description: 'Forward local port to this service', onClick: () => toast.info(`kubectl port-forward svc/${svcName} -n ${namespace} <localPort>:<servicePort>`) },
          { icon: Globe, label: 'Test Connectivity', description: 'Simple connectivity check', onClick: () => toast.info('Test connectivity: requires backend support (design 3.1)') },
          ...(backingDeployment ? [{ icon: Server, label: 'Scale Backing Deployment', description: `Open Deployment ${backingDeployment.name} to scale`, onClick: () => navigate(`/deployments/${backingDeployment.namespace}/${backingDeployment.name}`) }] : []),
          { icon: Download, label: 'Download YAML', description: 'Export Service definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export Service as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Service', description: 'Remove this service', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Service"
        resourceIcon={Globe}
        name={svcName}
        namespace={svcNamespace}
        status={status}
        backLink="/services"
        backLabel="Services"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Port Forward', icon: ExternalLink, variant: 'outline', onClick: () => toast.info(`kubectl port-forward svc/${svcName} -n ${namespace} <localPort>:<servicePort>`) },
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
          });
        }}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Service"
        resourceName={svcName}
        namespace={svcNamespace}
        onConfirm={async () => {
          if (isConnected && name && svcNamespace) {
            await deleteService.mutateAsync({ name: name!, namespace: svcNamespace });
            navigate('/services');
          } else {
            toast.success(`Service ${svcName} deleted (demo mode)`);
            navigate('/services');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
