/**
 * Gateway detail page.
 *
 * Shows Gateway metadata, listeners with their configuration, attached routes,
 * and a topology visualization of Gateway -> GatewayClass, HTTPRoute -> Service -> Pod
 * relationships. Supports v1 and v1beta1 API versions.
 *
 * TASK-SCALE-001
 */

import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ChevronRight, Copy, ExternalLink, Loader2, MoreHorizontal,
  Network, RefreshCw, Route, Shield, Globe, ArrowRightLeft, Layers,
  CheckCircle2, XCircle, Clock, AlertTriangle, Server, Box, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatusPill, NamespaceBadge, type StatusPillVariant } from '@/components/list';
import { LabelList, AnnotationList, SectionCard, DetailRow } from '@/components/resources';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { listResources } from '@/services/backendApiClient';
import { toast } from '@/components/ui/sonner';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GatewayResource extends KubernetesResource {
  spec: {
    gatewayClassName?: string;
    listeners?: Array<{
      name: string;
      hostname?: string;
      port: number;
      protocol: string;
      tls?: { mode?: string; certificateRefs?: Array<{ name: string; namespace?: string; group?: string; kind?: string }> };
      allowedRoutes?: { namespaces?: { from?: string; selector?: Record<string, unknown> }; kinds?: Array<{ group?: string; kind: string }> };
    }>;
    addresses?: Array<{ type?: string; value: string }>;
  };
  status?: {
    addresses?: Array<{ type?: string; value: string }>;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>;
    listeners?: Array<{
      name: string;
      attachedRoutes: number;
      supportedKinds?: Array<{ group?: string; kind: string }>;
      conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
    }>;
  };
}

interface HTTPRouteResource extends KubernetesResource {
  spec: {
    parentRefs?: Array<{ group?: string; kind?: string; namespace?: string; name: string; sectionName?: string; port?: number }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{ path?: { type?: string; value?: string }; headers?: Array<{ name: string; value: string }> }>;
      backendRefs?: Array<{ group?: string; kind?: string; name: string; namespace?: string; port?: number; weight?: number }>;
      filters?: Array<Record<string, unknown>>;
    }>;
  };
}

interface TopologyNode {
  id: string;
  label: string;
  kind: string;
  status: StatusPillVariant;
  namespace?: string;
}

interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getConditionStatus(conditions: Array<{ type: string; status: string; reason?: string }> | undefined, type: string): StatusPillVariant {
  const cond = conditions?.find((c) => c.type === type);
  if (!cond) return 'neutral';
  return cond.status === 'True' ? 'healthy' : cond.status === 'False' ? 'error' : 'warning';
}

// ── Hook ───────────────────────────────────────────────────────────────────────

function useGatewayDetail(namespace: string, name: string) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);

  const gatewayQuery = useQuery({
    queryKey: ['gateway-detail', currentClusterId, namespace, name],
    queryFn: async () => {
      if (!backendBaseUrl || !currentClusterId) return null;
      try {
        const result = await listResources(backendBaseUrl, currentClusterId, `/apis/gateway.networking.k8s.io/v1/namespaces/${namespace}/gateways`, {});
        const items = (result as { items: GatewayResource[] }).items;
        return items.find((g) => g.metadata.name === name) ?? null;
      } catch {
        try {
          const result = await listResources(backendBaseUrl, currentClusterId, `/apis/gateway.networking.k8s.io/v1beta1/namespaces/${namespace}/gateways`, {});
          const items = (result as { items: GatewayResource[] }).items;
          return items.find((g) => g.metadata.name === name) ?? null;
        } catch {
          return null;
        }
      }
    },
    refetchInterval: 15_000,
    enabled: isBackendConfigured() && !!currentClusterId && !isDemo,
  });

  const routesQuery = useQuery({
    queryKey: ['gateway-routes', currentClusterId, namespace, name],
    queryFn: async () => {
      if (!backendBaseUrl || !currentClusterId) return [];
      try {
        const result = await listResources(backendBaseUrl, currentClusterId, `/apis/gateway.networking.k8s.io/v1/httproutes`, {
          namespace,
        });
        const items = (result as { items: HTTPRouteResource[] }).items;
        return items.filter((r) =>
          r.spec.parentRefs?.some((ref) => ref.name === name && (!ref.namespace || ref.namespace === namespace)),
        );
      } catch {
        return [];
      }
    },
    refetchInterval: 15_000,
    enabled: isBackendConfigured() && !!currentClusterId && !isDemo,
  });

  return { gateway: gatewayQuery.data, routes: routesQuery.data ?? [], isLoading: gatewayQuery.isLoading, refetch: () => { gatewayQuery.refetch(); routesQuery.refetch(); } };
}

