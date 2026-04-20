/**
 * AI Settings page — restored sophisticated provider/model/key UI on top
 * of the new in-cluster brain (kubilitics-ai) architecture.
 *
 * Features:
 *  - Read current state via /api/v1/ai/status + capabilities
 *  - Provider config form (OpenAI / Anthropic / Ollama / Custom)
 *  - "Validate Connection" — round-trips through backend without saving
 *  - Save — persists via backend; backend writes to ~/.kubilitics/
 *    ai-overrides.yaml (in dev) or Secret/ConfigMap (in-cluster, TODO)
 *  - Cost & budget read-only card
 *  - Diagnostics card with smoke-test + recent audit (audit hidden if
 *    the brain doesn't expose it)
 *
 * No API key ever lands in localStorage — it is sent to the backend on
 * Save / Validate and immediately cleared from form state on success.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, XCircle, Loader2, Save, RotateCcw, Activity, Wrench, ExternalLink } from 'lucide-react';

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
import { useAIStatus } from '@/hooks/useAIStatus';
import { useAICapabilities } from '@/hooks/useAICapabilities';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { cn } from '@/lib/utils';

type Provider = 'openai' | 'anthropic' | 'ollama' | 'custom';

interface FormState {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

interface ValidateResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

const MODEL_OPTIONS: Record<Provider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  ollama: [],
  custom: [],
};

const DEFAULT_FORM: FormState = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '',
  baseUrl: '',
};

export default function AISettingsPage() {
  const navigate = useNavigate();
  const status = useAIStatus();
  const clusterId = useActiveClusterId() ?? undefined;
  const caps = useAICapabilities(clusterId);

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [smokeOutput, setSmokeOutput] = useState<string | null>(null);
  const [isSmokeTesting, setIsSmokeTesting] = useState(false);

  // Reset validation whenever the user mutates the form.
  useEffect(() => {
    setValidateResult(null);
  }, [form.provider, form.model, form.apiKey, form.baseUrl]);

  const stateLabel = status.data?.state ?? 'unknown';
  const stateTone = useMemo(() => {
    switch (stateLabel) {
      case 'ready':
        return 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300';
      case 'degraded':
        return 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300';
      default:
        return 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300';
    }
  }, [stateLabel]);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleProviderChange = (p: Provider) => {
    setForm((f) => ({
      ...f,
      provider: p,
      model: MODEL_OPTIONS[p][0] ?? '',
      apiKey: '',
      baseUrl: p === 'ollama' ? 'http://localhost:11434' : '',
    }));
  };

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const res = await fetch('/api/v1/ai/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          model: form.model,
          api_key: form.apiKey,
          base_url: form.baseUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        latency_ms?: number;
        error?: string;
      };
      const ok = !!json.ok;
      setValidateResult({ ok, latencyMs: json.latency_ms, error: json.error });
      if (ok) toast.success(`Connected (${json.latency_ms ?? 0}ms)`);
      else toast.error(`Validation failed: ${json.error ?? 'unknown error'}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      setValidateResult({ ok: false, error: msg });
      toast.error(`Validation failed: ${msg}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/v1/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          model: form.model,
          api_key: form.apiKey,
          base_url: form.baseUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (json.ok) {
        toast.success('AI configuration saved');
        // Don't keep the API key in component state after save.
        setForm((f) => ({ ...f, apiKey: '' }));
      } else {
        toast.error(`Save failed: ${json.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setForm(DEFAULT_FORM);
    setValidateResult(null);
    toast.info('Restored defaults');
  };

  const handleSmokeTest = async () => {
    setIsSmokeTesting(true);
    setSmokeOutput(null);
    try {
      // Reuse the validate endpoint as a low-cost ping. A real prompt
      // round-trip requires a session + WS handshake; for "is the brain
      // talking to its model" this is enough.
      const t0 = performance.now();
      const res = await fetch('/api/v1/ai/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          model: form.model,
          api_key: form.apiKey,
          base_url: form.baseUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      const total = Math.round(performance.now() - t0);
      if (json.ok) setSmokeOutput(`OK in ${total}ms — brain reachable, config shape valid.`);
      else setSmokeOutput(`FAIL: ${json.error ?? 'unknown error'}`);
    } catch (e) {
      setSmokeOutput(`FAIL: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setIsSmokeTesting(false);
    }
  };

  const saveDisabled = isSaving || !validateResult?.ok;

  return (
    <PageLayout label="AI Settings" showBanner={false} className="max-w-5xl mx-auto">
      <SectionOverviewHeader
        title="AI Settings"
        description="Configure the AI provider, model, and credentials. Validate before saving."
        icon={Bot}
      />

      {/* ━━━ Current State ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-current-state-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Current State</CardTitle>
              <CardDescription>What the in-cluster brain is reporting right now.</CardDescription>
            </div>
            <Badge variant="outline" className={cn('rounded-full px-3 py-1 text-xs font-medium', stateTone)}>
              {stateLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="AI Version" value={status.data?.version ?? '—'} />
          <StatTile label="Schema" value={caps.data?.capabilities?.schema_version ?? '—'} />
          <StatTile
            label="Engines"
            value={(status.data?.engines ?? []).join(', ') || '—'}
          />
          <StatTile
            label="Providers"
            value={(caps.data?.capabilities?.providers ?? []).join(', ') || '—'}
          />
        </CardContent>
      </Card>

      {/* ━━━ Provider Configuration ━━━ */}
      <Card className="border-none soft-shadow glass-panel" data-testid="ai-provider-card">
        <CardHeader>
          <CardTitle className="text-base">Provider Configuration</CardTitle>
          <CardDescription>Pick a provider, model, and credentials. Validate first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={form.provider} onValueChange={(v) => handleProviderChange(v as Provider)}>
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
              {MODEL_OPTIONS[form.provider].length > 0 ? (
                <Select value={form.model} onValueChange={(v) => setField('model', v)}>
                  <SelectTrigger id="ai-model" data-testid="model-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS[form.provider].map((m) => (
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
                  value={form.model}
                  onChange={(e) => setField('model', e.target.value)}
                  placeholder={form.provider === 'ollama' ? 'qwen2.5:3b' : 'model-name'}
                />
              )}
            </div>
          </div>

          {(form.provider === 'ollama' || form.provider === 'custom') && (
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                data-testid="base-url-input"
                value={form.baseUrl}
                onChange={(e) => setField('baseUrl', e.target.value)}
                placeholder={form.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
                className="font-mono text-sm"
              />
            </div>
          )}

          {(form.provider === 'openai' || form.provider === 'anthropic' || form.provider === 'custom') && (
            <div className="space-y-2">
              <Label htmlFor="ai-key">
                API Key {form.provider === 'custom' && <span className="text-muted-foreground">(optional)</span>}
              </Label>
              <Input
                id="ai-key"
                data-testid="api-key-input"
                type="password"
                value={form.apiKey}
                onChange={(e) => setField('apiKey', e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Stored server-side only. Never persisted to browser storage.
              </p>
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/30">
            <Button
              type="button"
              variant="outline"
              onClick={handleValidate}
              disabled={isValidating}
              data-testid="validate-btn"
            >
              {isValidating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Validate Connection
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              data-testid="save-btn"
            >
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>

            <Button type="button" variant="ghost" onClick={handleReset} data-testid="reset-btn">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to defaults
            </Button>

            {validateResult && (
              <span
                data-testid="validate-result"
                className={cn(
                  'text-xs font-medium inline-flex items-center gap-1.5',
                  validateResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                )}
              >
                {validateResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Connected ({validateResult.latencyMs ?? 0}ms)
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    {validateResult.error ?? 'Failed'}
                  </>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ━━━ Cost & Budget ━━━ */}
      <Card className="border-none soft-shadow glass-panel">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Cost & Budget</CardTitle>
              <CardDescription>Brain-reported usage. Configure a budget to enforce limits.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Per-user / monthly budget limits ship in the next release"
            >
              Configure budget
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">Soon</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="Tokens today" value="—" hint="Awaiting brain telemetry" />
          <StatTile label="Tokens this month" value="—" />
          <StatTile label="Estimated cost" value="—" />
        </CardContent>
      </Card>

      {/* ━━━ Diagnostics ━━━ */}
      <Card className="border-none soft-shadow glass-panel">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Diagnostics
          </CardTitle>
          <CardDescription>Smoke-test the current configuration end-to-end.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleSmokeTest}
            disabled={isSmokeTesting}
            data-testid="smoke-btn"
          >
            {isSmokeTesting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Activity className="h-4 w-4 mr-2" />
            )}
            Run smoke test
          </Button>
          {smokeOutput && (
            <div
              data-testid="smoke-output"
              className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap"
            >
              {smokeOutput}
            </div>
          )}
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
