# AI Sidecar Supervisor — Design Spec

**Date:** 2026-04-19
**Subproject:** 2 of the AI integration arc (depends on kotg-schema v1.0.1).
**Goal:** In `kubilitics-backend`, manage the lifecycle of the `kotg-ai-server` sidecar process, perform an mTLS handshake using `kotg-schema` AICapabilities, and expose capability state to the desktop app for capability-gated UI.

> Provider-agnostic by design. Choice of LLM (Ollama/OpenAI/Anthropic/etc.) is owned by subproject 4 (kotg-ai-server). See `memory/project_llm_strategy.md`.

---

## 1. Locked Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **On-demand sidecar with adaptive idle shutdown** (default 15min) | DevOps usage is bursty; zero idle overhead while AI not in use. Cold-start (~1–3s) is acceptable behind a "starting AI…" UI affordance. |
| 2 | **Bundled binary + optional `ai.binaryPath` override** | Zero-setup default matches seamless-install ethos. Override accommodates self-built binaries / dev. |
| 3 | **Capability discovery once per spawn** + manual "Refresh AI" button | Stable UI; no flicker; rare config changes restart cleanly. |
| 4 | **Per-spawn ephemeral mTLS certs (in-memory, via stdin)** | Honors the kotg-schema mTLS rule literally; zero on-disk secrets; no rotation logic; regen-on-restart matches lifecycle. |
| 5 | **One global sidecar; cluster_id required on every request** | Architect persona switches clusters constantly; per-cluster sidecars would burn RAM at scale. Schema already requires identity in metadata. **The sidecar MUST be stateless per request — no cross-cluster memory, no cross-user cache, no inferred default cluster. Chat session state is keyed strictly by `(cluster_id, user_id, session_id)`.** This is a hard requirement on subproject 4 (kotg-ai-server). |
| 6 | **Backend proxies everything (desktop never talks to sidecar)** | Single chokepoint for auth, RBAC, audit, observability, action gating. Sidecar stays bound to localhost behind mTLS only the backend holds. |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ kubilitics-backend (Go)                                         │
│                                                                 │
│  ┌──────────────┐   ┌────────────────┐   ┌─────────────────┐    │
│  │ AI HTTP/WS   │──▶│ AI Proxy       │──▶│ Sidecar         │    │
│  │ Handlers     │   │ (cluster_id    │   │ Supervisor      │    │
│  │ (desktop API)│   │  enforce + obs)│   │ (lifecycle+mTLS)│    │
│  └──────────────┘   └───────┬────────┘   └────────┬────────┘    │
│                             │                     │ exec        │
│                             ▼                     │ stdin: certs│
│                     ┌──────────────┐              │             │
│                     │ ActionGate   │              │             │
│                     │ (interface,  │              │             │
│                     │  no-op v1)   │              │             │
│                     └──────────────┘              │             │
└────────────────────────────────────────────────────┼────────────┘
                                                    ▼
                                           ┌──────────────────┐
                                           │ kotg-ai-server   │
                                           │ (gRPC, localhost,│
                                           │  ephemeral mTLS) │
                                           └──────────────────┘
```

**Flow:** desktop → backend WS → handlers → proxy (cluster_id enforce, observability) → ActionGate (no-op v1) → mTLS gRPC → sidecar.

**New backend package layout:**
- `internal/ai/supervisor/` — process lifecycle, cert mint, idle timer, crash backoff
- `internal/ai/proxy/` — gRPC client, WS↔gRPC translation, cluster_id injection
- `internal/ai/handlers/` — HTTP/WS endpoints
- `internal/ai/types/` — shared internal types (CapabilitiesSnapshot, SidecarStatus)
- `internal/ai/gate/` — ActionGate interface + NoOpGate (subproject 3 plugs the real gate)

---

## 3. Sidecar Supervisor

**State machine:** `Stopped → Starting → Ready → Stopping → Stopped`. `Crashed` is a transient state on unexpected exit (transitions to Stopped after backoff exhausted, or back to Starting on retry).

**Public API:**
```go
type Supervisor interface {
    EnsureReady(ctx context.Context) (*ReadyConn, error)  // lazy-spawns if Stopped
    GetCapabilities(ctx context.Context) (*CapabilitiesSnapshot, error)
    Refresh(ctx context.Context) error                    // soft restart for "Reload AI"
    Status() SidecarStatus                                // for /api/v1/ai/status
    IncStreams()                                          // proxy holds open streams
    DecStreams()
    CurrentSpawnID() string
    Shutdown(ctx context.Context) error                   // backend shutdown
}

