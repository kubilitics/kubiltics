# Backend ↔ kubilitics-ai Integration — Design Spec

**Date:** 2026-04-19
**Subproject:** 3a — Backend integration layer + `agent_runtime.proto` definition. First slice of the corrected AI integration arc that replaces the abandoned subprojects 3 (Action Gateway as standalone) and 4 (kotg-ai-server as primary path).

**Goal:** Wire `kubilitics-backend` to talk to the existing `kubilitics-ai` brain (in the kotg.ai monorepo) via a clean hybrid contract — gRPC for streaming AI events, HTTP for control-plane queries. Define `agent_runtime.proto` as the new typed contract for the backend→AI direction (the existing `cluster_data.proto` only covers the AI→backend direction). Retire the parallel re-implementations (`kotg-schema`, `kotg-ai-server`, AI supervisor) that we built before realizing kubilitics-ai already existed.

> **Context (the hard reset):** During subproject 3 brainstorming we discovered that `vellankikoti/kotg.ai/kubilitics-ai/` (148 Go files, ~2 MB) already implements: 5-level autonomy controller, safety engine (policy + blastradius + rollback), MCP server with tools (observation/analysis/execution/recommendation), reasoning engine, three LLM providers (Anthropic/Ollama/custom), HTTP+WS server, audit/cost/security/analytics pipelines. The minimal kotg-ai-server v0.1.0 we shipped is a junior re-implementation of one slice. The corrected mental model: **kubilitics-ai is the brain; kubilitics-backend is the integration + governance + control plane; kagent is one execution engine kubilitics-ai dispatches to internally**.

---

## 1. Locked Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **kubilitics-ai runs as an in-cluster pod (Helm sub-chart)** | Matches kagent's K8s-native deployment; supports HPA + PDB + network policies; too heavy for desktop bundle (Python multi-agent + MCP + Qdrant + Kuzu). Desktop dev runs local cluster + Helm install — same pattern as everything else in kubilitics. |
| 2 | **Hybrid wire contract: gRPC for streaming/data plane, HTTP for control plane** | CNCF pattern (Kubernetes, Istio, Argo all do this). Streaming AI events fit gRPC bidi; status/capabilities/audit queries fit REST. |
| 3 | **kagent dispatched by kubilitics-ai's internal Router as one execution engine among LLM-direct + Python-multi-agent** | Preserves kubilitics-ai as the brain. kagent is a runner, not the master. The Router's "best engine per request" decision lives inside kubilitics-ai. |
| 4 | **NEW `agent_runtime.proto` defines the backend→AI direction** | Existing `cluster_data.proto` covers only AI→backend (kubilitics-ai pulling cluster state). The backend→AI direction (chat, agent runs, capabilities) had no formal contract. New proto adds it cleanly. |
| 5 | **Output Normalizer contract: `AIEvent` proto** | All three engines (LLM, Python, kagent) MUST emit identical `AIEvent` streams. Backend never sees which engine ran. This is the true API contract — locked once. |

---

## 2. Architecture (corrected)

```
┌──────────────────────────────────────────────────────────────────┐
│  Desktop / Browser UI (chat panel — already shipped, unchanged)  │
└─────────────────────┬────────────────────────────────────────────┘
                      │ REST + WS (unchanged)
┌─────────────────────┴────────────────────────────────────────────┐
│  kubilitics-backend (Go)                                         │
│  ─────────────────────────                                       │
│  Existing: auth, RBAC, audit, multi-cluster control plane.       │
│                                                                  │
│  New AI integration layer (this subproject):                     │
│   - aiclient.GRPCClient → AgentRuntimeService (chat / runs)      │
│   - aiclient.HTTPClient → control endpoints (status / caps)      │
│   - WS chat handler proxies AIEvent stream → existing UI frames  │
│   - Smart gateway: enriches with cluster_id/user_id, RBAC checks │
│  Retired: AI supervisor (mTLS+stdin+exec+idle), kotg-schema dep. │
└─────────────────────┬────────────────────────────────────────────┘
                      │ gRPC (data) + HTTP (control)
                      │ kubilitics-ai.<ns>.svc:50051 / :8080
┌─────────────────────┴────────────────────────────────────────────┐
│  kubilitics-ai (Go, in-cluster pod, vellankikoti/kotg.ai)        │
│  ─────────────────────────────────────────                       │
│  Already-built: Safety Engine, MCP, reasoning, LLM providers,    │
│  audit, cost, security, analytics, multi-cluster awareness.      │
│                                                                  │
│  New for this subproject:                                        │
│   - implements AgentRuntimeService (the new proto)               │
│   - thin handler that today routes everything to LLM-direct      │
│     (Router/Normalizer/Python/kagent are 3b-3e, NOT this spec)   │
│                                                                  │
│  Existing: HTTP+WS server (becomes control-plane endpoints),     │
│  cluster_data.proto gRPC (AI ← backend, unchanged).              │
└──────────────────────────────────────────────────────────────────┘
```

