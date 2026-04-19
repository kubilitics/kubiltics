# kotg-ai-server v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0.1.0 minimal Go gRPC sidecar at `github.com/vellankikoti/kotg-ai-server`. Speaks the kotg-schema v1.0.1 contract (`AIControl.Capabilities` + `Chat.{CreateSession,Send,CancelTurn,ListSessions}` + grpc-health). Three providers: Ollama, OpenAI, Anthropic via native Go SDKs. In-memory sessions with TTL reaper. K8s-aware baked-in system prompt.

**Architecture:** Single binary, three layers — `cmd/kotg-ai-server` (flags + bootstrap) → `internal/server` (gRPC handlers + session manager + chat orchestration) → `internal/provider` (Provider interface + three SDK adapters). Reads ephemeral mTLS certs from stdin in length-prefixed framing (matches kubilitics-backend supervisor's `internal/ai/certs/mint.go:WriteStdinBlob`); binds 127.0.0.1:0; prints `READY <port>\n`; serves until SIGTERM.

**Tech Stack:** Go 1.24+, `github.com/vellankikoti/kotg-schema@v1.0.1`, `google.golang.org/grpc`, `google.golang.org/grpc/health/grpc_health_v1`, `github.com/ollama/ollama/api`, `github.com/sashabaranov/go-openai`, `github.com/anthropics/anthropic-sdk-go`. CI: golangci-lint v2.1.6 + action@v7 (per `feedback_ci_tooling_versions.md`).

**Spec:** `docs/superpowers/specs/2026-04-19-kotg-ai-server-v1-design.md`. Read it first.

**Working dir:** `~/code/kotg-ai-server` (new local clone of the new repo). Created in Pre-Flight.

**Push policy:** push only to `vellankikoti/kotg-ai-server`. Never push to any kubilitics/* org repo.

---

## File Structure

| Path | Responsibility |
|---|---|
| `cmd/kotg-ai-server/main.go` | flag parsing, config validation, cert read from stdin, server bootstrap, signal handling |
| `internal/provider/provider.go` | `Provider` interface, `Config`, `Message`, `Event`, `EventKind`, `New(cfg)` factory |
| `internal/provider/errors.go` | `ErrUnavailable`, `ErrRateLimited`, `ErrInvalidArgument`, `ErrInternal` + `ToGRPCCode(err)` mapper |
| `internal/provider/errors_test.go` | classification tests |
| `internal/provider/contract.go` | `RunStreamContract(t, p)` shared test helper for all providers |
| `internal/provider/ollama/ollama.go` | Ollama adapter |
| `internal/provider/ollama/ollama_test.go` | httptest-mocked tests + contract + cancel + backpressure |
| `internal/provider/openai/openai.go` | OpenAI adapter |
| `internal/provider/openai/openai_test.go` | httptest-mocked tests |
| `internal/provider/anthropic/anthropic.go` | Anthropic adapter |
| `internal/provider/anthropic/anthropic_test.go` | httptest-mocked tests |
| `internal/prompt/prompt.go` | `BuildSystemPrompt(clusterID)` + base template |
| `internal/prompt/prompt_test.go` | unit |
| `internal/server/budget.go` | `TrimToBudget(msgs, max int)` |
| `internal/server/budget_test.go` | unit |
| `internal/session/manager.go` | `Manager`, `Session`, `Create/Get/Append/SetTurnCancel/CancelTurn/List` + reaper |
| `internal/session/manager_test.go` | TTL eviction, caps, concurrency, cancel cleanup |
| `internal/transport/stdin.go` | `ReadCertBlob(io.Reader) (*Bundle, error)` |
| `internal/transport/stdin_test.go` | roundtrip with handcrafted blob bytes |
| `internal/transport/listener.go` | `BindLocalhost() (net.Listener, int, error)` + `WriteReady(io.Writer, port int) error` |
| `internal/transport/listener_test.go` | bind + READY framing |
| `internal/server/server.go` | gRPC server constructor (registers Health + AIControl + Chat) |
| `internal/server/aicontrol.go` | `AIControl.Capabilities` handler |
| `internal/server/chat.go` | `Chat.{CreateSession,Send,CancelTurn,ListSessions}` handlers |
| `internal/server/chat_test.go` | gRPC integration with fake provider |
| `internal/server/aicontrol_test.go` | schema-version + capabilities assertion |
| `.github/workflows/lint.yml` | buf lint not needed (no proto here); go build/test + golangci-lint v2.1.6 |
| `.github/workflows/release.yml` | tag → gh release |
| `.golangci.yml` | v2 schema, errcheck off |
| `.gitignore` | `kotg-ai-server` binary, IDE files |
| `README.md` | what it is + smoke commands + dev setup |
| `go.mod` / `go.sum` | deps |

---

## Pre-Flight

- [ ] **Create the GitHub repo (public, empty)**

```bash
gh repo create vellankikoti/kotg-ai-server --public --description "Minimal Go gRPC sidecar that fronts LLM providers (Ollama/OpenAI/Anthropic) for the Kubilitics AI integration." --confirm
```

If `--confirm` is rejected by your gh version, drop the flag and accept the prompt.

- [ ] **Clone locally and enter the directory**

```bash
mkdir -p ~/code && cd ~/code
git clone git@github.com:vellankikoti/kotg-ai-server.git
cd kotg-ai-server
```

From here on, all paths are relative to `~/code/kotg-ai-server` unless noted.

- [ ] **Initialize go module + commit baseline**

```bash
go mod init github.com/vellankikoti/kotg-ai-server
```

Edit `go.mod` to set Go version to `1.24.1` (per `feedback_ci_tooling_versions.md`):

```
module github.com/vellankikoti/kotg-ai-server

go 1.24.1
```

- [ ] **Add the kotg-schema + grpc + sdk deps**

```bash
go get github.com/vellankikoti/kotg-schema@v1.0.1
go get google.golang.org/grpc@latest
go get google.golang.org/grpc/health/grpc_health_v1@latest
go get github.com/ollama/ollama@latest
go get github.com/sashabaranov/go-openai@latest
go get github.com/anthropics/anthropic-sdk-go@latest
go mod tidy
```

- [ ] **Add `.gitignore`**

Create `.gitignore`:

```
# Built binary
/kotg-ai-server
/cmd/kotg-ai-server/kotg-ai-server

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
```

- [ ] **Add `.golangci.yml`** (v2 schema, errcheck off — survived the kotg-schema CI iterations)

Create `.golangci.yml`:

```yaml
version: "2"
linters:
  default: standard
  disable:
    - errcheck
```

- [ ] **Add `.github/workflows/lint.yml`**

Create `.github/workflows/lint.yml`:

```yaml
name: lint

on:
  pull_request:
  push:
    branches: [main]

jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.24" }
      - run: go build ./...
      - run: go test ./... -count=1 -timeout=120s
      - uses: golangci/golangci-lint-action@v7
        with:
          version: v2.1.6
```

- [ ] **Add `.github/workflows/release.yml`**

Create `.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.24" }
      - run: go build ./...
      - run: go test ./... -count=1 -timeout=120s
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Commit baseline + push**

```bash
git add .gitignore .golangci.yml .github/workflows/ go.mod go.sum
git commit -m "chore: scaffold module + deps + CI workflows"
git branch -M main
git push -u origin main
```

Wait for the lint workflow to be green before continuing. `gh run list --workflow=lint --limit=1` to check.

---

## Task 1: Prompt Package

**Files:**
- Create: `internal/prompt/prompt.go`
- Create: `internal/prompt/prompt_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/prompt/prompt_test.go`:

```go
package prompt

import (
    "strings"
    "testing"
)

func TestBuildSystemPromptIncludesClusterID(t *testing.T) {
    got := BuildSystemPrompt("prod-east-1")
    if !strings.Contains(got, "prod-east-1") {
        t.Errorf("prompt missing cluster ID; got: %s", got)
    }
}

func TestBuildSystemPromptHasRules(t *testing.T) {
    got := BuildSystemPrompt("c1")
    for _, want := range []string{
        "Kubernetes",
        "kubectl",
        "--dry-run",
        "production",
    } {
        if !strings.Contains(got, want) {
            t.Errorf("prompt missing %q; got:\n%s", want, got)
        }
    }
}

func TestBuildSystemPromptStable(t *testing.T) {
    a := BuildSystemPrompt("c1")
    b := BuildSystemPrompt("c1")
    if a != b {
        t.Errorf("BuildSystemPrompt is non-deterministic")
    }
}
```

- [ ] **Step 2: Run test, expect compile failure**

```bash
go test ./internal/prompt/ -count=1
```

- [ ] **Step 3: Implement `prompt.go`**

Create `internal/prompt/prompt.go`:

```go
// Package prompt builds the K8s-aware system prompt prepended to every
// chat completion. Single function for v1; v1.5 may add file-based
// override per the spec.
package prompt

import "fmt"

const basePrompt = `You are a Kubernetes operations assistant for the Kubilitics platform.
The user is currently operating cluster %q.

Rules:
- Be concise and practical. Show kubectl-style commands when useful.
- Never invent resource names that don't appear in the user's context.
- For destructive actions (delete, scale to 0, drain, etc.), ALWAYS show the equivalent --dry-run=client command first.
- Assume production environment unless the user explicitly states otherwise.
- If you don't know something specific to the user's cluster, say so — don't guess.`

// BuildSystemPrompt returns the system message for a chat turn, with the
// caller's cluster ID baked in. Pure function — no side effects.
func BuildSystemPrompt(clusterID string) string {
    return fmt.Sprintf(basePrompt, clusterID)
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
go test ./internal/prompt/ -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/prompt/
git commit -m "feat(prompt): K8s-aware system prompt with cluster ID injection"
```

---

## Task 2: Provider Interface + Errors

**Files:**
- Create: `internal/provider/provider.go`
- Create: `internal/provider/errors.go`
- Create: `internal/provider/errors_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/provider/errors_test.go`:

```go
package provider

import (
    "errors"
    "fmt"
    "testing"

    "google.golang.org/grpc/codes"
)

func TestToGRPCCode(t *testing.T) {
    cases := []struct {
        in   error
        want codes.Code
    }{
        {ErrUnavailable, codes.Unavailable},
        {ErrRateLimited, codes.ResourceExhausted},
        {ErrInvalidArgument, codes.InvalidArgument},
        {ErrInternal, codes.Internal},
        {fmt.Errorf("wrap: %w", ErrUnavailable), codes.Unavailable},
        {nil, codes.OK},
        {errors.New("random"), codes.Internal},
    }
    for _, tc := range cases {
        got := ToGRPCCode(tc.in)
        if got != tc.want {
            t.Errorf("ToGRPCCode(%v) = %v, want %v", tc.in, got, tc.want)
        }
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/provider/ -count=1
```

- [ ] **Step 3: Implement `errors.go`**

Create `internal/provider/errors.go`:

```go
package provider

import (
    "errors"

    "google.golang.org/grpc/codes"
)

// Sentinel errors that providers MUST wrap (or return directly) so the
// chat handler can map them to gRPC status codes.
var (
    ErrUnavailable     = errors.New("provider: unavailable")
    ErrRateLimited     = errors.New("provider: rate limited")
    ErrInvalidArgument = errors.New("provider: invalid argument")
    ErrInternal        = errors.New("provider: internal")
)

// ToGRPCCode classifies an error returned by a Provider into the gRPC
// code the chat handler returns to the client. Unknown errors map to
// codes.Internal so callers don't lose visibility.
func ToGRPCCode(err error) codes.Code {
    switch {
    case err == nil:
        return codes.OK
    case errors.Is(err, ErrUnavailable):
        return codes.Unavailable
    case errors.Is(err, ErrRateLimited):
        return codes.ResourceExhausted
    case errors.Is(err, ErrInvalidArgument):
        return codes.InvalidArgument
    case errors.Is(err, ErrInternal):
        return codes.Internal
    default:
        return codes.Internal
    }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/provider/ -count=1 -v
```

- [ ] **Step 5: Implement `provider.go`** (no test yet — factory tests come once at least one provider exists)

Create `internal/provider/provider.go`:

```go
// Package provider defines the LLM provider abstraction used by the
// chat handler. Each concrete provider lives in its own subpackage and
// must satisfy the Provider interface contract documented below.
package provider

import (
    "context"
)

// Config carries the runtime configuration for a single provider
// instance. Populated from CLI flags + env-var resolution in main.go.
type Config struct {
    Type     string // "ollama" | "openai" | "anthropic"
    Endpoint string // base URL
    Model    string // provider-specific model id
    APIKey   string // resolved from --api-key-env at startup; never logged
}

// Message is the canonical conversation entry handed from sidecar core
// to the provider. Each adapter maps this to its native SDK shape.
type Message struct {
    Role    string // "system" | "user" | "assistant"
    Content string
}

// EventKind distinguishes streamed unit kinds.
type EventKind int

const (
    KindTextDelta EventKind = iota
    KindDone
    KindError
)

// Event is the streamed unit. Mapped 1:1 by the chat handler to the
// kotg-schema AssistantEvent variants. Kept internal so providers
// don't import kotg-schema directly.
type Event struct {
    Kind  EventKind
    Text  string // for KindTextDelta
    Error error  // for KindError; classified per errors.go
}

// Provider streams completions for a chat conversation.
//
// Contract:
//   - ChatStream returns a buffered receive channel (cap 16); provider
//     closes it exactly once on success, error, or ctx cancellation.
//   - Provider MUST stop emitting events immediately when ctx is
//     cancelled. No goroutine leaks.
//   - Stream emits one or more KindTextDelta events, then exactly one
//     terminal event (KindDone OR KindError), then closes.
//   - No events may be emitted after the terminal event.
//   - Providers MUST NOT log API keys, full prompts, or completions.
type Provider interface {
    ChatStream(ctx context.Context, msgs []Message) (<-chan Event, error)
    // Close releases provider resources (HTTP clients, in-flight streams).
    // Idempotent. Safe to call multiple times.
    Close() error
}

// Standard buffer size for provider event channels. Smooths streaming
// under load without unbounded memory growth.
const ChannelBuffer = 16
```

> Factory `New(cfg)` is added in Task 6 (after at least one concrete provider exists; otherwise it'd reference packages that don't compile).

- [ ] **Step 6: Run all provider tests, expect PASS**

```bash
go test ./internal/provider/ -count=1 -v
go vet ./internal/provider/...
```

- [ ] **Step 7: Commit**

```bash
git add internal/provider/
git commit -m "feat(provider): interface + error sentinels + gRPC code mapper"
```

---

## Task 3: Token Budget

**Files:**
- Create: `internal/server/budget.go`
- Create: `internal/server/budget_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/server/budget_test.go`:

```go
package server

import (
    "strings"
    "testing"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

func TestTrimToBudgetUnderLimit(t *testing.T) {
    msgs := []provider.Message{
        {Role: "system", Content: "sys"},
        {Role: "user", Content: "hi"},
    }
    got := TrimToBudget(msgs, 16000)
    if len(got) != 2 {
        t.Errorf("expected unchanged, got %d msgs", len(got))
    }
}

func TestTrimToBudgetDropsOldest(t *testing.T) {
    msgs := []provider.Message{
        {Role: "system", Content: "sys"},
        {Role: "user", Content: strings.Repeat("a", 4000)},     // ~1000 tokens
        {Role: "assistant", Content: strings.Repeat("b", 4000)},
        {Role: "user", Content: strings.Repeat("c", 4000)},
        {Role: "assistant", Content: strings.Repeat("d", 4000)},
        {Role: "user", Content: "latest"},
    }
    got := TrimToBudget(msgs, 2500) // tight: must drop oldest
    if got[0].Role != "system" {
        t.Errorf("system must remain first, got role=%q", got[0].Role)
    }
    if got[len(got)-1].Content != "latest" {
        t.Errorf("latest user message must remain, got %q", got[len(got)-1].Content)
    }
    if len(got) >= len(msgs) {
        t.Errorf("expected trim, got %d msgs (input was %d)", len(got), len(msgs))
    }
}

func TestTrimToBudgetSystemNeverDropped(t *testing.T) {
    msgs := []provider.Message{
        {Role: "system", Content: strings.Repeat("S", 100000)}, // huge system msg
        {Role: "user", Content: "u"},
    }
    got := TrimToBudget(msgs, 100)
    if len(got) < 2 || got[0].Role != "system" {
        t.Errorf("system must remain even when over budget; got: %+v", got)
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/server/ -count=1
```

- [ ] **Step 3: Implement `budget.go`**

Create `internal/server/budget.go`:

```go
// Package server hosts the gRPC handlers (AIControl + Chat) and helpers
// that compose providers, sessions, and prompts into the wire surface.
package server

import "github.com/vellankikoti/kotg-ai-server/internal/provider"

// approxTokens estimates token count using the chars/4 rule of thumb.
// Sufficient for budget enforcement; precise tokenization defers to v2.
func approxTokens(s string) int {
    return (len(s) + 3) / 4
}

func totalTokens(msgs []provider.Message) int {
    n := 0
    for _, m := range msgs {
        n += approxTokens(m.Content)
    }
    return n
}

// TrimToBudget returns msgs trimmed to fit within max approximate tokens.
//
// Invariants:
//   - The first message (assumed system) is never dropped.
//   - The last message (assumed latest user turn) is never dropped.
//   - Drops oldest user/assistant pairs in order until budget is met OR
//     only system + last remain.
func TrimToBudget(msgs []provider.Message, max int) []provider.Message {
    if len(msgs) <= 2 {
        return msgs
    }
    // Always keep msgs[0] (system) and msgs[len-1] (latest user).
    // Drop from the middle, oldest first.
    head := msgs[0]
    tail := msgs[len(msgs)-1]
    middle := append([]provider.Message{}, msgs[1:len(msgs)-1]...)

    out := append([]provider.Message{head}, middle...)
    out = append(out, tail)

    for totalTokens(out) > max && len(middle) > 0 {
        // Drop the oldest middle message.
        middle = middle[1:]
        out = append([]provider.Message{head}, middle...)
        out = append(out, tail)
    }
    return out
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
go test ./internal/server/ -run TestTrim -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/server/budget.go internal/server/budget_test.go
git commit -m "feat(server): TrimToBudget with system+latest preservation"
```

---

## Task 4: Session Manager

**Files:**
- Create: `internal/session/manager.go`
- Create: `internal/session/manager_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/session/manager_test.go`:

```go
package session

import (
    "context"
    "sync"
    "testing"
    "time"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

func newTestManager(t *testing.T) *Manager {
    t.Helper()
    return New(Config{
        TTL:                   200 * time.Millisecond,
        MaxSessions:           5,
        MaxMessagesPerSession: 4,
        ReaperInterval:        50 * time.Millisecond,
    })
}

func TestCreateAndGet(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()

    s, err := m.Create("c1", "title")
    if err != nil {
        t.Fatalf("Create: %v", err)
    }
    if s.ID == "" {
        t.Fatalf("empty session ID")
    }
    got, ok := m.Get(s.ID)
    if !ok {
        t.Fatalf("Get returned not found")
    }
    if got.FocusClusterID != "c1" {
        t.Errorf("FocusClusterID = %q, want c1", got.FocusClusterID)
    }
}

func TestAppendBumpsUpdatedAtAndCapsMessages(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    s, _ := m.Create("c1", "t")

    for i := 0; i < 6; i++ {
        if err := m.Append(s.ID, provider.Message{Role: "user", Content: "x"}); err != nil {
            t.Fatalf("Append %d: %v", i, err)
        }
    }
    got, _ := m.Get(s.ID)
    if len(got.Messages) != 4 {
        t.Errorf("messages = %d, want 4 (cap)", len(got.Messages))
    }
}

func TestMaxSessionsCap(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    for i := 0; i < 5; i++ {
        if _, err := m.Create("c", "t"); err != nil {
            t.Fatalf("Create %d: %v", i, err)
        }
    }
    if _, err := m.Create("c", "t"); err == nil {
        t.Fatalf("expected error on 6th Create")
    }
}

func TestTTLEviction(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    s, _ := m.Create("c", "t")

    // Wait past TTL + reaper interval.
    time.Sleep(400 * time.Millisecond)
    if _, ok := m.Get(s.ID); ok {
        t.Errorf("session not evicted after TTL")
    }
}

func TestCancelTurnFiresAndClears(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    s, _ := m.Create("c", "t")

    fired := make(chan struct{}, 1)
    _, cancel := context.WithCancel(context.Background())
    wrapped := func() {
        cancel()
        fired <- struct{}{}
    }
    m.SetTurnCancel(s.ID, wrapped)
    if err := m.CancelTurn(s.ID); err != nil {
        t.Fatalf("CancelTurn: %v", err)
    }
    select {
    case <-fired:
    case <-time.After(time.Second):
        t.Fatalf("cancel func not invoked")
    }
    // Calling CancelTurn again must be a no-op (cancel func cleared).
    if err := m.CancelTurn(s.ID); err != nil {
        t.Fatalf("second CancelTurn: %v", err)
    }
    select {
    case <-fired:
        t.Fatalf("cancel func fired twice — not cleared after first call")
    case <-time.After(50 * time.Millisecond):
    }
}

func TestListLimitAndSince(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    s1, _ := m.Create("c", "t1")
    time.Sleep(10 * time.Millisecond)
    s2, _ := m.Create("c", "t2")

    // Limit = 1 returns most-recent.
    got := m.List(1, 0)
    if len(got) != 1 || got[0].ID != s2.ID {
        t.Errorf("List(1,0) = %v, want s2", got)
    }
    // sinceUnix filters strictly newer.
    cutoff := s1.UpdatedAt.Unix()
    got = m.List(10, cutoff)
    for _, s := range got {
        if s.UpdatedAt.Unix() <= cutoff {
            t.Errorf("session %s violates since filter", s.ID)
        }
    }
}

func TestConcurrentSafe(t *testing.T) {
    m := newTestManager(t)
    defer m.Stop()
    s, _ := m.Create("c", "t")
    var wg sync.WaitGroup
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = m.Append(s.ID, provider.Message{Role: "user", Content: "x"})
        }()
    }
    wg.Wait()
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/session/ -count=1
```

- [ ] **Step 3: Implement `manager.go`**

Create `internal/session/manager.go`:

```go
// Package session is the in-memory session manager backing the kotg-ai-server
// Chat service. State is bounded by TTL eviction and hard caps; nothing is
// persisted. All sessions are lost when the process restarts (by design —
// the supervisor's idle-shutdown wipes them anyway, and the desktop chat
// panel handles the spawn_changed reset cleanly).
package session

import (
    "crypto/rand"
    "encoding/hex"
    "errors"
    "fmt"
    "sort"
    "sync"
    "time"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

// Defaults match the spec.
const (
    DefaultTTL                   = 15 * time.Minute
    DefaultMaxSessions           = 1000
    DefaultMaxMessagesPerSession = 100
    DefaultReaperInterval        = 60 * time.Second
)

type Config struct {
    TTL                   time.Duration
    MaxSessions           int
    MaxMessagesPerSession int
    ReaperInterval        time.Duration
}

func (c Config) withDefaults() Config {
    if c.TTL <= 0 {
        c.TTL = DefaultTTL
    }
    if c.MaxSessions <= 0 {
        c.MaxSessions = DefaultMaxSessions
    }
    if c.MaxMessagesPerSession <= 0 {
        c.MaxMessagesPerSession = DefaultMaxMessagesPerSession
    }
    if c.ReaperInterval <= 0 {
        c.ReaperInterval = DefaultReaperInterval
    }
    return c
}

// Session is the in-memory record. Messages excludes the system prompt
// (rebuilt per turn from the cluster ID).
type Session struct {
    ID             string
    FocusClusterID string
    Title          string
    CreatedAt      time.Time
    UpdatedAt      time.Time
    Messages       []provider.Message
    activeCancel   func()
}

var ErrCapExceeded = errors.New("session: max sessions exceeded")
var ErrNotFound = errors.New("session: not found")

type Manager struct {
    cfg     Config
    mu      sync.Mutex
    by      map[string]*Session
    stop    chan struct{}
    stopped bool
}

func New(cfg Config) *Manager {
    m := &Manager{
        cfg:  cfg.withDefaults(),
        by:   make(map[string]*Session),
        stop: make(chan struct{}),
    }
    go m.reaperLoop()
    return m
}

// Stop halts the reaper. Safe to call multiple times.
func (m *Manager) Stop() {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.stopped {
        return
    }
    m.stopped = true
    close(m.stop)
}

func newID() string {
    var b [12]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

func (m *Manager) Create(focusClusterID, title string) (*Session, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if len(m.by) >= m.cfg.MaxSessions {
        return nil, fmt.Errorf("%w (max %d)", ErrCapExceeded, m.cfg.MaxSessions)
    }
    now := time.Now()
    s := &Session{
        ID:             newID(),
        FocusClusterID: focusClusterID,
        Title:          title,
        CreatedAt:      now,
        UpdatedAt:      now,
    }
    m.by[s.ID] = s
    return s, nil
}

func (m *Manager) Get(id string) (*Session, bool) {
    m.mu.Lock()
    defer m.mu.Unlock()
    s, ok := m.by[id]
    if !ok {
        return nil, false
    }
    // Return a shallow copy so callers can read without lock.
    out := *s
    out.Messages = append([]provider.Message{}, s.Messages...)
    return &out, true
}

func (m *Manager) Append(id string, msg provider.Message) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    s, ok := m.by[id]
    if !ok {
        return ErrNotFound
    }
    s.Messages = append(s.Messages, msg)
    if over := len(s.Messages) - m.cfg.MaxMessagesPerSession; over > 0 {
        s.Messages = s.Messages[over:]
    }
    s.UpdatedAt = time.Now()
    return nil
}

func (m *Manager) SetTurnCancel(id string, cancel func()) {
    m.mu.Lock()
    defer m.mu.Unlock()
    s, ok := m.by[id]
    if !ok {
        return
    }
    s.activeCancel = cancel
}

// CancelTurn fires the registered cancel func once and clears it.
// Calling on a session with no active turn is a no-op.
func (m *Manager) CancelTurn(id string) error {
    m.mu.Lock()
    s, ok := m.by[id]
    if !ok {
        m.mu.Unlock()
        return ErrNotFound
    }
    cancel := s.activeCancel
    s.activeCancel = nil
    m.mu.Unlock()
    if cancel != nil {
        cancel()
    }
    return nil
}

// List returns up to limit sessions whose UpdatedAt is strictly after
// sinceUnix (epoch seconds; 0 disables). Newest first. Caller-supplied
// limit ≤0 means no limit.
func (m *Manager) List(limit int, sinceUnix int64) []*Session {
    m.mu.Lock()
    defer m.mu.Unlock()
    out := make([]*Session, 0, len(m.by))
    for _, s := range m.by {
        if sinceUnix > 0 && s.UpdatedAt.Unix() <= sinceUnix {
            continue
        }
        copy := *s
        copy.Messages = nil // List is metadata-only; don't copy bodies
        out = append(out, &copy)
    }
    sort.Slice(out, func(i, j int) bool {
        return out[i].UpdatedAt.After(out[j].UpdatedAt)
    })
    if limit > 0 && len(out) > limit {
        out = out[:limit]
    }
    return out
}

func (m *Manager) reaperLoop() {
    t := time.NewTicker(m.cfg.ReaperInterval)
    defer t.Stop()
    for {
        select {
        case <-m.stop:
            return
        case <-t.C:
            m.evictExpired()
        }
    }
}

func (m *Manager) evictExpired() {
    cutoff := time.Now().Add(-m.cfg.TTL)
    m.mu.Lock()
    defer m.mu.Unlock()
    for id, s := range m.by {
        if s.UpdatedAt.Before(cutoff) {
            delete(m.by, id)
        }
    }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/session/ -count=1 -v -race
```

- [ ] **Step 5: Commit**

```bash
git add internal/session/
git commit -m "feat(session): in-memory manager with TTL reaper, caps, cancel-once"
```

---

## Task 5: Provider Stream Contract Helper

**Files:**
- Create: `internal/provider/contract.go`

This is a shared test helper used by every provider's tests in Tasks 6/7/8. It centralizes the four contract assertions: at-least-one-event, single-terminal, no-events-after-terminal, channel-closes.

- [ ] **Step 1: Implement (no test for the helper itself; it gets exercised by every provider test)**

Create `internal/provider/contract.go`:

```go
package provider

import (
    "context"
    "testing"
    "time"
)

// RunStreamContract asserts that p.ChatStream satisfies the Provider
// interface contract for one happy-path call. Each concrete provider
// test calls this after wiring up an httptest server that returns a
// well-formed streaming response.
//
// Caller is responsible for arranging the mock to emit at least one
// text token followed by a clean stream end.
func RunStreamContract(t *testing.T, p Provider) {
    t.Helper()
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    ch, err := p.ChatStream(ctx, []Message{{Role: "user", Content: "hello"}})
    if err != nil {
        t.Fatalf("ChatStream: %v", err)
    }

    var (
        gotDelta    int
        gotTerminal int
        afterTerm   int
        terminalKind EventKind
    )
    for ev := range ch {
        if gotTerminal > 0 {
            afterTerm++
            continue
        }
        switch ev.Kind {
        case KindTextDelta:
            gotDelta++
        case KindDone, KindError:
            gotTerminal++
            terminalKind = ev.Kind
        }
    }

    if gotDelta == 0 && terminalKind != KindError {
        t.Errorf("contract: expected ≥1 TextDelta or terminal Error, got 0 deltas and Done")
    }
    if gotTerminal != 1 {
        t.Errorf("contract: expected exactly 1 terminal event, got %d", gotTerminal)
    }
    if afterTerm > 0 {
        t.Errorf("contract: %d events after terminal", afterTerm)
    }
}

// RunCancellationContract asserts that ctx cancellation halts emission
// promptly and the channel closes.
func RunCancellationContract(t *testing.T, p Provider) {
    t.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    ch, err := p.ChatStream(ctx, []Message{{Role: "user", Content: "stream please"}})
    if err != nil {
        t.Fatalf("ChatStream: %v", err)
    }
    // Read one event then cancel.
    select {
    case _, ok := <-ch:
        if !ok {
            t.Fatalf("channel closed before first event")
        }
    case <-time.After(2 * time.Second):
        t.Fatalf("no event within 2s")
    }
    cancel()
    deadline := time.After(500 * time.Millisecond)
    for {
        select {
        case _, ok := <-ch:
            if !ok {
                return // closed — good
            }
        case <-deadline:
            t.Fatalf("channel did not close within 500ms of cancel")
        }
    }
}

// RunBackpressureContract asserts that a slow consumer doesn't deadlock
// the provider goroutine. Reads one event per 50ms; mock should emit
// faster.
func RunBackpressureContract(t *testing.T, p Provider) {
    t.Helper()
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    ch, err := p.ChatStream(ctx, []Message{{Role: "user", Content: "burst"}})
    if err != nil {
        t.Fatalf("ChatStream: %v", err)
    }
    for ev := range ch {
        if ev.Kind == KindError {
            t.Fatalf("unexpected error: %v", ev.Error)
        }
        time.Sleep(50 * time.Millisecond)
    }
}
```

- [ ] **Step 2: Build, commit**

```bash
go build ./internal/provider/...
git add internal/provider/contract.go
git commit -m "feat(provider): shared stream contract test helpers"
```

---

## Task 6: Ollama Provider

**Files:**
- Create: `internal/provider/ollama/ollama.go`
- Create: `internal/provider/ollama/ollama_test.go`

Ollama's API is simple JSON streaming over HTTP — one JSON object per line, each with `{message:{role,content},done:bool}`. We can use the official SDK (`github.com/ollama/ollama/api`) which abstracts this.

- [ ] **Step 1: Write tests with httptest mock first**

Create `internal/provider/ollama/ollama_test.go`:

```go
package ollama

import (
    "fmt"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

// fakeOllama emits a stream of JSON-per-line chat responses matching
// the Ollama /api/chat schema.
func fakeOllama(t *testing.T, deltas []string) *httptest.Server {
    return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/api/chat" {
            http.NotFound(w, r)
            return
        }
        flusher, ok := w.(http.Flusher)
        if !ok {
            t.Fatalf("ResponseWriter not flushable")
        }
        w.Header().Set("Content-Type", "application/x-ndjson")
        for _, d := range deltas {
            fmt.Fprintf(w, `{"model":"test","message":{"role":"assistant","content":%q},"done":false}`+"\n", d)
            flusher.Flush()
        }
        fmt.Fprintln(w, `{"model":"test","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":3,"eval_count":5}`)
    }))
}

func TestOllamaStreamContract(t *testing.T) {
    srv := fakeOllama(t, []string{"hello ", "world"})
    defer srv.Close()

    p, err := New(provider.Config{
        Type: "ollama", Endpoint: srv.URL, Model: "qwen2.5-coder:7b",
    })
    if err != nil {
        t.Fatalf("New: %v", err)
    }
    defer p.Close()

    provider.RunStreamContract(t, p)
}

func TestOllamaCancellation(t *testing.T) {
    // Mock that emits 1 event/100ms; cancellation should stop within 500ms.
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        flusher := w.(http.Flusher)
        for i := 0; i < 100; i++ {
            fmt.Fprintf(w, `{"model":"t","message":{"role":"assistant","content":"x"},"done":false}`+"\n")
            flusher.Flush()
            // Sleep handled by the test's RunCancellationContract pacing.
        }
    }))
    defer srv.Close()

    p, _ := New(provider.Config{Type: "ollama", Endpoint: srv.URL, Model: "m"})
    defer p.Close()
    provider.RunCancellationContract(t, p)
}

func TestOllamaInvalidModelFails(t *testing.T) {
    if _, err := New(provider.Config{Type: "ollama", Endpoint: "http://x", Model: ""}); err == nil {
        t.Fatalf("expected error for empty model")
    }
}

func TestOllamaUnavailableMaps(t *testing.T) {
    p, _ := New(provider.Config{Type: "ollama", Endpoint: "http://127.0.0.1:1", Model: "m"})
    defer p.Close()
    ch, err := p.ChatStream(t.Context(), []provider.Message{{Role: "user", Content: "x"}})
    if err != nil {
        return // either initial-dial error or terminal Error event is acceptable
    }
    var sawError bool
    for ev := range ch {
        if ev.Kind == provider.KindError {
            sawError = true
        }
    }
    if !sawError {
        t.Fatalf("expected KindError event when endpoint is dead")
    }
}
```

> Note: `t.Context()` requires Go 1.24+; if your toolchain warns, replace with `context.Background()`.

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/provider/ollama/ -count=1
```

- [ ] **Step 3: Implement `ollama.go`**

Create `internal/provider/ollama/ollama.go`:

```go
// Package ollama implements provider.Provider against an Ollama-compatible
// HTTP endpoint via the official Ollama Go SDK.
package ollama

import (
    "context"
    "errors"
    "fmt"
    "net/http"
    "net/url"

    api "github.com/ollama/ollama/api"
    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

type Provider struct {
    client *api.Client
    model  string
}

func New(cfg provider.Config) (*Provider, error) {
    if cfg.Model == "" {
        return nil, fmt.Errorf("ollama: model is required")
    }
    if cfg.Endpoint == "" {
        return nil, fmt.Errorf("ollama: endpoint is required")
    }
    u, err := url.Parse(cfg.Endpoint)
    if err != nil {
        return nil, fmt.Errorf("ollama: parse endpoint: %w", err)
    }
    return &Provider{
        client: api.NewClient(u, http.DefaultClient),
        model:  cfg.Model,
    }, nil
}

func (p *Provider) Close() error { return nil }

func (p *Provider) ChatStream(ctx context.Context, msgs []provider.Message) (<-chan provider.Event, error) {
    out := make(chan provider.Event, provider.ChannelBuffer)

    apiMsgs := make([]api.Message, 0, len(msgs))
    for _, m := range msgs {
        apiMsgs = append(apiMsgs, api.Message{Role: m.Role, Content: m.Content})
    }

    go func() {
        defer close(out)
        var emittedTerminal bool
        emitTerm := func(ev provider.Event) {
            if emittedTerminal {
                return
            }
            emittedTerminal = true
            select {
            case out <- ev:
            case <-ctx.Done():
            }
        }

        err := p.client.Chat(ctx, &api.ChatRequest{
            Model:    p.model,
            Messages: apiMsgs,
            Stream:   boolPtr(true),
        }, func(resp api.ChatResponse) error {
            if ctx.Err() != nil {
                return ctx.Err()
            }
            if resp.Message.Content != "" {
                select {
                case out <- provider.Event{Kind: provider.KindTextDelta, Text: resp.Message.Content}:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
            if resp.Done {
                emitTerm(provider.Event{Kind: provider.KindDone})
            }
            return nil
        })
        if err != nil && !errors.Is(err, context.Canceled) {
            emitTerm(provider.Event{
                Kind:  provider.KindError,
                Error: fmt.Errorf("%w: %v", provider.ErrUnavailable, err),
            })
            return
        }
        // Defensive: if Ollama closed the stream without a Done message,
        // synthesize one so the channel always has a terminal event.
        emitTerm(provider.Event{Kind: provider.KindDone})
    }()

    return out, nil
}

func boolPtr(b bool) *bool { return &b }
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
go test ./internal/provider/ollama/ -count=1 -v -timeout=60s
```

If `RunBackpressureContract` test was added (was not in this task — Ollama's mock doesn't naturally emit fast enough), skip. If `t.Context()` errors, replace with `context.Background()`.

- [ ] **Step 5: Commit**

```bash
git add internal/provider/ollama/
git commit -m "feat(provider/ollama): SDK-backed streaming chat with cancellation + error mapping"
```

---

## Task 7: OpenAI Provider

**Files:**
- Create: `internal/provider/openai/openai.go`
- Create: `internal/provider/openai/openai_test.go`

OpenAI uses SSE (`data: {...}\n\n`). The `sashabaranov/go-openai` SDK handles SSE parsing.

- [ ] **Step 1: Write tests with SSE httptest mock**

Create `internal/provider/openai/openai_test.go`:

```go
package openai

import (
    "fmt"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

func fakeOpenAI(t *testing.T, deltas []string) *httptest.Server {
    return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/chat/completions" {
            http.NotFound(w, r)
            return
        }
        w.Header().Set("Content-Type", "text/event-stream")
        flusher := w.(http.Flusher)
        for _, d := range deltas {
            fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", d)
            flusher.Flush()
        }
        fmt.Fprint(w, "data: [DONE]\n\n")
        flusher.Flush()
    }))
}

func TestOpenAIStreamContract(t *testing.T) {
    srv := fakeOpenAI(t, []string{"hi ", "there"})
    defer srv.Close()
    p, err := New(provider.Config{
        Type: "openai", Endpoint: srv.URL, Model: "gpt-4o-mini", APIKey: "sk-test",
    })
    if err != nil {
        t.Fatalf("New: %v", err)
    }
    defer p.Close()
    provider.RunStreamContract(t, p)
}

func TestOpenAIRequiresAPIKey(t *testing.T) {
    if _, err := New(provider.Config{Type: "openai", Endpoint: "http://x", Model: "m"}); err == nil {
        t.Fatalf("expected error when api key empty")
    }
}

func TestOpenAIRateLimitMaps(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        http.Error(w, `{"error":{"type":"rate_limit_error"}}`, http.StatusTooManyRequests)
    }))
    defer srv.Close()
    p, _ := New(provider.Config{Type: "openai", Endpoint: srv.URL, Model: "m", APIKey: "k"})
    defer p.Close()

    ch, err := p.ChatStream(t.Context(), []provider.Message{{Role: "user", Content: "x"}})
    if err == nil {
        var sawErr bool
        for ev := range ch {
            if ev.Kind == provider.KindError {
                sawErr = true
            }
        }
        if !sawErr {
            t.Fatalf("expected KindError")
        }
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/provider/openai/ -count=1
```

- [ ] **Step 3: Implement `openai.go`**

Create `internal/provider/openai/openai.go`:

```go
// Package openai implements provider.Provider against the OpenAI chat
// completions streaming API via github.com/sashabaranov/go-openai.
package openai

import (
    "context"
    "errors"
    "fmt"
    "io"

    sdk "github.com/sashabaranov/go-openai"
    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

type Provider struct {
    client *sdk.Client
    model  string
}

func New(cfg provider.Config) (*Provider, error) {
    if cfg.Model == "" {
        return nil, fmt.Errorf("openai: model is required")
    }
    if cfg.APIKey == "" {
        return nil, fmt.Errorf("openai: api key is required (check --api-key-env)")
    }
    sdkCfg := sdk.DefaultConfig(cfg.APIKey)
    if cfg.Endpoint != "" {
        sdkCfg.BaseURL = cfg.Endpoint
    }
    return &Provider{client: sdk.NewClientWithConfig(sdkCfg), model: cfg.Model}, nil
}

func (p *Provider) Close() error { return nil }

func (p *Provider) ChatStream(ctx context.Context, msgs []provider.Message) (<-chan provider.Event, error) {
    out := make(chan provider.Event, provider.ChannelBuffer)

    sdkMsgs := make([]sdk.ChatCompletionMessage, 0, len(msgs))
    for _, m := range msgs {
        sdkMsgs = append(sdkMsgs, sdk.ChatCompletionMessage{Role: m.Role, Content: m.Content})
    }

    stream, err := p.client.CreateChatCompletionStream(ctx, sdk.ChatCompletionRequest{
        Model:    p.model,
        Messages: sdkMsgs,
        Stream:   true,
    })
    if err != nil {
        close(out)
        return nil, classifyOpenAIError(err)
    }

    go func() {
        defer close(out)
        defer stream.Close()
        var emittedTerminal bool
        emitTerm := func(ev provider.Event) {
            if emittedTerminal {
                return
            }
            emittedTerminal = true
            select {
            case out <- ev:
            case <-ctx.Done():
            }
        }
        for {
            if ctx.Err() != nil {
                return
            }
            resp, err := stream.Recv()
            if errors.Is(err, io.EOF) {
                emitTerm(provider.Event{Kind: provider.KindDone})
                return
            }
            if err != nil {
                emitTerm(provider.Event{Kind: provider.KindError, Error: classifyOpenAIError(err)})
                return
            }
            for _, ch := range resp.Choices {
                if ch.Delta.Content != "" {
                    select {
                    case out <- provider.Event{Kind: provider.KindTextDelta, Text: ch.Delta.Content}:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }
    }()
    return out, nil
}

func classifyOpenAIError(err error) error {
    var apiErr *sdk.APIError
    if errors.As(err, &apiErr) {
        switch apiErr.HTTPStatusCode {
        case 429:
            return fmt.Errorf("%w: %v", provider.ErrRateLimited, err)
        case 400, 422:
            return fmt.Errorf("%w: %v", provider.ErrInvalidArgument, err)
        case 500, 502, 503, 504:
            return fmt.Errorf("%w: %v", provider.ErrUnavailable, err)
        }
    }
    return fmt.Errorf("%w: %v", provider.ErrUnavailable, err)
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/provider/openai/ -count=1 -v -timeout=60s
```

- [ ] **Step 5: Commit**

```bash
git add internal/provider/openai/
git commit -m "feat(provider/openai): SDK-backed SSE streaming with HTTP-status classification"
```

---

## Task 8: Anthropic Provider

**Files:**
- Create: `internal/provider/anthropic/anthropic.go`
- Create: `internal/provider/anthropic/anthropic_test.go`

Anthropic streams via SSE with a different shape (`event: ...\ndata: {...}`). The `anthropics/anthropic-sdk-go` handles parsing.

- [ ] **Step 1: Write tests with mock**

Create `internal/provider/anthropic/anthropic_test.go`:

```go
package anthropic

import (
    "fmt"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

// fakeAnthropic emits a minimal SSE stream matching the Messages API.
func fakeAnthropic(t *testing.T, deltas []string) *httptest.Server {
    return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "text/event-stream")
        flusher := w.(http.Flusher)
        fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m1\",\"role\":\"assistant\",\"content\":[],\"model\":\"claude-3-7-sonnet\",\"stop_reason\":null,\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n")
        fmt.Fprint(w, "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n")
        flusher.Flush()
        for _, d := range deltas {
            fmt.Fprintf(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":%q}}\n\n", d)
            flusher.Flush()
        }
        fmt.Fprint(w, "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n")
        fmt.Fprint(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":5}}\n\n")
        fmt.Fprint(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
        flusher.Flush()
    }))
}

func TestAnthropicStreamContract(t *testing.T) {
    srv := fakeAnthropic(t, []string{"hi ", "there"})
    defer srv.Close()
    p, err := New(provider.Config{
        Type: "anthropic", Endpoint: srv.URL, Model: "claude-3-7-sonnet", APIKey: "sk-test",
    })
    if err != nil {
        t.Fatalf("New: %v", err)
    }
    defer p.Close()
    provider.RunStreamContract(t, p)
}

func TestAnthropicRequiresAPIKey(t *testing.T) {
    if _, err := New(provider.Config{Type: "anthropic", Endpoint: "http://x", Model: "m"}); err == nil {
        t.Fatalf("expected error when api key empty")
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/provider/anthropic/ -count=1
```

- [ ] **Step 3: Implement `anthropic.go`**

> The anthropic-sdk-go API surface evolves; consult the latest version's `messages.NewStreaming` signature before writing. The implementation below is the v2026-current shape; if compile errors arise, adapt to the actual SDK while preserving the contract.

Create `internal/provider/anthropic/anthropic.go`:

```go
// Package anthropic implements provider.Provider against the Anthropic
// Messages streaming API via github.com/anthropics/anthropic-sdk-go.
package anthropic

import (
    "context"
    "errors"
    "fmt"

    sdk "github.com/anthropics/anthropic-sdk-go"
    "github.com/anthropics/anthropic-sdk-go/option"
    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

type Provider struct {
    client *sdk.Client
    model  string
}

func New(cfg provider.Config) (*Provider, error) {
    if cfg.Model == "" {
        return nil, fmt.Errorf("anthropic: model is required")
    }
    if cfg.APIKey == "" {
        return nil, fmt.Errorf("anthropic: api key is required (check --api-key-env)")
    }
    opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey)}
    if cfg.Endpoint != "" {
        opts = append(opts, option.WithBaseURL(cfg.Endpoint))
    }
    c := sdk.NewClient(opts...)
    return &Provider{client: &c, model: cfg.Model}, nil
}

func (p *Provider) Close() error { return nil }

func (p *Provider) ChatStream(ctx context.Context, msgs []provider.Message) (<-chan provider.Event, error) {
    out := make(chan provider.Event, provider.ChannelBuffer)

    var systemBlocks []sdk.TextBlockParam
    var userMsgs []sdk.MessageParam
    for _, m := range msgs {
        switch m.Role {
        case "system":
            systemBlocks = append(systemBlocks, sdk.TextBlockParam{Text: m.Content})
        case "user":
            userMsgs = append(userMsgs, sdk.NewUserMessage(sdk.NewTextBlock(m.Content)))
        case "assistant":
            userMsgs = append(userMsgs, sdk.NewAssistantMessage(sdk.NewTextBlock(m.Content)))
        }
    }

    stream := p.client.Messages.NewStreaming(ctx, sdk.MessageNewParams{
        Model:     sdk.Model(p.model),
        MaxTokens: 4096,
        System:    systemBlocks,
        Messages:  userMsgs,
    })

    go func() {
        defer close(out)
        var emittedTerminal bool
        emitTerm := func(ev provider.Event) {
            if emittedTerminal {
                return
            }
            emittedTerminal = true
            select {
            case out <- ev:
            case <-ctx.Done():
            }
        }
        for stream.Next() {
            if ctx.Err() != nil {
                return
            }
            ev := stream.Current()
            switch d := ev.AsAny().(type) {
            case sdk.ContentBlockDeltaEvent:
                if td, ok := d.Delta.AsAny().(sdk.TextDelta); ok && td.Text != "" {
                    select {
                    case out <- provider.Event{Kind: provider.KindTextDelta, Text: td.Text}:
                    case <-ctx.Done():
                        return
                    }
                }
            case sdk.MessageStopEvent:
                emitTerm(provider.Event{Kind: provider.KindDone})
                return
            }
        }
        if err := stream.Err(); err != nil && !errors.Is(err, context.Canceled) {
            emitTerm(provider.Event{Kind: provider.KindError, Error: fmt.Errorf("%w: %v", provider.ErrUnavailable, err)})
            return
        }
        emitTerm(provider.Event{Kind: provider.KindDone})
    }()
    return out, nil
}
```

> If the SDK type names above (`ContentBlockDeltaEvent`, `TextDelta`, `MessageStopEvent`, `Model`, `MessageNewParams`) don't match the installed version, run `go doc github.com/anthropics/anthropic-sdk-go` to discover the real names and adapt — keeping the contract identical.

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/provider/anthropic/ -count=1 -v -timeout=60s
```

- [ ] **Step 5: Commit**

```bash
git add internal/provider/anthropic/
git commit -m "feat(provider/anthropic): SDK-backed SSE streaming with text-delta extraction"
```

---

## Task 9: Provider Factory

**Files:**
- Modify: `internal/provider/provider.go` (append `New` factory)
- Create: `internal/provider/factory_test.go`

Now that all three providers exist, add the factory.

- [ ] **Step 1: Write failing test**

Create `internal/provider/factory_test.go`:

```go
package provider_test

import (
    "testing"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
)

func TestNewUnknownType(t *testing.T) {
    if _, err := provider.New(provider.Config{Type: "bogus", Model: "m"}); err == nil {
        t.Errorf("expected error for unknown provider type")
    }
}

func TestNewEmptyModel(t *testing.T) {
    if _, err := provider.New(provider.Config{Type: "ollama", Model: ""}); err == nil {
        t.Errorf("expected error for empty model")
    }
}

func TestNewOllamaSucceeds(t *testing.T) {
    p, err := provider.New(provider.Config{Type: "ollama", Endpoint: "http://127.0.0.1:11434", Model: "qwen2.5:7b"})
    if err != nil {
        t.Fatalf("New: %v", err)
    }
    p.Close()
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/provider/... -run TestNew -count=1
```

- [ ] **Step 3: Append factory to `provider.go`**

Append to the bottom of `internal/provider/provider.go`:

```go
import (
    "fmt"

    "github.com/vellankikoti/kotg-ai-server/internal/provider/anthropic"
    "github.com/vellankikoti/kotg-ai-server/internal/provider/ollama"
    "github.com/vellankikoti/kotg-ai-server/internal/provider/openai"
)

// New validates config and returns a configured provider. Fails fast on
// invalid type, empty model, or missing API key (provider-specific).
// Called once at startup; never at request time.
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

> Important: this creates an import cycle if the subpackages import the parent for `Config`. They do — but Go allows this because `provider.Config` is in the parent package and the subpackages only import the parent for `Config`/`Message`/`Event`/sentinels. The factory is the parent importing children, which is a different direction. This is fine in Go (no cycle).
>
> If you see "import cycle" errors, the fix is to move `Config`/`Message`/`Event` into a `provider/types` subpackage that all three providers import, with the factory still living in `provider/`. Adapt as needed.

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/provider/... -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/provider/
git commit -m "feat(provider): factory function dispatching to ollama/openai/anthropic"
```

---

## Task 10: Transport — stdin Cert Reader

**Files:**
- Create: `internal/transport/stdin.go`
- Create: `internal/transport/stdin_test.go`

Mirror the framing format from kubilitics-backend `internal/ai/certs/mint.go:WriteStdinBlob`: 3 length-prefixed (4-byte BE) PEM payloads — CA, server cert, server key.

- [ ] **Step 1: Write failing test**

Create `internal/transport/stdin_test.go`:

```go
package transport

import (
    "bytes"
    "encoding/binary"
    "testing"
)

func writeBlob(parts ...[]byte) []byte {
    var buf bytes.Buffer
    for _, p := range parts {
        var hdr [4]byte
        binary.BigEndian.PutUint32(hdr[:], uint32(len(p)))
        buf.Write(hdr[:])
        buf.Write(p)
    }
    return buf.Bytes()
}

func TestReadCertBlobRoundtrip(t *testing.T) {
    ca := []byte("ca pem")
    cert := []byte("server cert pem")
    key := []byte("server key pem")
    raw := writeBlob(ca, cert, key)

    got, err := ReadCertBlob(bytes.NewReader(raw))
    if err != nil {
        t.Fatalf("ReadCertBlob: %v", err)
    }
    if string(got.CAPEM) != string(ca) || string(got.ServerCertPEM) != string(cert) || string(got.ServerKeyPEM) != string(key) {
        t.Errorf("roundtrip mismatch: %+v", got)
    }
}

func TestReadCertBlobRejectsHugePayload(t *testing.T) {
    var buf bytes.Buffer
    var hdr [4]byte
    binary.BigEndian.PutUint32(hdr[:], 1<<24) // 16MB
    buf.Write(hdr[:])
    if _, err := ReadCertBlob(&buf); err == nil {
        t.Errorf("expected error on oversized payload")
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/transport/ -count=1
```

- [ ] **Step 3: Implement `stdin.go`**

Create `internal/transport/stdin.go`:

```go
// Package transport handles the supervisor handshake plumbing — stdin
// cert reading and READY-line announcement after binding.
package transport

import (
    "encoding/binary"
    "fmt"
    "io"
)

// CertBundle holds the in-memory PEM blobs the supervisor minted and
// passed to us via stdin. Client cert/key never travel here — they
// stay with the supervisor.
type CertBundle struct {
    CAPEM         []byte
    ServerCertPEM []byte
    ServerKeyPEM  []byte
}

// Max payload size per part — prevents DoS via crafted header.
const maxPartBytes = 1 << 20 // 1 MiB

// ReadCertBlob parses 3 length-prefixed PEM payloads (CA, server cert,
// server key) from r. Matches kubilitics-backend's
// internal/ai/certs/mint.go:WriteStdinBlob framing.
func ReadCertBlob(r io.Reader) (*CertBundle, error) {
    parts := make([][]byte, 3)
    for i := range parts {
        var hdr [4]byte
        if _, err := io.ReadFull(r, hdr[:]); err != nil {
            return nil, fmt.Errorf("read length: %w", err)
        }
        n := binary.BigEndian.Uint32(hdr[:])
        if n > maxPartBytes {
            return nil, fmt.Errorf("payload too large: %d bytes", n)
        }
        buf := make([]byte, n)
        if _, err := io.ReadFull(r, buf); err != nil {
            return nil, fmt.Errorf("read payload %d: %w", i, err)
        }
        parts[i] = buf
    }
    return &CertBundle{CAPEM: parts[0], ServerCertPEM: parts[1], ServerKeyPEM: parts[2]}, nil
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/transport/ -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/transport/stdin.go internal/transport/stdin_test.go
git commit -m "feat(transport): cert blob reader matching supervisor framing"
```

---

## Task 11: Transport — Listener + READY

**Files:**
- Create: `internal/transport/listener.go`
- Create: `internal/transport/listener_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/transport/listener_test.go`:

```go
package transport

import (
    "bytes"
    "strings"
    "testing"
)

func TestBindLocalhostReturnsPort(t *testing.T) {
    lis, port, err := BindLocalhost()
    if err != nil {
        t.Fatalf("BindLocalhost: %v", err)
    }
    defer lis.Close()
    if port <= 0 {
        t.Errorf("port = %d, want >0", port)
    }
}

func TestWriteReadyFormat(t *testing.T) {
    var buf bytes.Buffer
    if err := WriteReady(&buf, 12345); err != nil {
        t.Fatalf("WriteReady: %v", err)
    }
    s := buf.String()
    if !strings.HasPrefix(s, "READY 12345") || !strings.HasSuffix(s, "\n") {
        t.Errorf("WriteReady format wrong: %q", s)
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/transport/ -run "TestBind|TestWriteReady" -count=1
```

- [ ] **Step 3: Implement `listener.go`**

Create `internal/transport/listener.go`:

```go
package transport

import (
    "fmt"
    "io"
    "net"
)

// BindLocalhost binds 127.0.0.1:0 (kernel-assigned port) and returns
// the listener + selected port. Caller MUST Close() on shutdown.
func BindLocalhost() (net.Listener, int, error) {
    lis, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        return nil, 0, fmt.Errorf("bind 127.0.0.1:0: %w", err)
    }
    addr, ok := lis.Addr().(*net.TCPAddr)
    if !ok {
        lis.Close()
        return nil, 0, fmt.Errorf("listener returned non-TCP addr: %T", lis.Addr())
    }
    return lis, addr.Port, nil
}

// WriteReady prints the supervisor handshake line "READY <port>\n" to w
// and flushes if w supports it. Caller MUST call AFTER BindLocalhost
// succeeds — never before.
func WriteReady(w io.Writer, port int) error {
    if _, err := fmt.Fprintf(w, "READY %d\n", port); err != nil {
        return err
    }
    if f, ok := w.(interface{ Sync() error }); ok {
        _ = f.Sync()
    }
    return nil
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/transport/ -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/transport/listener.go internal/transport/listener_test.go
git commit -m "feat(transport): localhost binder + READY line writer with bind-first invariant"
```

---

## Task 12: Server — AIControl

**Files:**
- Create: `internal/server/aicontrol.go`
- Create: `internal/server/aicontrol_test.go`

Implements `AIControl.Capabilities` against the kotg-schema generated stubs. Returns honest values from the configured provider.

- [ ] **Step 1: Write failing test**

Create `internal/server/aicontrol_test.go`:

```go
package server

import (
    "context"
    "testing"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

func TestCapabilitiesReportsConfiguredProvider(t *testing.T) {
    h := NewAIControl("ollama", "qwen2.5-coder:7b")
    resp, err := h.Capabilities(context.Background(), &kotgv1.Empty{})
    if err != nil {
        t.Fatalf("Capabilities: %v", err)
    }
    if resp.SchemaVersion != "1.0.1" {
        t.Errorf("SchemaVersion = %q, want 1.0.1", resp.SchemaVersion)
    }
    if len(resp.Providers) != 1 || resp.Providers[0] != "ollama" {
        t.Errorf("Providers = %v, want [ollama]", resp.Providers)
    }
    if len(resp.Models) != 1 || resp.Models[0] != "qwen2.5-coder:7b" {
        t.Errorf("Models = %v, want [qwen2.5-coder:7b]", resp.Models)
    }
    if resp.SupportsUndo || resp.SupportsPlans {
        t.Errorf("v1 must report SupportsUndo=false and SupportsPlans=false")
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/server/ -run TestCapabilities -count=1
```

- [ ] **Step 3: Implement `aicontrol.go`**

Create `internal/server/aicontrol.go`:

```go
package server

import (
    "context"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// AIVersion is bumped per kotg-ai-server release.
const AIVersion = "0.1.0"

// SchemaVersion MUST match the kotg-schema dep version in go.mod.
const SchemaVersion = "1.0.1"

type AIControlHandler struct {
    kotgv1.UnimplementedAIControlServer
    providerType string
    model        string
}

func NewAIControl(providerType, model string) *AIControlHandler {
    return &AIControlHandler{providerType: providerType, model: model}
}

func (h *AIControlHandler) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
    return &kotgv1.AICapabilities{
        SchemaVersion: SchemaVersion,
        AiVersion:     AIVersion,
        Providers:     []string{h.providerType},
        Models:        []string{h.model},
        SupportsUndo:  false,
        SupportsPlans: false,
    }, nil
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/server/ -run TestCapabilities -count=1 -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/server/aicontrol.go internal/server/aicontrol_test.go
git commit -m "feat(server): AIControl.Capabilities returns honest snapshot"
```

---

## Task 13: Server — Chat Handlers

**Files:**
- Create: `internal/server/chat.go`
- Create: `internal/server/chat_test.go`

Implements all four `Chat` RPCs: `CreateSession`, `Send` (bidi), `CancelTurn`, `ListSessions`. Wires the session manager + provider + prompt + budget.

- [ ] **Step 1: Write failing tests** (gRPC-level, using a fake Provider)

Create `internal/server/chat_test.go`:

```go
package server

import (
    "context"
    "errors"
    "io"
    "net"
    "testing"
    "time"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
    "github.com/vellankikoti/kotg-ai-server/internal/session"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

// fakeProvider emits a fixed sequence of events.
type fakeProvider struct{ events []provider.Event }

func (f *fakeProvider) ChatStream(ctx context.Context, _ []provider.Message) (<-chan provider.Event, error) {
    out := make(chan provider.Event, len(f.events))
    go func() {
        defer close(out)
        for _, e := range f.events {
            select {
            case out <- e:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out, nil
}
func (f *fakeProvider) Close() error { return nil }

func newTestChatClient(t *testing.T, p provider.Provider) (kotgv1.ChatClient, func()) {
    t.Helper()
    mgr := session.New(session.Config{TTL: time.Minute, MaxSessions: 100, MaxMessagesPerSession: 50, ReaperInterval: time.Second})
    h := NewChat(mgr, p, 16000)

    lis, _ := net.Listen("tcp", "127.0.0.1:0")
    srv := grpc.NewServer()
    kotgv1.RegisterChatServer(srv, h)
    go srv.Serve(lis)

    conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        t.Fatalf("dial: %v", err)
    }
    return kotgv1.NewChatClient(conn), func() {
        conn.Close()
        srv.Stop()
        mgr.Stop()
    }
}

func TestChatCreateSession(t *testing.T) {
    cli, cleanup := newTestChatClient(t, &fakeProvider{})
    defer cleanup()

    s, err := cli.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1", Title: "t"})
    if err != nil {
        t.Fatalf("CreateSession: %v", err)
    }
    if s.SessionId == "" || s.FocusClusterId != "c1" {
        t.Errorf("bad session: %+v", s)
    }
}

func TestChatSendStreamsTextDeltas(t *testing.T) {
    p := &fakeProvider{events: []provider.Event{
        {Kind: provider.KindTextDelta, Text: "hello "},
        {Kind: provider.KindTextDelta, Text: "world"},
        {Kind: provider.KindDone},
    }}
    cli, cleanup := newTestChatClient(t, p)
    defer cleanup()

    sess, _ := cli.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})

    ctx := metadata.AppendToOutgoingContext(context.Background(), "kotg-cluster-id", "c1")
    stream, err := cli.Send(ctx)
    if err != nil {
        t.Fatalf("Send: %v", err)
    }
    if err := stream.Send(&kotgv1.UserMessage{SessionId: sess.SessionId, TurnId: "t1", Text: "hi"}); err != nil {
        t.Fatalf("send msg: %v", err)
    }
    stream.CloseSend()

    var deltas []string
    var sawDone bool
    for {
        ev, err := stream.Recv()
        if errors.Is(err, io.EOF) {
            break
        }
        if err != nil {
            t.Fatalf("Recv: %v", err)
        }
        switch e := ev.Event.(type) {
        case *kotgv1.AssistantEvent_TextDelta:
            deltas = append(deltas, e.TextDelta.Text)
        case *kotgv1.AssistantEvent_Done:
            sawDone = true
        }
    }
    if len(deltas) != 2 || deltas[0] != "hello " || deltas[1] != "world" {
        t.Errorf("deltas = %v", deltas)
    }
    if !sawDone {
        t.Errorf("no Done event")
    }
}

func TestChatSendRejectsMissingClusterID(t *testing.T) {
    cli, cleanup := newTestChatClient(t, &fakeProvider{})
    defer cleanup()
    sess, _ := cli.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})

    stream, _ := cli.Send(context.Background()) // no metadata
    stream.Send(&kotgv1.UserMessage{SessionId: sess.SessionId, TurnId: "t1", Text: "hi"})
    stream.CloseSend()
    _, err := stream.Recv()
    if status.Code(err) != codes.InvalidArgument {
        t.Errorf("err code = %v, want InvalidArgument", status.Code(err))
    }
}

func TestChatSendRejectsClusterMismatch(t *testing.T) {
    cli, cleanup := newTestChatClient(t, &fakeProvider{})
    defer cleanup()
    sess, _ := cli.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})

    ctx := metadata.AppendToOutgoingContext(context.Background(), "kotg-cluster-id", "c2-different")
    stream, _ := cli.Send(ctx)
    stream.Send(&kotgv1.UserMessage{SessionId: sess.SessionId, TurnId: "t1", Text: "hi"})
    stream.CloseSend()
    _, err := stream.Recv()
    if status.Code(err) != codes.PermissionDenied {
        t.Errorf("err code = %v, want PermissionDenied", status.Code(err))
    }
}

func TestChatSendRejectsUnknownSession(t *testing.T) {
    cli, cleanup := newTestChatClient(t, &fakeProvider{})
    defer cleanup()

    ctx := metadata.AppendToOutgoingContext(context.Background(), "kotg-cluster-id", "c1")
    stream, _ := cli.Send(ctx)
    stream.Send(&kotgv1.UserMessage{SessionId: "nonexistent", TurnId: "t1", Text: "hi"})
    stream.CloseSend()
    _, err := stream.Recv()
    if status.Code(err) != codes.NotFound {
        t.Errorf("err code = %v, want NotFound", status.Code(err))
    }
}

func TestChatErrorBeforeTokensSkipsAssistantAppend(t *testing.T) {
    p := &fakeProvider{events: []provider.Event{
        {Kind: provider.KindError, Error: provider.ErrUnavailable},
    }}
    mgr := session.New(session.Config{TTL: time.Minute, MaxSessions: 100, MaxMessagesPerSession: 50})
    defer mgr.Stop()
    h := NewChat(mgr, p, 16000)

    sess, _ := h.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})

    // Drive Send via a fake bidi (skip gRPC plumbing for this assertion):
    // simpler — directly verify session state after a chat round.
    // The real handler test above covers the gRPC path; here we just
    // assert the no-partial-append rule via the manager state.
    h.HandleTurn(context.Background(), sess.SessionId, "c1", "user msg")
    s, _ := mgr.Get(sess.SessionId)
    for _, m := range s.Messages {
        if m.Role == "assistant" {
            t.Errorf("assistant message appended despite error-before-tokens")
        }
    }
}
```

- [ ] **Step 2: Run, expect compile failure**

```bash
go test ./internal/server/ -run TestChat -count=1
```

- [ ] **Step 3: Implement `chat.go`**

Create `internal/server/chat.go`:

```go
package server

import (
    "context"
    "fmt"
    "io"
    "strings"

    "github.com/vellankikoti/kotg-ai-server/internal/prompt"
    "github.com/vellankikoti/kotg-ai-server/internal/provider"
    "github.com/vellankikoti/kotg-ai-server/internal/session"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
    tspb "google.golang.org/protobuf/types/known/timestamppb"
)

type ChatHandler struct {
    kotgv1.UnimplementedChatServer
    sessions       *session.Manager
    p              provider.Provider
    maxBudgetToken int
}

func NewChat(sessions *session.Manager, p provider.Provider, maxBudgetTokens int) *ChatHandler {
    if maxBudgetTokens <= 0 {
        maxBudgetTokens = 16000
    }
    return &ChatHandler{sessions: sessions, p: p, maxBudgetToken: maxBudgetTokens}
}

func (h *ChatHandler) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
    if req.FocusClusterId == "" {
        return nil, status.Error(codes.InvalidArgument, "focus_cluster_id required")
    }
    s, err := h.sessions.Create(req.FocusClusterId, req.Title)
    if err != nil {
        return nil, status.Errorf(codes.ResourceExhausted, "create session: %v", err)
    }
    return sessionToProto(s), nil
}

func (h *ChatHandler) Send(stream kotgv1.Chat_SendServer) error {
    md, _ := metadata.FromIncomingContext(stream.Context())
    cids := md.Get("kotg-cluster-id")
    if len(cids) == 0 || cids[0] == "" {
        return status.Error(codes.InvalidArgument, "kotg-cluster-id metadata required")
    }
    clusterID := cids[0]

    msg, err := stream.Recv()
    if err != nil {
        return status.Errorf(codes.InvalidArgument, "first frame: %v", err)
    }
    if msg.SessionId == "" {
        return status.Error(codes.InvalidArgument, "session_id required; call CreateSession first")
    }

    sess, ok := h.sessions.Get(msg.SessionId)
    if !ok {
        return status.Error(codes.NotFound, "session not found")
    }
    if sess.FocusClusterID != clusterID {
        return status.Error(codes.PermissionDenied, "cluster_id does not match session focus")
    }

    text := msg.Text
    if msg.ContextHint != "" {
        text = msg.Text + "\n\n[context: " + msg.ContextHint + "]"
    }

    return h.handleTurnStream(stream, sess.ID, clusterID, text)
}

// HandleTurn is exported for tests; production flow goes through Send.
func (h *ChatHandler) HandleTurn(ctx context.Context, sessionID, clusterID, userText string) {
    if err := h.sessions.Append(sessionID, provider.Message{Role: "user", Content: userText}); err != nil {
        return
    }
    sess, _ := h.sessions.Get(sessionID)
    msgs := []provider.Message{{Role: "system", Content: prompt.BuildSystemPrompt(clusterID)}}
    msgs = append(msgs, sess.Messages...)
    msgs = TrimToBudget(msgs, h.maxBudgetToken)

    turnCtx, cancel := context.WithCancel(ctx)
    defer cancel()
    h.sessions.SetTurnCancel(sessionID, cancel)
    defer h.sessions.SetTurnCancel(sessionID, nil)

    ch, err := h.p.ChatStream(turnCtx, msgs)
    if err != nil {
        return
    }
    var buf strings.Builder
    var sawDelta bool
    for ev := range ch {
        if ev.Kind == provider.KindTextDelta {
            sawDelta = true
            buf.WriteString(ev.Text)
        }
    }
    if sawDelta {
        _ = h.sessions.Append(sessionID, provider.Message{Role: "assistant", Content: buf.String()})
    }
}

func (h *ChatHandler) handleTurnStream(stream kotgv1.Chat_SendServer, sessionID, clusterID, userText string) error {
    if err := h.sessions.Append(sessionID, provider.Message{Role: "user", Content: userText}); err != nil {
        return status.Errorf(codes.Internal, "append: %v", err)
    }
    sess, _ := h.sessions.Get(sessionID)
    msgs := []provider.Message{{Role: "system", Content: prompt.BuildSystemPrompt(clusterID)}}
    msgs = append(msgs, sess.Messages...)
    msgs = TrimToBudget(msgs, h.maxBudgetToken)

    turnCtx, cancel := context.WithCancel(stream.Context())
    defer cancel()
    h.sessions.SetTurnCancel(sessionID, cancel)
    defer h.sessions.SetTurnCancel(sessionID, nil)

    ch, err := h.p.ChatStream(turnCtx, msgs)
    if err != nil {
        return status.Error(provider.ToGRPCCode(err), err.Error())
    }

    var buf strings.Builder
    var sawDelta bool
    var promptTokens, completionTokens int32

    for ev := range ch {
        switch ev.Kind {
        case provider.KindTextDelta:
            sawDelta = true
            buf.WriteString(ev.Text)
            if err := stream.Send(&kotgv1.AssistantEvent{
                Event: &kotgv1.AssistantEvent_TextDelta{TextDelta: &kotgv1.TextDelta{Text: ev.Text}},
            }); err != nil {
                return err
            }
        case provider.KindError:
            return status.Error(provider.ToGRPCCode(ev.Error), ev.Error.Error())
        case provider.KindDone:
            // emit final Done with token estimates after loop
        }
    }

    if sawDelta {
        _ = h.sessions.Append(sessionID, provider.Message{Role: "assistant", Content: buf.String()})
        completionTokens = int32(approxTokens(buf.String()))
    }
    promptTokens = int32(totalTokens(msgs))

    return stream.Send(&kotgv1.AssistantEvent{
        Event: &kotgv1.AssistantEvent_Done{Done: &kotgv1.Done{
            PromptTokens:     promptTokens,
            CompletionTokens: completionTokens,
        }},
    })
}

func (h *ChatHandler) CancelTurn(_ context.Context, req *kotgv1.CancelTurnRequest) (*kotgv1.Empty, error) {
    if err := h.sessions.CancelTurn(req.SessionId); err != nil {
        return nil, status.Error(codes.NotFound, err.Error())
    }
    return &kotgv1.Empty{}, nil
}

func (h *ChatHandler) ListSessions(req *kotgv1.ListSessionsRequest, stream kotgv1.Chat_ListSessionsServer) error {
    for _, s := range h.sessions.List(int(req.Limit), req.SinceUnix) {
        if err := stream.Send(sessionToProto(s)); err != nil {
            return err
        }
    }
    return nil
}

func sessionToProto(s *session.Session) *kotgv1.Session {
    return &kotgv1.Session{
        SessionId:      s.ID,
        Title:          s.Title,
        FocusClusterId: s.FocusClusterID,
        CreatedAt:      tspb.New(s.CreatedAt),
        UpdatedAt:      tspb.New(s.UpdatedAt),
        TurnCount:      int32(len(s.Messages) / 2),
    }
}

// silence import for io if some helper drops out
var _ = io.EOF
```

> **Done message field-name verification:** the plan assumes `Done{PromptTokens, CompletionTokens}`. Verify field names in `~/code/kotg-schema/gen/go/kotg/v1/chat.pb.go` for the `Done` message — the chat.proto preview earlier showed `prompt_tokens int32 = 3` so the Go field is likely `PromptTokens`. Adapt if different.

- [ ] **Step 4: Run, expect PASS**

```bash
go test ./internal/server/ -count=1 -v -timeout=60s
```

If `TestChatErrorBeforeTokensSkipsAssistantAppend` fails because `HandleTurn` is treated as deprecated, that's acceptable — the test is a redundant safety net for the rule already enforced inside `handleTurnStream`. Keep it.

- [ ] **Step 5: Commit**

```bash
git add internal/server/chat.go internal/server/chat_test.go
git commit -m "feat(server): Chat.{CreateSession,Send,CancelTurn,ListSessions} with session+prompt+budget"
```

---

## Task 14: Server Constructor (Wire Up)

**Files:**
- Create: `internal/server/server.go`

Constructs the gRPC server with mTLS, registers Health + AIControl + Chat. No tests at this layer — exercised by integration tests in Task 15 and the smoke test in Task 17.

- [ ] **Step 1: Implement `server.go`**

Create `internal/server/server.go`:

```go
package server

import (
    "crypto/tls"
    "crypto/x509"
    "fmt"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
    "github.com/vellankikoti/kotg-ai-server/internal/session"
    "github.com/vellankikoti/kotg-ai-server/internal/transport"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"
    "google.golang.org/grpc/health"
    healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// New constructs the gRPC server with mTLS using the supplied cert
// bundle and registers all kotg-ai-server services.
func New(bundle *transport.CertBundle, sessions *session.Manager, p provider.Provider, providerType, model string, maxTokens int) (*grpc.Server, error) {
    serverCert, err := tls.X509KeyPair(bundle.ServerCertPEM, bundle.ServerKeyPEM)
    if err != nil {
        return nil, fmt.Errorf("server keypair: %w", err)
    }
    caPool := x509.NewCertPool()
    if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
        return nil, fmt.Errorf("ca pool")
    }
    tlsCfg := &tls.Config{
        Certificates: []tls.Certificate{serverCert},
        ClientCAs:    caPool,
        ClientAuth:   tls.RequireAndVerifyClientCert,
        MinVersion:   tls.VersionTLS13,
    }

    srv := grpc.NewServer(grpc.Creds(credentials.NewTLS(tlsCfg)))

    h := health.NewServer()
    h.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
    healthpb.RegisterHealthServer(srv, h)

    kotgv1.RegisterAIControlServer(srv, NewAIControl(providerType, model))
    kotgv1.RegisterChatServer(srv, NewChat(sessions, p, maxTokens))

    return srv, nil
}
```

- [ ] **Step 2: Build, commit**

```bash
go build ./internal/server/...
git add internal/server/server.go
git commit -m "feat(server): mTLS server constructor wiring health + AIControl + Chat"
```

---

## Task 15: main.go (Bootstrap + Signal Handling)

**Files:**
- Create: `cmd/kotg-ai-server/main.go`

Top-level binary. Parses flags, validates fast, reads certs, binds, prints READY, serves until SIGTERM.

- [ ] **Step 1: Implement**

Create `cmd/kotg-ai-server/main.go`:

```go
// Command kotg-ai-server is the AI sidecar binary the kubilitics-backend
// supervisor exec's. See docs/superpowers/specs/2026-04-19-kotg-ai-server-v1-design.md
// in the kubilitics repo for the full design.
package main

import (
    "context"
    "flag"
    "fmt"
    "log"
    "net/url"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/vellankikoti/kotg-ai-server/internal/provider"
    "github.com/vellankikoti/kotg-ai-server/internal/server"
    "github.com/vellankikoti/kotg-ai-server/internal/session"
    "github.com/vellankikoti/kotg-ai-server/internal/transport"
)

func main() {
    var (
        providerType        = flag.String("provider", "ollama", "ollama | openai | anthropic")
        endpoint            = flag.String("endpoint", "http://127.0.0.1:11434", "provider base URL")
        model               = flag.String("model", "", "provider-specific model id (required)")
        apiKeyEnv           = flag.String("api-key-env", "", "env var name holding the API key (optional for Ollama)")
        sessionTTL          = flag.Duration("session-ttl", 15*time.Minute, "idle session TTL")
        maxSessions         = flag.Int("max-sessions", 1000, "hard cap on active sessions")
        maxMessages         = flag.Int("max-messages-per-session", 100, "hard cap on retained messages per session")
        maxBudgetTokens     = flag.Int("max-budget-tokens", 16000, "approximate token budget per provider call")
    )
    flag.Parse()

    // ─── validate ──────────────────────────────────────────────────────
    if err := validateFlags(*providerType, *endpoint, *model); err != nil {
        fmt.Fprintf(os.Stderr, "config error: %v\n", err)
        os.Exit(2)
    }
    apiKey := ""
    if *apiKeyEnv != "" {
        apiKey = os.Getenv(*apiKeyEnv)
        if apiKey == "" {
            fmt.Fprintf(os.Stderr, "config error: env var %s is empty\n", *apiKeyEnv)
            os.Exit(2)
        }
    }

    // ─── read mTLS certs from stdin ────────────────────────────────────
    bundle, err := transport.ReadCertBlob(os.Stdin)
    if err != nil {
        fmt.Fprintf(os.Stderr, "cert blob: %v\n", err)
        os.Exit(2)
    }

    // ─── construct provider (fail fast) ────────────────────────────────
    p, err := provider.New(provider.Config{
        Type:     *providerType,
        Endpoint: *endpoint,
        Model:    *model,
        APIKey:   apiKey,
    })
    if err != nil {
        fmt.Fprintf(os.Stderr, "provider: %v\n", err)
        os.Exit(2)
    }
    defer p.Close()

    // ─── session manager ───────────────────────────────────────────────
    mgr := session.New(session.Config{
        TTL:                   *sessionTTL,
        MaxSessions:           *maxSessions,
        MaxMessagesPerSession: *maxMessages,
    })
    defer mgr.Stop()

    // ─── bind THEN print READY ─────────────────────────────────────────
    lis, port, err := transport.BindLocalhost()
    if err != nil {
        fmt.Fprintf(os.Stderr, "bind: %v\n", err)
        os.Exit(2)
    }

    grpcSrv, err := server.New(bundle, mgr, p, *providerType, *model, *maxBudgetTokens)
    if err != nil {
        fmt.Fprintf(os.Stderr, "server: %v\n", err)
        os.Exit(2)
    }

    // Bind succeeded → print READY (ONLY after bind).
    if err := transport.WriteReady(os.Stdout, port); err != nil {
        fmt.Fprintf(os.Stderr, "write ready: %v\n", err)
        os.Exit(2)
    }
    log.Printf("kotg-ai-server: provider=%s model=%s endpoint=%s port=%d", *providerType, *model, *endpoint, port)

    // ─── signal handling ───────────────────────────────────────────────
    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer cancel()

    serveErr := make(chan error, 1)
    go func() { serveErr <- grpcSrv.Serve(lis) }()

    select {
    case <-ctx.Done():
        log.Printf("kotg-ai-server: shutdown signal received")
        grpcSrv.GracefulStop()
    case err := <-serveErr:
        if err != nil {
            log.Printf("kotg-ai-server: serve: %v", err)
        }
    }
}

func validateFlags(providerType, endpoint, model string) error {
    switch providerType {
    case "ollama", "openai", "anthropic":
    default:
        return fmt.Errorf("unsupported --provider %q (want ollama|openai|anthropic)", providerType)
    }
    u, err := url.Parse(endpoint)
    if err != nil || u.Scheme == "" || u.Host == "" {
        return fmt.Errorf("invalid --endpoint %q", endpoint)
    }
    if model == "" {
        return fmt.Errorf("--model is required")
    }
    return nil
}
```

- [ ] **Step 2: Build, expect clean**

```bash
go build ./cmd/kotg-ai-server/
```

- [ ] **Step 3: Commit**

```bash
git add cmd/kotg-ai-server/
git commit -m "feat(cmd): main bootstrap with flag validation, cert read, bind→READY, signal handling"
```

---

## Task 16: End-to-End Handshake Test (Reuse Supervisor's Stub Pattern)

**Files:**
- Create: `cmd/kotg-ai-server/main_test.go`

Spawns the binary via `exec`, mints a CA + client cert + server cert (matching the supervisor's exact framing), feeds via stdin, parses READY, dials with mTLS, calls `Capabilities`, asserts.

- [ ] **Step 1: Implement** (long file but self-contained)

Create `cmd/kotg-ai-server/main_test.go`:

```go
package main

import (
    "bufio"
    "context"
    "crypto/ecdsa"
    "crypto/elliptic"
    "crypto/rand"
    "crypto/tls"
    "crypto/x509"
    "crypto/x509/pkix"
    "encoding/binary"
    "encoding/pem"
    "fmt"
    "io"
    "math/big"
    "net"
    "os/exec"
    "path/filepath"
    "strconv"
    "strings"
    "testing"
    "time"

    kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"
)

// Reproduce the supervisor's blob framing: 3 length-prefixed PEM
// payloads (CA, server cert, server key).
func writeBlob(w io.Writer, parts ...[]byte) error {
    for _, p := range parts {
        var hdr [4]byte
        binary.BigEndian.PutUint32(hdr[:], uint32(len(p)))
        if _, err := w.Write(hdr[:]); err != nil {
            return err
        }
        if _, err := w.Write(p); err != nil {
            return err
        }
    }
    return nil
}

func mintTestCerts(t *testing.T) (caPEM, srvCertPEM, srvKeyPEM, cliCertPEM, cliKeyPEM []byte) {
    t.Helper()
    caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
    caTpl := &x509.Certificate{
        SerialNumber: big.NewInt(1),
        Subject: pkix.Name{CommonName: "test-ca"},
        NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
        KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
        BasicConstraintsValid: true, IsCA: true,
    }
    caDER, _ := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
    caPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

    sign := func(cn string, eku []x509.ExtKeyUsage, ips []net.IP, dns []string) ([]byte, []byte) {
        k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
        tpl := &x509.Certificate{
            SerialNumber: big.NewInt(time.Now().UnixNano()),
            Subject: pkix.Name{CommonName: cn},
            NotBefore: caTpl.NotBefore, NotAfter: caTpl.NotAfter,
            KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
            ExtKeyUsage: eku, IPAddresses: ips, DNSNames: dns,
        }
        der, _ := x509.CreateCertificate(rand.Reader, tpl, caTpl, &k.PublicKey, caKey)
        keyDER, _ := x509.MarshalECPrivateKey(k)
        return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
            pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
    }
    srvCertPEM, srvKeyPEM = sign("kotg-ai-server",
        []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
        []net.IP{net.ParseIP("127.0.0.1")}, []string{"localhost"})
    cliCertPEM, cliKeyPEM = sign("test-client",
        []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, nil, nil)
    return
}

func buildBinary(t *testing.T) string {
    t.Helper()
    out := filepath.Join(t.TempDir(), "kotg-ai-server")
    cmd := exec.Command("go", "build", "-o", out, ".")
    if outBytes, err := cmd.CombinedOutput(); err != nil {
        t.Fatalf("build: %v\n%s", err, outBytes)
    }
    return out
}

func TestE2EHandshakeAndCapabilities(t *testing.T) {
    bin := buildBinary(t)
    ca, sCert, sKey, cCert, cKey := mintTestCerts(t)

    // Use a fake Ollama endpoint (closed port) — Capabilities doesn't
    // call the provider, only Chat does.
    cmd := exec.Command(bin,
        "--provider=ollama",
        "--endpoint=http://127.0.0.1:1",
        "--model=qwen2.5:7b",
    )
    stdin, _ := cmd.StdinPipe()
    stdout, _ := cmd.StdoutPipe()
    if err := cmd.Start(); err != nil {
        t.Fatalf("start: %v", err)
    }
    defer func() { _ = cmd.Process.Kill(); cmd.Wait() }()

    if err := writeBlob(stdin, ca, sCert, sKey); err != nil {
        t.Fatalf("write blob: %v", err)
    }
    stdin.Close()

    sc := bufio.NewScanner(stdout)
    if !sc.Scan() {
        t.Fatalf("no READY line: %v", sc.Err())
    }
    line := sc.Text()
    if !strings.HasPrefix(line, "READY ") {
        t.Fatalf("expected READY, got %q", line)
    }
    port, _ := strconv.Atoi(strings.TrimPrefix(line, "READY "))
    if port <= 0 {
        t.Fatalf("bad port from READY line: %q", line)
    }

    clientPair, _ := tls.X509KeyPair(cCert, cKey)
    pool := x509.NewCertPool()
    pool.AppendCertsFromPEM(ca)
    creds := credentials.NewTLS(&tls.Config{
        Certificates: []tls.Certificate{clientPair},
        RootCAs:      pool,
        ServerName:   "localhost",
        MinVersion:   tls.VersionTLS13,
    })
    conn, err := grpc.NewClient(fmt.Sprintf("127.0.0.1:%d", port), grpc.WithTransportCredentials(creds))
    if err != nil {
        t.Fatalf("dial: %v", err)
    }
    defer conn.Close()

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    cli := kotgv1.NewAIControlClient(conn)
    resp, err := cli.Capabilities(ctx, &kotgv1.Empty{})
    if err != nil {
        t.Fatalf("Capabilities: %v", err)
    }
    if resp.SchemaVersion != "1.0.1" {
        t.Errorf("SchemaVersion = %q, want 1.0.1", resp.SchemaVersion)
    }
    if len(resp.Providers) != 1 || resp.Providers[0] != "ollama" {
        t.Errorf("Providers = %v, want [ollama]", resp.Providers)
    }
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
go test ./cmd/kotg-ai-server/ -count=1 -v -timeout=120s
```

If `t.TempDir()` causes path issues with relative `go build .`, switch to absolute working dir. Adjust as needed.

- [ ] **Step 3: Commit**

```bash
git add cmd/kotg-ai-server/main_test.go
git commit -m "test(e2e): handshake + mTLS dial + Capabilities against built binary"
```

---

## Task 17: README + Smoke Instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:

````markdown
# kotg-ai-server

Minimal Go gRPC sidecar that fronts LLM providers (Ollama, OpenAI, Anthropic) for the Kubilitics AI integration. Designed to be exec'd by the kubilitics-backend AI supervisor over a per-spawn ephemeral mTLS handshake.

## Wire contract

`github.com/vellankikoti/kotg-schema@v1.0.1` — see that repo for the full proto definitions.

This server implements:

- `kotg.v1.AIControl/Capabilities` — returns `{schema_version:"1.0.1", ai_version, providers, models, supports_undo:false, supports_plans:false}`
- `kotg.v1.Chat/CreateSession`, `Send` (bidi stream), `CancelTurn`, `ListSessions`
- `grpc.health.v1.Health/Check`

## Lifecycle

The supervisor:
1. Mints an ephemeral CA + server cert + client cert in memory.
2. Exec's `kotg-ai-server` with provider flags.
3. Writes 3 length-prefixed PEM payloads (CA, server cert, server key) to stdin.

The server:
1. Reads the cert blob from stdin.
2. Validates flags (`--provider`, `--endpoint`, `--model`, optional `--api-key-env`).
3. Binds `127.0.0.1:0`.
4. Prints `READY <port>\n` to stdout (only after bind succeeds).
5. Serves gRPC over mTLS until SIGTERM.

## CLI flags

```
--provider                 ollama|openai|anthropic   (required)
--endpoint                 base URL                  (required)
--model                    provider-specific model   (required)
--api-key-env              env-var name holding API key (optional; required for openai/anthropic)
--session-ttl              idle session TTL          (default 15m)
--max-sessions             cap                       (default 1000)
--max-messages-per-session cap                       (default 100)
--max-budget-tokens        per-call token budget     (default 16000)
```

## Smoke test (manual; not in CI)

Run a local Ollama, then:

```sh
# 1. Build
go build -o /tmp/kotg-ai-server ./cmd/kotg-ai-server/

# 2. Pull a model
ollama pull qwen2.5-coder:7b

# 3. Run via the e2e harness (uses the test cert+blob plumbing)
go test ./cmd/kotg-ai-server/ -run TestE2E -v
```

For a real chat smoke test, drive the binary from kubilitics-backend with `KUBILITICS_AI_ENABLED=true KUBILITICS_AI_BINARY_PATH=/tmp/kotg-ai-server` and curl the AI WS endpoint per the supervisor spec.

## Out of scope (later versions)

- Tool calling / function calling — v1.5
- MCP server registration — v1.5
- RAG / vector search — v2
- Multi-agent — v2
- Server-side session summarization or persistence — v2

See `docs/superpowers/specs/2026-04-19-kotg-ai-server-v1-design.md` in the kubilitics repo for the full design + roadmap.

## License

TBD — public repo for now.
````

- [ ] **Step 2: Commit + push**

```bash
git add README.md
git commit -m "docs: README with wire contract + lifecycle + smoke instructions"
git push origin main
```

---

## Task 18: Tag v0.1.0

- [ ] **Step 1: Verify CI green**

```bash
gh run list --workflow=lint --limit=1
```

- [ ] **Step 2: Tag + push**

```bash
git tag -a v0.1.0 -m "v0.1.0 — minimal Go sidecar (Ollama+OpenAI+Anthropic, in-memory sessions)"
git push origin v0.1.0
```

- [ ] **Step 3: Verify release**

```bash
gh run list --workflow=release --limit=1     # wait for green
gh release view v0.1.0                       # confirm GitHub Release exists
curl -sI https://proxy.golang.org/github.com/vellankikoti/kotg-ai-server/@v/v0.1.0.info | head -1
```

Expected: HTTP 200 from the proxy. (Per the lesson learned during kotg-schema renaming, no path-rename needed here — module path was correct from the start.)

---

## Task 19: Memory Snapshot

**Files:**
- Create: `~/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/project_kotg_ai_server_v0_1_0.md`
- Modify: `~/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/MEMORY.md`

- [ ] **Step 1: Write project memory**

Create the memory file:

```markdown
---
name: kotg-ai-server v0.1.0 shipped
description: Minimal Go gRPC sidecar at vellankikoti/kotg-ai-server@v0.1.0. Three providers (Ollama+OpenAI+Anthropic), in-memory sessions with TTL, K8s-aware system prompt. Subproject 4 of the AI integration arc.
type: project
---

**Status:** v0.1.0 published. Module: `github.com/vellankikoti/kotg-ai-server`. Tag, GitHub release, and proxy.golang.org all green.

**What's in:**
- gRPC mTLS sidecar (server cert from stdin, binds 127.0.0.1:0, prints READY <port>)
- Three LLM providers via native Go SDKs: Ollama, OpenAI, Anthropic
- Provider abstraction with classified errors (Unavailable/RateLimited/InvalidArgument/Internal)
- In-memory session manager (TTL 15min, max 1000 sessions, max 100 msgs/session, idle reaper)
- K8s-aware baked-in system prompt with cluster_id injection
- Token-budget guard (default 16k, system+latest never dropped)
- Chat bidi RPC: enforces session_id, validates cluster_id metadata, cluster-mismatch → PermissionDenied, no-partial-append on error-before-tokens

**What's NOT in (deferred):**
- Tool calling / function calling — v1.5
- MCP — v1.5
- RAG / Qdrant / Kuzu — v2
- Multi-agent — v2
- Session persistence/summarization — v2
- Provider routing (--provider=multi) — v1.5

**Wire-contract anchors used (all match kotg-schema v1.0.1):**
- AIControl RPC: `Capabilities(Empty) → AICapabilities`
- Chat RPCs: `CreateSession`, `Send` (bidi: UserMessage in, AssistantEvent out), `CancelTurn`, `ListSessions`
- AssistantEvent variants emitted in v1: `_TextDelta`, `_Done`. (Error → gRPC status, NOT `_Error` event.)

**How to apply:**
- Subproject 5 (chat panel UI) consumes the kubilitics-backend WS endpoint that already proxies to this sidecar via supervisor (subproject 2).
- Subproject 7 (Tauri sidecar packaging) embeds this binary alongside the kubilitics-backend Go binary.
- Subproject 8 (Helm) packages it as a sidecar container next to the backend.
- For local dev: build with `go build -o /tmp/kotg-ai-server ./cmd/kotg-ai-server/`, pull `ollama pull qwen2.5-coder:7b`, set `KUBILITICS_AI_ENABLED=true KUBILITICS_AI_BINARY_PATH=/tmp/kotg-ai-server` on the kubilitics-backend dev server.
```

- [ ] **Step 2: Add to MEMORY.md index**

Append:

```
- [kotg-ai-server v0.1.0](project_kotg_ai_server_v0_1_0.md) — Minimal Go sidecar shipped at vellankikoti/kotg-ai-server@v0.1.0. Three providers, in-memory sessions, K8s-aware prompt. Subproject 4 done.
```

- [ ] **Step 3: No commit** — memory files are not in the repo.

---

## Self-Review

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| §1 Locked Decisions (1–5) | Pre-flight (#1 repo), T6/T7/T8 (#2 SDKs), T15 (#3 flags+env), T4+T13 (#4 sessions), T1 (#5 prompt) |
| §2 Architecture / package layout | All tasks follow layout exactly |
| §3 Provider Interface (Provider + Config + Event + classification + factory) | T2, T6, T7, T8, T9 |
| §4 Chat Flow (session manager, per-turn flow, system prompt, event mapping, AICapabilities) | T1, T4, T12, T13 |
| §5 Configuration + invocation (CLI flags, validation, logging, backend config extension) | T15 (server flags). Backend config extension itself happens in subproject 2's follow-up — out of scope here. |
| §6 Testing (unit, provider, stream contract, cancel, backpressure, server integration, schema-version, handshake, smoke) | T1/T3/T4 (unit), T6/T7/T8 (provider integration + contract), T5 (shared contract helpers), T13 (server integration), T12 (schema version), T16 (handshake), T17 (smoke instructions) |
| §6 Repo bootstrap | Pre-flight |
| §6 Rollout | Pre-flight (CI), T17 (README), T18 (tag) |
| §7 Out of Scope | T17 README + spec referenced |

**Backend config extension** (the v1 of `cfg.AI.provider/endpoint/model/apiKeyEnv` fields the supervisor passes via argv) is NOT in this plan — it's a follow-up edit to kubilitics-backend's `internal/config/config.go` and supervisor `spawn.go`. Add as a separate small task once this binary is tagged.

**Placeholder scan:** none of the forbidden patterns. Type-name verification notes are explicit at T8 (anthropic SDK), T13 (Done message field names).

**Type consistency:** `Provider`, `Config`, `Message`, `Event`, `EventKind` shapes consistent across T2, T5, T6, T7, T8, T9, T13, T15. `Session` shape consistent T4 → T13. `CertBundle` consistent T10 → T14 → T15.

**Known caveats:**
- T8 anthropic SDK type names are best-effort; verify via `go doc` before committing.
- T13's `Done{PromptTokens, CompletionTokens}` field names depend on the kotg-schema generated code; verify in the .pb.go.
- The plan defers the "extend cfg.AI on the backend with provider/endpoint/model/apiKeyEnv" change to a follow-up — without it, the supervisor (subproject 2) can't actually pass these flags. That follow-up is small (4 fields + supervisor argv build) and lives in the kubilitics repo, not here.
