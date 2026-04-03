/**
 * React Query hooks for the Auto-Pilot feature.
 * Follows the same pattern as useBlastRadius.ts — useActiveClusterId for cluster
 * scoping, backendConfigStore for base URL, and graceful disabled state.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getAutoPilotFindings,
  getAutoPilotActions,
  getAutoPilotConfig,
  getAutoPilotRules,
  approveAutoPilotAction,
  dismissAutoPilotAction,
  triggerAutoPilotScan,
  updateAutoPilotRuleConfig,
  type AutoPilotFinding,
  type AutoPilotAction,
  type AutoPilotRuleConfig,
  type AutoPilotRuleMeta,
  type AutoPilotScanResponse,
  type AutoPilotStatusResponse,
} from '@/services/api/autopilot';

// ── Query Keys ───────────────────────────────────────────────────────────────

const AUTOPILOT_KEYS = {
  all: ['autopilot'] as const,
  findings: (clusterId: string) => ['autopilot', 'findings', clusterId] as const,
  actions: (clusterId: string, status?: string, limit?: number, offset?: number) =>
    ['autopilot', 'actions', clusterId, status, limit, offset] as const,
  config: (clusterId: string) => ['autopilot', 'config', clusterId] as const,
  rules: (clusterId: string) => ['autopilot', 'rules', clusterId] as const,
};

// ── Shared hook helpers ──────────────────────────────────────────────────────

function useAutoPilotBase() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const enabled = !!clusterId && isBackendConfigured;
  return { clusterId: clusterId ?? '', effectiveBaseUrl, enabled };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Fetch current findings for the active cluster. */
export function useAutoPilotFindings() {
  const { clusterId, effectiveBaseUrl, enabled } = useAutoPilotBase();

  return useQuery<AutoPilotFinding[], Error>({
    queryKey: AUTOPILOT_KEYS.findings(clusterId),
    queryFn: () => getAutoPilotFindings(effectiveBaseUrl, clusterId),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch paginated actions with optional status filter. */
export function useAutoPilotActions(
  status?: string,
  limit = 20,
  offset = 0,
) {
  const { clusterId, effectiveBaseUrl, enabled } = useAutoPilotBase();

  return useQuery<AutoPilotAction[], Error>({
    queryKey: AUTOPILOT_KEYS.actions(clusterId, status, limit, offset),
    queryFn: () => getAutoPilotActions(effectiveBaseUrl, clusterId, status, limit, offset),
    enabled,
    staleTime: 15_000,
    retry: 1,
  });
}

/** Fetch per-rule configuration for the active cluster. */
export function useAutoPilotConfig() {
  const { clusterId, effectiveBaseUrl, enabled } = useAutoPilotBase();

  return useQuery<AutoPilotRuleConfig[], Error>({
    queryKey: AUTOPILOT_KEYS.config(clusterId),
    queryFn: () => getAutoPilotConfig(effectiveBaseUrl, clusterId),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Fetch available rules with metadata. */
export function useAutoPilotRules() {
  const { clusterId, effectiveBaseUrl, enabled } = useAutoPilotBase();

  return useQuery<AutoPilotRuleMeta[], Error>({
    queryKey: AUTOPILOT_KEYS.rules(clusterId),
    queryFn: () => getAutoPilotRules(effectiveBaseUrl, clusterId),
    enabled,
    staleTime: 120_000,
    retry: 1,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Approve a pending action. Invalidates actions query on success. */
export function useApproveAction() {
  const { clusterId, effectiveBaseUrl } = useAutoPilotBase();
  const queryClient = useQueryClient();

  return useMutation<AutoPilotStatusResponse, Error, string>({
    mutationFn: (actionId: string) =>
      approveAutoPilotAction(effectiveBaseUrl, clusterId, actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'actions', clusterId] });
    },
  });
}

/** Dismiss a pending action. Invalidates actions query on success. */
export function useDismissAction() {
  const { clusterId, effectiveBaseUrl } = useAutoPilotBase();
  const queryClient = useQueryClient();

  return useMutation<AutoPilotStatusResponse, Error, string>({
    mutationFn: (actionId: string) =>
      dismissAutoPilotAction(effectiveBaseUrl, clusterId, actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'actions', clusterId] });
    },
  });
}

/** Trigger a manual scan. Invalidates findings on success. */
export function useTriggerScan() {
  const { clusterId, effectiveBaseUrl } = useAutoPilotBase();
  const queryClient = useQueryClient();

  return useMutation<AutoPilotScanResponse, Error, void>({
    mutationFn: () => triggerAutoPilotScan(effectiveBaseUrl, clusterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'findings', clusterId] });
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'actions', clusterId] });
    },
  });
}

/** Update a single rule's configuration. Invalidates config on success. */
export function useUpdateRuleConfig() {
  const { clusterId, effectiveBaseUrl } = useAutoPilotBase();
  const queryClient = useQueryClient();

  return useMutation<AutoPilotRuleConfig, Error, { ruleId: string; config: AutoPilotRuleConfig }>({
    mutationFn: ({ ruleId, config }) =>
      updateAutoPilotRuleConfig(effectiveBaseUrl, clusterId, ruleId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'config', clusterId] });
    },
  });
}
