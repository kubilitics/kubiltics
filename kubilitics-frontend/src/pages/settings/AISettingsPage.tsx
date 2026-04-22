/**
 * AI Settings page — driven by the `useAIConfigStore` Tauri-keychain
 * round-trip (Phase 2 / Blocker C). The raw API key never touches the
 * backend REST API; the Rust side pushes it into the OS keychain and
 * the brain reads it there on startup. This page therefore talks
 * exclusively to the Tauri commands via the store.
 *
 * Previous iteration POSTed to `/api/v1/ai/config` via fetch — that
 * endpoint is now legacy and the store is the single source of truth.
 *
 * - provider dropdown (OpenAI / Anthropic / Ollama / Custom)
 * - model (dropdown for OpenAI / Anthropic; freeform for Ollama / Custom)
 * - base_url (shown for Ollama + Custom)
 * - api_key (shown for OpenAI / Anthropic / Custom; masked display when
 *   a key is already in the keychain; empty entry preserves existing)
 * - Test connection — round-trips through `test_llm_connection`
 * - Save & Test — debounced non-secret edits save on a 500ms timer;
 *   clicking the button forces an immediate save + a connection test.
 *
 * Reset budget cap lives in this page too (Gap 3): the backend brain
 * exposes `reset_budget` via a Tauri command; the button here fires it
 * and toasts the result.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, XCircle, Loader2, Save, RotateCcw, Activity, ExternalLink } from 'lucide-react';
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

export default function AISettingsPage() {
  const navigate = useNavigate();
  const store = useAIConfigStore();
  const { provider, model, baseUrl, hasApiKey, loading, lastError } = store;

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

  // Detected providers from the OS env / localhost probe.  Surfaced as
  // one-click connect buttons so users don't have to know model names or
  // base URLs on their first run.
  type Detected = {
    provider: string; source: string; model: string; base_url: string; env_var: string;
  };
  const [detected, setDetected] = useState<Detected[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => {
    invoke<Detected[]>('detect_available_providers')
      .then(setDetected)
      .catch(() => setDetected([]));
  }, []);

  const handleQuickConnect = async (d: Detected) => {
    setConnecting(d.provider);
    try {
      // Quick-connect doesn't need to pass the key — the brain reads the
      // env var itself (OPENAI_API_KEY / ANTHROPIC_API_KEY etc.) or in the
      // Ollama case there's no key at all. We just save provider/model/base_url.
      await store.save({
        provider: d.provider as Provider,
        model: d.model,
        baseUrl: d.base_url,
        apiKey: '',
      });
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

  // Paste-any-key detector. Users paste whatever they have; we figure out
  // which provider + model from the key prefix. No URL/model selection.
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
    // Unknown prefix — assume OpenAI-compatible and let the user refine below.
    return null;
  };
  const pastedGuess = guessFromKey(pastedKey);

  const handlePasteConnect = async () => {
    if (!pastedGuess) return;
    setPasting(true);
    try {
      await store.save({
        provider: pastedGuess.provider,
        model: pastedGuess.model,
        baseUrl: pastedGuess.baseUrl,
        apiKey: pastedKey.trim(),
      });
      setPastedKey('');
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

  // Hydrate on mount — pulls provider/model/base_url from config.yaml
  // and flips has_api_key from the keychain probe.
  useEffect(() => {
    void store.hydrate();
    // Kick off a budget probe — returns {spent_usd, cap_usd}. Non-fatal
    // if the brain isn't reachable; the card just shows "—".
    invoke<{ spent_usd: number; cap_usd: number }>('get_budget_status')
      .then((b) => {
        setBudgetSpent(b.spent_usd);
        setBudgetCap(b.cap_usd);
      })
      .catch(() => {
        /* budget card stays blank; not a Settings-level error */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any edit invalidates a previous test result.
  useEffect(() => {
    setTestResult(null);
  }, [provider, model, baseUrl, apiKey]);

  const handleProviderChange = (p: Provider) => {
    setFieldDebounced('provider', p);
    // When the user flips providers the model + base_url defaults shift;
    // push them through the debouncer too so the next save includes them.
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
    try {
      await store.save({ provider, model, baseUrl, apiKey });
      toast.success('AI configuration saved');
      setApiKey(''); // drop raw key from React state once it's in the keychain
      // Immediately pulse a connection test so the user sees end-to-end green.
      const res = await store.testConnection({ provider, model, baseUrl });
      setTestResult({ ok: res.ok, latencyMs: res.latencyMs, error: res.error ?? undefined });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    // Reset the form to defaults WITHOUT touching the keychain. User can
    // hit Save to commit.
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
      // Re-probe
      const b = await invoke<{ spent_usd: number; cap_usd: number }>('get_budget_status');
      setBudgetSpent(b.spent_usd);
      setBudgetCap(b.cap_usd);
    } catch (e) {
      toast.error(`Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResettingBudget(false);
    }
  };

  const stateTone = hasApiKey
    ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
    : 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300';

  return (
    <PageLayout label="AI Settings" showBanner={false} className="max-w-5xl mx-auto">
      <SectionOverviewHeader
        title="AI Settings"
        description="Configure the AI provider, model, and credentials. The API key lives in the OS keychain — never in a config file."
        icon={Bot}
      />

      {/* ━━━ Current State ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-current-state-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Current State</CardTitle>
              <CardDescription>Brain-reported configuration from the keychain round-trip.</CardDescription>
            </div>
            <Badge variant="outline" className={cn('rounded-full px-3 py-1 text-xs font-medium', stateTone)}>
              {hasApiKey ? 'configured' : 'needs API key'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Provider" value={provider} />
          <StatTile label="Model" value={model || '—'} />
          <StatTile label="Base URL" value={baseUrl || 'default'} />
          <StatTile label="Key in Keychain" value={hasApiKey ? 'yes' : 'no'} />
        </CardContent>
      </Card>

      {/* ━━━ Quick Connect — always visible, paste any key ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-quick-connect-card">
        <CardHeader>
          <CardTitle className="text-base">Quick Connect</CardTitle>
          <CardDescription>
            Paste any AI provider key below — we detect the provider from the
            prefix and pick a sensible model for you. No URL or model name to memorize.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {detected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detected.map((d) => {
                const label =
                  d.provider === 'openai' ? 'OpenAI' :
                  d.provider === 'anthropic' ? 'Anthropic' :
                  d.provider === 'ollama' ? 'Ollama (local)' :
                  d.env_var.replace('_API_KEY', '').toLowerCase();
                const sourceText =
                  d.source === 'env' ? `from $${d.env_var}` :
                  d.source === 'localhost' ? 'running on localhost' :
                  'saved in keychain';
                return (
                  <Button
                    key={`${d.provider}-${d.source}-${d.env_var}`}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickConnect(d)}
                    disabled={connecting !== null}
                  >
                    {connecting === d.provider ? 'Connecting…' : `${label} · ${sourceText}`}
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

      {/* ━━━ Provider Configuration ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-provider-card">
        <CardHeader>
          <CardTitle className="text-base">Provider Configuration</CardTitle>
          <CardDescription>Changes to provider / model / base URL auto-save 500ms after you stop typing.</CardDescription>
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
                  <SelectItem value="ollama">Ollama (local)</SelectItem>
                  <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-model">Model</Label>
              {MODEL_OPTIONS[provider].length > 0 ? (
                <Select value={model} onValueChange={(v) => setFieldDebounced('model', v)}>
                  <SelectTrigger id="ai-model" data-testid="model-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS[provider].map((m) => (
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
                  placeholder={provider === 'ollama' ? 'qwen2.5:3b' : 'model-name'}
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
                placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
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
                Saved to the OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret).
                Never written to disk in plaintext, never returned to this form.
              </p>
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
              <span className="text-xs text-red-600 dark:text-red-400" data-testid="store-error">
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
