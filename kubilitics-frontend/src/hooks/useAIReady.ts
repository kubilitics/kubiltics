import { useMemo } from 'react';
import { useAIStatus } from './useAIStatus';
import { useAICapabilities } from './useAICapabilities';
import { useActiveProfile, type Profile } from './useActiveProfile';

/**
 * useAIReady — THE ONLY HOOK ANY UI MAY GATE ON.
 *
 * Composes the three underlying queries (status / capabilities / user-config)
 * into one boolean + reason. UI components MUST consume this hook; direct
 * imports of useAIStatus / useAICapabilities / useAIUserConfig outside this
 * file are blocked by scripts/check-frontend-discipline.mjs at lint time.
 *
 * Reason precedence (the only place this logic lives):
 *   1. Any underlying query loading → 'loading'
 *   2. Any underlying query errored → 'brain_unreachable'
 *   3. Status reports state='error' or state='unavailable' → 'brain_error'
 *   4. User has not saved provider+key → 'not_configured'   ← THE HEADLINE BUG
 *   5. Status reports state='degraded' → 'degraded' (ready=true; still usable)
 *   6. capabilities.data.ready === true → 'ready' (status.state need not be
 *      'ready' — the brain's /status historically returns "" when up but
 *      pre-event; capabilities is the authoritative ready signal)
 *   7. Anything else (defensive) → 'loading'
 *
 * `ready: boolean` is true for 'ready' and 'degraded'; false otherwise.
 *
 * Spec: docs/superpowers/specs/2026-04-26-ai-status-single-source-design.md
 */

export type AIReadyReason =
  | 'loading'
  | 'brain_unreachable'
  | 'brain_error'
  | 'not_configured'
  | 'degraded'
  | 'ready';

export type AIReadyState = {
  ready: boolean;
  reason: AIReadyReason;
  label: string;
  detail?: string;
  // Diagnostic escape hatches — for debug overlays only. New gating logic
  // must live inside useAIReady, never in consumers. The CI scanner blocks
  // direct *imports* of the underlying hooks; reading these here is fine.
  status: ReturnType<typeof useAIStatus>;
  config: ReturnType<typeof activeProfileToConfigShape>;
  capabilities: ReturnType<typeof useAICapabilities>;
};

/**
 * Translate an active Profile into the same `{ data, isConfigured, isLoading,
 * error }` shape that the old `useAIUserConfig` returned, so the existing
 * precedence chain in `useAIReady` doesn't need to change. This function
 * is the only consumer of the Profile type within the readiness path.
 */
function activeProfileToConfigShape(p: Profile | null): {
  data?: { provider: string; has_api_key: string };
  isConfigured: boolean;
  isLoading: boolean;
  error?: unknown;
} {
  if (!p) {
    return { isConfigured: false, isLoading: false };
  }
  const hasBaseUrl = !!p.base_url.trim();
  const credsOk =
    p.provider === 'ollama' || p.provider === 'custom' ? hasBaseUrl : p.has_key;
  return {
    data: { provider: p.provider, has_api_key: p.has_key ? 'true' : 'false' },
    isConfigured: !!p.provider && credsOk,
    isLoading: false,
    error: undefined,
  };
}

const LABELS: Record<AIReadyReason, string> = {
  loading: 'AI',
  brain_unreachable: 'AI Unreachable',
  brain_error: 'AI Error',
  not_configured: 'AI Not Configured',
  degraded: 'AI Degraded',
  ready: 'AI Ready',
};

export function useAIReady(clusterId?: string): AIReadyState {
  const status = useAIStatus();
  const capabilities = useAICapabilities(clusterId);
  const active = useActiveProfile();
  const config = activeProfileToConfigShape(active);

  const reason: AIReadyReason = (() => {
    if (status.isLoading || capabilities.isLoading || config.isLoading) return 'loading';
    if (status.isError || capabilities.isError || config.error instanceof Error) return 'brain_unreachable';
    const state = status.data?.state;
    if (state === 'error' || state === 'unavailable') return 'brain_error';
    if (!config.isConfigured) return 'not_configured';
    if (state === 'degraded') return 'degraded';
    if (capabilities.data?.ready) return 'ready';
    // Defensive fallback. Reachable when capabilities.data.ready is false
    // and status.state is not 'error'/'unavailable'/'degraded' — typically
    // the brain just started and hasn't loaded a provider yet, or
    // capabilities is mid-refetch. Surfacing 'loading' shows a spinner
    // rather than incorrectly asserting ready or error.
    return 'loading';
  })();

  const ready = reason === 'ready' || reason === 'degraded';

  let detail: string | undefined;
  if (reason === 'brain_unreachable') {
    detail =
      (status.error instanceof Error ? status.error.message : undefined) ??
      (capabilities.error instanceof Error ? capabilities.error.message : undefined) ??
      (config.error instanceof Error ? config.error.message : undefined);
  } else if (reason === 'brain_error') {
    detail = status.data?.disabled_reason;
  }

  return useMemo(
    () => ({
      ready,
      reason,
      label: LABELS[reason],
      detail,
      status,
      config,
      capabilities,
    }),
    [ready, reason, detail, status, active, capabilities],
  );
}
