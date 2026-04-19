# kotg-ai-server v1 — Design Spec

**Date:** 2026-04-19
**Subproject:** 4 of the AI integration arc.
**Goal:** Build a minimal, production-grade Go binary at `vellankikoti/kotg-ai-server` that the kubilitics-backend supervisor (subproject 2) exec's to provide LLM-backed chat. Speaks the kotg-schema v1.0.1 gRPC contract, supports Ollama (primary) + OpenAI + Anthropic via native Go SDKs, streams responses back. **No multi-agent, no MCP, no RAG, no graph DB, no memory.** Validates the full vertical slice (UI → backend → supervisor → kotg-ai-server → LLM → streaming response) before adding intelligence depth.

> The Python-based `kotg/` multi-agent stack in the kotg.ai repo is **not** v1. v2+ may introduce it as an optional Python sidecar behind this Go binary's wire contract. v1 stays pure Go for packaging simplicity (single binary, Tauri sidecar friendly, Helm-container friendly).

---

## 1. Locked Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **New repo `vellankikoti/kotg-ai-server`** | Honors the freeze rule (no kubilitics/* org pushes); matches kotg-schema repo precedent; tags binary independently of the kotg.ai monorepo's Python work. |
| 2 | **Native Go SDKs per provider (Ollama, OpenAI, Anthropic)** | Pure-Go binary; no Python runtime; full provider features. Three small Event mappers vs three SDKs is a fair trade. |
| 3 | **CLI flags + env vars for provider config** | Uniform across Tauri (env from OS) and Helm (env from Secret refs); API keys never in argv (only env-var *names* passed); ps-debuggable. |
| 4 | **Stateless chat — no server-side session storage** | Sidecar lifecycle is ephemeral (idle shutdown 15min); desktop already owns transcript; all three providers accept full message history natively. Token-budget guard trims oldest history. |
| 5 | **K8s-aware baked-in system prompt** | Product positioning is "the AI that knows your cluster"; portable across providers; no config fragility for v1 demo. Single `BuildSystemPrompt(clusterID)` function — A/B testable later. |

---

## 2. Architecture

```
                      ┌────────────────────────────────────────┐
                      │ kotg-ai-server (Go)                    │
                      │                                        │
   stdin (PEM blob) ──▶ certs framing                          │
                      │                                        │
                      │  ┌──────────────┐  ┌──────────────┐    │
   gRPC mTLS over ◀──▶│  AIControl    │  │  Chat Send   │    │
   127.0.0.1:<port>   │  Capabilities │  │  bidi stream │    │
                      │  └──────────────┘  └──────┬───────┘    │
                      │  + grpc.health.v1.Health  │            │
                      │                           │            │
                      │                  ┌────────▼────────┐   │
                      │                  │ Provider iface  │   │
                      │                  │ ChatStream(ctx, │   │
                      │                  │   msgs) → chan  │   │
                      │                  └────────┬────────┘   │
                      │                           │            │
                      │      ┌────────────────────┼────────────┼─────┐
                      │      ▼                    ▼            ▼     │
                      │  Ollama              OpenAI        Anthropic │
                      └──────────────────────────────────────────────────┘
```

**Lifecycle:** supervisor exec's binary → reads certs from stdin (length-prefixed framing per `internal/ai/certs/mint.go` from subproject 2) → binds 127.0.0.1:0 → flushes `READY <port>\n` to stdout **only after bind succeeds** → serves grpc-health + AIControl + Chat until SIGTERM. On SIGTERM: stop accepting new requests, close in-flight streams cleanly, exit.

**Repo:** `github.com/vellankikoti/kotg-ai-server`. Default branch `main`. Module path matches.

**Package layout** (each file ≤300 LOC):