**Hard rules (still locked from brainstorm):**
- Backend never sees which engine ran. Output Normalizer = `AIEvent` proto.
- Safety engine wraps every dispatch. kagent doesn't bypass it (3e wires this; 3a stub leaves a hook).
- kagent runs alongside kubilitics-ai in cluster. Backend talks ONLY to kubilitics-ai. (3c integrates kagent.)

---

## 3. The new proto: `agent_runtime.proto`

Lives at `vellankikoti/kotg.ai/kubilitics-ai/api/proto/v1/agent_runtime.proto`. Generated Go committed alongside `cluster_data.pb.go`.

```proto
syntax = "proto3";

package kubilitics.ai.v1;

option go_package = "github.com/kubilitics/kubilitics-ai/api/proto/v1;aiv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/empty.proto";

// ─── AgentRuntimeService ─────────────────────────────────────────────────
// The single service kubilitics-backend calls to invoke AI capabilities.
// Streaming RPCs MUST emit AIEvent frames (the Output Normalizer contract).
service AgentRuntimeService {
  // Chat is a bidirectional stream. Client sends ChatRequest frames
  // (initially CreateSession or UserMessage), server emits AIEvent frames.
  rpc Chat(stream ChatRequest) returns (stream AIEvent);

  // RunAgent invokes a named agent (kagent CRD name OR built-in agent ID)
  // for non-conversational, fire-and-collect workflows.
  rpc RunAgent(stream AgentRequest) returns (stream AIEvent);

  // CancelTurn aborts a streaming Chat or RunAgent operation server-side.
  rpc CancelTurn(CancelRequest) returns (google.protobuf.Empty);

  // Capabilities returns what the kubilitics-ai instance can do — which
  // engines are available, which providers are configured, autonomy
  // policy in effect.
  rpc Capabilities(google.protobuf.Empty) returns (CapabilitiesResponse);
}

// ─── ChatRequest (bidi input) ────────────────────────────────────────────
message ChatRequest {
  oneof request {
    CreateSession create = 1;
    UserMessage   message = 2;
  }
}

message CreateSession {
  string focus_cluster_id = 1;
  string user_id = 2;
  string title = 3;       // optional
}

message UserMessage {
  string session_id = 1;
  string turn_id = 2;
  string text = 3;
  string context_hint = 4;  // serialized JSON — current page, resource being viewed
}

// ─── AgentRequest (bidi input for RunAgent) ──────────────────────────────
message AgentRequest {
  oneof request {
    AgentInvoke invoke = 1;
    AgentInput  input = 2;
  }
}

message AgentInvoke {
  string agent_id = 1;       // e.g. "diagnose-pod", "kagent:my-agent"
  string focus_cluster_id = 2;
  string user_id = 3;
  string trace_id = 4;
  map<string, string> parameters = 5;
}

message AgentInput {
  string run_id = 1;
  string text = 2;            // for agents that take iterative input
}

message CancelRequest {
  oneof target {
    string session_id = 1;    // cancels active turn in a Chat session
    string run_id = 2;        // cancels a RunAgent invocation
  }
}

// ─── AIEvent — THE OUTPUT NORMALIZER CONTRACT ────────────────────────────
// Every engine (LLM-direct, Python multi-agent, kagent) emits this exact
// shape. Backend / UI never sees engine-specific details.
message AIEvent {
  string anchor_id = 1;
  google.protobuf.Timestamp emitted_at = 2;
  // schema_version locks the AIEvent contract version. Backend MUST refuse
  // to forward events whose schema_version is incompatible with what it was
  // built against. Bumped on any oneof addition/removal/renumbering.
  string schema_version = 99;

  oneof event {
    TextDelta      text_delta      = 10;
    ToolStart      tool_start      = 11;
    ToolEnd        tool_end        = 12;
    ActionPending  action_pending  = 13;
    PlanProposed   plan_proposed   = 14;
    Citation       citation        = 15;
    Done           done            = 16;
    ErrorEvent     error_event     = 17;
    SessionCreated session_created = 18;  // emitted in response to CreateSession
  }
}

message TextDelta {
  string text = 1;
}

message ToolStart {
  string tool_call_id = 1;
  string tool_name = 2;
  string preview = 3;
}

message ToolEnd {
  string tool_call_id = 1;
  bool ok = 2;
  string preview = 3;
}

message ActionPending {
  string proposal_id = 1;
  ActionTier tier = 2;
  string action_type = 3;       // "scale" | "rollout_restart" | "delete_pod" | ...
  string target = 4;            // e.g. "deployment/api-server"
  string dry_run_preview = 5;
  bytes  payload_json = 6;      // engine-opaque structured payload
  google.protobuf.Timestamp expires_at = 7;
}

enum ActionTier {
  ACTION_TIER_UNSPECIFIED = 0;
  ACTION_TIER_LOW = 1;
  ACTION_TIER_MEDIUM = 2;
  ACTION_TIER_HIGH = 3;
}

message PlanProposed {
  string plan_id = 1;
  string summary = 2;
  int32 step_count = 3;
}

message Citation {
  string assistant_text_anchor_id = 1;
  string tool_call_id = 2;
  string short_label = 3;
}

message Done {
  bool cancelled = 1;
  bool partial = 2;
  int32 prompt_tokens = 3;
  int32 completion_tokens = 4;
  string engine_used = 5;        // INTERNAL ONLY — backend strips before forwarding to UI
  int64 total_latency_ms = 6;
}

message ErrorEvent {
  string code = 1;
  string message = 2;
}

message SessionCreated {
  string session_id = 1;
}

// ─── CapabilitiesResponse ────────────────────────────────────────────────
message CapabilitiesResponse {
  string schema_version = 1;       // matches the agent_runtime.proto release
  string ai_version = 2;           // kubilitics-ai release
  repeated string engines = 3;     // ["llm", "python_multi_agent", "kagent"] (only ones available)
  repeated string providers = 4;   // ["openai", "anthropic", "ollama"]
  repeated string models = 5;
  AutonomyLevel autonomy_level = 6;
  bool supports_undo = 7;
  bool supports_plans = 8;
  repeated string allowed_actions = 9;  // policy whitelist, e.g. ["scale", "rollout_restart"]
}

enum AutonomyLevel {
  AUTONOMY_UNSPECIFIED = 0;
  AUTONOMY_OBSERVE = 1;
  AUTONOMY_RECOMMEND = 2;
  AUTONOMY_PROPOSE = 3;
  AUTONOMY_ACT_WITH_GUARD = 4;
  AUTONOMY_FULL = 5;
}
```