type ReadyConn struct {
    Conn    *grpc.ClientConn   // mTLS to localhost:port
    SpawnID string             // changes on each spawn
}

type SidecarStatus struct {
    State            string    // "stopped" | "starting" | "ready" | "stopping" | "crashed"
    LastError        string    // last non-nil error message, if any
    RestartAttempts  int       // attempts in current window
    NextRetryAt      time.Time // zero if not retrying
    ActiveStreams    int
    CurrentSpawnID   string
    DisabledReason   string    // set when restart cap exhausted
}
```

**Spawn sequence:**
1. Mint ephemeral CA + server cert + client cert (in-memory, `crypto/x509`).
2. `exec.CommandContext(supervisorCtx, binaryPath)` with stdin pipe; sidecar reads PEM blob from stdin (length-prefixed framing header); supervisor writes CA+server-cert+server-key, then closes that side of the pipe.
3. Sidecar binds `:0` on 127.0.0.1, prints `READY <port>\n` to stdout (5s timeout → kill + Crashed). **No port-allocation race** — sidecar owns binding.
4. Supervisor dials `127.0.0.1:<port>` with mTLS using the ephemeral CA + client cert.
5. Supervisor calls `grpc.health.v1.Health/Check`; only `SERVING` → state Ready. (READY stdout signal alone is not sufficient.)
6. Supervisor calls `AIControl.GetCapabilities`, caches snapshot, transitions to Ready.
7. Start idle timer.

**Adaptive idle shutdown:** every successful proxy call resets the idle timer. Configurable via `ai.idleShutdownSeconds` (default 900). When timer fires AND `ActiveStreams == 0`, transition Stopping → SIGTERM (5s grace) → SIGKILL → Stopped.

**Crash policy:** unexpected exit → exponential backoff (1s, 2s, 4s, 8s, max 30s), capped at `ai.maxRestartAttempts` (default 5) within `ai.restartWindowSeconds` (default 300). After cap exhausted, transition to Stopped with `DisabledReason="restart_cap_exhausted"`. Next `EnsureReady` after `restartWindowSeconds` from last attempt resets the counter and retries from scratch.

**Refresh semantics:** atomic `Stopping → kill(SIGTERM, 5s grace, SIGKILL) → Stopped → reset backoff counter → next call cold-spawns`. Active streams are cleanly terminated by the proxy (DecStreams runs, WS closes with reason `spawn_changed`). The desktop chat panel shows a non-blocking toast: "AI restarted — please retry your last message." User retries; new spawn handles it.

**Binary discovery:** `ai.binaryPath` config wins → else `<executable_dir>/kotg-ai-server` → else `kotg-ai-server` on `$PATH` (last resort, logs warning).

**Context plumbing:** `exec.CommandContext` is bound to `supervisorCtx` (backend lifecycle). `EnsureReady(ctx)` honors the caller's context for the wait only — caller cancel does NOT kill the sidecar (other callers may need it).

---

## 4. Proxy

Single struct, holds a Supervisor reference and the ActionGate interface.

```go
func (p *Proxy) Chat(ctx context.Context, clusterID string, req *chatv1.ChatRequest) (chatv1.Chat_StreamClient, error) {
    if clusterID == "" {
        return nil, ErrMissingCluster
    }
    ready, err := p.supervisor.EnsureReady(ctx)
    if err != nil {
        return nil, err
    }
    spawnID := ready.SpawnID
    ctx = metadata.AppendToOutgoingContext(ctx,
        "kotg-cluster-id", clusterID,
        "kotg-user-id",    userIDFromCtx(ctx),
        "kotg-request-id", reqIDFromCtx(ctx),
    )
    p.supervisor.IncStreams()
    stream, err := p.gate.WrapChat(ctx, ready.Conn, req)
    if err != nil {
        p.supervisor.DecStreams()
        return nil, err
    }
    return wrapStream(stream, spawnID, p.supervisor), nil
}
```

**Stream cleanup is `defer`-guaranteed.** `wrapStream` registers `defer p.supervisor.DecStreams()` and a context-watcher goroutine. Single ownership: counter never leaks across client WS close, ctx cancel, sidecar Unavailable, panic recovery.

**SpawnID enforcement:** proxy stores SpawnID at stream open; on each `Recv` it checks `supervisor.CurrentSpawnID()` matches; mismatch → cancel stream with `Aborted`.

**One-shot transient retry** for unary idempotent calls only (Capabilities, ListSessions): if dial succeeds but first RPC returns `Unavailable` within 200ms, supervisor.Refresh() then retry once. Streams are NOT retried (would re-emit user message).

**Timeout boundaries:** chat stream max duration `ai.chatMaxDurationSeconds` (default 600); per-message idle `ai.perMessageIdleSeconds` (default 60). Both enforced via `context.WithDeadline` at proxy. Exceeding either closes the stream with structured reason.

**Idle timer behavior (clarified):** the per-message idle timer resets on **every** AssistantEvent received from the sidecar — not just text. Long-reasoning models that emit `ToolStart`/`ToolEnd`/`Citation` events between text chunks keep the stream alive. The 60s budget is "no event of any kind from the sidecar"; that's a real hang, not slow reasoning.

**Rate limiting (v1):** simple per-user token bucket at the proxy: `ai.rateLimitPerUserPerMin` (default 30 chat starts/min, default 60 unary calls/min). Exceeded → HTTP 429 with `Retry-After`. Bucket keyed by `userIDFromCtx`. Counters exported as `kubilitics_ai_ratelimit_dropped_total{op,user_hash}`. Action gate (subproject 3) layers richer policy on top; this is the floor.

**Observability** (every proxy call): structured log `{op, cluster_id, user_id, req_id, latency_ms, status_code, spawn_id}`, prometheus histogram `kubilitics_ai_proxy_duration_seconds{op,status}`, counter `kubilitics_ai_proxy_errors_total{op,code}`.

> LLM-level metrics — token usage per request, provider latency, model-name labels, cost per call — are emitted by the sidecar itself in **subproject 4 (kotg-ai-server)** and surfaced in dashboards in **subproject 10**. The proxy measures only the wire boundary; it has no visibility into prompt/completion tokens.

**ActionGate interface** (v1 stub; subproject 3 fills):
```go
type ActionGate interface {
    WrapChat(ctx, conn, req)         (chatv1.Chat_StreamClient, error)
    WrapAction(ctx, conn, req)       (*clusterv1.ActionResult, error)
}
type NoOpGate struct{}  // pass-through
```

---

## 5. Handlers

| Endpoint | Method | Behavior |
|---|---|---|
| `/api/v1/ai/capabilities?cluster_id=X[&warm=true]` | GET | **Read-only by default.** If `ai.enabled=false` → always `{ready:false, disabled_reason:"ai_disabled", capabilities:null}` (sidecar is never spawned, `?warm=true` is ignored). Otherwise returns cached snapshot or `{ready:false, disabled_reason:"never_started", capabilities:null}` (UI should show "Open chat to start AI"). `?warm=true` opts into a spawn. |
| `/api/v1/ai/chat?cluster_id=X` | WS upgrade | Bidi WS ↔ proxy.Chat stream. Client→server frames map to ChatRequest; server→client to AssistantEvent. **Only path that implicitly spawns the sidecar.** |
| `/api/v1/ai/status` | GET | Raw supervisor status — for desktop's "AI: Ready/Starting/Disabled" pill and for ops debugging. Global (no cluster_id). |
| `/api/v1/ai/refresh` | POST | Calls `Supervisor.Refresh()`; returns 202 with new spawn_id once Ready. Global. |

All endpoints require an authenticated user. Cluster-scoped endpoints reject missing `cluster_id` with HTTP 400 immediately, no default. WS frames use a JSON envelope `{type, payload}` matching `AssistantEvent` oneof variants. Strict schema validation; unknown `type` → close with `1003 Unsupported Data`. Reuses kubilitics-backend's existing WebSocket helper (same one used for terminal streams).

---

## 6. Desktop (Frontend) Integration

**One React Query hook:**
```ts
useAICapabilities(clusterId): { ready: boolean, capabilities: AICapabilities | null, disabledReason: string }
```

Backed by `GET /api/v1/ai/capabilities?cluster_id=X` (read-only; no spawn).

**Status pill** (header or chat panel) subscribes to `/api/v1/ai/status` polling. **Adaptive cadence:**
- `Starting`: 1s
- `Ready`: 5s
- `Stopped`: 10s
- `Crashed` / `Disabled`: exponential backoff to 30s

**UI gating rule:** chat panel + Action Templates menu are hidden unless `useAICapabilities(...).ready === true`. When `disabledReason` is set, show a small banner with an actionable message:

| `disabledReason` | Banner message | CTA |
|---|---|---|
| `ai_disabled` | "AI is disabled in this deployment." | none |
| `never_started` | "AI is ready. Open chat to start." | "Open chat" → focuses panel |
| `restart_cap_exhausted` | "AI failed to start after multiple attempts." | "Retry" → POST `/refresh` |
| `spawn_changed` (toast) | "AI restarted — please retry your last message." | none |

---

## 7. Configuration

Added to existing kubilitics-backend config:

```yaml
ai:
  enabled: false              # feature flag; default off until subprojects 3-6 ship
  binaryPath: ""              # bundled default
  idleShutdownSeconds: 900
  chatMaxDurationSeconds: 600
  perMessageIdleSeconds: 60
  maxRestartAttempts: 5
  restartWindowSeconds: 300
  rateLimitPerUserPerMin: 30   # chat-start floor; subproject 3 layers richer policy
