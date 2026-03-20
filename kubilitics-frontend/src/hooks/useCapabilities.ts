/**
 * Hook for fetching backend capabilities (e.g. resource_topology_kinds).
 * Used to show accurate "supported kinds" in topology views and avoid static frontend/backend drift.
 */
import { useQuery } from '@tanstack/react-query';
import { getCapabilities } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

export interface UseCapabilitiesResult {
  resourceTopologyKinds: string[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useCapabilities(): UseCapabilitiesResult {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['backend-capabilities'],
    queryFn: () => getCapabilities(effectiveBaseUrl),
    enabled: isBackendConfigured(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  return {
    resourceTopologyKinds: data?.resource_topology_kinds,
    isLoading,
    error: error || null,
  };
}