**Notes:**
- `Done.engine_used` is internal. The single rule: **only the WS-frame adapter at `internal/ai/handlers/chat.go`** strips it before forwarding to the chat panel. Every other code path that touches an `AIEvent` (logging, audit, metrics) is allowed to read it. No other component is permitted to write `AIEvent`s out to UI clients — enforced by lint rule (`engine_used` reference outside the chat handler triggers a CI failure).
- `AIEvent.schema_version`: backend's WS adapter checks this on every received event. Mismatch → log + emit `ErrorEvent{code:"SchemaVersionMismatch"}` to the UI + close the stream. Prevents subtle silent breakage when kubilitics-ai upgrades the proto.
- This proto is the contract. Every engine adapter (LLM, Python, kagent) maps its native output to `AIEvent`.

---

## 4. Backend changes (this subproject's actual work)

### 4.1 New: `internal/ai/aiclient/`

```go
// aiclient/grpc.go
type GRPCClient struct {
    conn   *grpc.ClientConn          // single long-lived conn (gRPC multiplexes)
    client aiv1.AgentRuntimeServiceClient
    addr   string                     // "kubilitics-ai.<ns>.svc:50051"
    state  ConnectionState            // idle | connecting | open | error
    mu     sync.Mutex
}

func NewGRPCClient(addr string, opts ClientOpts) *GRPCClient
func (c *GRPCClient) Chat(ctx, opts) (aiv1.AgentRuntimeService_ChatClient, error)
func (c *GRPCClient) RunAgent(ctx, opts) (aiv1.AgentRuntimeService_RunAgentClient, error)
func (c *GRPCClient) Capabilities(ctx) (*aiv1.CapabilitiesResponse, error)
func (c *GRPCClient) CancelTurn(ctx, sessionOrRunID) error
func (c *GRPCClient) Close() error
func (c *GRPCClient) State() ConnectionState
```

