import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./useApi";
import type { AddOnTier, ClusterProfile, PrivateCatalogSource } from "../types/api/addons";
import type { AddonCostAttribution, RightsizingRecommendation, AdvisorRecommendation, AddonTestResult, AddonMaintenanceWindow, CreateMaintenanceWindowRequest } from "../services/backendApiClient";

export const ADDON_KEYS = {
  catalog: (filters: { page?: number; limit?: number; q?: string }) =>
    ["addon-catalog", filters] as const,
  entry: (addonId: string) => ["addon-catalog-entry", addonId] as const,
  installed: (clusterId: string) => ["installed-addons", clusterId] as const,
  install: (installId: string) => ["addon-install", installId] as const,
  history: (clusterId: string, installId: string) =>
    ["addon-history", clusterId, installId] as const,
  audit: (clusterId: string, installId: string) =>
    ["addon-audit", clusterId, installId] as const,
  financialStack: (clusterId: string) =>
    ["financial-stack", clusterId] as const,
  financialStackPlan: (clusterId: string) =>
    ["financial-stack-plan", clusterId] as const,
  financialStackProject: (projectId: string) =>
    ["addons", "financial-stack", projectId] as const,
  profiles: ["addon-profiles"] as const,
  maintenanceWindows: (clusterId: string) =>
    ["addon-maintenance-windows", clusterId] as const,
  catalogSources: ["addon-catalog-sources"] as const,
};

/** Paginated catalog from Artifact Hub. Pass page, limit, and optional search q. */
export function useCatalog(page: number, limit: number, search?: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.catalog({ page, limit, q: search ?? "" }),
    queryFn: () => api.listCatalog({ page, limit, q: search?.trim() || undefined }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCatalogEntry(addonId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.entry(addonId),
    queryFn: () => api.getCatalogEntry(addonId),
    enabled: !!addonId,
  });
}

export function useInstalledAddons(clusterId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.installed(clusterId),
    queryFn: () => api.listInstalledAddons(clusterId),
    enabled: !!clusterId,
    refetchInterval: 30000,
  });
}

export function useAddonInstall(clusterId: string, installId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...ADDON_KEYS.installed(clusterId), installId],
    queryFn: () => api.getAddonInstall(clusterId, installId),
    enabled: !!clusterId && !!installId,
  });
}

export function useAddonReleaseHistory(clusterId: string, installId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.history(clusterId, installId),
    queryFn: () => api.getAddonReleaseHistory(clusterId, installId),
    enabled: !!clusterId && !!installId,
  });
}

export function useAddonAuditEvents(clusterId: string, installId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.audit(clusterId, installId),
    queryFn: () => api.getAddonAuditEvents(clusterId, installId),
    enabled: !!clusterId && !!installId,
  });
}

/** Cluster-level financial stack status (prometheus/opencost installed). */
export function useFinancialStack(clusterId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.financialStack(clusterId),
    queryFn: () => api.getFinancialStack(clusterId),
    enabled: !!clusterId,
  });
}

/** Cluster-level install plan for cost stack (Prometheus + OpenCost). */
export function useFinancialStackPlan(clusterId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.financialStackPlan(clusterId),
    queryFn: () => api.getFinancialStackPlanForCluster(clusterId),
    enabled: !!clusterId,
  });
}

/** Project-level financial stack recommendation (suggested_addons + plan). */
export function useFinancialStackByProject(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.financialStackProject(projectId),
    queryFn: () => api.getFinancialStackPlan(projectId),
    enabled: !!projectId,
  });
}

// ── Profile hooks ─────────────────────────────────────────────────────────────

/** List all bootstrap profiles (built-in + user-created). */
export function useProfiles() {
  const api = useApi();
  return useQuery({
    queryKey: ADDON_KEYS.profiles,
    queryFn: () => api.listProfiles(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Create a custom profile and invalidate the profiles list cache. */
export function useCreateProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string; addons: ClusterProfile["addons"] }) =>
      api.createProfile(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDON_KEYS.profiles }),
  });
}

/** Update an existing custom profile. */
export function useUpdateProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ClusterProfile> }) =>
      api.updateProfile(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDON_KEYS.profiles }),
  });
}

