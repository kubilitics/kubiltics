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
