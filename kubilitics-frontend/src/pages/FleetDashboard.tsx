/**
 * FleetDashboard — Multi-cluster fleet overview page.
 *
 * TASK-ENT-004: Fleet Dashboard
 *
 * Route: /fleet
 * Shows all connected clusters as cards in a responsive grid with
 * aggregate metrics, health-coded status badges, and click-to-navigate.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Server,
  Box,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Layers,
  ArrowRight,
  Unplug,
  Globe,
  Star,
  Tag,
  MoreVertical,
  Search,
  Rocket,
  Clock,
  X,
  Check,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useFleetOverview } from '@/hooks/useFleetOverview';
import type { FleetCluster, FleetAggregates } from '@/hooks/useFleetOverview';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { searchResources } from '@/services/backendApiClient';
import type { SearchResultItem } from '@/services/backendApiClient';
import {
  useClusterOrganizationStore,
  ENV_DOT_COLORS,
  ENV_LABELS,
  ENV_BADGE_CLASSES,
  GROUP_COLORS,
  type EnvironmentTag,
} from '@/stores/clusterOrganizationStore';
import { useQueryClient } from '@tanstack/react-query';

// ─── Animation variants ──────────────────────────────────────────────────────

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } },
};

// ─── Aggregate Stat Card ─────────────────────────────────────────────────────

function AggregateCard({
  label,
  value,
  icon: Icon,
  iconClass,
  bgClass,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClass: string;
  bgClass: string;
}) {
  return (
    <Card className="border-0 shadow-sm bg-card/80 backdrop-blur-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('flex items-center justify-center w-10 h-10 rounded-xl', bgClass)}>
          <Icon className={cn('h-5 w-5', iconClass)} aria-hidden />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Aggregate Metrics Strip ─────────────────────────────────────────────────

function AggregateStrip({ aggregates, isLoading }: { aggregates: FleetAggregates; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <AggregateCard
        label="Total Clusters"
        value={aggregates.totalClusters}
        icon={Layers}
        iconClass="text-blue-600 dark:text-blue-400"
        bgClass="bg-blue-100 dark:bg-blue-950/50"
      />
      <AggregateCard
        label="Total Nodes"
        value={aggregates.totalNodes}
        icon={Server}
        iconClass="text-sky-600 dark:text-sky-400"
        bgClass="bg-sky-100 dark:bg-sky-950/50"
      />
      <AggregateCard
        label="Total Pods"
        value={aggregates.totalPods}
        icon={Box}
        iconClass="text-violet-600 dark:text-violet-400"
        bgClass="bg-violet-100 dark:bg-violet-950/50"
      />
      <AggregateCard
        label="Total Deploys"
        value={aggregates.totalDeployments}
        icon={Rocket}
        iconClass="text-indigo-600 dark:text-indigo-400"
        bgClass="bg-indigo-100 dark:bg-indigo-950/50"
      />
      <AggregateCard
        label="Healthy"
        value={aggregates.healthyClusters}
        icon={CheckCircle2}
        iconClass="text-emerald-600 dark:text-emerald-400"
        bgClass="bg-emerald-100 dark:bg-emerald-950/50"
      />
      <AggregateCard
        label="Degraded"
        value={aggregates.degradedClusters}
        icon={AlertTriangle}
        iconClass="text-amber-600 dark:text-amber-400"
        bgClass="bg-amber-100 dark:bg-amber-950/50"
      />
      <AggregateCard
        label="Failed"
        value={aggregates.failedClusters}
        icon={XCircle}
        iconClass="text-red-600 dark:text-red-400"
        bgClass="bg-red-100 dark:bg-red-950/50"
      />
    </div>
  );
}

// ─── Cluster Card ────────────────────────────────────────────────────────────

const statusConfig = {
  healthy: {
    variant: 'success' as const,
    label: 'Healthy',
    ringClass: 'ring-emerald-500/20 dark:ring-emerald-400/20',
    indicatorClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  warning: {
    variant: 'warning' as const,
    label: 'Degraded',
    ringClass: 'ring-amber-500/20 dark:ring-amber-400/20',
    indicatorClass: 'bg-amber-500 dark:bg-amber-400',
  },
  error: {
    variant: 'error' as const,
    label: 'Failed',
    ringClass: 'ring-red-500/20 dark:ring-red-400/20',
    indicatorClass: 'bg-red-500 dark:bg-red-400',
  },
};

function ClusterCard({ cluster, onClick }: { cluster: FleetCluster; onClick: () => void }) {
  const cfg = statusConfig[cluster.status];
  const favorites = useClusterOrganizationStore((s) => s.favorites);
  const envTags = useClusterOrganizationStore((s) => s.envTags);
  const groups = useClusterOrganizationStore((s) => s.groups);
  const toggleFavorite = useClusterOrganizationStore((s) => s.toggleFavorite);
  const setEnvTag = useClusterOrganizationStore((s) => s.setEnvTag);
  const addToGroup = useClusterOrganizationStore((s) => s.addToGroup);
  const removeFromGroup = useClusterOrganizationStore((s) => s.removeFromGroup);

  const isFav = favorites.includes(cluster.id);
  const envTag = envTags[cluster.id] as EnvironmentTag | undefined;

  // Find which groups this cluster belongs to
  const memberGroups = Object.entries(groups).filter(([, g]) => g.clusterIds.includes(cluster.id));

  return (
    <Card
      className={cn(
        'group cursor-pointer border transition-all duration-200',
        'hover:shadow-md hover:border-primary/20 dark:hover:border-primary/30',
        'ring-1',
        cfg.ringClass,
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${cluster.name} - ${cfg.label}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="p-5">
        {/* Header: Name + Status + Actions */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {envTag && (
                <span className="block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ENV_DOT_COLORS[envTag] }} />
              )}
              <h3 className="font-semibold text-foreground truncate text-sm">
                {cluster.name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <p className="text-xs text-muted-foreground truncate">
                {cluster.context}
              </p>
              {envTag && (
                <span className={cn('text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border', ENV_BADGE_CLASSES[envTag])}>
                  {ENV_LABELS[envTag]}
                </span>
              )}
              {memberGroups.map(([gid, g]) => (
                <span key={gid} className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-current/20" style={{ color: g.color, backgroundColor: `${g.color}15` }}>
                  {g.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Favorite star */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(cluster.id); }}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={cn('h-4 w-4', isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400')} />
            </button>
            {/* Context menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Cluster actions"
                >
                  <MoreVertical className="h-4 w-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {/* Environment tagging */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Tag className="h-3.5 w-3.5" />
                    <span>Environment</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(['production', 'staging', 'development', 'testing'] as EnvironmentTag[]).map((env) => (
                      <DropdownMenuItem
                        key={env}
                        onClick={(e) => { e.stopPropagation(); setEnvTag(cluster.id, envTag === env ? null : env); }}
                        className="gap-2"
                      >
                        <span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ENV_DOT_COLORS[env] }} />
                        <span className="flex-1">{ENV_LABELS[env]}</span>
                        {envTag === env && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                    {envTag && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); setEnvTag(cluster.id, null); }}
                          className="gap-2 text-muted-foreground"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Clear tag</span>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Group assignment */}
                {Object.keys(groups).length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                      <Layers className="h-3.5 w-3.5" />
                      <span>Groups</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {Object.entries(groups).map(([gid, g]) => {
                        const isMember = g.clusterIds.includes(cluster.id);
                        return (
                          <DropdownMenuItem
                            key={gid}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isMember) removeFromGroup(gid, cluster.id);
                              else addToGroup(gid, cluster.id);
                            }}
                            className="gap-2"
                          >
                            <span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                            <span className="flex-1">{g.name}</span>
                            {isMember && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(cluster.id); }}
                  className="gap-2"
                >
                  <Star className={cn('h-3.5 w-3.5', isFav ? 'fill-amber-400 text-amber-400' : '')} />
                  <span>{isFav ? 'Remove from favorites' : 'Add to favorites'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <StatusBadge variant={cfg.variant} label={cfg.label} size="sm" dot />
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Nodes</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{cluster.nodeCount}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Pods</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{cluster.podCount}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Deployments</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{cluster.deploymentCount}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Services</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{cluster.serviceCount}</p>
          </div>
        </div>

        {/* Footer: Provider + Version + Last Connected + Arrow */}
        <div className="flex items-center justify-between border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {/* Health indicator dot */}
            <span
              className={cn(
                'block w-2 h-2 rounded-full shrink-0',
                cfg.indicatorClass,
              )}
              aria-label={cfg.label}
            />
            {cluster.provider && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 font-medium">
                <Globe className="h-3 w-3" aria-hidden />
                {cluster.provider}
              </span>
            )}
            {cluster.version && (
              <span className="font-mono">{cluster.version}</span>
            )}
            {cluster.lastConnected && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                <Clock className="h-3 w-3" aria-hidden />
                {formatDistanceToNow(new Date(cluster.lastConnected), { addSuffix: true })}
              </span>
            )}
          </div>
          <ArrowRight
            className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
            aria-hidden
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function ClusterCardSkeleton() {
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-8" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border/50 pt-3">
          <Skeleton className="h-4 w-14 rounded" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50">
        <Unplug className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold text-foreground">No clusters connected</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Connect your first cluster to see fleet-wide health, metrics, and status at a glance.
        </p>
      </div>
      <Button onClick={() => navigate('/connect?addCluster=true')} variant="default" size="sm">
        Connect Cluster
      </Button>
    </div>
  );
}

// ─── Cross-Cluster Search Result ─────────────────────────────────────────────

interface FleetSearchResult extends SearchResultItem {
  clusterId: string;
  clusterName: string;
}

const SEARCH_DEBOUNCE_MS = 300;

function CrossClusterSearch({
  clusters,
}: {
  clusters: FleetCluster[];
}) {
  const navigate = useNavigate();
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const { setActiveCluster, clusters: storeClusters } = useClusterStore();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FleetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close results on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !isConfigured || clusters.length === 0) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        // Search across all clusters in parallel
        const searchPromises = clusters.map(async (cluster) => {
          try {
            const resp = await searchResources(backendBaseUrl, cluster.id, q, 10);
            return resp.results.map((item) => ({
              ...item,
              clusterId: cluster.id,
              clusterName: cluster.name,
            }));
          } catch {
            // If one cluster fails, don't break the whole search
            return [] as FleetSearchResult[];
          }
        });

        const allResults = await Promise.all(searchPromises);
        setResults(allResults.flat().slice(0, 25));
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [backendBaseUrl, clusters, isConfigured],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      debounceRef.current = setTimeout(() => {
        performSearch(value);
      }, SEARCH_DEBOUNCE_MS);
    },
    [performSearch],
  );

  const handleResultClick = useCallback(
    (result: FleetSearchResult) => {
      // Switch to the cluster context first
      setCurrentClusterId(result.clusterId);
      const storeCluster = storeClusters.find((c) => c.id === result.clusterId);
      if (storeCluster) setActiveCluster(storeCluster);

      // Clear stale queries
      queryClient.removeQueries({ queryKey: ['k8s'] });
      queryClient.removeQueries({ queryKey: ['backend', 'resources'] });
      queryClient.removeQueries({ queryKey: ['backend', 'resource'] });

      // Navigate to the resource detail page
      navigate(result.path);
      setQuery('');
      setResults([]);
      setIsFocused(false);
    },
    [navigate, setCurrentClusterId, setActiveCluster, storeClusters, queryClient],
  );

  const showResults = isFocused && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
        <Input
          type="text"
          placeholder="Search across all clusters..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="pl-9 pr-9 h-10 bg-muted/40 border-muted-foreground/15 focus-visible:bg-background"
          aria-label="Cross-cluster search"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {showResults && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-1.5 w-full rounded-lg border bg-popover shadow-lg overflow-hidden"
          >
            {isSearching ? (
              <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                <Activity className="h-4 w-4 animate-spin" aria-hidden />
                Searching across {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No resources found matching &ldquo;{query}&rdquo;
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
                {results.map((result, i) => (
                  <button
                    key={`${result.clusterId}-${result.kind}-${result.namespace}-${result.name}-${i}`}
                    onClick={() => handleResultClick(result)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-md bg-muted/70 shrink-0">
                      <Box className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{result.name}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {result.kind}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <span className="font-medium text-primary/80">{result.clusterName}</span>
                        {result.namespace && (
                          <>
                            <span className="text-muted-foreground/40">/</span>
                            <span>{result.namespace}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FleetDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const { setActiveCluster, clusters: storeClusters } = useClusterStore();
  const fleetData = useFleetOverview();
  const { clusters, aggregates, isError, error } = fleetData;
  // Only show loading skeleton on FIRST render. Once we have data, never go back to skeleton.
  const hasData = useRef(false);
  if (clusters.length > 0) hasData.current = true;
  const isLoading = fleetData.isLoading && !hasData.current;
  const [newGroupName, setNewGroupName] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(new Set());
  const addGroup = useClusterOrganizationStore((s) => s.addGroup);
  const removeGroup = useClusterOrganizationStore((s) => s.removeGroup);
  const addClusterToGroup = useClusterOrganizationStore((s) => s.addToGroup);
  const groups = useClusterOrganizationStore((s) => s.groups);

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || selectedClusterIds.size === 0) return;
    const id = `group-${Date.now()}`;
    const colorIndex = Object.keys(groups).length % GROUP_COLORS.length;
    addGroup(id, newGroupName.trim(), GROUP_COLORS[colorIndex]);
    selectedClusterIds.forEach((cid) => addClusterToGroup(id, cid));
    setNewGroupName('');
    setSelectedClusterIds(new Set());
    setShowGroupForm(false);
    toast.success(`Group "${newGroupName.trim()}" created with ${selectedClusterIds.size} cluster(s)`);
  };

  const handleDeleteGroup = (gid: string, gname: string) => {
    removeGroup(gid);
    toast.success(`Group "${gname}" deleted`);
  };

  const toggleClusterSelection = (cid: string) => {
    setSelectedClusterIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  };

  function handleClusterClick(cluster: FleetCluster) {
    // Update BOTH stores so header, topology exports, and all downstream
    // consumers see the correct cluster immediately.
    setCurrentClusterId(cluster.id);

    // Find the matching Cluster object from the clusterStore
    const storeCluster = storeClusters.find((c) => c.id === cluster.id);
    if (storeCluster) {
      setActiveCluster(storeCluster);
    }

    // Clear stale queries from the previous cluster so fresh data loads
    queryClient.removeQueries({ queryKey: ['k8s'] });
    queryClient.removeQueries({ queryKey: ['backend', 'resources'] });
    queryClient.removeQueries({ queryKey: ['backend', 'resource'] });
    queryClient.removeQueries({ queryKey: ['backend', 'events'] });

    navigate(`/dashboard?cluster=${encodeURIComponent(cluster.id)}`);
  }

  return (
    <div className="fleet-dashboard p-4 md:p-6 -m-2" role="main" aria-label="Fleet Dashboard">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-5 md:space-y-6"
      >
        {/* Page Header */}
        <motion.div variants={item} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Layers className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div>
              <h1 className="font-h2 text-foreground tracking-tight">Fleet Overview</h1>
              <p className="font-caption text-muted-foreground mt-0.5">
                Multi-cluster health and status at a glance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => navigate('/connect?addCluster=true')} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Cluster
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowGroupForm(true); setSelectedClusterIds(new Set()); setNewGroupName(''); }} className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              New Group
            </Button>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40"
              role="status"
              aria-label="Auto-refreshing every 30 seconds"
              aria-live="polite"
            >
              <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Auto-refresh</span>
            </div>
          </div>
        </motion.div>

        {/* Aggregate Metrics */}
        <motion.div variants={item}>
          <AggregateStrip aggregates={aggregates} isLoading={isLoading} />
        </motion.div>

        {/* Cross-Cluster Search */}
        {clusters.length > 0 && (
          <motion.div variants={item} className="flex justify-center">
            <CrossClusterSearch clusters={clusters} />
          </motion.div>
        )}

        {/* Error Banner */}
        {isError && error && (
          <motion.div variants={item}>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" aria-hidden />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  Failed to load fleet data
                </p>
                <p className="text-xs text-red-700/80 dark:text-red-400/70 mt-0.5">
                  {error.message}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Cluster Grid */}
        <motion.div variants={item}>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ClusterCardSkeleton key={i} />
              ))}
            </div>
          ) : clusters.length === 0 ? (
            <EmptyState />
          ) : (() => {
            // Group clusters visually by their assigned groups
            const groupEntries = Object.entries(groups);
            const groupedClusterIds = new Set(groupEntries.flatMap(([, g]) => g.clusterIds));
            const ungrouped = clusters.filter((c) => !groupedClusterIds.has(c.id));

            return (
              <div className="space-y-6">
                {/* Ungrouped clusters */}
                {ungrouped.length > 0 && (
                  <div>
                    {groupEntries.length > 0 && (
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">All Clusters</h3>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {ungrouped.map((cluster) => (
                        <ClusterCard key={cluster.id} cluster={cluster} onClick={() => handleClusterClick(cluster)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Grouped clusters */}
                {groupEntries.map(([gid, g]) => {
                  const groupClusters = clusters.filter((c) => g.clusterIds.includes(c.id));
                  if (groupClusters.length === 0) return null;
                  return (
                    <div key={gid}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: g.color || '#6366f1' }} />
                        <h3 className="text-sm font-semibold text-foreground">{g.name}</h3>
                        <span className="text-xs text-muted-foreground">{groupClusters.length} cluster{groupClusters.length !== 1 ? 's' : ''}</span>
                        <button
                          onClick={() => handleDeleteGroup(gid, g.name)}
                          className="ml-auto text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                          title={`Delete group "${g.name}"`}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pl-5 border-l-2" style={{ borderColor: g.color || '#6366f1' }}>
                        {groupClusters.map((cluster) => (
                          <ClusterCard key={cluster.id} cluster={cluster} onClick={() => handleClusterClick(cluster)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </motion.div>
      </motion.div>

      {/* Create Group Dialog */}
      {showGroupForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-foreground">Create Group</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Select clusters to organize into a group</p>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Group Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Production, Staging, US-East"
                  className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Select Clusters ({selectedClusterIds.size} selected)</label>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {clusters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggleClusterSelection(c.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all text-sm',
                        selectedClusterIds.has(c.id)
                          ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-300 dark:border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800/50 border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800',
                      )}
                    >
                      <div className={cn(
                        'h-4 w-4 rounded border-2 flex items-center justify-center shrink-0',
                        selectedClusterIds.has(c.id)
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-slate-300 dark:border-slate-600',
                      )}>
                        {selectedClusterIds.has(c.id) && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.provider || 'Unknown'} · {c.status}</div>
                      </div>
                      <div className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        c.status === 'healthy' ? 'bg-green-500' : c.status === 'warning' ? 'bg-amber-500' : 'bg-red-500',
                      )} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowGroupForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateGroup} disabled={!newGroupName.trim() || selectedClusterIds.size === 0}>
                Create Group
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
