import { useEffect, useRef, useState } from 'react';
import { useAiAvailableStore } from '@/stores/aiAvailableStore';
import * as aiService from '@/services/aiService';

export type AIStatusKind = 'active' | 'unconfigured' | 'unavailable';

export interface AIStatus {
  status: AIStatusKind;
  provider?: string;
  model?: string;
  version?: string;
  errorMessage?: string;
  /** True when the status check is in-flight */
  checking: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export interface AIStatusWithRefetch extends AIStatus {
  /** Immediately re-check AI health (e.g. after saving API key). */
  refetch: () => void;
}

export function useAIStatus(): AIStatusWithRefetch {
  const [status, setStatus] = useState<AIStatus>({ status: 'unavailable', checking: true });
  const abortRef = useRef<AbortController | null>(null);
  // Re-run when aiAvailable changes so we pick up the adopted AI sidecar immediately.
  const aiAvailable = useAiAvailableStore((s) => s.aiAvailable);

  const check = async () => {
    // Always poll — health endpoint is always reachable (no guard).
    // This lets us detect AI becoming ready even before aiAvailable is set.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus((prev) => ({ ...prev, checking: true }));

    try {
      const data = await aiService.getAIHealth();

      if (!data.llm_configured) {
        setStatus({
          status: 'unconfigured',
          checking: false,
        });
        return;
      }

      setStatus({
        status: 'active',
        provider: data.llm_provider,
        model: data.llm_model,
        checking: false,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus({
        status: 'unavailable',
        errorMessage: 'AI service unreachable',
        checking: false
      });
    }
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAvailable]);

  return { ...status, refetch: check };
}
