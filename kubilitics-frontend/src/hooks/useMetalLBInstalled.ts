/**
 * Hook to detect if MetalLB CRDs (ipaddresspools, bgppeers) are installed in the cluster.
 * When backend is configured, uses GET /clusters/{clusterId}/features/metallb.
 * When using direct K8s, attempts to list ipaddresspools; 404 means not installed.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getClusterFeatureMetallb } from '@/services/backendApiClient';
import { useK8sResourceList } from './useKubernetes';
import { useConnectionStatus } from './useConnectionStatus';

export function useMetalLBInstalled(): { installed: boolean; isLoading: boolean } {
  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = getEffectiveBackendBaseUrl();
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const backendQuery = useQuery({
    queryKey: ['cluster-feature-metallb', clusterId ?? ''],
    queryFn: () => getClusterFeatureMetallb(backendBaseUrl!, clusterId!),
    enabled: !!(isBackendConfigured() && clusterId && isConnected),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Direct K8s: try listing ipaddresspools; success (even empty) = installed
  const k8sList = useK8sResourceList('ipaddresspools', undefined, {
    enabled: isConnected && !isBackendConfigured(),
    limit: 1,
    refetchInterval: 0,
  });

  if (isBackendConfigured() && clusterId && isConnected) {
    return {
      installed: backendQuery.data?.installed ?? false,
      isLoading: backendQuery.isLoading,
    };
  }

  // Direct K8s: if we got data (even empty list), MetalLB is installed; 404/error = not installed
  if (isConnected && !isBackendConfigured()) {
    const hasData = k8sList.data != null;
    const isError = k8sList.isError;
    const is404 = isError && (k8sList.error as Error)?.message?.includes('404');
    return {
      installed: hasData && !is404,
      isLoading: k8sList.isLoading,
    };
  }

  return { installed: false, isLoading: false };
}
