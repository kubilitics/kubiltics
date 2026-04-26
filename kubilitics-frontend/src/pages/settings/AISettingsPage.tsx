/**
 * AI Settings page.
 *
 * Contract with the Rust side (see `src-tauri/src/ai_config.rs`):
 *   load_ai_config           — reads yaml ONLY. Never probes the keychain.
 *                              Returns provider, model, base_url, and a
 *                              cached has_api_key flag.
 *   save_ai_config           — validates + writes yaml + keychain + hot-
 *                              wires the brain via POST /api/v1/config/provider.
 *                              Authoritative keychain touch; one expected
 *                              macOS prompt.
 *   test_llm_connection      — 10-token ping. Authoritative keychain read.
 *   detect_available_providers — env + localhost + yaml cache. NO keychain.
 *   migrate_has_api_key      — one-shot keychain probe for pre-cache-flag
 *                              upgraders. Idempotent after first success.
 *   get_brain_status /       — reachability signals for the banner + the
 *   restart_brain              manual Restart-engine button.
 *
 * Page structure (post-P0/P1/P2/P3 redesign):
 *   1. Header (no "Live" decoration — nothing on this page streams)
 *   2. Brain Reachability Banner — conditional, only shown when the
 *      sidecar isn't responding. Calls get_brain_status on mount and
 *      surfaces a Restart-engine button.
 *   3. Quick Connect card — auto-detected providers + paste-any-key.
 *      Pill labels read "Use <name>" so the action is unambiguous.
 *   4. Provider card — single live-editable card holding provider,
 *      model, base URL, and API key with Test / Save actions. This
 *      replaces the old "Current State" (read-only tiles) +
 *      "Provider Configuration" (editable) split, which was two
 *      views of the same data.
 *   5. Cost & Budget card — unchanged.
 *
 * One-shot keychain migration runs on first mount if the yaml's
 * migrated_keychain_probe flag is false. A preface toast explains
 * the macOS prompt the user may see; after migration completes the
 * authoritative has_api_key is in the yaml and no further keychain
 * access happens on page load.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvalidateAI } from '@/hooks/useInvalidateAI';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  RotateCcw,
  Activity,
  ExternalLink,
  AlertTriangle,
  ServerCrash,
  RefreshCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { PageLayout } from '@/components/layout/PageLayout';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { useAIConfigStore, setFieldDebounced, type Provider } from '@/stores/aiConfigStore';
import { cn } from '@/lib/utils';

const MODEL_OPTIONS: Record<Provider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  ollama: [],
  custom: [],
};

interface TestUI {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

// Brain status reported by the Tauri command. Treat anything other than
// "ready" as "not ready" — there's no useful distinction for this page
// between "starting" and "stopped".
interface BrainStatus {
  status: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brain reachability banner — rendered only when the AI engine sidecar
// isn't responding. Without this, users hit "Save" expecting everything
// to work and are bewildered when the AI stays Unreachable. The banner
// names the actual problem and offers the one-click fix (Restart engine).
// ─────────────────────────────────────────────────────────────────────────────
function BrainReachabilityBanner({
  ready,
  onRestart,
  restarting,
}: {
  ready: boolean;
  onRestart: () => void;
  restarting: boolean;
}) {
  if (ready) return null;
  return (
    <div
      role="alert"
      data-testid="brain-reachability-banner"
      className={cn(
        'rounded-xl border p-4 flex items-start gap-3',
        'border-amber-300 bg-amber-50 text-amber-900',
        'dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200',
      )}
    >
      <ServerCrash className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">AI engine isn't responding</p>
        <p className="text-xs mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">
          You can still edit and save configuration here, but saving
          won't activate AI features until the engine comes online. If
          this persists after a restart, check the app logs for the
          kubilitics-ai-server sidecar.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRestart}
        disabled={restarting}
        className={cn(
          'shrink-0 bg-white dark:bg-amber-950/40',
          'border-amber-400/60 dark:border-amber-700/60',
          'text-amber-900 dark:text-amber-100',
          'hover:bg-amber-100 dark:hover:bg-amber-900/50',
        )}
        data-testid="brain-restart-btn"
      >
        {restarting ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
        )}
        {restarting ? 'Restarting…' : 'Restart engine'}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function AISettingsPage() {
  const navigate = useNavigate();
  const store = useAIConfigStore();
  const { provider, model, baseUrl, hasApiKey, lastError } = store;

  /**
   * "Is this config actually usable?" — provider-aware. Previously the
   * badge was driven by a raw `hasApiKey` boolean, which is wrong for
   * Ollama (no key needed) and noisy for Custom (key optional). This
   * mirrors what the backend validates in ai/handlers/config.go and
   * what useAIUserConfig uses to gate the chat input.
   */
  const isConfigured = useMemo(() => {
    if (!provider) return false;
    // Ollama + custom: URL is the gate. No key required.
    if (provider === 'ollama' || provider === 'custom') {
      return !!baseUrl.trim();
    }
    // OpenAI / Anthropic: key is the gate.
    return hasApiKey;
  }, [provider, baseUrl, hasApiKey]);

  const invalidateAI = useInvalidateAI();

  // API key is transient — held only in this component's state until the
  // user saves. Once save() returns and hydrate() re-reads the store,
  // `hasApiKey` flips true and this local input is cleared.
  const [apiKey, setApiKey] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestUI | null>(null);
  const [budgetSpent, setBudgetSpent] = useState<number | null>(null);
  const [budgetCap, setBudgetCap] = useState<number | null>(null);
  const [resettingBudget, setResettingBudget] = useState(false);

  // Brain reachability — polled on mount and when the user restarts.
  // Kept in local state (not in the zustand store) because it's specific
  // to this page's banner; other screens have their own "AI Unreachable"
  // indicators driven by chat-level probes.
  const [brainReady, setBrainReady] = useState<boolean>(true); // optimistic — hide banner until we know otherwise
  const [restarting, setRestarting] = useState(false);

  // Ollama model discovery — hardcoded "llama3" defaults broke every
  // user whose server actually had a different model pulled (qwen2.5,
  // phi3, etc.). Fetch the real list from <base_url>/api/tags whenever
  // the user is on the Ollama provider AND the base URL is non-empty.
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(null);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);

  const fetchOllamaModels = async (baseUrlArg?: string) => {
    setOllamaModelsLoading(true);
    setOllamaModelsError(null);
    try {
      const list = await invoke<string[]>('list_ollama_models', {
        baseUrl: baseUrlArg ?? baseUrl,
      });
      setOllamaModels(list);
      // If the currently-selected model isn't in the list (common after
      // switching servers or on first load), auto-select the first one
      // so Save doesn't silently fail with a model-not-pulled error.
      if (list.length > 0 && !list.includes(model)) {
        setFieldDebounced('model', list[0]);
      }
    } catch (e) {
      setOllamaModels([]);
      setOllamaModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setOllamaModelsLoading(false);
    }
  };

  // Auto-fetch when provider flips to ollama or baseUrl changes (debounced
  // implicitly via the store's 500ms setFieldDebounced). Strict "only run
  // for ollama" guard — we don't want to fire Ollama calls while the user
  // is on OpenAI.
  useEffect(() => {
    if (provider !== 'ollama') {
      setOllamaModels([]);
      setOllamaModelsError(null);
      return;
    }
    // Small delay so the user typing a URL doesn't fire 20 requests.
    const t = window.setTimeout(() => {
      void fetchOllamaModels(baseUrl);
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, baseUrl]);

  // Quick Connect — auto-detected providers from the Rust side.
  type Detected = {
    provider: string; source: string; model: string; base_url: string; env_var: string;
  };
  const [detected, setDetected] = useState<Detected[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => {
    invoke<Detected[] | null>('detect_available_providers')
      .then((v) => setDetected(Array.isArray(v) ? v : []))
      .catch(() => setDetected([]));
  }, []);

  // Paste-any-key detector.
  const [pastedKey, setPastedKey] = useState<string>('');
  const [pasting, setPasting] = useState(false);

  type Guess = { provider: Provider; model: string; baseUrl: string; label: string };
  const guessFromKey = (k: string): Guess | null => {
    const key = k.trim();
    if (!key) return null;
    if (key.startsWith('sk-ant-')) {
      return { provider: 'anthropic', model: 'claude-3-5-sonnet-latest', baseUrl: '', label: 'Anthropic' };
    }
    if (key.startsWith('sk-or-')) {
      return { provider: 'custom', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1', label: 'OpenRouter' };
    }
    if (key.startsWith('gsk_')) {
      return { provider: 'custom', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1', label: 'Groq' };
    }
    if (key.startsWith('tgp_')) {
      return { provider: 'custom', model: 'Qwen/Qwen2.5-7B-Instruct-Turbo', baseUrl: 'https://api.together.xyz/v1', label: 'Together.ai' };
    }
    if (key.startsWith('sk-')) {
      return { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '', label: 'OpenAI' };
    }
    return null;
  };
  const pastedGuess = guessFromKey(pastedKey);

  const handleQuickConnect = async (d: Detected) => {
    setConnecting(d.provider);
    try {
      const saveRes = await store.save({
        provider: d.provider as Provider,
        model: d.model,
        baseUrl: d.base_url,
        apiKey: '',
      });
      await invalidateAI();
      if (!saveRes.brainHotwireOk) {
        toast.error(`Saved, but AI engine didn't accept the new config: ${saveRes.brainHotwireError}`);
        return;
      }
      const res = await store.testConnection({
        provider: d.provider as Provider,
        model: d.model,
        baseUrl: d.base_url,
      });
      setTestResult({ ok: res.ok, latencyMs: res.latencyMs, error: res.error ?? undefined });
      if (res.ok) toast.success(`Connected to ${d.provider} (${res.latencyMs ?? 0}ms)`);
      else toast.error(`Test failed: ${res.error ?? 'unknown'}`);
    } catch (e) {
      toast.error(`Quick-connect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(null);
    }
  };

  const handlePasteConnect = async () => {
    if (!pastedGuess) return;
    setPasting(true);
    try {
      const saveRes = await store.save({
        provider: pastedGuess.provider,
        model: pastedGuess.model,
        baseUrl: pastedGuess.baseUrl,
        apiKey: pastedKey.trim(),
      });
      await invalidateAI();
      setPastedKey('');
      if (!saveRes.brainHotwireOk) {
        toast.error(`Saved, but AI engine didn't accept the new config: ${saveRes.brainHotwireError}`);
        return;
      }
      const res = await store.testConnection({
        provider: pastedGuess.provider,
        model: pastedGuess.model,
        baseUrl: pastedGuess.baseUrl,
      });
      setTestResult({ ok: res.ok, latencyMs: res.latencyMs, error: res.error ?? undefined });
      if (res.ok) toast.success(`Connected to ${pastedGuess.label} (${res.latencyMs ?? 0}ms)`);
      else toast.error(`Saved but connection test failed: ${res.error ?? 'unknown'}`);
    } catch (e) {
      toast.error(`Connect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPasting(false);
    }
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────
  // HARD RULE: mounting this page must NEVER hit the keychain, directly
  // or transitively. macOS binds keychain ACLs to a binary signature
  // hash; every `cargo tauri dev` rebuild shifts the hash and any
  // keychain access triggers the "enter login password" dialog. There
  // used to be a one-shot migration here that probed the keychain once
  // per install to reconcile an older yaml schema. Even one prompt on
  // open is a prompt too many — removed. Users who saved a key on a
  // pre-cache-flag build will see "needs API key" until they next hit
  // Save; that single Save is the only time the keychain is touched,
  // and they expect a prompt there. No more surprise dialogs on page
  // open. Ever.
  useEffect(() => {
    void (async () => {
      // 1. Hydrate non-secret config from yaml. Never touches the keychain.
      await store.hydrate();

      // 2. Brain reachability. Pure in-memory bool on the Rust side —
      //    no file I/O, no keychain, no network.
      try {
        const s = await invoke<BrainStatus>('get_brain_status');
        setBrainReady(s.status === 'ready');
      } catch {
        setBrainReady(false);
      }

      // 3. Budget probe — harmless if the brain is down; returns nulls.
      try {
        const b = await invoke<{ spent_usd: number; cap_usd: number }>('get_budget_status');
        setBudgetSpent(b.spent_usd);
        setBudgetCap(b.cap_usd);
      } catch {
        /* budget card stays blank; not a Settings-level error */
      }
    })();

    // Brain reachability poll loop — lightweight, 5s cadence. Clears on unmount.
    const interval = window.setInterval(async () => {
      try {
        const s = await invoke<BrainStatus>('get_brain_status');
        setBrainReady(s.status === 'ready');
      } catch {
        setBrainReady(false);
      }
    }, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any edit invalidates a previous test result.
  useEffect(() => {
    setTestResult(null);
  }, [provider, model, baseUrl, apiKey]);

  const handleProviderChange = (p: Provider) => {
    setFieldDebounced('provider', p);
    const nextModel = MODEL_OPTIONS[p][0] ?? '';
    setFieldDebounced('model', nextModel);
    setFieldDebounced('baseUrl', p === 'ollama' ? 'http://localhost:11434' : '');
    setApiKey('');
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await store.testConnection({ provider, model, baseUrl, apiKey });
      setTestResult({ ok: res.ok, latencyMs: res.latencyMs, error: res.error ?? undefined });
      if (res.ok) toast.success(`Connected (${res.latencyMs ?? 0}ms)`);
      else toast.error(`Test failed: ${res.error ?? 'unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    // Capture before any clearing — the post-save Test below needs the
    // key in-hand. Falling back to keychain_get is unreliable in dev
    // (binary-hash-bound ACL) and produces a misleading "missing API
    // key" error right after a successful save.
    const submittedKey = apiKey;
    try {
      const saveRes = await store.save({ provider, model, baseUrl, apiKey: submittedKey });
      await invalidateAI();
      setApiKey('');
      if (!saveRes.brainHotwireOk) {
        // Yaml + keychain persisted, but the brain either rejected the
        // config or wasn't reachable. Tell the user the real state — do
        // NOT toast a green "saved" success when the top-bar pill is
        // about to stay red. That mismatch is exactly what produced the
        // "Test says Connected, AI says Unreachable" paradox.
        toast.error(`Saved, but AI engine didn't accept the new config: ${saveRes.brainHotwireError}`);
        setTestResult({ ok: false, error: saveRes.brainHotwireError });
        return;
      }
      toast.success('AI configuration saved and activated');
      const res = await store.testConnection({ provider, model, baseUrl, apiKey: submittedKey });
      setTestResult({ ok: res.ok, latencyMs: res.latencyMs, error: res.error ?? undefined });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFieldDebounced('provider', 'openai');
    setFieldDebounced('model', 'gpt-4o');
    setFieldDebounced('baseUrl', '');
    setApiKey('');
    setTestResult(null);
    toast.info('Restored defaults (click Save to persist)');
  };

  const handleResetBudget = async () => {
    setResettingBudget(true);
    try {
      await invoke('reset_budget');
      toast.success('Budget cap reset');
      const b = await invoke<{ spent_usd: number; cap_usd: number }>('get_budget_status');
      setBudgetSpent(b.spent_usd);
      setBudgetCap(b.cap_usd);
    } catch (e) {
      toast.error(`Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResettingBudget(false);
    }
  };

  const handleRestartBrain = async () => {
    setRestarting(true);
    try {
      await invoke('restart_brain');
      toast.success('AI engine restart requested');
      // Give the sidecar a moment to come up, then re-poll.
      window.setTimeout(async () => {
        try {
          const s = await invoke<BrainStatus>('get_brain_status');
          setBrainReady(s.status === 'ready');
        } catch {
          setBrainReady(false);
        }
      }, 1500);
    } catch (e) {
      toast.error(`Restart failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestarting(false);
    }
  };

  const stateTone = isConfigured
    ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
    : 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300';

  return (
    <PageLayout label="AI Settings" showBanner={false} className="max-w-5xl mx-auto">
      <SectionOverviewHeader
        title="AI Settings"
        description="Configure the AI provider, model, and credentials. API keys live in your OS keychain — never in a config file."
        icon={Bot}
        liveBadge={false}
      />

      {/* ━━━ Brain Reachability Banner ━━━ */}
      <BrainReachabilityBanner
        ready={brainReady}
        onRestart={handleRestartBrain}
        restarting={restarting}
      />

      {/* ━━━ Quick Connect ━━━
          Always shown — first-time setup AND swap-providers (paste a
          different prefix and the form below auto-fills with the right
          baseUrl/model so users don't need to memorize Together vs
          OpenRouter vs OpenAI URL conventions). */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-quick-connect-card">
        <CardHeader>
          <CardTitle className="text-base">Quick Connect</CardTitle>
          <CardDescription>
            Paste any AI provider key below — we detect the provider from
            the prefix and pick a sensible model for you. No URL or model
            name to memorize.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {detected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detected.map((d) => {
                const label =
                  d.provider === 'openai' ? 'OpenAI' :
                  d.provider === 'anthropic' ? 'Anthropic' :
                  d.provider === 'ollama' ? 'Ollama' :
                  d.env_var.replace('_API_KEY', '').toLowerCase();
                const sourceText =
                  d.source === 'env' ? `from $${d.env_var}` :
                  d.source === 'localhost' ? 'local' :
                  'saved';
                return (
                  <Button
                    key={`${d.provider}-${d.source}-${d.env_var}`}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickConnect(d)}
                    disabled={connecting !== null}
                  >
                    {connecting === d.provider ? 'Connecting…' : `Use ${label} · ${sourceText}`}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="password"
              placeholder="Paste any API key — sk-... (OpenAI), sk-ant-... (Anthropic), gsk_... (Groq), tgp_... (Together), sk-or-... (OpenRouter)"
              value={pastedKey}
              onChange={(e) => setPastedKey(e.target.value)}
              className="flex-1 font-mono text-xs"
              aria-label="API key"
            />
            <Button
              onClick={handlePasteConnect}
              disabled={!pastedGuess || pasting}
              className="whitespace-nowrap"
            >
              {pasting
                ? 'Connecting…'
                : pastedGuess
                  ? `Connect ${pastedGuess.label}`
                  : 'Paste a key to continue'}
            </Button>
          </div>
          {pastedGuess && (
            <p className="text-xs text-muted-foreground">
              Detected <strong>{pastedGuess.label}</strong>. We'll save as
              provider <code>{pastedGuess.provider}</code>, model <code>{pastedGuess.model}</code>
              {pastedGuess.baseUrl ? <>, base URL <code>{pastedGuess.baseUrl}</code></> : null}.
              Change anything below if you want — this is just a sensible default.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ━━━ Provider (merged: status + editable fields) ━━━
          Replaces the old "Current State" (read-only tiles) +
          "Provider Configuration" (editable) split — those were two
          views of the same underlying data and confused users about
          which was authoritative. */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-provider-card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base">Provider</CardTitle>
              <CardDescription>
                Edit provider, model, and credentials. Non-secret changes
                auto-save 500ms after you stop typing. API keys are only
                written to the OS keychain when you click Save.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn('rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap', stateTone)}
              data-testid="ai-provider-status-badge"
            >
              {isConfigured
                ? 'configured'
                : provider === 'ollama' || provider === 'custom'
                  ? 'needs base URL'
                  : 'needs API key'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={provider} onValueChange={(v) => handleProviderChange(v as Provider)}>
                <SelectTrigger id="ai-provider" data-testid="provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="ollama">Ollama (local or remote)</SelectItem>
                  <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-model" className="flex items-center gap-2">
                Model
                {provider === 'ollama' && (
                  <button
                    type="button"
                    onClick={() => void fetchOllamaModels(baseUrl)}
                    disabled={ollamaModelsLoading}
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground',
                      'px-1.5 py-0.5 rounded border border-border/60 hover:border-border',
                      'transition-colors',
                      ollamaModelsLoading && 'opacity-60 cursor-wait',
                    )}
                    title="Re-fetch model list from the Ollama server"
                    data-testid="ollama-refresh-models"
                  >
                    <RefreshCw
                      className={cn('h-3 w-3', ollamaModelsLoading && 'animate-spin')}
                      aria-hidden="true"
                    />
                    Refresh
                  </button>
                )}
              </Label>
              {provider === 'ollama' ? (
                // Ollama: dynamically fetched from <base_url>/api/tags.
                // If the fetch failed (unreachable / typo'd URL / CORS),
                // fall back to a freeform input so the user can still
                // type a model name and fix the URL later.
                ollamaModels.length > 0 ? (
                  <Select value={model} onValueChange={(v) => setFieldDebounced('model', v)}>
                    <SelectTrigger id="ai-model" data-testid="model-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      id="ai-model"
                      data-testid="model-input"
                      value={model}
                      onChange={(e) => setFieldDebounced('model', e.target.value)}
                      placeholder={ollamaModelsLoading ? 'Fetching models…' : 'qwen2.5:3b'}
                      disabled={ollamaModelsLoading}
                    />
                    {ollamaModelsError && !ollamaModelsLoading && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                        <span>Couldn't list models from that URL: {ollamaModelsError}. Check the base URL above, or type a model name manually.</span>
                      </p>
                    )}
                  </>
                )
              ) : (MODEL_OPTIONS[provider] ?? []).length > 0 ? (
                <Select value={model} onValueChange={(v) => setFieldDebounced('model', v)}>
                  <SelectTrigger id="ai-model" data-testid="model-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(MODEL_OPTIONS[provider] ?? []).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="ai-model"
                  data-testid="model-input"
                  value={model}
                  onChange={(e) => setFieldDebounced('model', e.target.value)}
                  placeholder="model-name"
                />
              )}
            </div>
          </div>

          {(provider === 'ollama' || provider === 'custom') && (
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                data-testid="base-url-input"
                value={baseUrl}
                onChange={(e) => setFieldDebounced('baseUrl', e.target.value)}
                placeholder={provider === 'ollama' ? 'http://localhost:11434 — or https://your-remote-ollama.example' : 'https://api.example.com/v1'}
                className="font-mono text-sm"
              />
            </div>
          )}

          {(provider === 'openai' || provider === 'anthropic' || provider === 'custom') && (
            <div className="space-y-2">
              <Label htmlFor="ai-key">
                API Key {provider === 'custom' && <span className="text-muted-foreground">(optional)</span>}
                {hasApiKey && apiKey === '' && (
                  <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">stored in keychain</span>
                )}
              </Label>
              <Input
                id="ai-key"
                data-testid="api-key-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? '•••• (leave blank to keep existing)' : 'sk-...'}
                autoComplete="off"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Saved to the OS keychain (macOS Keychain / Windows Credential
                Manager / Linux libsecret). Never written to disk in
                plaintext, never returned to this form.
              </p>
              {/* Detect prefix/provider mismatch — Together (tgp_), OpenRouter
                  (sk-or-), Groq (gsk_), Anthropic (sk-ant-) keys won't work
                  against OpenAI's endpoint. Warn before the user wastes a
                  Save → Test cycle on a 401. */}
              {(() => {
                const k = apiKey.trim();
                if (!k) return null;
                let warn: string | null = null;
                if (provider === 'openai' && (k.startsWith('tgp_') || k.startsWith('sk-or-') || k.startsWith('gsk_') || k.startsWith('sk-ant-'))) {
                  if (k.startsWith('tgp_')) warn = 'This looks like a Together AI key. Switch Provider to "custom" and set Base URL to https://api.together.xyz/v1.';
                  else if (k.startsWith('sk-or-')) warn = 'This looks like an OpenRouter key. Switch Provider to "custom" and set Base URL to https://openrouter.ai/api/v1.';
                  else if (k.startsWith('gsk_')) warn = 'This looks like a Groq key. Switch Provider to "custom" and set Base URL to https://api.groq.com/openai/v1.';
                  else if (k.startsWith('sk-ant-')) warn = 'This looks like an Anthropic key. Switch Provider to "anthropic".';
                } else if (provider === 'anthropic' && !k.startsWith('sk-ant-')) {
                  warn = 'Anthropic keys start with "sk-ant-". Double-check the key or switch Provider.';
                }
                return warn ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠ {warn}</p>
                ) : null;
              })()}
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/30">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testing}
              data-testid="test-btn"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Activity className="h-4 w-4 mr-2" />
              )}
              Test connection
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              data-testid="save-btn"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save &amp; Test
            </Button>

            <Button type="button" variant="ghost" onClick={handleReset} data-testid="reset-btn">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to defaults
            </Button>

            {testResult && (
              <span
                data-testid="test-result"
                className={cn(
                  'text-xs font-medium inline-flex items-center gap-1.5',
                  testResult.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400',
                )}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Connected ({testResult.latencyMs ?? 0}ms)
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    {testResult.error ?? 'Failed'}
                  </>
                )}
              </span>
            )}
            {lastError && (
              <span
                className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5"
                data-testid="store-error"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {lastError}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ━━━ Cost & Budget ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-budget-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Cost &amp; Budget</CardTitle>
              <CardDescription>Monthly spend tracking. Hit the cap and the chat stream emits a budget_exceeded event.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetBudget}
                disabled={resettingBudget}
                data-testid="reset-budget-btn"
              >
                {resettingBudget ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                Reset budget cap
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/settings/ai/budget')}>
                Configure budget
                <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/settings/ai/tools')}>
                Tool Catalog
                <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile
            label="Spent this month"
            value={budgetSpent == null ? '—' : `$${budgetSpent.toFixed(2)}`}
          />
          <StatTile
            label="Cap"
            value={budgetCap == null ? '—' : budgetCap === 0 ? 'unlimited' : `$${budgetCap.toFixed(2)}`}
          />
          <StatTile
            label="Remaining"
            value={
              budgetCap == null || budgetSpent == null
                ? '—'
                : budgetCap === 0
                  ? '∞'
                  : `$${Math.max(0, budgetCap - budgetSpent).toFixed(2)}`
            }
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold mt-1 truncate" title={value}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}
