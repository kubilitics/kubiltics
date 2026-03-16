/**
 * FleetDashboard — Multi-cluster fleet overview page.
 *
 * TASK-ENT-004: Fleet Dashboard
 *
 * Route: /fleet
 * Shows all connected clusters as cards in a responsive grid with
 * aggregate metrics, health-coded status badges, and click-to-navigate.
 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useFleetOverview } from '@/hooks/useFleetOverview';
import type { FleetCluster, FleetAggregates } from '@/hooks/useFleetOverview';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
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
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
        {/* Header: Name + Status */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground truncate text-sm">
              {cluster.name}
            </h3>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {cluster.context}
            </p>
          </div>
          <StatusBadge variant={cfg.variant} label={cfg.label} size="sm" dot />
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

        {/* Footer: Provider + Version + Arrow */}
        <div className="flex items-center justify-between border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {cluster.provider && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 font-medium">
                <Globe className="h-3 w-3" aria-hidden />
                {cluster.provider}
              </span>
            )}
            {cluster.version && (
              <span className="font-mono">{cluster.version}</span>
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
      <Button onClick={() => navigate('/connect')} variant="default" size="sm">
        Connect Cluster
      </Button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FleetDashboard() {
  const navigate = useNavigate();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const { clusters, aggregates, isLoading, isError, error } = useFleetOverview();

  function handleClusterClick(cluster: FleetCluster) {
    setCurrentClusterId(cluster.id);
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
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40"
            role="status"
            aria-label="Auto-refreshing every 30 seconds"
            aria-live="polite"
          >
            <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Auto-refresh</span>
          </div>
        </motion.div>

        {/* Aggregate Metrics */}
        <motion.div variants={item}>
          <AggregateStrip aggregates={aggregates} isLoading={isLoading} />
        </motion.div>

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
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {clusters.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  onClick={() => handleClusterClick(cluster)}
                />
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
