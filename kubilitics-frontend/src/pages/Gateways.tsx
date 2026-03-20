/**
 * Gateway API list page.
 *
 * Displays Gateway, GatewayClass, HTTPRoute, and GRPCRoute resources from
 * the Gateway API (gateway.networking.k8s.io). Supports both v1 (GA) and
 * v1beta1 API versions with automatic fallback.
 *
 * TASK-SCALE-001
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, Plus,
  ChevronDown, ChevronLeft, ChevronRight, Trash2,
  Globe, Network, Route, ArrowRightLeft, Layers, Shield,
  CheckCircle2, XCircle, Clock, AlertTriangle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  StatusPill, ListPagination, PAGE_SIZE_OPTIONS,
  resourceTableRowClassName, ROW_MOTION,
  TableEmptyState, ListPageLoadingShell, NamespaceBadge, CopyNameDropdownItem,
  type StatusPillVariant,
} from '@/components/list';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { listResources } from '@/services/backendApiClient';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

type GatewayResourceTab = 'gateways' | 'gatewayclasses' | 'httproutes' | 'grpcroutes';

interface GatewayResource extends KubernetesResource {
  spec: {
    gatewayClassName?: string;
    listeners?: Array<{
      name: string;
      hostname?: string;
      port: number;
      protocol: string;
      tls?: { mode?: string; certificateRefs?: Array<{ name: string; namespace?: string }> };
      allowedRoutes?: { namespaces?: { from?: string } };
    }>;
    addresses?: Array<{ type?: string; value: string }>;
  };
  status?: {
    addresses?: Array<{ type?: string; value: string }>;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>;
    listeners?: Array<{
      name: string;
      attachedRoutes: number;
      conditions?: Array<{ type: string; status: string; reason?: string }>;
    }>;
  };
}

interface GatewayClassResource extends KubernetesResource {
  spec: {
    controllerName: string;
    description?: string;
    parametersRef?: { group: string; kind: string; name: string; namespace?: string };
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}

interface HTTPRouteResource extends KubernetesResource {
  spec: {
    parentRefs?: Array<{ group?: string; kind?: string; namespace?: string; name: string; sectionName?: string; port?: number }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{ path?: { type?: string; value?: string }; headers?: Array<{ type?: string; name: string; value: string }> }>;
      backendRefs?: Array<{ group?: string; kind?: string; name: string; namespace?: string; port?: number; weight?: number }>;
    }>;
  };
  status?: {
    parents?: Array<{
      parentRef: { name: string; namespace?: string };
      conditions?: Array<{ type: string; status: string; reason?: string }>;
    }>;
  };
}

interface GRPCRouteResource extends KubernetesResource {
  spec: {
    parentRefs?: Array<{ group?: string; kind?: string; namespace?: string; name: string }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{ method?: { service?: string; method?: string }; headers?: Array<{ type?: string; name: string; value: string }> }>;
      backendRefs?: Array<{ group?: string; kind?: string; name: string; namespace?: string; port?: number; weight?: number }>;
    }>;
  };
  status?: {
    parents?: Array<{
      parentRef: { name: string; namespace?: string };
      conditions?: Array<{ type: string; status: string; reason?: string }>;
    }>;
  };
}

// ── API Versions ───────────────────────────────────────────────────────────────

const GATEWAY_API_GROUPS = {
  gateways: {
    v1: '/apis/gateway.networking.k8s.io/v1',
    v1beta1: '/apis/gateway.networking.k8s.io/v1beta1',
    resource: 'gateways',
  },
  gatewayclasses: {
    v1: '/apis/gateway.networking.k8s.io/v1',
    v1beta1: '/apis/gateway.networking.k8s.io/v1beta1',
    resource: 'gatewayclasses',
  },
  httproutes: {
    v1: '/apis/gateway.networking.k8s.io/v1',
    v1beta1: '/apis/gateway.networking.k8s.io/v1beta1',
    resource: 'httproutes',
  },
  grpcroutes: {
    v1: '/apis/gateway.networking.k8s.io/v1',
    v1beta1: '/apis/gateway.networking.k8s.io/v1beta1',
    resource: 'grpcroutes',
  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getGatewayStatus(gw: GatewayResource): StatusPillVariant {
  const conditions = gw.status?.conditions;
  if (!conditions || conditions.length === 0) return 'neutral';
  const accepted = conditions.find((c) => c.type === 'Accepted');
  if (accepted?.status === 'True') {
    const programmed = conditions.find((c) => c.type === 'Programmed');
    return programmed?.status === 'True' ? 'healthy' : 'warning';
  }
  return 'error';
}

function getGatewayStatusLabel(gw: GatewayResource): string {
  const conditions = gw.status?.conditions;
  if (!conditions || conditions.length === 0) return 'Unknown';
  const programmed = conditions.find((c) => c.type === 'Programmed');
  if (programmed?.status === 'True') return 'Programmed';
  const accepted = conditions.find((c) => c.type === 'Accepted');
  if (accepted?.status === 'True') return 'Accepted';
  if (accepted?.status === 'False') return accepted.reason ?? 'Not Accepted';
  return 'Pending';
}

function getClassStatus(cls: GatewayClassResource): StatusPillVariant {
  const accepted = cls.status?.conditions?.find((c) => c.type === 'Accepted');
  if (!accepted) return 'neutral';
  return accepted.status === 'True' ? 'healthy' : 'error';
}

function getRouteStatus(route: HTTPRouteResource | GRPCRouteResource): StatusPillVariant {
  const parents = route.status?.parents;
  if (!parents || parents.length === 0) return 'neutral';
  const allAccepted = parents.every((p) =>
    p.conditions?.some((c) => c.type === 'Accepted' && c.status === 'True'),
  );
  return allAccepted ? 'healthy' : 'warning';
}

function totalAttachedRoutes(gw: GatewayResource): number {
  return gw.status?.listeners?.reduce((sum, l) => sum + (l.attachedRoutes ?? 0), 0) ?? 0;
}

// ── Custom Hook for Gateway API Resources ──────────────────────────────────────

function useGatewayResources<T extends KubernetesResource>(
  type: keyof typeof GATEWAY_API_GROUPS,
  namespace?: string,
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);

  const config = GATEWAY_API_GROUPS[type];

  return useQuery({
    queryKey: ['gateway-api', type, currentClusterId, namespace],
    queryFn: async () => {
      if (!isBackendConfigured() || !currentClusterId || isDemo) {
        return { items: [] as T[] };
      }

      // Try v1 first, fall back to v1beta1
      try {
        const result = await listResources(backendBaseUrl!, currentClusterId, `${config.v1}/${config.resource}`, {
          namespace,
        });
        return result as { items: T[] };
      } catch {
        try {
          const result = await listResources(backendBaseUrl!, currentClusterId, `${config.v1beta1}/${config.resource}`, {
            namespace,
          });
          return result as { items: T[] };
        } catch {
          return { items: [] as T[] };
        }
      }
    },
    refetchInterval: 15_000,
    enabled: isBackendConfigured() && !!currentClusterId && !isDemo,
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Gateways() {
  const navigate = useNavigate();
  const { isOnline } = useConnectionStatus();
  const activeNamespace = useClusterStore((s) => s.activeNamespace);
  const effectiveNamespace = activeNamespace !== 'All Namespaces' ? activeNamespace : undefined;

  const [activeTab, setActiveTab] = useState<GatewayResourceTab>('gateways');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // ── Data ─────────────────────────────────────────────────────────────────

  const gatewaysQuery = useGatewayResources<GatewayResource>('gateways', effectiveNamespace);
  const classesQuery = useGatewayResources<GatewayClassResource>('gatewayclasses');
  const httpRoutesQuery = useGatewayResources<HTTPRouteResource>('httproutes', effectiveNamespace);
  const grpcRoutesQuery = useGatewayResources<GRPCRouteResource>('grpcroutes', effectiveNamespace);

  const gateways = gatewaysQuery.data?.items ?? [];
  const classes = classesQuery.data?.items ?? [];
  const httpRoutes = httpRoutesQuery.data?.items ?? [];
  const grpcRoutes = grpcRoutesQuery.data?.items ?? [];

  const isLoading = gatewaysQuery.isLoading || classesQuery.isLoading || httpRoutesQuery.isLoading;

  // ── Filtered Data ────────────────────────────────────────────────────────

  const filterItems = useCallback(<T extends KubernetesResource>(items: T[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const name = item.metadata.name?.toLowerCase() ?? '';
      const ns = item.metadata.namespace?.toLowerCase() ?? '';
      return name.includes(q) || ns.includes(q);
    });
  }, [search]);

  const filteredGateways = useMemo(() => filterItems(gateways), [filterItems, gateways]);
  const filteredClasses = useMemo(() => filterItems(classes), [filterItems, classes]);
  const filteredHttpRoutes = useMemo(() => filterItems(httpRoutes), [filterItems, httpRoutes]);
  const filteredGrpcRoutes = useMemo(() => filterItems(grpcRoutes), [filterItems, grpcRoutes]);

  // ── Pagination ───────────────────────────────────────────────────────────

  function paginate<T>(items: T[]): T[] {
    return items.slice((page - 1) * pageSize, page * pageSize);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) return <ListPageLoadingShell />;

  // ── Stat Cards ───────────────────────────────────────────────────────────

  const totalGateways = gateways.length;
  const healthyGateways = gateways.filter((g) => getGatewayStatus(g) === 'healthy').length;
  const totalRoutes = httpRoutes.length + grpcRoutes.length;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground dark:text-foreground">
            Gateway API
          </h1>
          {!isOnline && <WifiOff className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            gatewaysQuery.refetch();
            classesQuery.refetch();
            httpRoutesQuery.refetch();
            grpcRoutesQuery.refetch();
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gateways</p>
            <p className="text-2xl font-bold text-foreground">{totalGateways}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Programmed</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{healthyGateways}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Classes</p>
            <p className="text-2xl font-bold text-foreground">{classes.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Routes</p>
            <p className="text-2xl font-bold text-foreground">{totalRoutes}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search gateways, routes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as GatewayResourceTab); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="gateways" className="flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5" /> Gateways
            <Badge variant="secondary" className="ml-1 text-[10px]">{gateways.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="gatewayclasses" className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Classes
            <Badge variant="secondary" className="ml-1 text-[10px]">{classes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="httproutes" className="flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" /> HTTP Routes
            <Badge variant="secondary" className="ml-1 text-[10px]">{httpRoutes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="grpcroutes" className="flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" /> gRPC Routes
            <Badge variant="secondary" className="ml-1 text-[10px]">{grpcRoutes.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Gateways Tab */}
        <TabsContent value="gateways" className="mt-4">
          {filteredGateways.length === 0 ? (
            <TableEmptyState resource="Gateways" />
          ) : (
            <div className="rounded-lg border border-border dark:border-border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Listeners</TableHead>
                    <TableHead>Routes</TableHead>
                    <TableHead>Addresses</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginate(filteredGateways).map((gw) => (
                    <motion.tr
                      key={gw.metadata.uid}
                      {...ROW_MOTION}
                      className={resourceTableRowClassName}
                      onClick={() => navigate(`/gateways/${gw.metadata.namespace}/${gw.metadata.name}`)}
                    >
                      <TableCell className="font-medium">{gw.metadata.name}</TableCell>
                      <TableCell><NamespaceBadge namespace={gw.metadata.namespace ?? '-'} /></TableCell>
                      <TableCell>{gw.spec.gatewayClassName ?? '-'}</TableCell>
                      <TableCell>
                        <StatusPill variant={getGatewayStatus(gw)} label={getGatewayStatusLabel(gw)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {gw.spec.listeners?.map((l) => (
                            <Badge key={l.name} variant="outline" className="text-[10px]">
                              {l.name}:{l.port}/{l.protocol}
                            </Badge>
                          )) ?? '-'}
                        </div>
                      </TableCell>
                      <TableCell>{totalAttachedRoutes(gw)}</TableCell>
                      <TableCell>
                        {gw.status?.addresses?.map((a) => a.value).join(', ') ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {calculateAge(gw.metadata.creationTimestamp)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <CopyNameDropdownItem name={gw.metadata.name} />
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 dark:text-red-400">
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* GatewayClasses Tab */}
        <TabsContent value="gatewayclasses" className="mt-4">
          {filteredClasses.length === 0 ? (
            <TableEmptyState resource="GatewayClasses" />
          ) : (
            <div className="rounded-lg border border-border dark:border-border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Controller</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginate(filteredClasses).map((cls) => (
                    <motion.tr key={cls.metadata.uid} {...ROW_MOTION} className={resourceTableRowClassName}>
                      <TableCell className="font-medium">{cls.metadata.name}</TableCell>
                      <TableCell className="font-mono text-xs">{cls.spec.controllerName}</TableCell>
                      <TableCell>
                        <StatusPill
                          variant={getClassStatus(cls)}
                          label={cls.status?.conditions?.find((c) => c.type === 'Accepted')?.status === 'True' ? 'Accepted' : 'Not Accepted'}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {cls.spec.description ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {calculateAge(cls.metadata.creationTimestamp)}
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* HTTPRoutes Tab */}
        <TabsContent value="httproutes" className="mt-4">
          {filteredHttpRoutes.length === 0 ? (
            <TableEmptyState resource="HTTPRoutes" />
          ) : (
            <div className="rounded-lg border border-border dark:border-border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Parent Gateways</TableHead>
                    <TableHead>Hostnames</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rules</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginate(filteredHttpRoutes).map((route) => (
                    <motion.tr key={route.metadata.uid} {...ROW_MOTION} className={resourceTableRowClassName}>
                      <TableCell className="font-medium">{route.metadata.name}</TableCell>
                      <TableCell><NamespaceBadge namespace={route.metadata.namespace ?? '-'} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {route.spec.parentRefs?.map((ref, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {ref.namespace ? `${ref.namespace}/` : ''}{ref.name}
                            </Badge>
                          )) ?? '-'}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {route.spec.hostnames?.join(', ') ?? '*'}
                      </TableCell>
                      <TableCell>
                        <StatusPill variant={getRouteStatus(route)} label={getRouteStatus(route) === 'healthy' ? 'Accepted' : 'Pending'} />
                      </TableCell>
                      <TableCell>{route.spec.rules?.length ?? 0}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {calculateAge(route.metadata.creationTimestamp)}
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* GRPCRoutes Tab */}
        <TabsContent value="grpcroutes" className="mt-4">
          {filteredGrpcRoutes.length === 0 ? (
            <TableEmptyState resource="GRPCRoutes" />
          ) : (
            <div className="rounded-lg border border-border dark:border-border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Namespace</TableHead>
                    <TableHead>Parent Gateways</TableHead>
                    <TableHead>Hostnames</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rules</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginate(filteredGrpcRoutes).map((route) => (
                    <motion.tr key={route.metadata.uid} {...ROW_MOTION} className={resourceTableRowClassName}>
                      <TableCell className="font-medium">{route.metadata.name}</TableCell>
                      <TableCell><NamespaceBadge namespace={route.metadata.namespace ?? '-'} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {route.spec.parentRefs?.map((ref, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {ref.namespace ? `${ref.namespace}/` : ''}{ref.name}
                            </Badge>
                          )) ?? '-'}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {route.spec.hostnames?.join(', ') ?? '*'}
                      </TableCell>
                      <TableCell>
                        <StatusPill variant={getRouteStatus(route)} label={getRouteStatus(route) === 'healthy' ? 'Accepted' : 'Pending'} />
                      </TableCell>
                      <TableCell>{route.spec.rules?.length ?? 0}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {calculateAge(route.metadata.creationTimestamp)}
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {(() => {
        const currentItems = activeTab === 'gateways' ? filteredGateways
          : activeTab === 'gatewayclasses' ? filteredClasses
          : activeTab === 'httproutes' ? filteredHttpRoutes
          : filteredGrpcRoutes;
        const totalPages = Math.max(1, Math.ceil(currentItems.length / pageSize));
        if (currentItems.length <= pageSize) return null;
        return (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, currentItems.length)} of {currentItems.length}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
