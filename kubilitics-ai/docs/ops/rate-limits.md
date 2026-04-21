# LLM Provider Rate Limits

## Observed failure modes

Apr 21, 2026 bench, 250 prompts × gpt-4o × tier-1:
- 65 / 80 failures were `API 429: Rate limit reached on tokens per min (TPM): Limit 450000`.
- After task 2 (retry + backoff), first-attempt failures are expected to
  fall from 30% to <5% of the bench.

## TPM math

| Model | Tier-1 TPM | Avg tokens per tool-calling turn | Max QPM before throttle |
|---|---:|---:|---:|
| gpt-4o        | 450,000   | 20,000 | 22 |
| gpt-4o-mini   | 2,000,000 | 20,000 | 100 |
| claude-3-5-sonnet | 400,000 | 20,000 | 20 |

`tokens per turn` includes the 128-tool schema (~12K input tokens) and a
summarized tool result per call (~2K each). A prompt that fires 3 tool
calls = 3 × (12K + 2K) = 42K tokens. At tier-1 gpt-4o = 10 such prompts
per minute max.

## Upgrade path

1. Log in at https://platform.openai.com/account/billing/limits
2. Request tier upgrade via "Usage tiers". Tier-3 = 2M TPM for gpt-4o, enough
   for the full 500-prompt bench at concurrency=3 without throttle.
3. Tier-3 requires $100 paid + 7-day account age. Contact finance.

## Client-side mitigations (shipped)

- `internal/llm/provider/openai/retry.go`: hint-aware 429 retry, max 3 attempts.
- `cmd/chat-quality-bench` defaults to `--concurrency 1` for this reason.
- Consider tighter tool-window trimming (<= 64 tools per request) to halve
  per-request input token cost — not shipped; tradeoff with tool coverage.

## Ollama alternative

Ollama is $0/token. Latency-bound on the host, not rate-limited. Use for
dev loops and scale validation; use OpenAI for final answer quality.
