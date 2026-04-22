/**
 * aiConfigStore — Zustand store for the AI Settings round-trip.
 *
 * Phase 2 / Blocker C. The raw API key NEVER lives in this store or
 * localStorage — it is handed to the Rust `save_ai_config` command which
 * pushes it into the OS keychain. On hydrate / reload, the Rust side
 * returns only `has_api_key: boolean` so the UI can render a "configured
 * (hidden)" state without leaking secret material back to the webview.
 */
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type Provider = 'openai' | 'anthropic' | 'ollama' | 'custom';

export interface AIConfigInput {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface TestResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string | null;
}

export interface AIConfigState {
  provider: Provider;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  loading: boolean;
  lastError: string | null;

  hydrate: () => Promise<void>;
  save: (cfg: AIConfigInput) => Promise<void>;
  testConnection: (cfg: AIConfigInput) => Promise<TestResult>;
}

// Rust payload shape (snake_case).
interface RustCfg {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
  has_api_key?: boolean;
}
interface RustTest {
  ok: boolean;
  status: number;
  latency_ms: number;
  error: string | null;
}

function toRust(cfg: AIConfigInput): RustCfg {
  return {
    provider: cfg.provider,
    model: cfg.model,
    base_url: cfg.baseUrl,
    api_key: cfg.apiKey,
  };
}

export const useAIConfigStore = create<AIConfigState>((set, get) => ({
  provider: 'openai',
  model: 'gpt-4o',
  baseUrl: '',
  hasApiKey: false,
  loading: false,
  lastError: null,

  hydrate: async () => {
    set({ loading: true, lastError: null });
    try {
      const cfg = await invoke<RustCfg>('load_ai_config');
      set({
        provider: (cfg.provider as Provider) || 'openai',
        model: cfg.model || 'gpt-4o',
        baseUrl: cfg.base_url ?? '',
        hasApiKey: Boolean(cfg.has_api_key),
        loading: false,
      });
    } catch (err) {
      set({ loading: false, lastError: String(err) });
    }
  },

  save: async (cfg) => {
    set({ loading: true, lastError: null });
    try {
      await invoke('save_ai_config', { cfg: toRust(cfg) });
      // Re-hydrate so has_api_key flips true and any normalization the
      // Rust side applied (default base_url, default model) is reflected.
      await get().hydrate();
    } catch (err) {
      set({ loading: false, lastError: String(err) });
      throw err;
    }
  },

  testConnection: async (cfg) => {
    try {
      const res = await invoke<RustTest>('test_llm_connection', { cfg: toRust(cfg) });
      return {
        ok: res.ok,
        status: res.status,
        latencyMs: res.latency_ms,
        error: res.error,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
}));
