import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, DollarSign, Save, RotateCcw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { getBackendBase } from '@/lib/backendUrl';

type BudgetConfig = {
  global_monthly_budget: number;
  per_user_monthly_budget: number;
  per_investigation_limit: number;
};

const DEFAULTS: BudgetConfig = {
  global_monthly_budget: 0,
  per_user_monthly_budget: 0,
  per_investigation_limit: 0,
};

/**
 * AI Budget settings.
 *
 * Three caps the brain enforces (when set > 0):
 *  - global_monthly_budget   — total $ across all users in a calendar month
 *  - per_user_monthly_budget — $ per user per month
 *  - per_investigation_limit — max tokens per single investigation
 *
 * Persisted to ~/.kubilitics/ai-budget.yaml via POST /api/v1/ai/budget.
 * The brain reads this on launch / SIGHUP. Zero means "no limit".
 */
export default function AIBudgetPage() {
  const navigate = useNavigate();
  const [budget, setBudget] = useState<BudgetConfig>(DEFAULTS);
  const [original, setOriginal] = useState<BudgetConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${getBackendBase()}/api/v1/ai/budget`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as BudgetConfig;
        if (cancelled) return;
        setBudget(data);
        setOriginal(data);
      } catch (e) {
        if (!cancelled) setError(`Failed to load: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    budget.global_monthly_budget !== original.global_monthly_budget ||
    budget.per_user_monthly_budget !== original.per_user_monthly_budget ||
    budget.per_investigation_limit !== original.per_investigation_limit;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${getBackendBase()}/api/v1/ai/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(budget),
      });
      const data = await resp.json();
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setOriginal(budget);
      toast.success('Budget saved. Brain will pick up changes on next reload.');
    } catch (e) {
      setError((e as Error).message);
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setBudget(original);
    setError(null);
  };

  const update = (k: keyof BudgetConfig, v: string) => {
    const num = v === '' ? 0 : Number(v);
    if (Number.isNaN(num) || num < 0) return;
    setBudget((prev) => ({ ...prev, [k]: num }));
  };

  return (
    <div className="page-container" role="main" aria-label="AI Budget Settings">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <ConnectionRequiredBanner />
        <SectionOverviewHeader
          title="AI Budget"
          description="Cap LLM spend across users, organisations, and investigations. Zero means no limit; the brain enforces these on every request."
          icon={DollarSign}
          extraActions={
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings/ai')}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to AI Settings
            </Button>
          }
        />

        <Card className="border-none soft-shadow glass-panel">
          <CardHeader>
            <CardTitle className="text-base">Spend caps</CardTitle>
            <CardDescription>
              All values in USD per calendar month except the per-investigation token cap.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-1.5">
              <Label htmlFor="global">Global monthly budget</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-4">$</span>
                <Input
                  id="global"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0 (no limit)"
                  value={budget.global_monthly_budget || ''}
                  onChange={(e) => update('global_monthly_budget', e.target.value)}
                  disabled={loading}
                  className="max-w-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Total LLM spend across the whole installation in a calendar month. Hard cap.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="peruser">Per-user monthly budget</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-4">$</span>
                <Input
                  id="peruser"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0 (no limit)"
                  value={budget.per_user_monthly_budget || ''}
                  onChange={(e) => update('per_user_monthly_budget', e.target.value)}
                  disabled={loading}
                  className="max-w-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Each authenticated user's max spend per calendar month. Resets on the 1st.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="perinvest">Per-investigation token limit</Label>
              <Input
                id="perinvest"
                type="number"
                step="1"
                min="0"
                placeholder="0 (no limit)"
                value={budget.per_investigation_limit || ''}
                onChange={(e) => update('per_investigation_limit', e.target.value)}
                disabled={loading}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Hard cap on tokens consumed by a single chat session / investigation. Stops runaway loops.
              </p>
            </div>

            {error ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving || loading || !dirty}>
                <Save className="h-4 w-4 mr-1.5" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={!dirty || saving}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none soft-shadow glass-panel">
          <CardHeader>
            <CardTitle className="text-base">How budgets are enforced</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The brain (<code className="text-xs bg-muted px-1 py-0.5 rounded">internal/llm/budget</code>)
              tracks every completion's prompt + completion tokens, multiplies by the provider's published
              per-token price, and accumulates per-user and global totals in a calendar month window.
            </p>
            <p>
              When a request would push a counter past its cap, the brain refuses with a structured
              <code className="text-xs bg-muted px-1 py-0.5 rounded mx-1">budget_exceeded</code>
              error and the chat panel surfaces it inline. Counters reset at 00:00 UTC on the 1st.
            </p>
            <p>
              Zero values disable the corresponding cap. Recommended default for production:
              <span className="font-medium text-foreground"> per-user $25/mo, per-investigation 8000 tokens</span>,
              global unlimited.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
