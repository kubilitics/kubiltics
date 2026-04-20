import { useQuery } from '@tanstack/react-query';

/**
 * Shape returned by GET /api/v1/ai/config — the user-visible AI
 * configuration persisted by the Kubilitics Settings UI
 * (~/.kubilitics/ai-overrides.yaml). Distinct from the brain's own
 * runtime capabilities (`/api/v1/ai/capabilities`). The chat panel must
 * gate on BOTH to avoid the pathological case where the brain boots
 * with a dev-baked provider and the user lands in a working chat
 * without ever visiting Settings.
 */
export type AIUserConfig = {
  provider: string;
  model: string;
  base_url: string;
  api_key_masked: string;
  /** Backend returns the string "true" / "false" (historical shape). */
  has_api_key: string;
};

export type AIUserConfigState = {
  data?: AIUserConfig;
  /** True iff the user saved a non-empty provider + key via Settings. */
  isConfigured: boolean;
  isLoading: boolean;
  error?: unknown;
};

export function useAIUserConfig(): AIUserConfigState {
  const q = useQuery<AIUserConfig>({
    queryKey: ['ai', 'user-config'],
    queryFn: async () => {
      const res = await fetch('/api/v1/ai/config');
      if (!res.ok) throw new Error(`ai/config ${res.status}`);
      return res.json();
    },
    staleTime: 15_000,
  });
  const provider = (q.data?.provider ?? '').trim();
  const hasKey = q.data?.has_api_key === 'true';
  const hasBaseUrl = !!(q.data?.base_url && q.data.base_url.trim());
  // Hosted providers (openai, anthropic) require a key; ollama / custom need
  // a base_url. Match backend validateConfigShape in ai/handlers/config.go.
  const credsOk =
    provider === 'ollama' || provider === 'custom' ? hasBaseUrl : hasKey;
  return {
    data: q.data,
    isConfigured: !!q.data && !!provider && credsOk,
    isLoading: q.isLoading,
    error: q.error,
  };
}
