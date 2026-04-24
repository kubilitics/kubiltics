// Per-provider, per-model USD rates for chat token cost display.
//
// Token counts come from the brain's Done event (Chat WebSocket). We
// multiply them by these rates to render "$0.0024" beside the turn's
// token counters in the chat panel. Internal accounting on the brain
// tallies its own USD for budget enforcement; this file is purely for
// client-side display and never feeds any authoritative billing path.
//
// Rates are quoted in USD per 1 million tokens — matching how OpenAI,
// Anthropic, Together.ai, Groq, and Ollama-hosted (iximiuz) publish
// them — so a 1K-token prompt on gpt-4o-mini costs
// `1000 * 0.15 / 1_000_000 = $0.00015`.
//
// Unknown models fall back to `DEFAULT_RATES`, which is the low end of
// the hosted range so the UI under-reports rather than over-reports —
// better to surface accidental rate drift than to scare a user with a
// fake bill. Pair with the brain's accounting.Tallier whenever you care
// about the authoritative number.

export interface TokenRate {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

// Matches the brain's Ollama provider: local/remote self-hosted models.
// Ollama itself is free; the cost field stays 0 so the UI renders "free"
// rather than a fake number.
const OLLAMA_RATES: TokenRate = { inputPerMillion: 0, outputPerMillion: 0 };

// Conservative 2026 public rates. Update in one place here when providers
// shift pricing; the UI reflects it everywhere.
const RATE_TABLE: Record<string, Record<string, TokenRate>> = {
  openai: {
    'gpt-4o':          { inputPerMillion: 2.50,  outputPerMillion: 10.00 },
    'gpt-4o-mini':     { inputPerMillion: 0.15,  outputPerMillion: 0.60  },
    'gpt-4-turbo':     { inputPerMillion: 10.00, outputPerMillion: 30.00 },
    'gpt-3.5-turbo':   { inputPerMillion: 0.50,  outputPerMillion: 1.50  },
  },
  anthropic: {
    'claude-3-5-sonnet-latest': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    'claude-3-5-haiku-latest':  { inputPerMillion: 0.80, outputPerMillion: 4.00  },
    'claude-3-opus-latest':     { inputPerMillion: 15.0, outputPerMillion: 75.00 },
  },
  ollama: {
    // Any Ollama model — local or hosted — is zero-marginal-cost to the user.
  },
  custom: {
    // Together.ai public rates (iximiuz, etc. pass these through).
    'Qwen/Qwen2.5-7B-Instruct-Turbo':    { inputPerMillion: 0.30, outputPerMillion: 0.30 },
    'Qwen/Qwen2.5-72B-Instruct-Turbo':   { inputPerMillion: 1.20, outputPerMillion: 1.20 },
    // Groq public rates.
    'llama-3.3-70b-versatile':           { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    // OpenRouter passthrough: cost varies per upstream model, so leave
    // the table empty — we'll fall through to the default.
  },
};

// Default when we can't map the model: treat as Ollama (free) rather
// than guess. A precise 0 beats an imagined number.
const DEFAULT_RATES: TokenRate = OLLAMA_RATES;

export function rateFor(provider: string, model: string): TokenRate {
  const p = RATE_TABLE[(provider || '').toLowerCase()];
  if (!p) return DEFAULT_RATES;
  // Ollama: model-agnostic, always free.
  if (provider === 'ollama') return OLLAMA_RATES;
  const r = p[model];
  return r ?? DEFAULT_RATES;
}

/** USD cost for a single turn. Returns 0 when provider is free-tier (ollama). */
export function costForTurn(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const r = rateFor(provider, model);
  return (
    (promptTokens * r.inputPerMillion) / 1_000_000 +
    (completionTokens * r.outputPerMillion) / 1_000_000
  );
}

/**
 * Format a small USD amount for the chat footer. The typical turn costs
 * between $0.0001 and $0.10; rendering "0.00" for anything under a cent
 * would hide real cost. Pick precision by magnitude:
 *   ≥ $0.10 → 2 decimals   ("$0.14")
 *   ≥ $0.01 → 3 decimals   ("$0.024")
 *   ≥ $0    → 4 decimals   ("$0.0024")
 *   = 0     → "free"        (Ollama / unknown model)
 */
export function formatCostUSD(usd: number): string {
  if (!isFinite(usd) || usd < 0) return '—';
  if (usd === 0) return 'free';
  if (usd >= 0.1)  return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}
