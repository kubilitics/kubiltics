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
  save: (cfg: AIConfigInput) => Promise<SaveResult>;
  testConnection: (cfg: AIConfigInput) => Promise<TestResult>;
}

/**
 * Shape returned by save_ai_config. `saved` is always true when the
 * promise resolves; `brainHotwireOk` is the real "is AI live right now"
 * signal — false means yaml was persisted but the brain's runtime
 * adapter didn't accept the new config (so the top-bar AI pill will
 * still say Unreachable). UI callers should surface this honestly
 * rather than toasting a generic "saved" success.
 */
export interface SaveResult {
  saved: boolean;
  brainHotwireOk: boolean;
  brainHotwireError: string;
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

// ── Debounced non-secret field edits ─────────────────────────────────────
//
// Phase 2 / B.15. The Settings UI calls `setFieldDebounced('baseUrl', v)`
// on every keystroke; we collect the latest value across all fields and
// fire a single `save_ai_config` 500ms after the last edit. The api_key
// path is deliberately excluded — a user clicking "Save & Test" should
// not wait for a timer to elapse. `save()` is the immediate path for
// secrets and explicit form submissions.
//
// State is scoped inside an IIFE-created controller so tests can grab a
// fresh instance via `__createDebounceControllerForTests()`. Module-level
// globals (the prior design) leaked between parallel vitest files and
// could resurface as flakes.
const DEBOUNCE_MS = 500;
type DebounceableField = 'provider' | 'model' | 'baseUrl';

interface DebounceController {
  setField: <K extends DebounceableField>(field: K, value: AIConfigInput[K]) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

function createDebounceController(): DebounceController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  return {
    setField<K extends DebounceableField>(field: K, value: AIConfigInput[K]) {
      // Update the store immediately so the UI is responsive.
      useAIConfigStore.setState({ [field]: value } as Partial<AIConfigState>);
      if (timer) clearTimeout(timer);
      flushPromise = new Promise<void>((resolve) => {
        timer = setTimeout(async () => {
          timer = null;
          const state = useAIConfigStore.getState();
          const cfg: AIConfigInput = {
            provider: state.provider,
            model: state.model,
            baseUrl: state.baseUrl,
            // api_key intentionally omitted — Rust treats absent as "leave existing"
          };
          try {
            await invoke('save_ai_config', { cfg: toRust(cfg) });
          } catch (err) {
            useAIConfigStore.setState({ lastError: String(err) });
          } finally {
            resolve();
          }
        }, DEBOUNCE_MS);
      });
    },
    async flush() {
      if (flushPromise) await flushPromise;
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flushPromise = null;
    },
  };
}

const debounceController = createDebounceController();

export function setFieldDebounced<K extends DebounceableField>(
  field: K,
  value: AIConfigInput[K],
): void {
  debounceController.setField(field, value);
}

// Test helper — awaits the pending debounced save (if any). No-op when idle.
export async function flushFieldDebounce(): Promise<void> {
  await debounceController.flush();
}

// Test-only reset — parallel vitest files can call this in afterEach to
// guarantee a clean slate even if a test skipped vi.useFakeTimers or
// forgot to flush. Not exported to product code paths.
export function __resetDebounceForTests(): void {
  debounceController.cancel();
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
      const cfg = await invoke<RustCfg | null>('load_ai_config');
      const rawProvider = (cfg?.provider ?? '').toLowerCase();
      const known: readonly Provider[] = ['openai', 'anthropic', 'ollama', 'custom'];
      const provider = (known as readonly string[]).includes(rawProvider)
        ? (rawProvider as Provider)
        : 'openai';
      set({
        provider,
        model: cfg?.model || 'gpt-4o',
        baseUrl: cfg?.base_url ?? '',
        hasApiKey: Boolean(cfg?.has_api_key),
        loading: false,
      });
    } catch (err) {
      set({ loading: false, lastError: String(err) });
    }
  },

  save: async (cfg) => {
    interface RustSaveResult {
      saved: boolean;
      brain_hotwire_ok: boolean;
      brain_hotwire_error: string;
    }
    set({ loading: true, lastError: null });
    try {
      const res = await invoke<RustSaveResult>('save_ai_config', { cfg: toRust(cfg) });
      // Re-hydrate so has_api_key flips true and any normalization the
      // Rust side applied (default base_url, default model) is reflected.
      await get().hydrate();
      return {
        saved: res.saved,
        brainHotwireOk: res.brain_hotwire_ok,
        brainHotwireError: res.brain_hotwire_error,
      };
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
