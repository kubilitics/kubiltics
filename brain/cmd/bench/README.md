# kubilitics-ai bench

A wide-event benchmarking harness for the kubilitics-ai brain. One row per
LLM call. Every dimension queryable. Same shape as `internal/audit/types.go`
so production traffic and bench traffic converge under a single
observability-2.0 schema (high-cardinality, single event per unit-of-work,
no pre-aggregated counters).

## Why wide events

Counters and histograms answer "how many" and "how slow on average." Wide
events answer "which prompt, on which model, in which provider, at which
time, hit the slow tail and what was the finish reason?" One JSON line per
LLM call lets you slice on `provider × model × prompt_id × tag` after the
fact with `jq` or any column store. The schema is intentionally flat —
new dimensions go into `attributes`, never new top-level columns, so the
file format stays append-only.

## Build

```bash
cd kubilitics-ai
go build ./cmd/bench/
```

## Pointing the kubilitics-ai server at a real LLM

The brain's provider is selected by `config.yaml` and overridable by env vars
prefixed `KUBILITICS_AI_LLM_*`. Start the server, then point bench at it.

### Ollama (local or remote)

`config.yaml`:
```yaml
llm:
  provider: ollama
  ollama:
    base_url: http://localhost:11434
    model: llama3
```

Run:
```bash
./kubilitics-ai-server   # gRPC :50051, HTTP :8081
./bench -tag ollama-llama3 -prompts cmd/bench/prompts/smoke.yaml
```

### OpenAI

```bash
export KUBILITICS_AI_LLM_PROVIDER=openai
export KUBILITICS_AI_LLM_OPENAI_APIKEY=sk-...
export KUBILITICS_AI_LLM_OPENAI_MODEL=gpt-4o-mini
./kubilitics-ai-server
./bench -tag openai-gpt-4o-mini
```

### Anthropic

```bash
export KUBILITICS_AI_LLM_PROVIDER=anthropic
export KUBILITICS_AI_LLM_ANTHROPIC_APIKEY=sk-ant-...
export KUBILITICS_AI_LLM_ANTHROPIC_MODEL=claude-3-5-sonnet-latest
./kubilitics-ai-server
./bench -tag anthropic-sonnet-3.5
```

## Running benches

Smoke (3 prompts, ~15s on a fast Ollama):
```bash
./bench -prompts cmd/bench/prompts/smoke.yaml -iterations 3 -tag ollama-llama3
```

Full (~15 prompts, run before tagging a release):
```bash
./bench -prompts cmd/bench/prompts/full.yaml  -iterations 5 -tag openai-gpt-4o-mini
```

Dry run (no LLM, in-process bufconn mock — used by CI):
```bash
./bench -dry-run -iterations 2 -tag ci-smoke
```

## Output

Each iteration appends one JSON line to `-output` (default
`bench-results.ndjson`). The final line is a `bench.summary` event.

```bash
# Slowest prompts by p95 total latency
jq -s 'map(select(.event_type=="bench.llm_call"))
       | group_by(.prompt_id)
       | map({id:.[0].prompt_id, p95:(map(.total_ms)|sort|.[((length-1)*95/100)|floor])})
       | sort_by(.p95) | reverse' bench-results.ndjson

# Compare two tags side-by-side
jq -s 'group_by(.tag) | map({tag:.[0].tag, p95_ttft:(map(.ttft_ms)|sort|.[((length-1)*95/100)|floor])})' \
   bench-results.ndjson
```

## What the metrics mean

- **TTFT (time-to-first-token)** — how snappy the assistant feels. This is
  what a human sees as "responsiveness." Dominated by network RTT, queueing,
  and the first decode. Streaming UIs live and die here.
- **Total latency** — how long until the answer is fully produced. This is
  what your throughput, cost-per-answer, and capacity planning live on. A
  fast TTFT with slow total means you're bottlenecked on output tokens, not
  the prefill. Both matter for different reasons; bench reports both.
- **chars_per_sec** — output speed measured between first token and Done.
  Comparable across prompts of similar output length.
- **input_token_estimate** — pre-flight `len(text)/4` heuristic so you can
  correlate slowdowns with input size without standing up tokenizers.

## v0.9.0 follow-up

The bench writes `bench.llm_call` wide events to a file. The runtime
(`internal/runtime/llm_engine.go`) currently emits no equivalent event into
the audit pipeline — production LLM calls are invisible to the same
analysis. The next step is to emit a `runtime.llm_call` wide event with the
**identical schema** (TTFT, total, chunks, output_chars, finish_reason,
provider, model) from the engine into `internal/audit`. Bench file format
and runtime audit schema must converge; that's the whole point of the
wide-event approach.
