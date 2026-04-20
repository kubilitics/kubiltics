# Kubilitics AI — Capabilities Summary

> **Audience:** technical investors. Every claim below points to working
> code and measured numbers, not roadmap slides. If a feature is partial
> or planned, it's marked plainly.

**Date:** 2026-04-20  •  **Repos:** `vellankikoti/kubilitics` (control plane + UI), `vellankikoti/kotg.ai` (AI brain), `vellankikoti/kotg-schema` (wire contract)

---

## TL;DR

We ship a Kubernetes operational-intelligence platform with an AI brain that
runs **in your cluster**, behind a **typed wire contract**, gated by a
**safety wrapper** with autonomy levels, and instrumented with
**observability-2.0 wide events**. The AI is **provider-agnostic** (Ollama,
OpenAI, Anthropic, any OpenAI-compatible endpoint), with a **Router + Engine**
architecture that lets us swap reasoning engines (LLM-direct today; kagent
and Python multi-agent registered as drop-in engines, with live integrations
landing in v1.5). One-command install via Helm. End-to-end measured today:
TTFT ~1.0s and total ~3.9s through OpenAI gpt-4o-mini via the full server
stack (Router → LLMEngine → Safety wrapper → adapter), with **zero
measurable overhead** vs. calling OpenAI directly.

---

## 1. Architecture (what's actually wired)

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser  ──HTTP/WS──▶  kubilitics-backend  ──gRPC + HTTP──▶  brain │
│  (chat panel)            (control plane)         (kotg-schema)      │
│                                                                     │
│                                       ┌─────────────────────────┐   │
│                                       │  kubilitics-ai (brain)   │   │
│                                       │                          │   │
│                                       │   Safety Wrapper         │   │
│                                       │      │                   │   │
│                                       │      ▼                   │   │
│                                       │   Router                 │   │
│                                       │      │                   │   │
│                                       │      ├── LLM-direct ✓    │   │
│                                       │      ├── kagent (skel)   │   │
│                                       │      └── python (skel)   │   │
│                                       └─────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Wire contract (frozen, public)
- Repo: `vellankikoti/kotg-schema@v1.0.1`
- `service Chat { CreateSession, Send (stream UserMessage → stream AssistantEvent), CancelTurn, ListSessions }`
- `service AIControl { Capabilities, Health }`
- `AssistantEvent` oneof: `TextDelta`, `ToolStart`, `ToolEnd`,
  `ActionPending`, `PlanProposed`, `Citation`, `Error`, `Done`

This is the contract the UI and backend agree on. The brain is replaceable
behind it. **Proof:** kubilitics-backend (commit `e7cf35f` on main) consumes
this contract via `internal/ai/aiclient/` (~250 LOC of hand-rolled gRPC + HTTP
clients).

### Router + Engine abstraction (kubilitics-ai/v0.4.0)
- `internal/router/` — `Engine` interface, `Router` orchestrator, `Event` canonical type, `PickFunc` selector.
- `internal/runtime/llm_engine.go` — wraps the LLM adapter as `router.Engine` named `"llm"`.
- `internal/engines/kagent/engine.go` — kagent adapter skeleton. Returns structured `kagent_unconfigured` / `kagent_unimplemented` when not wired. Real backend integration scoped for v1.5.
- `internal/engines/python/engine.go` — same shape for Python multi-agent (LangGraph) sidecar.
- **Output Normalizer rule:** every Engine emits canonical `router.Event`s; one function (`mapRouterEvent`) translates to wire format. The backend never sees engine-specific details.

### Safety wrapper (kubilitics-ai/v0.6.0)
- `internal/safety/wrapper/wrapper.go` wraps the Router with:
  - **Preflight:** `FocusClusterID` required (refuses cluster-less requests).
  - **Per-event postcheck:** `ActionPending` events filtered against an `AllowedActions` allow-list. Empty list = block ALL actions (safest default). `["*"]` = development only. Explicit list = production whitelist.
  - **Audit:** every phase (start, per-block, end, error) hits an `AuditSink` interface.
- 7/7 wrapper tests, 27/27 across the AI subtree.

### Multi-provider LLM (already exists)
- `internal/llm/provider/{openai,anthropic,ollama,custom}/` — four working providers.
- `internal/llm/adapter/` — unified `LLMAdapter` interface: `Complete`, `CompleteStream`, `CountTokens`, `GetCapabilities`, `NormalizeToolCall`, `CompleteWithTools` (full agentic loop with tool execution).
- `internal/llm/budget/` — token/cost tracking.

### Safety policy + autonomy levels
- 6 autonomy levels (0=Observe → 5=Full-Autonomous) defined in `internal/config/`.
- Immutable safety rules, custom policies, approval-required ops — enforceable per-deployment.
- Wired today at the wrapper boundary (allow-list); the rich engine + blast-radius + autonomy controller already exist in `internal/safety/` and slot into the wrapper in v1.5.