// ── Topology Builder ───────────────────────────────────────────────────────────

function buildTopology(gateway: GatewayResource, routes: HTTPRouteResource[]): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const seen = new Set<string>();

  // GatewayClass node
  if (gateway.spec.gatewayClassName) {
    const classId = `class:${gateway.spec.gatewayClassName}`;
    if (!seen.has(classId)) {
      seen.add(classId);
      nodes.push({ id: classId, label: gateway.spec.gatewayClassName, kind: 'GatewayClass', status: 'healthy' });
    }
    edges.push({ source: `gw:${gateway.metadata.uid}`, target: classId, label: 'class' });
  }

  // Gateway node
  const gwId = `gw:${gateway.metadata.uid}`;
  const gwAccepted = gateway.status?.conditions?.find((c) => c.type === 'Accepted');
  nodes.push({
    id: gwId,
    label: gateway.metadata.name,
    kind: 'Gateway',
    status: gwAccepted?.status === 'True' ? 'healthy' : 'warning',
    namespace: gateway.metadata.namespace,
  });

  // Route nodes and backend refs
  for (const route of routes) {
    const routeId = `route:${route.metadata.uid}`;
    if (!seen.has(routeId)) {
      seen.add(routeId);
      nodes.push({
        id: routeId,
        label: route.metadata.name,
        kind: 'HTTPRoute',
        status: 'healthy',
        namespace: route.metadata.namespace,
      });
    }
    edges.push({ source: routeId, target: gwId, label: 'parentRef' });

    // Backend service refs
    for (const rule of route.spec.rules ?? []) {
      for (const backend of rule.backendRefs ?? []) {
        const svcId = `svc:${backend.namespace ?? route.metadata.namespace}/${backend.name}`;
        if (!seen.has(svcId)) {
          seen.add(svcId);
          nodes.push({
            id: svcId,
            label: backend.name,
            kind: (backend.kind ?? 'Service'),
            status: 'neutral',
            namespace: backend.namespace ?? route.metadata.namespace,
          });
        }
        edges.push({
          source: routeId,
          target: svcId,
          label: backend.port ? `port:${backend.port}${backend.weight ? ` w:${backend.weight}` : ''}` : undefined,
        });
      }
    }
  }

  return { nodes, edges };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function GatewayDetail() {
  const params = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const ns = params.namespace ?? '';
  const name = params.name ?? '';

  const { gateway, routes, isLoading, refetch } = useGatewayDetail(ns, name);
  const [activeTab, setActiveTab] = useState('overview');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!gateway) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <p className="text-muted-foreground">Gateway "{name}" not found in namespace "{ns}".</p>
        <Button variant="outline" onClick={() => navigate('/gateways')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Gateways
        </Button>
      </div>
    );
  }

  const topology = buildTopology(gateway, routes);
  const conditions = gateway.status?.conditions ?? [];
  const listeners = gateway.spec.listeners ?? [];
  const listenerStatuses = gateway.status?.listeners ?? [];
  const addresses = gateway.status?.addresses ?? gateway.spec.addresses ?? [];

  const overallStatus: StatusPillVariant = (() => {
    const programmed = conditions.find((c) => c.type === 'Programmed');
    if (programmed?.status === 'True') return 'healthy';
    const accepted = conditions.find((c) => c.type === 'Accepted');
    if (accepted?.status === 'True') return 'warning';
    return 'error';
  })();

  const overallLabel = (() => {
    const programmed = conditions.find((c) => c.type === 'Programmed');
    if (programmed?.status === 'True') return 'Programmed';
    const accepted = conditions.find((c) => c.type === 'Accepted');
    if (accepted?.status === 'True') return 'Accepted';
    return conditions[0]?.reason ?? 'Unknown';
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 p-4 md:p-6"
    >
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/gateways" className="hover:text-foreground transition-colors">Gateways</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span>{ns}</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 dark:bg-muted/30">
            <Network className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{name}</h1>
              <StatusPill variant={overallStatus} label={overallLabel} />
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
              <span>Namespace: {ns}</span>
              <span>Class: {gateway.spec.gatewayClassName ?? '-'}</span>
              <span>Age: {calculateAge(gateway.metadata.creationTimestamp)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            navigator.clipboard.writeText(name);
            toast.success('Copied name');
          }}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Labels & Annotations */}
      {gateway.metadata.labels && Object.keys(gateway.metadata.labels).length > 0 && (
        <div className="lg:col-span-2">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <LabelList labels={gateway.metadata.labels} showCard={false} showCopyAll={false} />
          </div>
        </div>
      )}
      {gateway.metadata.annotations && Object.keys(gateway.metadata.annotations).length > 0 && (
        <div className="lg:col-span-2">
          <AnnotationList annotations={gateway.metadata.annotations} showCard={false} maxVisible={5} />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" className="flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="listeners" className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> Listeners
            <Badge variant="secondary" className="ml-1 text-[10px]">{listeners.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="routes" className="flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" /> Routes
            <Badge variant="secondary" className="ml-1 text-[10px]">{routes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="topology" className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Topology
          </TabsTrigger>
          <TabsTrigger value="blast-radius" className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Blast Radius
          </TabsTrigger>
          <TabsTrigger value="yaml" className="flex items-center gap-1.5">
            YAML
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Gateway Info */}
            <SectionCard icon={Network} title="Gateway Info">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <DetailRow label="Name" value={name} />
                <DetailRow label="Namespace" value={ns} />
                <DetailRow label="Gateway Class" value={gateway.spec.gatewayClassName ?? '-'} />
                <DetailRow label="Age" value={calculateAge(gateway.metadata.creationTimestamp)} />
              </div>
            </SectionCard>

            {/* Addresses */}
            <SectionCard icon={Globe} title="Addresses">
              {addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No addresses assigned.</p>
              ) : (
                <div className="space-y-2">
                  {addresses.map((addr, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge variant="outline">{addr.type ?? 'IPAddress'}</Badge>
                      <span className="font-mono text-sm font-semibold">{addr.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Conditions */}
            <SectionCard icon={CheckCircle2} title="Conditions" className="md:col-span-2">
              {conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conditions</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Age</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conditions.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm font-semibold">{c.type}</TableCell>
                          <TableCell>
                            <Badge variant={c.status === 'True' ? 'default' : 'destructive'}>{c.status}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{c.reason ?? '-'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {c.lastTransitionTime ? calculateAge(c.lastTransitionTime) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        {/* Listeners Tab */}
        <TabsContent value="listeners" className="mt-4">
          <div className="grid gap-6">
            {listeners.map((listener) => {
              const listenerStatus = listenerStatuses.find((ls) => ls.name === listener.name);
              return (
                <SectionCard key={listener.name} icon={Globe} title={listener.name}>
                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="outline">{listener.protocol}</Badge>
                    <Badge variant="secondary">:{listener.port}</Badge>
                    <Badge variant="secondary" className="text-xs">
                      {listenerStatus?.attachedRoutes ?? 0} routes attached
                    </Badge>
                    {listenerStatus?.conditions && (
                      <StatusPill
                        variant={getConditionStatus(listenerStatus.conditions, 'Ready')}
                        label={listenerStatus.conditions.find((c) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'Not Ready'}
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    <DetailRow label="Hostname" value={<span className="font-mono">{listener.hostname ?? '*'}</span>} />
                    {listener.tls && (
                      <DetailRow label="TLS Mode" value={
                        <div className="flex items-center gap-1.5">
                          <Shield className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-sm font-semibold">{listener.tls.mode ?? 'Terminate'}</span>
                        </div>
                      } />
                    )}
                    <DetailRow label="Allowed Routes" value={listener.allowedRoutes?.namespaces?.from ?? 'Same'} />
                    {listenerStatus?.supportedKinds && (
                      <DetailRow label="Supported Kinds" value={
                        <div className="flex flex-wrap gap-1">
                          {listenerStatus.supportedKinds.map((sk, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{sk.kind}</Badge>
                          ))}
                        </div>
                      } />
                    )}
                  </div>
                  {listener.tls?.certificateRefs && listener.tls.certificateRefs.length > 0 && (
                    <div className="mt-3">
                      <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Certificate Refs</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {listener.tls.certificateRefs.map((ref, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {ref.namespace ? `${ref.namespace}/` : ''}{ref.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              );
            })}
          </div>
        </TabsContent>

        {/* Routes Tab */}
        <TabsContent value="routes" className="mt-4">
          {routes.length === 0 ? (
            <SectionCard icon={Route} title="HTTP Routes">
              <div className="flex flex-col items-center justify-center p-8">
                <Route className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No HTTPRoutes attached to this Gateway.</p>
              </div>
            </SectionCard>
          ) : (
            <div className="space-y-6">
              {routes.map((route) => (
                <SectionCard key={route.metadata.uid} icon={Route} title={route.metadata.name}>
                  <div className="flex items-center gap-2 mb-4">
                    <NamespaceBadge namespace={route.metadata.namespace ?? '-'} />
                    {route.spec.hostnames?.map((h) => (
                      <Badge key={h} variant="outline" className="font-mono text-xs">{h}</Badge>
                    ))}
                  </div>
                  {route.spec.rules?.map((rule, ri) => (
                    <div key={ri} className="mb-3 last:mb-0">
                      <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Rule {ri + 1}</span>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2">
                        <DetailRow label="Matches" value={
                          rule.matches?.length ? (
                            <div className="space-y-0.5">
                              {rule.matches.map((m, mi) => (
                                <div key={mi} className="font-mono text-sm font-semibold">
                                  {m.path?.type ?? 'PathPrefix'}: {m.path?.value ?? '/'}
                                </div>
                              ))}
                            </div>
                          ) : '*'
                        } />
                        <DetailRow label="Backends" value={
                          rule.backendRefs?.length ? (
                            <div className="space-y-1">
                              {rule.backendRefs.map((b, bi) => (
                                <div key={bi} className="flex items-center gap-1">
                                  <Badge variant="secondary" className="text-xs">
                                    {b.namespace ? `${b.namespace}/` : ''}{b.name}:{b.port ?? '?'}
                                  </Badge>
                                  {b.weight != null && (
                                    <span className="text-xs text-muted-foreground">w:{b.weight}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : '-'
                        } />
                      </div>
                    </div>
                  ))}
                </SectionCard>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Topology Tab */}
        <TabsContent value="topology" className="mt-4">
          <SectionCard icon={Layers} title="Gateway Topology">
              <div className="min-h-[300px] flex flex-col items-center gap-6 py-4">
                {/* GatewayClass */}
                {topology.nodes.filter((n) => n.kind === 'GatewayClass').map((node) => (
                  <div key={node.id} className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 dark:bg-muted/20 px-4 py-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{node.label}</span>
                      <Badge variant="outline" className="text-[9px]">GatewayClass</Badge>
                    </div>
                    <div className="h-6 w-px bg-border" />
                  </div>
                ))}

                {/* Gateway */}
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg border-2 px-4 py-3',
                    overallStatus === 'healthy' ? 'border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/20' :
                    overallStatus === 'warning' ? 'border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/20' :
                    'border-red-500/50 bg-red-50/30 dark:bg-red-950/20',
                  )}>
                    <Network className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-semibold text-sm">{gateway.metadata.name}</p>
                      <p className="text-xs text-muted-foreground">{ns}</p>
                    </div>
                    <StatusPill variant={overallStatus} label={overallLabel} />
                  </div>
                  {routes.length > 0 && <div className="h-6 w-px bg-border" />}
                </div>

                {/* Routes -> Services */}
                {routes.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-6">
                    {routes.map((route) => (
                      <div key={route.metadata.uid} className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                          <Route className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium">{route.metadata.name}</span>
                          <Badge variant="outline" className="text-[9px]">HTTPRoute</Badge>
                        </div>
                        {/* Backend refs */}
                        {route.spec.rules?.flatMap((r) => r.backendRefs ?? []).length ? (
                          <>
                            <div className="h-4 w-px bg-border" />
                            <div className="flex flex-wrap gap-2">
                              {route.spec.rules?.flatMap((r) => r.backendRefs ?? []).map((b, i) => (
                                <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 dark:bg-muted/10 px-2.5 py-1.5">
                                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-xs font-medium">{b.name}</span>
                                  {b.port && <Badge variant="secondary" className="text-[9px]">:{b.port}</Badge>}
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </SectionCard>
        </TabsContent>

        {/* Blast Radius Tab */}
        <TabsContent value="blast-radius" className="mt-4">
          <BlastRadiusTab
            kind={normalizeKindForTopology('Gateway')}
            namespace={ns || gateway?.metadata?.namespace || ''}
            name={name || gateway?.metadata?.name || ''}
          />
        </TabsContent>

        {/* YAML Tab */}
        <TabsContent value="yaml" className="mt-4">
          <SectionCard icon={Server} title="YAML">
            <pre className="overflow-auto rounded-md bg-muted/50 dark:bg-muted/20 p-4 text-xs font-mono text-foreground max-h-[600px]">
              {JSON.stringify(gateway, null, 2)}
            </pre>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