| Path | Responsibility |
|---|---|
| `cmd/kotg-ai-server/main.go` | Flag parsing, config validation (fail-fast), cert read from stdin, server bootstrap, signal handling |
| `internal/server/server.go` | gRPC server registration (Health + AIControl + Chat) |
| `internal/server/aicontrol.go` | `AIControl.Capabilities` handler — returns honest capabilities snapshot |
| `internal/server/chat.go` | `Chat.Send` bidi handler — accumulates UserMessages, builds prompt, streams provider events back as AssistantEvents |
| `internal/server/budget.go` | `TrimToBudget(msgs, max)` — drops oldest user/assistant pairs to fit token budget |
| `internal/server/budget_test.go` | unit tests |
| `internal/provider/provider.go` | `Provider` interface, `Config`, `Message`, `Event`, `New(cfg)` factory |
| `internal/provider/errors.go` | error sentinels + classification → gRPC code mapping |
| `internal/provider/ollama/ollama.go` | Ollama native-SDK adapter |
| `internal/provider/ollama/ollama_test.go` | httptest-mocked Ollama |
| `internal/provider/openai/openai.go` | OpenAI native-SDK adapter |
| `internal/provider/openai/openai_test.go` | httptest-mocked OpenAI |
| `internal/provider/anthropic/anthropic.go` | Anthropic native-SDK adapter |
| `internal/provider/anthropic/anthropic_test.go` | httptest-mocked Anthropic |
| `internal/prompt/prompt.go` | `BuildSystemPrompt(clusterID)` + base template (single string) |
| `internal/transport/stdin.go` | Cert-blob reader (mirrors kubilitics-backend's `internal/ai/certs/mint.go:ReadStdinBlob` framing) |
| `internal/transport/ready.go` | READY-line writer (binds first, flushes stdout after) |

---

## 3. Provider Interface

```go
// internal/provider/provider.go
package provider

import (
    "context"
    "fmt"
)

type Config struct {
    Type     string // "ollama" | "openai" | "anthropic"
    Endpoint string // base URL
    Model    string // provider-specific model id
    APIKey   string // resolved from --api-key-env at startup; never logged
}

type Message struct {
    Role    string // "system" | "user" | "assistant"
    Content string
}

// Provider streams completions for a chat conversation.
//
// Contract:
//   - ChatStream returns a receive channel; provider closes it exactly
//     once on success, error, or ctx cancellation.
//   - Provider MUST stop emitting events immediately when ctx is
//     cancelled (no goroutine leaks).
//   - Channel is buffered (16) to prevent blocking the provider goroutine.
//   - Stream emits one or more KindTextDelta events, then exactly one
//     terminal event (KindDone OR KindError), then closes.
//   - No events are emitted after the terminal event.
//   - Providers MUST NOT log API keys or full prompts.
type Provider interface {
    ChatStream(ctx context.Context, msgs []Message) (<-chan Event, error)
    // Close releases provider resources (HTTP clients, in-flight streams).
    // Idempotent. Safe to call multiple times.
    Close() error
}

type Event struct {
    Kind  EventKind
    Text  string  // for KindTextDelta
    Error error   // for KindError; classified per errors.go
}

type EventKind int

const (
    KindTextDelta EventKind = iota
    KindDone
    KindError
)

// New validates config and returns a configured provider. Fails fast on
// invalid type, empty model, or unparseable endpoint. Called once at
// startup; never at request time.
func New(cfg Config) (Provider, error) {
    if cfg.Model == "" {
        return nil, fmt.Errorf("provider: model is required")
    }
    switch cfg.Type {
    case "ollama":
        return ollama.New(cfg)
    case "openai":
        return openai.New(cfg)
    case "anthropic":
        return anthropic.New(cfg)
    default:
        return nil, fmt.Errorf("provider: unsupported type %q", cfg.Type)
    }
}
```

**Error classification** (`internal/provider/errors.go`):

| Sentinel | gRPC code | When |
|---|---|---|
| `ErrUnavailable` | `codes.Unavailable` | Ollama down, provider 5xx, network |
| `ErrRateLimited` | `codes.ResourceExhausted` | OpenAI/Anthropic 429 |
| `ErrInvalidArgument` | `codes.InvalidArgument` | Bad model, malformed request, OpenAI 400 |
| `ErrInternal` | `codes.Internal` | Unexpected; full error surfaces in /status `last_error` |

**Provider concrete behavior (v1 only):**

| Provider | SDK | Used | Deferred |
|---|---|---|---|
| Ollama | `github.com/ollama/ollama/api` | `Chat()` streaming | tool calling |
| OpenAI | `github.com/sashabaranov/go-openai` | `CreateChatCompletionStream` | function calling, vision |
| Anthropic | `github.com/anthropics/anthropic-sdk-go` | `Messages.NewStreaming` | tool use, prompt caching |

---

## 4. Chat Flow

**Per-turn data flow inside `chatHandler.Send`:**

1. Read all `*kotgv1.UserMessage` frames from the bidi stream until half-close (or until the first frame in v1 — clients are expected to send one frame per turn for now).
2. Extract `cluster_id` from gRPC incoming metadata (`md.Get("kotg-cluster-id")`); if missing, return `codes.InvalidArgument`.
3. Build the system message: `prompt.BuildSystemPrompt(clusterID)`.
4. Build `[]provider.Message`: `[{system, prompt}, ...history (role,content)..., {user, latestTurnText}]`. The chat handler accumulates `UserMessage.Text` from all read frames into the latest user message.
5. Apply `TrimToBudget(msgs, maxHistoryTokens)` (default 16,000 tokens, approximate via chars/4). System message is never dropped; latest user message is never dropped.
6. `provider.ChatStream(ctx, msgs)` → receive channel of `Event`.
7. For each event: map to `AssistantEvent` and `stream.Send(...)`.
8. After channel close: send `AssistantEvent_Done` (or `_Error` if terminal was Error), return.

**System prompt** (`internal/prompt/prompt.go`):

```go
const basePrompt = `You are a Kubernetes operations assistant for the Kubilitics platform.
The user is currently operating cluster %q.

Rules:
- Be concise and practical. Show kubectl-style commands when useful.
- Never invent resource names that don't appear in the user's context.
- For destructive actions (delete, scale to 0, drain, etc.), ALWAYS show the equivalent --dry-run=client command first.
- Assume production environment unless the user explicitly states otherwise.
- If you don't know something specific to the user's cluster, say so — don't guess.`

func BuildSystemPrompt(clusterID string) string {
    return fmt.Sprintf(basePrompt, clusterID)
}
```

**Event mapping (provider Event → AssistantEvent):**

| Provider Event | AssistantEvent variant |
|---|---|
| `KindTextDelta{Text}` | `*AssistantEvent_TextDelta{Text}` |
| `KindError{Error}` | `*AssistantEvent_Error{Code: classified, Message: err.Error()}` |
| `KindDone` | `*AssistantEvent_Done{}` |

v1 does NOT emit `ToolStart`, `ToolEnd`, `ActionPending`, `PlanProposed`, or `Citation` — those require multi-agent / tool-calling / RAG.

**`AICapabilities` response** (every `AIControl.Capabilities` call):

```go
&kotgv1.AICapabilities{
    SchemaVersion: "1.0.1",
    AiVersion:     "0.1.0",
    Providers:     []string{cfg.Type},  // exactly one in v1
    Models:        []string{cfg.Model},
    SupportsUndo:  false,
    SupportsPlans: false,
}
```

---

## 5. Configuration + Invocation

**Supervisor invokes:**

```
kotg-ai-server \
  --provider=ollama \
  --endpoint=http://127.0.0.1:11434 \
  --model=qwen2.5-coder:7b \
  --api-key-env=KOTG_OLLAMA_KEY    # optional; ignored when not needed
```

**Startup validation (fail-fast, exit code 2 with a clear error message):**
- `--provider` is one of `ollama|openai|anthropic`
- `--endpoint` is parseable as a URL with scheme + host
- `--model` is non-empty
- If `--api-key-env=NAME` is set: `os.Getenv(NAME)` returns non-empty
- Cert blob on stdin parses (3 length-prefixed PEM payloads: CA, server cert, server key)

**Logging discipline (security):**
- Startup log line: `provider=ollama model=qwen2.5-coder:7b endpoint=http://127.0.0.1:11434` — no key, no key-env-name leakage
- Per-request log: `cluster_id=<x> session_id=<y> turn_id=<z> latency_ms=<n> status=<s>` — no prompt content, no completion content
- Errors log type + code only (`provider_unavailable`, `rate_limited`); raw provider error never logged at INFO

**Backend config extension** (additive to subproject 2's `cfg.AI`):

```yaml
ai:
  enabled: true
  binaryPath: /opt/kotg-ai-server
  # NEW (v1 of kotg-ai-server):
  provider: "ollama"           # ollama | openai | anthropic
  endpoint: "http://127.0.0.1:11434"
  model: "qwen2.5-coder:7b"
  apiKeyEnv: ""                # name of env var holding the API key (empty for Ollama)
  # ...existing fields from subproject 2 unchanged
```

Supervisor's `Config` struct grows by 4 fields; `spawnSidecar` builds argv from these. Helm chart's `KUBILITICS_AI_*` env block adds 4 corresponding entries.

---

## 6. Testing & Rollout

**Test pyramid:**

| Layer | What | How |
|---|---|---|
| **Unit** | `BuildSystemPrompt`, `TrimToBudget`, errors classification, factory `New(cfg)` validation | pure Go; no exec, no net |
| **Provider integration** | Each provider adapter implements `ChatStream` correctly | `httptest.Server` mocking each provider's HTTP/SSE shape |
| **Stream contract tests** (per provider) | Assert: ≥1 TextDelta OR Error; exactly one terminal Done OR Error; no events after terminal; channel closes after terminal | Drive each adapter against a mock that emits a known event stream; assert the received `Event` sequence |
| **Cancellation test** (per provider) | Cancel `ctx` mid-stream → provider stops emitting within 100ms; channel closes; no goroutine leak (`runtime.NumGoroutine` delta) | Mock that emits 1 event/100ms; cancel after 200ms; assert |
| **Backpressure test** (per provider) | Slow consumer (read once per second) over a 16-token completion → no deadlock, no unbounded goroutine growth | Mock that emits 50 deltas as fast as possible; consumer with `time.Sleep(1s)` between reads |
| **Invalid-config test** | `New(Config{Type:"bogus"})` errors; `New(Config{Model:""})` errors; main fails fast on missing API key when `--api-key-env` is set | unit; main_test runs the binary with bad flags and asserts exit code 2 |
| **Server integration** | gRPC `Capabilities` + `Chat.Send` end-to-end against a fake provider | spawn the binary in-process via test helper; client asserts AssistantEvent sequence |
| **Schema-version assertion** | Server integration test reads `Capabilities().SchemaVersion` and asserts it equals the kotg-schema dep version (`1.0.1`) | parameterized via build flag or const |
| **Cert + READY handshake** | Binary reads stdin certs, binds, prints `READY <port>`, accepts mTLS dial | reuse the supervisor-side test framework from kubilitics-backend subproject 2 (stub patterns transfer) |
| **Live LLM smoke** | One manual run against local Ollama with `qwen2.5-coder:7b` to confirm real tokens stream | not in CI; documented in README with exact commands and expected output |

No real OpenAI/Anthropic calls in CI (cost, auth). Mocks cover the wire contract.

**Repo bootstrap (one-time):**
1. Create empty `vellankikoti/kotg-ai-server` repo (public).
2. `git init` → `module github.com/vellankikoti/kotg-ai-server` in go.mod, `go 1.24.1`.
3. `go get github.com/vellankikoti/kotg-schema@v1.0.1`.
4. Copy `.github/workflows/lint.yml` from kotg-schema (golangci-lint v2.1.6 + action@v7 + buf-setup with github_token).
5. Copy `.golangci.yml` (errcheck disabled).

**Rollout sequence:**

1. **Build behind same `ai.enabled` feature flag.** kotg-ai-server is invoked only when supervisor spawns it, which only happens when `ai.enabled=true`. Nothing changes on the kubilitics side until the flag flips.
2. **Tag `v0.1.0`** on kotg-ai-server when Section-3 chat flow works against Ollama and the full test pyramid is green.
3. **Local dogfood** in the kubilitics-backend dev cluster: set the new `cfg.AI.provider/endpoint/model` fields + `KUBILITICS_AI_BINARY_PATH=/path/to/kotg-ai-server`. Probe `?warm=true`, then open a WS chat session via `wscat` and verify TextDelta streams.
4. **Wait for subproject 5** (chat panel UI) — until that ships, "demo" is CLI-only.
5. **Tag `v1.x.0-beta.1` on kubilitics** when the chat panel UI lands and a desktop user can have a real Ollama-backed conversation about their cluster. Push to `vellankikoti/kubilitics` only.

---

## 7. Out of Scope (Later Subprojects)

| Concern | Subproject |
|---|---|
| Tool calling / function calling | v1.5 (after subproject 3 ActionGate creates the runway) |
| MCP server registration | v1.5 |
| Action approval flow + audit | 3 — Action Gateway |
| Chat panel UI (the consumer of the WS endpoint) | 5 — Chat Panel UI |
| Tauri sidecar packaging glue (binary embed for desktop) | 7 |
| Helm sub-chart for the AI binary | 8 |
| Cost/token observability dashboards | 10 |
| Multi-agent (LangGraph or Go equivalent) | v2 |
| RAG / vector search (Qdrant) | v2 |
| Knowledge graph (Kuzu) | v2 |
| Server-side session storage + summarization | v2 |
| Provider routing / multi-provider single sidecar | v1.5 (`--provider=multi` flag) |
| Configurable system prompt file | v1.5 |