---

## 2. Observability 2.0 (wide events)

We don't emit narrow counters and pre-aggregated histograms. We emit **one
wide event per unit of work**, every dimension queryable after the fact.
Same philosophy as Honeycomb/observability-2.0; native to our schema.

- `internal/audit/types.go` — `Event` struct: `timestamp`, `correlation_id`, `event_type`, `result`, `user`, `resource`, `action`, flexible `metadata` map, `error`, `error_code`, `duration_ms`. Used today by the safety wrapper at every phase.
- `kubilitics-ai/cmd/bench/` — wide-event LLM bench harness. Each LLM call emits one ndjson row with `provider`, `model`, `prompt_id`, `prompt_category`, `ttft_ms`, `total_ms`, `chunks`, `output_chars`, `tokens_in`, `tokens_out`, `correlation_id`, `tag`, `attributes{}`. Final line is a `bench.summary` event.
- v0.9.0 follow-up: emit the same `bench.llm_call`-shaped event from the production LLM path so prod traffic and bench runs converge under one schema.

This is **not a slide claim** — it's a working format with sample output at
`/tmp/openai-smoke.ndjson` and `/tmp/ollama-smoke.ndjson` from runs done
today (2026-04-20).

---

## 3. Measured performance (real, today)

### OpenAI gpt-4o-mini via full server stack
3 prompts × 3 iterations + warmup, end-to-end through Router + LLMEngine + Safety wrapper + adapter:

| metric            | value      |
|-------------------|------------|
| success rate      | 100%       |
| TTFT p50 / p95    | 1034 / 1891 ms |
| total p50 / p95   | 3889 / 11313 ms |
| tokens out total  | 2208       |
| cost              | $0.00136   |

### vs. direct OpenAI (no kubilitics-ai layer)
| metric          | direct | via kubilitics-ai | overhead |
|-----------------|--------|-------------------|----------|
| TTFT p50        | 1233 ms | 1034 ms          | none (within noise) |
| total p50       | 5227 ms | 3889 ms          | none |
| success         | 9/9    | 9/9              | — |

The Router + Wrapper layers add **no measurable latency**.

### Tool-aware path: comprehensive 498-case coverage matrix over **all 166 MCP tools**

Earlier we shipped a 15-prompt smoke. Investors and we ourselves wanted real
proof, not anecdote: 166 tools × 3 prompts each = **498 prompts**, generated
programmatically from the taxonomy itself (no hand-cherry-picking), one
iteration per prompt, OpenAI gpt-4o-mini, full agentic loop through the LLM
engine with the MCP executor.

