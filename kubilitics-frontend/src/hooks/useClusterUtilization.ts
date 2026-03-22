/**
 * useClusterUtilization — computes cluster-wide CPU and Memory utilization
 * by fetching per-node metrics from the Metrics Server API and comparing
 * against each node's allocatable capacity.
 *
 * This supplements useClusterOverview whose backend response may not include
 * the `utilization` field even when the Metrics Server is installed.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getNodeMetrics, listResources } from '@/services/backendApiClient';

/* ─── Parsing helpers ─── */

/** Parse CPU string like "787.26m" or "4" (cores) into millicores. */
function parseCpuMillicores(cpu: string): number {
  if (!cpu) return 0;
  const s = cpu.trim();
  if (s.endsWith('m')) return parseFloat(s.slice(0, -1)) || 0;
  if (s.endsWith('n')) return (parseFloat(s.slice(0, -1)) || 0) / 1_000_000;
  if (s.endsWith('u')) return (parseFloat(s.slice(0, -1)) || 0) / 1_000;
  return (parseFloat(s) || 0) * 1000; // bare number = cores
}

/** Parse memory string like "864.57Mi", "8025296Ki", "8Gi" into bytes. */
function parseMemoryBytes(mem: string): number {
  if (!mem) return 0;
  const s = mem.trim();
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  for (const [suffix, multiplier] of Object.entries(units)) {
    if (s.endsWith(suffix)) {
      return (parseFloat(s.slice(0, -suffix.length)) || 0) * multiplier;
    }
  }
  return parseFloat(s) || 0; // bare number = bytes
}

interface NodeInfo {
  name: string;
  allocatableCpuMillicores: number;
  allocatableMemoryBytes: number;
}

export interface ClusterUtilization {
  cpuPercent: number;
  memoryPercent: number;
  cpuUsedMillicores: number;
  cpuTotalMillicores: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  nodeCount: number;
  metricsAvailable: boolean;
}

export function useClusterUtilization(clusterId: string | undefined) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  // Step 1: Fetch node list to get names + capacity
  const nodesQuery = useQuery({
    queryKey: ['backend', 'resources', 'nodes', backendBaseUrl, clusterId],
    queryFn: async () => {
      const result = await listResources(backendBaseUrl, clusterId!, 'nodes');
      const items: NodeInfo[] = (result.items || []).map((node: Record<string, unknown>) => ({
        name: node.metadata?.name ?? '',
        allocatableCpuMillicores: parseCpuMillicores(node.status?.allocatable?.cpu ?? '0'),
        allocatableMemoryBytes: parseMemoryBytes(node.status?.allocatable?.memory ?? '0'),
      }));
      return items;
    },
    enabled: isConfigured && !!clusterId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const nodes = nodesQuery.data ?? [];

  // Step 2: Fetch per-node metrics
  const metricsQueries = useQueries({
    queries: nodes.map((node) => ({
      queryKey: ['backend', 'nodeMetrics', backendBaseUrl, clusterId, node.name],
      queryFn: () => getNodeMetrics(backendBaseUrl, clusterId!, node.name),
      enabled: isConfigured && !!clusterId && nodes.length > 0,
      staleTime: 30_000,
      refetchInterval: 30_000,
      retry: 1,
    })),
  });

  // Step 3: Aggregate into cluster utilization
  const isLoading = nodesQuery.isLoading || metricsQueries.some((q) => q.isLoading);
  const anyMetricsSucceeded = metricsQueries.some((q) => q.isSuccess && q.data);

  let cpuUsedMillicores = 0;
  let cpuTotalMillicores = 0;
  let memoryUsedBytes = 0;
  let memoryTotalBytes = 0;

  nodes.forEach((node, i) => {
    cpuTotalMillicores += node.allocatableCpuMillicores;
    memoryTotalBytes += node.allocatableMemoryBytes;

    const metrics = metricsQueries[i]?.data;
    if (metrics) {
      cpuUsedMillicores += parseCpuMillicores(metrics.CPU ?? '');
      memoryUsedBytes += parseMemoryBytes(metrics.Memory ?? '');
    }
  });

  const cpuPercent = cpuTotalMillicores > 0 ? (cpuUsedMillicores / cpuTotalMillicores) * 100 : 0;
  const memoryPercent = memoryTotalBytes > 0 ? (memoryUsedBytes / memoryTotalBytes) * 100 : 0;

  const utilization: ClusterUtilization = {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryPercent: Math.round(memoryPercent * 10) / 10,
    cpuUsedMillicores,
    cpuTotalMillicores,
    memoryUsedBytes,
    memoryTotalBytes,
    nodeCount: nodes.length,
    metricsAvailable: anyMetricsSucceeded,
  };

  return { utilization, isLoading };
}
