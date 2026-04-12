/**
 * useFleetOverview — Fetches all clusters and their health summaries for the Fleet Dashboard.
 *
 * TASK-ENT-004: Fleet Dashboard
 *
 * - Calls GET /api/v1/clusters to list all connected clusters.
 * - For each cluster, fetches GET /api/v1/clusters/{id}/summary for health + counts.
 * - Aggregates totals: nodes, pods, healthy/degraded/failed cluster counts.
 * - Polls every 30s via TanStack Query refetchInterval.
 */
import { useQuery, useQueries } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusters, getClusterSummary } from '@/services/backendApiClient';
import type { BackendCluster, BackendClusterSummary } from '@/services/backendApiClient';

/** Shape of a single cluster in the fleet view. */
export interface FleetCluster {
  id: string;
  name: string;
  context: string;
  status: 'healthy' | 'warning' | 'error';
  provider?: string;
  version?: string;
  region?: string;
  nodeCount: number;
  podCount: number;
  healthScore: number;
  healthGrade: string;
  deploymentCount: number;
  serviceCount: number;
  lastConnected?: string;
  healthReason?: string;
}

/** Aggregate metrics across the fleet. */
export interface FleetAggregates {
  totalClusters: number;
  totalNodes: number;
  totalPods: number;
  totalDeployments: number;
  healthyClusters: number;
  degradedClusters: number;
  failedClusters: number;
}

export interface FleetOverviewResult {
  clusters: FleetCluster[];
  aggregates: FleetAggregates;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

const FLEET_POLL_INTERVAL = 30_000;

function mapBackendStatus(status?: string): 'healthy' | 'warning' | 'error' {
  if (!status) return 'healthy';
  const s = status.toLowerCase();
  if (s === 'error' || s === 'failed' || s === 'disconnected' || s === 'unreachable') return 'error';
  if (s === 'warning' || s === 'degraded') return 'warning';
  return 'healthy';
}

function mapHealthStatus(healthStatus?: string): 'healthy' | 'warning' | 'error' {
  if (!healthStatus) return 'healthy';
  const s = healthStatus.toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'failed') return 'error';
  if (s === 'warning' || s === 'degraded') return 'warning';
  return 'healthy';
}

function mergeCluster(
  cluster: BackendCluster,
  summary: BackendClusterSummary | null
): FleetCluster {
  const status = summary
    ? mapHealthStatus(summary.health_status)
    : mapBackendStatus(cluster.status);

  return {
    id: cluster.id,
    name: cluster.name,
    context: cluster.context,
    status,
    provider: cluster.provider,
    version: cluster.version,
    region: undefined, // backend does not expose region currently
    nodeCount: summary?.node_count ?? cluster.node_count ?? 0,
    podCount: summary?.pod_count ?? 0,
    healthScore: 0, // populated from summary when available
    healthGrade: status === 'healthy' ? 'A' : status === 'warning' ? 'C' : 'F',
    deploymentCount: summary?.deployment_count ?? 0,
    serviceCount: summary?.service_count ?? 0,
    lastConnected: cluster.last_connected,
    healthReason: summary?.health_reason,
  };
}

function computeAggregates(clusters: FleetCluster[]): FleetAggregates {
  return {
    totalClusters: clusters.length,
    totalNodes: clusters.reduce((sum, c) => sum + c.nodeCount, 0),
    totalPods: clusters.reduce((sum, c) => sum + c.podCount, 0),
    totalDeployments: clusters.reduce((sum, c) => sum + c.deploymentCount, 0),
    healthyClusters: clusters.filter((c) => c.status === 'healthy').length,
    degradedClusters: clusters.filter((c) => c.status === 'warning').length,
    failedClusters: clusters.filter((c) => c.status === 'error').length,
  };
}

export function useFleetOverview(): FleetOverviewResult {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  // Step 1: Fetch cluster list
  const clustersQuery = useQuery({
    queryKey: ['fleet', 'clusters', backendBaseUrl],
    queryFn: () => getClusters(backendBaseUrl),
    enabled: isConfigured,
    refetchInterval: FLEET_POLL_INTERVAL,
    staleTime: 15_000,
  });

  const clusterList = clustersQuery.data ?? [];

  // Step 2: For each cluster, fetch its summary
  const summaryQueries = useQueries({
    queries: clusterList.map((cluster) => ({
      queryKey: ['fleet', 'clusterSummary', backendBaseUrl, cluster.id],
      queryFn: () => getClusterSummary(backendBaseUrl, cluster.id),
      enabled: isConfigured && clusterList.length > 0,
      refetchInterval: FLEET_POLL_INTERVAL,
      staleTime: 15_000,
      // Don't fail the whole fleet if one cluster is unreachable
      retry: 1,
    })),
  });

  // Merge clusters with their summaries
  const fleetClusters: FleetCluster[] = clusterList.map((cluster, i) => {
    const summaryData = summaryQueries[i]?.data ?? null;
    return mergeCluster(cluster, summaryData);
  });

  const aggregates = computeAggregates(fleetClusters);

  // Only show loading skeleton on FIRST load, not on refetch.
  // isLoading = true when query has no data yet. isFetching = true during background refetch.
  // Using isLoading prevents the page from flashing skeleton every 30s.
  const isSummaryInitialLoading = summaryQueries.some((q) => q.isLoading && !q.data);
  const isLoading = (clustersQuery.isLoading && !clustersQuery.data) || (clusterList.length > 0 && isSummaryInitialLoading);

  return {
    clusters: fleetClusters,
    aggregates,
    isLoading,
    isError: clustersQuery.isError,
    error: clustersQuery.error as Error | null,
  };
}