**Resilience policy (locked, not configurable in v1):**

```go
type ClientOpts struct {
    DialTimeout       time.Duration  // default 5s — fail fast if Service DNS unresolvable
    UnaryTimeout      time.Duration  // default 10s — Capabilities, CancelTurn
    StreamIdleTimeout time.Duration  // default 90s — abort if no AIEvent received in window
    StreamMaxDuration time.Duration  // default 600s — hard cap on a single Chat/RunAgent stream
    ReconnectBackoff  []time.Duration // 1s, 2s, 4s, 8s, 16s, 30s (max), repeat 30s
    ReconnectMaxAttempts int          // default 10 within a 5min window; after that, surface error to UI
    KeepaliveTime     time.Duration  // default 20s — gRPC keepalive ping
    KeepaliveTimeout  time.Duration  // default 10s — close conn if no pong
}
```

**Retry rules:**
- **Unary RPCs (`Capabilities`, `CancelTurn`):** retried once on `Unavailable` after `min(2*attempt-1 s, 8s)` backoff.
- **Streaming RPCs (`Chat`, `RunAgent`):** NOT auto-retried. Stream failure → emit `ErrorEvent` to UI; user re-invokes via the chat panel's existing retry affordance. Auto-retry on a streaming chat would re-send the user's prompt and double-bill tokens.
- **Connection-level:** the underlying `grpc.ClientConn` auto-reconnects per the `ReconnectBackoff` schedule. State changes (`open` → `error` → `connecting` → `open`) propagate through `setConnectionState` so the chat panel's status pill updates within ~1s.

```go
// aiclient/http.go
type HTTPClient struct {
    base string                       // "http://kubilitics-ai.<ns>.svc:8080"
    http *http.Client
}

func NewHTTPClient(base string) *HTTPClient
func (c *HTTPClient) GetStatus(ctx) (*Status, error)
func (c *HTTPClient) GetAudit(ctx, filter) ([]AuditEntry, error)
// Capabilities is gRPC (it's part of AgentRuntimeService); HTTP covers
// only kubilitics-ai's internal control endpoints (audit queries,
// cost dashboards, etc.) where REST is the natural fit.
```

### 4.2 Rewired: `internal/ai/handlers/chat.go`

Existing WS handler kept; only the source of events changes:

```go
// Before (subproject 2):
//   ws → proxy.Chat() → supervisor → spawned binary mTLS gRPC → AssistantEvent
// After (this subproject):
//   ws → proxy.Chat() → aiclient.GRPCClient.Chat() → AgentRuntimeService → AIEvent

// The WS frame mapper changes its input type from kotgv1.AssistantEvent to
// aiv1.AIEvent. Output WS frames `{type, payload}` stay identical.
```

### 4.3 Rewired: `internal/ai/handlers/{status,capabilities,sessions,refresh}.go`