```

Same block exposed in `deploy/helm/kubilitics/values.yaml` with identical defaults.

---

## 8. Testing

| Layer | What | How |
|---|---|---|
| **Unit** | cert minting, state machine transitions, idle timer math, backoff calc, WS frame validation | pure Go tests with `testing` + `testify`; no exec, no net |
| **Supervisor integration** | full spawn↔shutdown lifecycle | use `examples/stub_chat_server` from kotg-schema as the `kotg-ai-server` stand-in; pass via `binaryPath`; assert state machine sequence + cert handshake |
| **Proxy integration** | metadata injection, SpawnID guard, stream cancellation, NoOpGate call-through | spin up real supervisor + stub sidecar in-process; drive proxy methods; assert metadata received by stub |
| **Handler integration** | HTTP+WS endpoints end-to-end | `httptest.Server` + `gorilla/websocket` client; happy-path per endpoint; missing-cluster_id → 400; sidecar Unavailable → 503 |
| **Crash/recovery integration** | stub sidecar exits mid-stream → backoff schedule observed, retry attempts capped, status surfaces correctly | stub binary that `os.Exit(1)`s on signal from test |

**No E2E with real LLM in this subproject.** kotg-ai-server isn't built yet (subproject 4); the stubs from kotg-schema cover the wire contract completely. Real-LLM E2E lives with kotg-ai-server's own tests, validated against Ollama (dev/scale) and OpenAI+Claude (final quality).

---

## 9. Rollout

1. **Build behind feature flag.** All AI handlers gated on `ai.enabled` (default `false`). Merging to main is safe — UI shows nothing AI-related when disabled.
2. **Internal dogfood.** Flip `ai.enabled=true` on a local dev cluster only. Ship the stub sidecar binary in the dev build so the supervisor can spawn something real. Validate state pill, capability surfacing, refresh button.
3. **Wait for kotg-ai-server (subproject 4).** Real binary lands; bundling step in build pipeline starts copying it next to the backend binary in both Tauri sidecar and Helm image.
4. **Helm chart values exposure.** `ai.*` block in `values.yaml` mirroring backend config. Default `ai.enabled: false` until subprojects 3–6 are merged.
5. **Beta tag.** First public release with `ai.enabled: true` is `v1.x.0-beta.1` per the freeze rule (push only to `vellankikoti/kubilitics`, never to org repo).

---

## 10. Out of Scope (Other Subprojects)

| Concern | Subproject |
|---|---|
| Real LLM provider wiring (Ollama / OpenAI / Anthropic) | 4 — kotg-ai-server |
| Action approval UX + audit trail (fills the ActionGate) | 3 — Action Gateway |
| Chat panel UI (the consumer of the WS endpoint) | 5 — Chat Panel UI |
| Action approval flow UI | 6 |
| Tauri sidecar packaging glue (binary embed) | 7 |
| Helm sub-chart for the AI binary | 8 |
| Cost/token observability dashboards | 10 |
| AI safety depth (jailbreak resistance, content filtering) | v1.5 (deferred per AI integration spec) |