/** Delete a custom profile. */
export function useDeleteProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProfile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDON_KEYS.profiles }),
  });
}

// ── Cost Attribution hook (T8.09) ──────────────────────────────────────────────

/**
 * useAddonCostAttribution fetches live cost data for a specific addon install
 * from the OpenCost allocation API via the Kubilitics backend.
 * Returns null when OpenCost is not available in the cluster (204 response).
 */
export function useAddonCostAttribution(clusterId: string, installId: string) {
  const api = useApi();
  return useQuery<AddonCostAttribution | null>({
    queryKey: ["addon-cost-attribution", clusterId, installId],
    queryFn: () => api.getAddonCostAttribution(clusterId, installId),
    enabled: !!clusterId && !!installId,
    staleTime: 60 * 1000, // 1 min — cost data changes slowly
    retry: false,         // Don't retry if OpenCost is offline
  });
}

// ── Rightsizing Recommendations hook (T8.10) ───────────────────────────────────

/**
 * useAddonRightsizing fetches resource adjustment suggestions for a specific addon install.
 * Returns null when Rightsizing data is not available (204 response).
 */
export function useAddonRightsizing(clusterId: string, installId: string) {
  const api = useApi();
  return useQuery<RightsizingRecommendation | null>({
    queryKey: ["addon-rightsizing", clusterId, installId],
    queryFn: () => api.getAddonRightsizing(clusterId, installId),
    enabled: !!clusterId && !!installId,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
}

/**
 * useAddonRecommendations fetches intelligent advisor suggestions for the cluster.
 */
export function useAddonRecommendations(clusterId: string) {
  const api = useApi();
  return useQuery<AdvisorRecommendation[]>({
    queryKey: ["addon-recommendations", clusterId],
    queryFn: () => api.getAddonAdvisorRecommendations(clusterId),
    enabled: !!clusterId,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

// ── Helm Test Execution hook (T9.01) ───────────────────────────────────────────

/**
 * useRunAddonTests returns a mutation that posts to the test endpoint.
 * Callers receive the AddonTestResult with per-hook status and log snippets.
 */
export function useRunAddonTests(clusterId: string, installId: string) {
  const api = useApi();
  return useMutation<AddonTestResult, Error>({
    mutationFn: () => api.runAddonTests(clusterId, installId),
  });
}

// ── Maintenance Windows (T9.03) ───────────────────────────────────────────────

/** Fetch all maintenance windows for a cluster. */
export function useMaintenanceWindows(clusterId: string) {
  const api = useApi();
  return useQuery<AddonMaintenanceWindow[], Error>({
    queryKey: ADDON_KEYS.maintenanceWindows(clusterId),
    queryFn: () => api.listMaintenanceWindows(clusterId),
    enabled: !!clusterId,
  });
}

/** Create a new maintenance window; invalidates the list query on success. */
export function useCreateMaintenanceWindow(clusterId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<AddonMaintenanceWindow, Error, CreateMaintenanceWindowRequest>({
    mutationFn: (req) => api.createMaintenanceWindow(clusterId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.maintenanceWindows(clusterId) });
    },
  });
}

/** Delete a maintenance window by ID; invalidates the list query on success. */
export function useDeleteMaintenanceWindow(clusterId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (windowId) => api.deleteMaintenanceWindow(clusterId, windowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.maintenanceWindows(clusterId) });
    },
  });
}

// ── Private Catalog Source hooks (T9.04) ──────────────────────────────────────

/** Fetch all private catalog sources. */
export function useCatalogSources() {
  const api = useApi();
  return useQuery<PrivateCatalogSource[], Error>({
    queryKey: ADDON_KEYS.catalogSources,
    queryFn: () => api.listCatalogSources(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Create a new private catalog source. */
export function useCreateCatalogSource() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<PrivateCatalogSource, Error, Partial<PrivateCatalogSource>>({
    mutationFn: (req) => api.createCatalogSource(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.catalogSources });
    },
  });
}

/** Delete a private catalog source. */
export function useDeleteCatalogSource() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (sourceId) => api.deleteCatalogSource(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.catalogSources });
    },
  });
}