- `GET /api/v1/ai/status` → calls `aiclient.HTTPClient.GetStatus()` (kubilitics-ai exposes /status)
- `GET /api/v1/ai/capabilities` → calls `aiclient.GRPCClient.Capabilities()` (it's part of the gRPC service)
- `POST /api/v1/ai/sessions` → opens a Chat stream, sends `CreateSession`, reads back `SessionCreated`, returns the session_id
- `POST /api/v1/ai/refresh` → drops + recreates the gRPC ClientConn (no-op for in-cluster gRPC, but kept for API stability)

### 4.4 Retired: `internal/ai/supervisor/`, `internal/ai/certs/`, NoOpGate

Move to `internal/ai/_archived/` with a README explaining the rewrite. Keep the code visible (recovery floor) but exclude from build via a `//go:build never` tag at the top of each file. The proxy chokepoint stays — only the underlying transport changes.

### 4.5 Retired: `kotg-schema` import

Remove `github.com/vellankikoti/kotg-schema` from `go.mod`. Replace with `github.com/kubilitics/kubilitics-ai/api/proto/v1` (the new aiv1 package generated from agent_runtime.proto).

---

## 5. kubilitics-ai changes (just the contract, not the brain)

The Router/Normalizer/Python/kagent integration is subprojects 3b-3e. **3a (this spec) is the absolute minimum kubilitics-ai needs to expose to make backend integration testable**:

- Add `api/proto/v1/agent_runtime.proto` (the file from §3 above)
- Generate Go code → `api/proto/v1/agent_runtime.pb.go` + `agent_runtime_grpc.pb.go`
- New `internal/runtime/server.go` that implements `AgentRuntimeService`. v1 stub:
  - `Chat`: routes everything to LLM-direct path (existing `internal/llm/provider/`); emits `TextDelta` events; sends `Done` at end
  - `RunAgent`: returns `Unimplemented` (subprojects 3c/3d implement)
  - `Capabilities`: returns honest static values (`engines: ["llm"]`, current providers, autonomy_level from config)
  - `CancelTurn`: returns OK (no-op in stub)
- HTTP handler `/status` returns minimal JSON `{state, version}` so backend's HTTPClient has something real to call

This is the absolute thinnest end-to-end vertical: backend → gRPC → kubilitics-ai LLM direct → token stream back. Subsequent subprojects (3b Router + Normalizer, 3c kagent, 3d Python multi-agent, 3e Safety wiring) layer on top without changing the contract.

---

## 6. Configuration

Backend `cfg.AI` extended (additive, defaults preserve current behavior):

```yaml
ai:
  enabled: false                    # existing — feature flag
  # Replaces all the supervisor-era spawn config:
  endpoint: "kubilitics-ai.kubilitics.svc:50051"   # gRPC
  http_endpoint: "http://kubilitics-ai.kubilitics.svc:8080"  # control
  request_timeout_seconds: 30
  max_concurrent_streams: 50
  rate_limit_per_user_per_min: 30   # existing — kept

  # All the supervisor fields are removed:
  #   binary_path, idle_shutdown_seconds, max_restart_attempts,
  #   restart_window_seconds, provider, model, api_key_env,
  #   chat_max_duration_seconds, per_message_idle_seconds
  # — those moved to kubilitics-ai's own config.
```

Helm values mirror this. The supervisor-era env var block (`KUBILITICS_AI_BINARY_PATH`, etc.) is removed; replaced with `KUBILITICS_AI_ENDPOINT` / `KUBILITICS_AI_HTTP_ENDPOINT`.

---

## 7. Testing

| Layer | What | How |
|---|---|---|
| **Unit** | aiclient retry/reconnect logic, AIEvent → WS-frame mapper | pure Go, mocked gRPC stub |
| **gRPC integration** | end-to-end Chat stream against a stub `AgentRuntimeService` | `bufconn` (in-process gRPC) — fast, no network |
| **Stub kubilitics-ai** | A minimal Go binary that implements `AgentRuntimeService` returning canned `AIEvent` sequences. Used by backend tests + manual smoke. | Lives in `kubilitics-backend/internal/ai/aiclient/testdata/stub-kubilitics-ai/` (mirrors how subproject 2 had a stub sidecar) |
| **Handler integration** | WS chat happy path; missing cluster_id 400; unknown session 404; `error` frame propagation | `httptest.Server` + `gorilla/websocket` client, talking to backend talking to bufconn-stubbed AI |
| **Capabilities integration** | `/api/v1/ai/capabilities` returns honest values from stub | httptest |
| **Manual smoke** | Spin up real kubilitics-ai (Helm install or `go run` in kotg.ai repo), backend connects, chat panel works end-to-end with Ollama | documented in README |

CI runs only the bufconn-stubbed tests. Real kubilitics-ai smoke is manual.

---

## 8. Rollout

1. **Build behind same `ai.enabled` feature flag.** No user-visible change until the flag flips.
2. **Define `agent_runtime.proto` in kotg.ai repo + commit generated Go.** Tag `kubilitics-ai v0.2.0` (or whatever the next version is) so backend's `go get` resolves.
3. **Backend rewires.** Supervisor archived; aiclient added; tests pass against bufconn stub.
4. **Manual smoke.** Run kubilitics-ai locally (`cd kotg.ai/kubilitics-ai && go run ./cmd/server/`), backend points at it via env vars, chat panel works.
5. **Helm chart.** Add kubilitics-ai sub-chart (Deployment + Service + ConfigMap) to `kubilitics/deploy/helm/kubilitics/`. Single `helm install` brings up backend + kubilitics-ai together.
6. **Beta tag.** `v1.x.0-beta.2` on `vellankikoti/kubilitics` once smoke passes. Per the freeze rule: never push to kubilitics/* org repo.

---

## 9. Disposition Summary (what we did before — what happens now)

| Built earlier | Decision | Action |
|---|---|---|
| `vellankikoti/kotg-schema` v1.0.1 | **Archive** | Add ARCHIVED.md to repo. Keep public release alive (don't break existing go.mod refs). New work uses kubilitics-ai's `agent_runtime.proto`. |
| `vellankikoti/kotg-ai-server` v0.1.0 | **Archive** | Same. Optional future revival as "AI lite" mode for users without kubilitics-ai install — not v1. |
| `kubilitics-backend/internal/ai/supervisor/` | **Retire from build** | Move to `_archived/` with `//go:build never`. Keep visible. |
| `kubilitics-backend/internal/ai/certs/` | **Retire from build** | Same. mTLS-from-stdin not needed for in-cluster gRPC. |
| `kubilitics-backend/internal/ai/gate/` (NoOpGate) | **Retire** | Safety lives in kubilitics-ai. Remove the package. |
| `kubilitics-backend/internal/ai/proxy/` | **Keep, refactor** | The chokepoint pattern (cluster_id enforce, metadata, observability, rate limit) survives. Underneath: gRPC client instead of supervisor. |
| `kubilitics-backend/internal/ai/handlers/` | **Keep, rewire** | WS handler drives from gRPC stream; status/capabilities/sessions/refresh re-target to aiclient. |
| `kubilitics-backend` chat panel UI (subproject 5) | **Keep entirely** | Speaks `{type, payload}` WS frames — UI doesn't see the transport change. |
| Tests for retired components | **Move to _archived** | Don't run; keep as historical reference. |

---

## 10. Out of Scope (Subsequent Subprojects)

| Concern | Subproject |
|---|---|
| Router (best-engine-per-request dispatcher inside kubilitics-ai) | 3b |
| kagent integration adapter (one of the engines the Router dispatches to) | 3c |
| Python multi-agent integration (LangGraph + RAG + Kuzu) | 3d |
| Safety engine wiring (preflight + postcheck around every dispatch) | 3e |
| Helm sub-chart for kubilitics-ai + kagent installed together | 3f |
| Approval UI for autonomy levels 3-4 (replaces old approve/reject button plan) | 3g |
| Cost / token observability dashboards | 10 (deferred) |
| MCP tool registry curation (kagent ships ~14 tools; we expose a subset) | TBD |

---

## 11. Open Questions for the Reviewer

1. **Where does `agent_runtime.proto` live ultimately?** Currently scoped to `vellankikoti/kotg.ai/kubilitics-ai/api/proto/v1/`. If kubilitics-ai gets extracted to its own repo eventually, the proto moves too. For 3a, the kotg.ai monorepo is fine.

2. **Versioning policy for the proto.** Suggest: same as kubilitics-ai itself (`v0.2.0`, `v0.3.0`, ...). Breaking changes require a major bump and a buf-breaking-check CI. Defer to a small follow-up task; don't gate 3a on it.

3. **kubilitics-ai's HTTP server is currently a grab-bag** (`handlers_*.go` for cost/security/persistence/memory/topology_ai/wizards/analytics). 3a only consumes `/status`. Future subprojects will need to consume more — the cleanup of those handlers is its own subproject (TBD).