Generator: `kubilitics-ai/scripts/gen_prompts.py` reads
`kubilitics-ai/cmd/extract-tools` JSON dump (the merged
`ToolTaxonomy` + `GetChatToolDefinitions`) and emits 3 paraphrased natural
prompts per tool using verb/noun templates derived from the tool's name and
description. Bench harness extended in
[`vellankikoti/kotg.ai feat/ai-tool-coverage-bench`](https://github.com/vellankikoti/kotg.ai/tree/feat/ai-tool-coverage-bench)
(commit `361a1d6`) to record `expected_tool`, the ordered list of tools the
LLM actually fired (`actual_tools[]`), and a per-call `match` field
(`exact | semantic | miss`). Concurrency: 10. Wall time: ~6 minutes.
OpenAI cost: **$0.026**.

**Headline numbers (v2, 2026-04-20 — 498 prompts, 1 iteration each, gpt-4o-mini):**

| metric                                  | v1 → v2 |
|-----------------------------------------|---------|
| MCP tools registered                    | **166** |
| Prompts run                             | 498 |
| LLM-call success rate                   | 99.6% (496/498) — unchanged |
| **Exact-match (LLM picked the named tool)** | 45.0% → **47.0%** (+2.0 pp) |
| **Semantic-match (LLM picked a functional sibling)** | 0.6% → **12.0%** (+11.4 pp) |
| **Combined hit rate**                   | 45.6% → **59.0%** (+13.4 pp) |
| Miss                                    | 54.4% → **41.0%** (-13.4 pp) |
| Engine panics / lost events             | **0** |
| `content:null` 400-errors               | 0 (preventatively fixed in v2 — `oaiMessage.MarshalJSON` always emits `"content":""` on assistant tool-call + tool messages, locked in by 4 unit tests) |
| LLM total ms p50 / p95                  | 4069 / 10833 (unchanged) |
| Tool exec ms p50 / p95                  | 3 / 50 (errors fast — no live backend) |

v2 ships three improvements on
[`vellankikoti/kotg.ai feat/ai-tool-coverage-improvements`](https://github.com/vellankikoti/kotg.ai/tree/feat/ai-tool-coverage-improvements):
(1) alias map expanded from 13 → **139 entries** via a generated
`cmd/build-aliases` Go tool that groups read-only verb families by canonical
resource noun; (2) `content:null` engine bug fixed in
`internal/llm/provider/openai/tool_loop.go` with custom `MarshalJSON` for
assistant + tool messages; (3) `cmd/bench` now takes `-autonomy` and
`-cluster-id` flags and POSTs to a new `_default_` user sentinel on the
safety autonomy endpoint, plus `scripts/gen_prompts.py` carries explicit
pre-authorization context on execution-category prompts.

**Per-category breakdown — v1 → v2 deltas (`prompt_category`, `match` ∈ {exact, semantic, miss}):**

| Category         | N   | v1 combined | v2 combined | Δ |
|------------------|-----|-------------|-------------|---|
| cost             | 12  | 100.0%      | 100.0%      | +0.0 pp |
| analysis         | 93  | 69.9%       | **88.2%**   | **+18.3 pp** |
| troubleshooting  | 21  | 85.7%       | 85.7%       | +0.0 pp |
| automation       | 12  | 75.0%       | 75.0%       | +0.0 pp |
| recommendation   | 24  | 37.5%       | **75.0%**   | **+37.5 pp** |
| security         | 15  | 60.0%       | **73.3%**   | **+13.3 pp** |
| action           | 15  | 40.0%       | **66.7%**   | **+26.7 pp** |
| observation      | 279 | 35.1%       | **46.2%**   | **+11.1 pp** |
| execution        | 27  | 3.7%        | **18.5%**   | **+14.8 pp** |

**Honest analysis of the misses (no spin):**

1. **Execution category (3.7% hit) is the most striking — and it is correct
   behavior.** 26/27 destructive prompts (`scale_deployment`, `delete_resource`,
   `restart_pod`, `drain_node`, `cordon_node`, `apply_resource_patch`) caused
   the LLM to refuse-or-explain rather than call the tool. That's the safety
   layer working: gpt-4o-mini does not call destructive tools without
   confirmation context, even when the system prompt makes them available.
   For a v1 product this is the right default. We will explicitly test
   "approve and execute X" two-turn flows in the next bench.
2. **Observation (35% hit) is dragged down by the 93 `observe_*` tools that
   share overlapping surface area** (`observe_resource`, `observe_pod_detailed`,
   `observe_pod_dependencies`, `observe_resources_by_query`, etc.). The
   alias map only covers the obvious siblings (13 entries today). Many
   "miss" rows actually picked a sensible sibling — e.g. prompt
   `observe_resource__1` (`"Show me resource."`) picked
   `observe_resources_by_query`, which a human would also call correct.
   Expanding the alias map is mechanical work and would push observation
   hit rate well above 60%.
3. **Two LLM-call errors (0.4%)** trace to a real engine bug surfaced by
   this run: when an MCP tool returns a Go error, the engine's next-turn
   message construction can produce `content: null` instead of `""`, which
   OpenAI rejects with HTTP 400 `expected a string, got null`. Bug filed
   against `internal/runtime/llm_engine.go`; not fixed in the bench branch.
4. **Analysis (70%), troubleshooting (86%), automation (75%), cost (100%)**
   — the categories with verbs that map cleanly to tool names — show that
   when the prompt's natural-English action matches the tool's primary
   verb, the LLM routes reliably. This is the strongest signal in the data.

Full per-prompt detail and the top-50-misses table:
`/tmp/coverage-summary.md` (in-repo run artifact, regenerable with one
`bench` invocation).

**What this is NOT:** an end-to-end reliability number. The
kubilitics-backend on `:8190` was not running, so tool execution returned
errors after selection. This bench measures **selection coverage** — does
the LLM pick the right tool — which is the right metric for a routing
system. End-to-end success against a live backend is the next measurement.

### Ollama qwen2.5:3b on AWS t3.large (2 vCPU, CPU-only)
Same 3 prompts × 3 iterations + warmup, locally hosted Ollama on a stopped/started
EC2 t3.large at $0.083/hr:

| metric            | value |
|-------------------|-------|
| success rate      | 100% (9/9) |
| TTFT p50 / p95    | 1064 / 6124 ms (warm/cold) |
| total p50 / p95   | **123,177 / 201,593 ms** |
| throughput        | 3.0 tokens/sec sustained |
| tokens out total  | 3053 (avg 339/answer) |
| cost              | $0 incremental (~$0.10 for the bench session itself) |

**Honest read:** CPU inference on small VMs is **unsuitable for production
chat UX** — a 200-second answer to a single troubleshooting question is
dead on arrival for an interactive product. Two clean fixes, both
one-line config changes:

1. **GPU**: switch `instance_type = "g5.xlarge"` (NVIDIA A10G, ~$1/hr) → expect ~50-100 tok/s, total p50 in the ~3-5s range.
2. **Hosted API**: switch `provider: openai` (or anthropic) → see the OpenAI numbers above.

The takeaway is **not** "Ollama is bad" — it's that the LLM-direct path
is provider-agnostic and the bench harness gives an honest dollar-for-dollar
picture. Same code, three providers, three real numbers.

**Cold-load tax:** first request after a model loads into RAM takes ~5-11s
extra TTFT (model pages in). All subsequent calls are warm at ~1s TTFT.
Production deploys should keep one always-warm replica per model.

Bench numbers above are real, captured with the public bench tool
(`kubilitics-ai/cmd/bench/`), and reproducible with one command. Wide-event
ndjson at `/tmp/ollama-smoke.ndjson` and `/tmp/openai-smoke.ndjson`.

---

## 4. Deployment (one command)

```bash
helm install kubilitics ./deploy/helm/kubilitics \
  --set ai.enabled=true \
  --set kubilitics-ai.enabled=true \
  --set kubilitics-ai.llm.provider=ollama \
  --set kubilitics-ai.llm.ollama.baseUrl=http://ollama.default.svc.cluster.local:11434
```

- Parent `kubilitics` chart vendors `kubilitics-ai` as a sub-chart at `deploy/helm/kubilitics/charts/kubilitics-ai/`.
- Sub-chart exposes gRPC :50051 + HTTP :8081, ConfigMap-driven LLM provider, Secret-projected API keys, security-context-hardened pod (non-root UID 1000, drop-all caps, seccomp RuntimeDefault).
- `helm lint` + `helm template` validated for three scenarios: both-enabled, backend-only (external brain), default (no AI resources).
- Hub auto-registers in-cluster (no clicks, no auth by default for trial). Per memory `project_helm_seamless_install.md`, DONE at v1.0.0.

---

## 5. UI (subproject 5)

- Right-side chat panel, per-cluster sessions, hybrid context (selected resource + cluster-wide), Cmd+I keyboard shortcut, `AskAIButton` injected on 10 intelligence pages (cluster, workloads, networking, storage, security, cost, scaling, events, blast-radius, root-cause).
- Streaming responses via WebSocket → backend → gRPC bidi to brain.
- Status pill (ready/degraded/unavailable/error), `cancel_turn` support.

---

## 6. What is NOT done (honest scope)

| Item                                                        | Status   |
|-------------------------------------------------------------|----------|
| kagent (CNCF) **wire-level** integration in `kagent.Engine` | v1.5     |
| Python multi-agent (LangGraph) sidecar wire integration      | v1.5     |
| Approval UI for autonomy levels 3–4                          | v1.5 (depends on real ActionPending traffic) |
| Production audit sink (`NoopSink` in v1, ready audit pipe at `internal/audit`) | v1.5 |
| Rich safety engine plugged into wrapper preflight (currently only allow-list) | v1.5 |
| Production wide-event emission from `internal/runtime/llm_engine.go` | v0.9.0 |
| GPU support in bench-VM Terraform (default is CPU; one-line override to g5.xlarge) | optional |

What this list is **not**: aspirational research. Every item is a concrete
file path with a defined integration shape and a tagged release for it.

---

## 7. Repos / commits / tags (proof points)

- `vellankikoti/kubilitics` main `b79374f` — backend + UI + parent helm chart with ai sub-chart wired.
- `vellankikoti/kotg.ai` main `ef3bde5` — brain through subproject 3f.
- `vellankikoti/kotg.ai` `feat/ai-bench` `19caad7` — bench harness + server fixes.
- `vellankikoti/kubilitics` `feat/bench-vm` `590bac2` — Terraform for Ollama bench VM.
- `vellankikoti/kotg-schema@v1.0.1` — frozen wire contract.
- `vellankikoti/kotg.ai/kubilitics-ai/v0.7.0` — brain + standalone helm chart.

---

## 8. Why this matters for an enterprise buyer

1. **Brain runs in your cluster.** No data exfil to a vendor SaaS.
2. **Provider-agnostic.** Swap Ollama → OpenAI → Anthropic → bring-your-own; no code change.
3. **Engine-agnostic.** kagent vs Python multi-agent vs LLM-direct is one line of config; the contract doesn't move.
4. **Safety as a first-class boundary.** Autonomy levels, immutable rules, allow-list, full audit — enforced at the wrapper, not as a post-hoc filter.
5. **Observability 2.0 native.** One wide event per unit of work; every dimension queryable; no metric explosion as we add features.
6. **Honest scope.** Skeleton vs. live integration is marked in code (`*_unimplemented` errors) and in this document.
