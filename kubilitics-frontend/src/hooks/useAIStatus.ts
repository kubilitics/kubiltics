/**
 * useAIStatus — E-PLAT-004
 * Polls /health on the kubilitics-ai backend (port 8081) every 30 s.
 * Returns { status: 'active' | 'unavailable' | 'unconfigured', provider, model, error }
 *
 * P2-8: In Tauri when AI sidecar is not available, does not make any request to 8081.
 */
import { useEffect, useRef, useState } from 'react';
import { AI_BASE_URL as AI_BACKEND_URL } from '@/services/aiService';
import { getAIAvailableForRequest, useAiAvailableStore } from '@/stores/aiAvailableStore';

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

interface HealthResponse {
  status?: string;
  version?: string;
  llm_provider?: string;
  llm_model?: string;
  llm_configured?: boolean;
}

async function fetchAIHealth(signal: AbortSignal): Promise<AIStatus> {
  try {
    const res = await fetch(`${AI_BACKEND_URL}/health`, { signal });
    if (!res.ok) {
      return { status: 'unavailable', errorMessage: `HTTP ${res.status}`, checking: false };
    }
    const data: HealthResponse = await res.json();
    const llmConfigured = data.llm_configured ?? !!(data.llm_provider && data.llm_provider !== 'none');
    if (!llmConfigured) {
      return {
        status: 'unconfigured',
        version: data.version,
        checking: false,
      };
    }
    return {
      status: 'active',
      provider: data.llm_provider,
      model: data.llm_model,
      version: data.version,
      checking: false,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // component unmounted, return current state silently
      return { status: 'unavailable', checking: false };
    }
    return { status: 'unavailable', errorMessage: 'AI service unreachable', checking: false };
  }
}

export function useAIStatus(): AIStatus {
  const [status, setStatus] = useState<AIStatus>({ status: 'unavailable', checking: true });
  const abortRef = useRef<AbortController | null>(null);
  const aiAvailable = useAiAvailableStore((s) => s.aiAvailable);

  const check = () => {
    if (!getAIAvailableForRequest()) {
      setStatus({ status: 'unavailable', checking: false });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus((prev) => ({ ...prev, checking: true }));
    fetchAIHealth(ctrl.signal).then((s) => setStatus(s));
  };

  useEffect(() => {
    if (!getAIAvailableForRequest()) {
      setStatus({ status: 'unavailable', checking: false });
      return;
    }
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAvailable]);

  return status;
}
