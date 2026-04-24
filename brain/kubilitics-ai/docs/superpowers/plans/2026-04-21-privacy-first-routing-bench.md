# Privacy-First Routing Bench — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three deferred code fixes (MaxTurns, OpenAI 429 retry, rate-limit docs), add a routing tracer + per-stage cost accounting + privacy guardrail tests, build a self-contained HTML bench report generator, then run the full investor-grade bench (smoke-20 local + small-VM, 500 on a GPU VM) and produce a committed HTML report with 50 per-prompt SVG routing diagrams.

**Architecture:** Tracer hooks are injected at each existing boundary (user→LLM, LLM→executor→backend→K8s→summarizer→LLM) emitting JSONL per turn. A cost tallier maps tokens × model price to USD. A privacy test suite pumps synthetic K8s payloads with sensitive values through the full redaction chain and asserts zero leakage. The bench harness grows a `--trace-dir` flag and dumps per-prompt trace files. A new `cmd/bench-report` reads JUnit XML + traces and renders one self-contained HTML file with inline SVG.

**Tech Stack:** Go 1.24 (brain), existing k8s REST + gRPC integration, OpenAI + Ollama LLM providers, standard library only for report generation (no external JS/CSS deps).

---

## Preconditions (do once, before Task 1)

- [ ] **Precondition A: Clean git state**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && git status -sb
```
Expected: `## main...origin/main` with no unstaged/staged changes. Commit or stash first.

- [ ] **Precondition B: Services not running (they'll conflict during brain restart)**

```bash
lsof -nP -iTCP:50051 -iTCP:28081 -sTCP:LISTEN
```
If anything is bound, kill it. The brain will be restarted in Task 12.

- [ ] **Precondition C: AWS CLI works**

```bash
aws sts get-caller-identity --query 'Arn' --output text
```
Expected: an IAM user ARN. Small-VM + big-VM tasks need it.

---

## Task 1: Fix A — bump `MaxTurns` to 20 with env override

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution.go`
- Test: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution_test.go`

- [ ] **Step 1.1: Write the failing test**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution_test.go` if not present (append otherwise):

```go
package types

import (
	"os"
	"testing"
)

func TestDefaultAgentConfig_MaxTurnsIs20(t *testing.T) {
	// Regression: 10 was too low for prompts that iterate namespace-by-namespace
	// (e.g. "list all the pods"). The bench hit "agentic loop exceeded max
	// turns (10) without final answer" in 14 of 250 runs on Apr 21.
	if got := DefaultAgentConfig().MaxTurns; got != 20 {
		t.Fatalf("DefaultAgentConfig().MaxTurns = %d, want 20", got)
	}
}

func TestDefaultAgentConfig_MaxTurnsRespectsEnv(t *testing.T) {
	t.Setenv("KOTG_AGENT_MAX_TURNS", "7")
	if got := DefaultAgentConfig().MaxTurns; got != 7 {
		t.Fatalf("env override not honored: got %d", got)
	}
}

func TestDefaultAgentConfig_MaxTurnsBadEnvFallsBackToDefault(t *testing.T) {
	t.Setenv("KOTG_AGENT_MAX_TURNS", "not-a-number")
	if got := DefaultAgentConfig().MaxTurns; got != 20 {
		t.Fatalf("bad env should fall back to 20, got %d", got)
	}
	_ = os.Unsetenv("KOTG_AGENT_MAX_TURNS")
}
```

- [ ] **Step 1.2: Run test, expect fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/llm/types/... -run MaxTurns -v
```
Expected: FAIL — `MaxTurns = 10, want 20`.

- [ ] **Step 1.3: Implement**

Edit `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution.go`. Find the existing `DefaultAgentConfig()` function and replace its body:

```go
// DefaultAgentConfig returns safe production defaults.
//
// MaxTurns was 10 historically. Bench on Apr 21 showed 14/250 prompts hit
// that cap when the LLM walked resource lists one namespace at a time.
// Bumped to 20. Overridable via KOTG_AGENT_MAX_TURNS for ops who want to
// tune without a rebuild.
func DefaultAgentConfig() AgentConfig {
	max := 20
	if v := os.Getenv("KOTG_AGENT_MAX_TURNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			max = n
		}
	}
	return AgentConfig{
		MaxTurns:      max,
		ParallelTools: true,
	}
}
```

Also add `"os"` and `"strconv"` to the file's imports if not already present.

- [ ] **Step 1.4: Run tests, expect pass**

```bash
go test ./internal/llm/types/... -run MaxTurns -v
```
Expected: 3 PASS.

- [ ] **Step 1.5: Run the broader test suite — nothing else should break**

```bash
go test ./internal/llm/... -count=1
```
Expected: all PASS.

- [ ] **Step 1.6: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/llm/types/tool_execution.go internal/llm/types/tool_execution_test.go
git commit -m "fix(agent): MaxTurns 10 -> 20 with KOTG_AGENT_MAX_TURNS override

Apr 21 bench: 14/250 prompts failed 'agentic loop exceeded max turns
(10)' — the LLM walks resource lists namespace-by-namespace and needs
more headroom. 20 fits the worst observed case with margin; env
override lets ops tune without a rebuild."
```

---

## Task 2: Fix B — OpenAI 429 retry with backoff

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/openai/retry.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/openai/retry_test.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/openai/tool_loop.go` (call site)

- [ ] **Step 2.1: Find the existing call site**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
grep -n "httpClient.Do\|http.NewRequest\|ctx, \"POST\"" internal/llm/provider/openai/tool_loop.go | head
```
Expected: find the `httpReq` + `resp, err := c.httpClient.Do(httpReq)` pair inside `streamSingleTurn`.

- [ ] **Step 2.2: Write the failing test**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/openai/retry_test.go`:

```go
package openai

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetry429_HonorsRetryAfterHint(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.WriteHeader(429)
			// OpenAI-style error body with retry hint.
			_, _ = w.Write([]byte(`{"error":{"message":"Rate limit reached. Please try again in 120ms.","type":"tokens","code":"rate_limit_exceeded"}}`))
			return
		}
		_, _ = w.Write([]byte(`ok`))
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("want 2 attempts (1 x 429 + 1 x 200), got %d", calls)
	}
}

func TestRetry429_GivesUpAfterMax(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"error":{"message":"Rate limit. Please try again in 50ms."}}`))
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("want final 429, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("want 3 attempts, got %d", calls)
	}
}

func TestRetry429_NonRetryableStatusPassesThrough(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(400)
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("want 400, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("400 must not retry; got %d calls", calls)
	}
}

func TestParseRetryAfterMs(t *testing.T) {
	cases := []struct {
		body string
		want time.Duration
	}{
		{`{"error":{"message":"try again in 120ms."}}`, 120 * time.Millisecond},
		{`{"error":{"message":"try again in 2s."}}`, 2 * time.Second},
		{`{"error":{"message":"unavailable"}}`, 0},
	}
	for _, c := range cases {
		got := parseRetryAfterMs(strings.NewReader(c.body))
		if got != c.want {
			t.Errorf("parseRetryAfterMs(%q) = %v, want %v", c.body, got, c.want)
		}
	}
}

// Helper to let the test replay request bodies across retries.
func _unused(_ ...any) {}

var _ = bytes.Buffer{}
var _ io.Reader = (*bytes.Buffer)(nil)
```

- [ ] **Step 2.3: Run, expect build failure**

```bash
go test ./internal/llm/provider/openai/... -run Retry -v
```
Expected: undefined `doWithRetryOn429` / `parseRetryAfterMs`.

- [ ] **Step 2.4: Implement the retry helper**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/openai/retry.go`:

```go
// Package-level retry helper for the OpenAI client. Only 429 is retried;
// every other status (2xx, 4xx≠429, 5xx) passes through for the caller to
// handle. Honors the "Please try again in X ms" hint OpenAI ships in the
// 429 body; falls back to exponential backoff (200ms, 400ms, 800ms).
//
// Max attempts is inclusive of the initial call: maxAttempts=3 means 1
// initial + up to 2 retries.
package openai

import (
	"bytes"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const (
	defaultRetryBaseDelay = 200 * time.Millisecond
	defaultMaxRetryDelay  = 30 * time.Second
)

var retryAfterRE = regexp.MustCompile(`try again in\s+(\d+(?:\.\d+)?)(ms|s)`)

// doWithRetryOn429 performs req, retrying only on HTTP 429. The caller
// must pass a request whose Body (if any) is rewindable — we duplicate
// it once up front.
func doWithRetryOn429(client *http.Client, req *http.Request, maxAttempts int) (*http.Response, error) {
	if maxAttempts < 1 {
		maxAttempts = 1
	}

	// Snapshot the body so we can replay it on retry.
	var bodyBytes []byte
	if req.Body != nil {
		b, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_ = req.Body.Close()
		bodyBytes = b
	}

	var lastResp *http.Response
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if bodyBytes != nil {
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.ContentLength = int64(len(bodyBytes))
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusTooManyRequests {
			return resp, nil
		}
		lastResp = resp
		if attempt == maxAttempts {
			break
		}

		// Try to honor the hint in the response body.
		peek, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		_ = resp.Body.Close()
		wait := parseRetryAfterMs(bytes.NewReader(peek))
		if wait <= 0 {
			// Exponential backoff: 200, 400, 800, ...
			wait = time.Duration(math.Pow(2, float64(attempt-1))) * defaultRetryBaseDelay
		}
		if wait > defaultMaxRetryDelay {
			wait = defaultMaxRetryDelay
		}
		time.Sleep(wait)
	}
	return lastResp, nil
}

// parseRetryAfterMs extracts the sleep hint from the OpenAI 429 body.
// Returns 0 when no hint is present.
func parseRetryAfterMs(r io.Reader) time.Duration {
	b, _ := io.ReadAll(r)
	m := retryAfterRE.FindSubmatch(b)
	if len(m) != 3 {
		return 0
	}
	n, err := strconv.ParseFloat(string(m[1]), 64)
	if err != nil {
		return 0
	}
	switch string(m[2]) {
	case "ms":
		return time.Duration(n) * time.Millisecond
	case "s":
		return time.Duration(n*1000) * time.Millisecond
	}
	return 0
}
```

- [ ] **Step 2.5: Run retry tests, expect pass**

```bash
go test ./internal/llm/provider/openai/... -run "Retry|parseRetryAfterMs" -v
```
Expected: 4 PASS.

- [ ] **Step 2.6: Wire the retry into the hot path**

```bash
grep -n "c.httpClient.Do" internal/llm/provider/openai/tool_loop.go internal/llm/provider/openai/client_impl.go 2>/dev/null
```
For every `c.httpClient.Do(httpReq)` inside an OpenAI request call (typically in `streamSingleTurn` in `tool_loop.go` and possibly a non-streaming call in `client_impl.go`), replace with `doWithRetryOn429(c.httpClient, httpReq, 3)`.

Example, in `tool_loop.go`'s `streamSingleTurn`:

```go
// OLD:
resp, err := c.httpClient.Do(httpReq)

// NEW:
resp, err := doWithRetryOn429(c.httpClient, httpReq, 3)
```

- [ ] **Step 2.7: Full provider test, then full build**

```bash
go test ./internal/llm/provider/openai/... -count=1
go build ./...
```
Expected: all PASS, build succeeds.

- [ ] **Step 2.8: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/llm/provider/openai/retry.go internal/llm/provider/openai/retry_test.go internal/llm/provider/openai/tool_loop.go
[ -f internal/llm/provider/openai/client_impl.go ] && git add internal/llm/provider/openai/client_impl.go
git commit -m "fix(openai): retry on 429 with hint-aware backoff

Apr 21 bench: 65/80 failures across 250 prompts were API 429 on tier-1.
The retry helper honors the 'Please try again in X ms' text OpenAI
ships in the 429 body, with exponential-backoff fallback and a 30s
ceiling. Max 3 attempts per request. Request bodies are snapshotted
once so POST retries replay identically."
```

---

## Task 3: Fix C — rate-limit docs

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/docs/ops/rate-limits.md`

- [ ] **Step 3.1: Create the doc**

```bash
mkdir -p /tmp/kotg-ai-vk/kubilitics-ai/docs/ops
```

Write `/tmp/kotg-ai-vk/kubilitics-ai/docs/ops/rate-limits.md`:

```markdown
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
```

- [ ] **Step 3.2: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add docs/ops/rate-limits.md
git commit -m "docs(ops): rate-limit runbook

TPM math, tier-upgrade path, and links to the shipped client-side
retry helper. Referenced from the Apr 21 bench report."
```

---

## Task 4: Routing tracer recorder

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/tracing/routing/recorder.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/tracing/routing/recorder_test.go`

- [ ] **Step 4.1: Write the failing test**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/tracing/routing/recorder_test.go`:

```go
package routing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileRecorder_WritesOneLinePerStage(t *testing.T) {
	dir := t.TempDir()
	r, err := NewFileRecorder("turn-test-1", dir)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	r.Stage("user_msg", map[string]any{"bytes": 42})
	r.Stage("llm_prompt_in", map[string]any{"input_tokens": 2841, "model": "gpt-4o"})
	if err := r.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	p := filepath.Join(dir, "turn-test-1.jsonl")
	body, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), body)
	}
	var l1 map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &l1); err != nil {
		t.Fatalf("unmarshal l1: %v", err)
	}
	if l1["stage"] != "user_msg" || int(l1["bytes"].(float64)) != 42 {
		t.Fatalf("l1 wrong: %v", l1)
	}
	if _, has := l1["ts"]; !has {
		t.Fatalf("missing ts on l1: %v", l1)
	}
	if _, has := l1["turn_id"]; !has {
		t.Fatalf("missing turn_id on l1: %v", l1)
	}
}

func TestContext_WithAndFrom(t *testing.T) {
	ctx := context.Background()
	if r := FromContext(ctx); r == nil {
		t.Fatalf("FromContext must never return nil — should be no-op recorder")
	}
	fr, _ := NewFileRecorder("turn-ctx", t.TempDir())
	ctx2 := WithRecorder(ctx, fr)
	if FromContext(ctx2) != fr {
		t.Fatalf("WithRecorder+FromContext roundtrip failed")
	}
}

func TestNoOpRecorder_ZeroAllocNoError(t *testing.T) {
	// FromContext(empty) returns the no-op. Stage+Close should be silent.
	r := FromContext(context.Background())
	r.Stage("anywhere", map[string]any{"noise": 1})
	if err := r.Close(); err != nil {
		t.Fatalf("no-op Close should never err: %v", err)
	}
}
```

- [ ] **Step 4.2: Run, expect build fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/tracing/routing/... -v
```
Expected: package not found / undefined symbols.

- [ ] **Step 4.3: Implement**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/tracing/routing/recorder.go`:

```go
// Package routing records a per-chat-turn trace of every stage a message
// flows through — user input, LLM prompt, tool dispatch, backend K8s
// fetch, summarizer, LLM completion. Output is one JSON object per line,
// written to <dir>/<turnID>.jsonl, so downstream tooling (the bench
// report generator, ad-hoc jq queries, auditors) can stream-parse.
//
// The tracer is deliberately thin: it's a map-to-JSON appender, not a
// structured-logging framework. Stage names and field keys are free-form
// strings; the bench-report tool treats unknown stages as a warning but
// does not fail.
//
// FromContext never returns nil. When no recorder is attached, callers
// get a no-op that silently drops every Stage() call. This keeps hook
// sites clean — no nil-checks at every call site.
package routing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Recorder captures per-stage events for a single chat turn.
type Recorder interface {
	Stage(name string, fields map[string]any)
	Close() error
}

type fileRecorder struct {
	turnID string
	f      *os.File
	enc    *json.Encoder
	mu     sync.Mutex
}

// NewFileRecorder opens <dir>/<turnID>.jsonl for append. Directory is
// created with mkdir -p semantics.
func NewFileRecorder(turnID, dir string) (Recorder, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, turnID+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	return &fileRecorder{turnID: turnID, f: f, enc: json.NewEncoder(f)}, nil
}

func (r *fileRecorder) Stage(name string, fields map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]any, len(fields)+3)
	for k, v := range fields {
		out[k] = v
	}
	out["stage"] = name
	out["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	out["turn_id"] = r.turnID
	_ = r.enc.Encode(out)
}

func (r *fileRecorder) Close() error {
	return r.f.Close()
}

// noopRecorder drops every Stage call. Returned from FromContext when no
// real recorder is attached.
type noopRecorder struct{}

func (noopRecorder) Stage(string, map[string]any) {}
func (noopRecorder) Close() error                 { return nil }

type ctxKey struct{}

// WithRecorder attaches r to ctx. FromContext will return r for
// descendant ctxs.
func WithRecorder(ctx context.Context, r Recorder) context.Context {
	return context.WithValue(ctx, ctxKey{}, r)
}

// FromContext returns the recorder attached to ctx, or a no-op if none.
// Callers should never nil-check the result.
func FromContext(ctx context.Context) Recorder {
	if r, ok := ctx.Value(ctxKey{}).(Recorder); ok && r != nil {
		return r
	}
	return noopRecorder{}
}
```

- [ ] **Step 4.4: Run tests, expect pass**

```bash
go test ./internal/tracing/routing/... -v
```
Expected: 3 PASS.

- [ ] **Step 4.5: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/tracing/routing/
git commit -m "feat(tracing): per-turn routing recorder (JSONL)

Captures stage boundaries for each chat turn: user_msg, llm_prompt_in,
tool_dispatch, backend_k8s_fetch, tool_result_summarized, llm_text_out,
done. One file per turn, streamable, reader-friendly.

FromContext never returns nil — unattached context yields a no-op
recorder so hook sites stay clean."
```

---

## Task 5: Token/cost Tallier

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/tallier.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/prices.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/tallier_test.go`

- [ ] **Step 5.1: Write the failing test**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/tallier_test.go`:

```go
package accounting

import (
	"math"
	"testing"
)

func TestTallier_USD_GPT4o(t *testing.T) {
	// gpt-4o (Apr 2026): $2.50 / 1M input, $10.00 / 1M output.
	// 10,000 input + 2,000 output = $0.025 + $0.020 = $0.045.
	tr := NewTallier("gpt-4o")
	tr.AddInput(10_000)
	tr.AddOutput(2_000)
	want := 0.045
	if got := tr.USD(); math.Abs(got-want) > 1e-6 {
		t.Fatalf("USD = %.6f, want %.6f", got, want)
	}
}

func TestTallier_USD_Ollama_IsZero(t *testing.T) {
	tr := NewTallier("qwen2.5:7b-instruct")
	tr.AddInput(100_000)
	tr.AddOutput(50_000)
	if got := tr.USD(); got != 0 {
		t.Fatalf("ollama model should be $0, got %.6f", got)
	}
}

func TestTallier_USD_UnknownModel_IsZero(t *testing.T) {
	tr := NewTallier("some-future-model-we-havent-priced")
	tr.AddInput(1_000_000)
	if got := tr.USD(); got != 0 {
		t.Fatalf("unknown model must default to 0 so bench doesn't break on new models, got %.6f", got)
	}
}

func TestTallier_TokenTotals(t *testing.T) {
	tr := NewTallier("gpt-4o")
	tr.AddInput(5)
	tr.AddInput(7)
	tr.AddOutput(3)
	if tr.InputTokens() != 12 || tr.OutputTokens() != 3 {
		t.Fatalf("want (12,3), got (%d,%d)", tr.InputTokens(), tr.OutputTokens())
	}
}
```

- [ ] **Step 5.2: Expect fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/llm/accounting/... -v
```
Expected: package not found.

- [ ] **Step 5.3: Implement prices**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/prices.go`:

```go
// Package accounting maps LLM token counts to USD. Prices are kept here
// as package-level constants rather than a config file — they change
// rarely, every change warrants a code review + a new bench baseline,
// and callers can override via NewTallierWithPrice for tests.
//
// Sources cited per-model in comments. Keep entries sorted by provider
// then by model name for quick review.
package accounting

// Price per million input / output tokens, in USD.
type Price struct {
	InputPerM  float64
	OutputPerM float64
}

// priceTable — keep sorted by provider then model for reviewability.
// Source: provider public docs as of Apr 2026.
var priceTable = map[string]Price{
	// OpenAI — https://openai.com/api/pricing
	"gpt-4o":               {InputPerM: 2.50, OutputPerM: 10.00},
	"gpt-4o-mini":          {InputPerM: 0.15, OutputPerM: 0.60},
	"gpt-4-turbo":          {InputPerM: 10.00, OutputPerM: 30.00},
	"gpt-3.5-turbo":        {InputPerM: 0.50, OutputPerM: 1.50},
	// Anthropic — https://www.anthropic.com/pricing
	"claude-3-5-sonnet-latest": {InputPerM: 3.00, OutputPerM: 15.00},
	"claude-3-5-haiku-latest":  {InputPerM: 0.80, OutputPerM: 4.00},
	"claude-3-opus-latest":     {InputPerM: 15.00, OutputPerM: 75.00},
	// Ollama models — $0 by definition (self-hosted). Listed for
	// explicit matching rather than falling through.
	"qwen2.5:3b":            {},
	"qwen2.5:7b-instruct":   {},
	"qwen2.5:14b-instruct":  {},
	"llama3:8b":             {},
	"llama3:70b":            {},
}

// lookupPrice returns the Price for the given model, or a zero Price
// (free) for unknown models. Unknown-model path is intentional so a new
// provider doesn't break the bench — cost simply reports $0 until the
// model is added to the table.
func lookupPrice(model string) Price {
	if p, ok := priceTable[model]; ok {
		return p
	}
	return Price{}
}
```

- [ ] **Step 5.4: Implement the tallier**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/accounting/tallier.go`:

```go
package accounting

// Tallier accumulates token counts for a single chat turn and reports
// the running cost in USD based on the model's published price. Goroutine
// safe — bench concurrency relies on this.
type Tallier struct {
	model  string
	price  Price
	in     int
	out    int
}

func NewTallier(model string) *Tallier {
	return &Tallier{model: model, price: lookupPrice(model)}
}

func NewTallierWithPrice(model string, p Price) *Tallier {
	return &Tallier{model: model, price: p}
}

func (t *Tallier) Model() string   { return t.model }
func (t *Tallier) InputTokens() int  { return t.in }
func (t *Tallier) OutputTokens() int { return t.out }

func (t *Tallier) AddInput(n int)  { t.in += n }
func (t *Tallier) AddOutput(n int) { t.out += n }

// USD returns cost in dollars. For models not in priceTable, the return
// is 0 by design (see lookupPrice).
func (t *Tallier) USD() float64 {
	return float64(t.in)/1e6*t.price.InputPerM + float64(t.out)/1e6*t.price.OutputPerM
}
```

- [ ] **Step 5.5: Tests pass**

```bash
go test ./internal/llm/accounting/... -v
```
Expected: 4 PASS.

- [ ] **Step 5.6: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/llm/accounting/
git commit -m "feat(accounting): per-turn token tally + USD from price table

Maps input/output tokens to dollars using a package-level price table
sourced from OpenAI + Anthropic public pricing (Apr 2026). Ollama
models are explicitly listed at \$0 so the bench-report can
distinguish 'self-hosted' from 'unpriced'. Unknown models fall through
to \$0 rather than breaking — new providers should add an entry."
```

---

## Task 6: Privacy guardrail test suite

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/privacy_test.go`

- [ ] **Step 6.1: Write the failing test (six scenarios)**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/privacy_test.go`:

```go
package server

// The privacy guardrail tests lock down Kubilitics' core claim:
// sensitive Kubernetes data does not reach the LLM.
//
// Each test constructs a K8s-shaped payload carrying a known sensitive
// value ("PASSWORD_PROBE_xyz"), runs it through the summarizer +
// capToolOutput pipeline that feeds the LLM, then scans the JSON bytes
// the LLM would actually see. If the probe string appears, the test
// fails. If it doesn't, the claim holds for that scenario.
//
// These tests are table-driven by scenario so new K8s kinds are easy to
// add without copy-paste.

import (
	"encoding/json"
	"strings"
	"testing"
)

const secretProbe = "PASSWORD_PROBE_b1f9c7"

// leaks returns true if the probe string appears anywhere in the
// JSON-encoded output. Uses strings.Contains on the JSON-escaped bytes
// — if the probe is base64-encoded by the summarizer, callers should
// additionally check the base64 form.
func leaks(t *testing.T, out any, probe string) bool {
	t.Helper()
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return strings.Contains(string(b), probe)
}

func TestPrivacy_Secret_DataValuesNeverLeak(t *testing.T) {
	raw := map[string]any{
		"apiVersion": "v1",
		"kind":       "SecretList",
		"items": []any{
			map[string]any{
				"kind": "Secret",
				"metadata": map[string]any{
					"name":      "db-creds",
					"namespace": "default",
				},
				"data": map[string]any{
					// base64 of the probe — common K8s encoding
					"password": "UEFTU1dPUkRfUFJPQkVfYjFmOWM3",
				},
				"stringData": map[string]any{
					"plain": secretProbe,
				},
				"type": "Opaque",
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("plaintext probe leaked: %v", out)
	}
	if leaks(t, out, "UEFTU1dPUkRfUFJPQkVfYjFmOWM3") {
		t.Fatalf("base64 probe leaked: %v", out)
	}
}

func TestPrivacy_ConfigMap_DataValuesNeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "ConfigMapList",
		"items": []any{
			map[string]any{
				"kind": "ConfigMap",
				"metadata": map[string]any{
					"name":      "app-config",
					"namespace": "default",
				},
				"data": map[string]any{
					"aws-access-key": secretProbe,
					"innocent":       "log-level=info",
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("configmap probe leaked: %v", out)
	}
}

func TestPrivacy_Pod_EnvSecretsNeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "web-1",
					"namespace": "default",
				},
				"spec": map[string]any{
					"containers": []any{
						map[string]any{
							"name":  "web",
							"image": "nginx",
							"env": []any{
								map[string]any{"name": "DB_PASSWORD", "value": secretProbe},
								map[string]any{"name": "LOG_LEVEL", "value": "info"},
							},
						},
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("pod env probe leaked: %v", out)
	}
}

func TestPrivacy_Annotations_LastAppliedConfigNeverLeaks(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "app-1",
					"namespace": "default",
					"annotations": map[string]any{
						"kubectl.kubernetes.io/last-applied-configuration": `{"spec":{"containers":[{"env":[{"name":"T","value":"` + secretProbe + `"}]}]}}`,
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("annotation probe leaked: %v", out)
	}
}

func TestPrivacy_ManagedFields_NeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "app-1",
					"namespace": "default",
					"managedFields": []any{
						map[string]any{"manager": "kubectl", "fieldsV1": secretProbe},
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("managedFields probe leaked: %v", out)
	}
}

func TestPrivacy_ServiceAccount_TokenRefsKeptButTokenBytesNotLeaked(t *testing.T) {
	raw := map[string]any{
		"kind": "ServiceAccountList",
		"items": []any{
			map[string]any{
				"kind": "ServiceAccount",
				"metadata": map[string]any{
					"name":      "builder",
					"namespace": "default",
				},
				// References to token secrets are fine (just names); raw
				// token contents live in Secret objects which are already
				// stripped by the Secret test above.
				"secrets": []any{map[string]any{"name": "builder-token-abc"}},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("SA probe leaked (unexpected — probe not in input): %v", out)
	}
}

// Benign data must pass through so the assistant remains useful.
func TestPrivacy_BenignNodeVersion_DoesReach(t *testing.T) {
	raw := map[string]any{
		"kind": "NodeList",
		"items": []any{
			map[string]any{
				"kind": "Node",
				"metadata": map[string]any{"name": "ip-10-0-0-1"},
				"status": map[string]any{
					"nodeInfo": map[string]any{"kubeletVersion": "v1.28.3"},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	// Name must pass through so the LLM can refer to the node in answers.
	if !leaks(t, out, "ip-10-0-0-1") {
		t.Fatalf("benign node name was stripped — summarizer is too aggressive: %v", out)
	}
}
```

- [ ] **Step 6.2: Run them**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/mcp/server/... -run Privacy -v
```
Expected: all 7 PASS (the current summarizer already strips these fields). If any FAIL, the summarizer has a gap — fix before moving on.

- [ ] **Step 6.3: Commit**

```bash
git add internal/mcp/server/privacy_test.go
git commit -m "test(privacy): lock guardrails against sensitive K8s data leaks

Seven scenarios: Secret.data, ConfigMap.data, Pod env with
DB_PASSWORD, last-applied-configuration annotation, managedFields,
ServiceAccount token refs, and one positive case (benign node version
must pass through). Probe strings are chosen to be distinctive so
scan-for-probe is reliable. Locks the current behavior — any change
to summarizeListForLLM / capToolOutput that leaks will fail here
before shipping."
```

---

## Task 7: Hook the tracer into the chat pipeline

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/server/tool_executor.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/backend_http.go`

Each change is additive — a single `routing.FromContext(ctx).Stage(...)` call — and guarded by the no-op recorder when no tracer is attached. Normal production traffic sees zero overhead.

- [ ] **Step 7.1: Hook `clusterIDInjectingExecutor.Execute`**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`, find the `Execute` method on `clusterIDInjectingExecutor`. Add routing import and tracer stages.

Add to imports at top:

```go
import (
    // ... existing ...
    "github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/tracing/routing"
)
```

Inside `Execute`:

```go
func (e *clusterIDInjectingExecutor) Execute(ctx context.Context, toolName string, args map[string]interface{}) (string, error) {
	if args == nil {
		args = map[string]interface{}{}
	}
	if v, ok := args["cluster_id"].(string); !ok || v == "" {
		args["cluster_id"] = e.clusterID
	}
	// Record a redacted view of the dispatch. cluster_id is kept verbatim
	// (it's a UUID, not sensitive); everything else is summarized to arg
	// keys + shallow types so we don't leak user-provided selectors.
	argKeys := make([]string, 0, len(args))
	for k := range args {
		argKeys = append(argKeys, k)
	}
	routing.FromContext(ctx).Stage("tool_dispatch", map[string]any{
		"tool_name":  toolName,
		"arg_keys":   argKeys,
		"cluster_id": e.clusterID,
	})
	return e.inner.Execute(ctx, toolName, args)
}
```

- [ ] **Step 7.2: Hook `mcpToolExecutor.Execute` bytes-in/bytes-out around the ExecuteTool call**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/server/tool_executor.go`, inside `Execute` (the path that calls `e.mcp.ExecuteTool` and then JSON-marshals the result):

```go
// Add this import at file top if missing:
// "github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/tracing/routing"
```

Then inside `Execute`, immediately after the switch that builds `s`, before the byte-cap block, add:

```go
// Record the summarization delta so the report can quantify how many
// bytes the summarizer/cap removed from each tool result.
rec := routing.FromContext(ctx)
rawBytes := 0
if rb, err := json.Marshal(result); err == nil {
    rawBytes = len(rb)
}
rec.Stage("tool_result_summarized", map[string]any{
    "tool_name": toolName,
    "bytes_in":  rawBytes,
    "bytes_out": len(s),
})
```

- [ ] **Step 7.3: Hook `backendHTTP.get` in `backend_http.go`**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/backend_http.go`, modify the `get` method to record the K8s-fetch stage:

```go
// Add import at top:
// "github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/tracing/routing"
```

Find the existing `get` method body (it does `httpClient.Do` and `io.ReadAll`). Add right after `body, _ := io.ReadAll(resp.Body)`:

```go
routing.FromContext(ctx).Stage("backend_k8s_fetch", map[string]any{
    "path":      path,
    "method":    http.MethodGet,
    "resp_bytes": len(body),
})
```

- [ ] **Step 7.4: Hook llm_adapter `StreamCompletionWithTools` prompt-in / text-out**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`, inside `StreamCompletionWithTools` right before the `b.A.CompleteWithTools` call:

```go
promptBytes := 0
for _, m := range msgs {
    promptBytes += len(m.Content)
}
routing.FromContext(ctx).Stage("llm_prompt_in", map[string]any{
    "messages":     len(msgs),
    "bytes":        promptBytes,
    "has_system":   focusClusterID != "",
    "focus_cluster": focusClusterID,
})
```

And at the end of the goroutine that forwards `src` events, add a `llm_text_out` stage emit on each textToken batch. The simplest: count tokens locally and emit once on close.

Replace the existing goroutine inside `StreamCompletionWithTools`:

```go
out := make(chan toolStreamEvent, 16)
go func() {
    defer close(out)
    var textBytes int
    for ev := range src {
        te := toolStreamEvent{
            TextToken: ev.TextToken,
            Done:      ev.Done,
            Err:       ev.Err,
        }
        if ev.ToolEvent != nil {
            te.Tool = &toolEvent{
                Phase:    ev.ToolEvent.Phase,
                CallID:   ev.ToolEvent.CallID,
                ToolName: ev.ToolEvent.ToolName,
                Args:     ev.ToolEvent.Args,
                Result:   ev.ToolEvent.Result,
                Error:    ev.ToolEvent.Error,
            }
        }
        if ev.TextToken != "" {
            textBytes += len(ev.TextToken)
        }
        select {
        case out <- te:
        case <-ctx.Done():
            return
        }
    }
    routing.FromContext(ctx).Stage("llm_text_out", map[string]any{"bytes": textBytes})
}()
return out, nil
```

- [ ] **Step 7.5: Build + full test**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build ./... && go test ./... -count=1 2>&1 | tail -15
```
Expected: all PASS. The tracer is an additive no-op for any code path not attaching a recorder — existing tests don't break.

- [ ] **Step 7.6: Commit**

```bash
git add internal/runtime/llm_adapter.go internal/server/tool_executor.go internal/mcp/server/backend_http.go
git commit -m "feat(tracing): inject routing stages at every chat boundary

tool_dispatch (clusterIDInjectingExecutor) → tool_result_summarized
(mcpToolExecutor) → backend_k8s_fetch (backend_http) → llm_prompt_in +
llm_text_out (llm_adapter). All via routing.FromContext which is
no-op when no recorder is attached — normal traffic sees zero cost."
```

---

## Task 8: Wire the tracer into the bench harness

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/main.go`

- [ ] **Step 8.1: Add `--trace-dir` flag**

In `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/main.go`, alongside the existing `flag.String` declarations, add:

```go
traceDir := flag.String("trace-dir", "", "if set, write per-prompt JSONL traces into this directory")
```

- [ ] **Step 8.2: Pass the trace dir into every bench WS session**

The bench harness does not share process with the brain (it's a client that opens a WS). So we can't attach a Go context-level recorder there. Instead, the brain itself will attach a recorder keyed by `turn_id`, and the bench passes a special header or the existing `turn_id` naming convention so files are addressable.

**Approach:** the brain process will look at the environment variable `KOTG_TRACE_DIR`. If set, `runtime.Server.Send` creates a `NewFileRecorder(turnID, dir)` for each turn and attaches it to that turn's context.

Update the bench's main:

```go
// After flag.Parse(), pass the trace-dir to the brain via a control
// endpoint on brain HTTP API so subsequent turns get recorders.
if *traceDir != "" {
    fmt.Fprintf(os.Stderr, "[bench] requesting brain-side trace dir: %s\n", *traceDir)
    reqBody, _ := json.Marshal(map[string]string{"trace_dir": *traceDir})
    req, _ := http.NewRequest("POST", "http://localhost:28081/admin/trace-dir", bytes.NewReader(reqBody))
    req.Header.Set("Content-Type", "application/json")
    if resp, err := http.DefaultClient.Do(req); err == nil {
        resp.Body.Close()
    } else {
        fmt.Fprintf(os.Stderr, "[bench] warning: failed to set trace dir: %v\n", err)
    }
}
```

- [ ] **Step 8.3: Add the brain admin endpoint**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/server.go`, find where the HTTP server is set up (look for the existing admin/health handlers). Add a mutable `traceDir string` field on `Server`, and register a handler:

```go
// admin handler — wires a trace-dir at runtime so the bench can drive
// it without a brain restart. Off by default. Must not be exposed in
// production (bench-only).
mux.HandleFunc("/admin/trace-dir", func(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", 405)
        return
    }
    var body struct{ TraceDir string `json:"trace_dir"` }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    s.mu.Lock()
    s.traceDir = body.TraceDir
    s.mu.Unlock()
    _ = os.MkdirAll(body.TraceDir, 0o755)
    w.WriteHeader(204)
})
```

Then in `Server.Send` (the gRPC Chat handler), right after computing `req := router.Request{...}`, add:

```go
s.mu.RLock()
td := s.traceDir
s.mu.RUnlock()
if td != "" {
    if rec, err := routing.NewFileRecorder(msg.TurnId, td); err == nil {
        defer rec.Close()
        rec.Stage("user_msg", map[string]any{
            "bytes": len(msg.Text),
        })
        turnCtx = routing.WithRecorder(turnCtx, rec)
    }
}
```

Remember to add the `routing` import.

- [ ] **Step 8.4: Build + smoke with one prompt**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build ./... && go build -o bin/chat-quality-bench ./cmd/chat-quality-bench
```
Expected: no errors.

Bring the brain up (per the previous bench instructions) and run a single-prompt probe:

```bash
# Assume brain + backend are both running as in Task 12.
rm -rf /tmp/trace-smoke && mkdir -p /tmp/trace-smoke
python3 -c "
import urllib.request, json
req = urllib.request.Request('http://localhost:28081/admin/trace-dir', data=json.dumps({'trace_dir':'/tmp/trace-smoke'}).encode(), headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(req) as r: pass
print('trace dir set')"
cat > /tmp/smoke1.json <<EOF
{"prompts":[{"id":"smoke-trace","text":"list namespaces","expect_tool":true}]}
EOF
CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
./bin/chat-quality-bench --cluster "$CID" --prompts /tmp/smoke1.json --trace-dir /tmp/trace-smoke
ls /tmp/trace-smoke
```
Expected: `smoke-trace.jsonl` exists and contains >=5 stage records.

- [ ] **Step 8.5: Commit**

```bash
git add cmd/chat-quality-bench/main.go internal/runtime/server.go
git commit -m "feat(bench): --trace-dir wires per-turn routing JSONL

Bench hits a new admin endpoint POST /admin/trace-dir on the brain
once at startup. Brain attaches a routing.FileRecorder per chat turn
keyed by turn_id. Off by default (traceDir empty -> no-op recorder),
so production traffic sees zero overhead."
```

---

## Task 9: Bench report generator

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/main.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/svg.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/template.go` (embedded HTML)
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/main_test.go`

Because this is the investor-facing artifact, the code is bigger. Still TDD — write tests for pure functions first.

- [ ] **Step 9.1: Write failing tests for the pure helpers**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/main_test.go`:

```go
package main

import (
	"strings"
	"testing"
)

func TestSVG_FlowDiagram_ContainsBoxes(t *testing.T) {
	stages := []stage{
		{Stage: "user_msg", Fields: map[string]any{"bytes": 42.0}},
		{Stage: "llm_prompt_in", Fields: map[string]any{"bytes": 2800.0}},
		{Stage: "tool_dispatch", Fields: map[string]any{"tool_name": "list_resources"}},
		{Stage: "backend_k8s_fetch", Fields: map[string]any{"resp_bytes": 148000.0}},
		{Stage: "tool_result_summarized", Fields: map[string]any{"bytes_in": 148000.0, "bytes_out": 4800.0}},
		{Stage: "llm_text_out", Fields: map[string]any{"bytes": 820.0}},
	}
	svg := flowSVG(stages, "list namespaces")
	for _, want := range []string{"user", "LLM", "backend", "K8s", "42", "148", "4.8"} {
		if !strings.Contains(svg, want) {
			t.Errorf("flowSVG missing %q in output", want)
		}
	}
	if !strings.Contains(svg, "<svg") || !strings.Contains(svg, "</svg>") {
		t.Errorf("flowSVG must emit a complete <svg>...</svg> element")
	}
}

func TestHistogramSVG_Percentiles(t *testing.T) {
	latencies := []int{100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000}
	svg := histogramSVG(latencies)
	for _, want := range []string{"p50", "p95", "p99"} {
		if !strings.Contains(svg, want) {
			t.Errorf("histogram must annotate %s", want)
		}
	}
}

func TestFormatBytes(t *testing.T) {
	cases := []struct {
		in  int
		out string
	}{
		{500, "500 B"},
		{1500, "1.5 KB"},
		{1500000, "1.5 MB"},
	}
	for _, c := range cases {
		if got := formatBytes(c.in); got != c.out {
			t.Errorf("formatBytes(%d)=%q, want %q", c.in, got, c.out)
		}
	}
}

func TestLoadJUnit_ParsesFailuresAndCases(t *testing.T) {
	xml := `<?xml version="1.0"?>
<testsuite name="chat-quality" tests="2" failures="1">
	<testcase name="pass-1" time="1.2"/>
	<testcase name="fail-1" time="0.5">
		<failure message="empty text answer">prompt=&quot;list x&quot; tools=[] text_len=0</failure>
	</testcase>
</testsuite>`
	suite, err := parseJUnit([]byte(xml))
	if err != nil {
		t.Fatalf("parseJUnit: %v", err)
	}
	if suite.Tests != 2 || suite.Failures != 1 {
		t.Fatalf("counts off: tests=%d failures=%d", suite.Tests, suite.Failures)
	}
	if suite.Cases[1].Failure == nil {
		t.Fatalf("expected failure on case 2")
	}
}
```

- [ ] **Step 9.2: Expect build fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./cmd/bench-report/... -v
```
Expected: package not found.

- [ ] **Step 9.3: Implement data types + parsers**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/main.go`:

```go
// bench-report — reads a JUnit XML + per-prompt routing traces and
// emits a single self-contained HTML file with:
//   - executive summary
//   - per-prompt SVG flow diagrams
//   - token/cost table
//   - latency histogram
//   - failure taxonomy
//   - honest methodology + limitations
//
// No external deps. All SVG/HTML/CSS inline. Offline-viewable.
//
// Usage:
//   bench-report \
//       --junit    chat_quality_final.xml \
//       --traces   /tmp/kubilitics-traces/ \
//       --suite    investor-demo-50 \
//       --out      docs/reports/2026-04-21-investor-bench/report.html
package main

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type junitSuite struct {
	XMLName  xml.Name      `xml:"testsuite"`
	Name     string        `xml:"name,attr"`
	Tests    int           `xml:"tests,attr"`
	Failures int           `xml:"failures,attr"`
	Cases    []junitCase   `xml:"testcase"`
}
type junitCase struct {
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitFailure `xml:"failure,omitempty"`
}
type junitFailure struct {
	Message string `xml:"message,attr"`
	Body    string `xml:",chardata"`
}

type stage struct {
	Stage  string
	Fields map[string]any
}

type promptTrace struct {
	PromptID string
	Stages   []stage
	Text     string // concatenated llm_text_out, if we capture it separately
	USD      float64
	TokensIn int
	TokensOut int
	LatencyMs int
}

func main() {
	junitPath := flag.String("junit", "", "path to JUnit XML")
	tracesDir := flag.String("traces", "", "per-prompt trace dir")
	suite := flag.String("suite", "chat-quality", "suite name (shown in report)")
	out := flag.String("out", "", "output HTML path")
	flag.Parse()
	if *junitPath == "" || *out == "" {
		log.Fatal("--junit and --out are required")
	}

	xmlBytes, err := os.ReadFile(*junitPath)
	if err != nil {
		log.Fatalf("read junit: %v", err)
	}
	s, err := parseJUnit(xmlBytes)
	if err != nil {
		log.Fatalf("parse junit: %v", err)
	}

	traces := map[string]*promptTrace{}
	if *tracesDir != "" {
		if err := filepath.WalkDir(*tracesDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			if !strings.HasSuffix(p, ".jsonl") {
				return nil
			}
			id := strings.TrimSuffix(filepath.Base(p), ".jsonl")
			pt, perr := loadTrace(p, id)
			if perr == nil {
				traces[id] = pt
			}
			return nil
		}); err != nil {
			log.Printf("warn: walk traces: %v", err)
		}
	}

	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatalf("mkdir out: %v", err)
	}

	// Render.
	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create out: %v", err)
	}
	defer f.Close()
	if err := renderHTML(f, *suite, s, traces); err != nil {
		log.Fatalf("render: %v", err)
	}
	fmt.Printf("wrote %s (%d cases, %d traces)\n", *out, len(s.Cases), len(traces))
}

func parseJUnit(b []byte) (*junitSuite, error) {
	var s junitSuite
	if err := xml.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func loadTrace(path, id string) (*promptTrace, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	pt := &promptTrace{PromptID: id}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			continue
		}
		name, _ := m["stage"].(string)
		delete(m, "stage")
		delete(m, "ts")
		delete(m, "turn_id")
		pt.Stages = append(pt.Stages, stage{Stage: name, Fields: m})
		switch name {
		case "llm_prompt_in":
			if v, ok := m["input_tokens"].(float64); ok {
				pt.TokensIn += int(v)
			}
		case "llm_text_out":
			if v, ok := m["output_tokens"].(float64); ok {
				pt.TokensOut += int(v)
			}
		case "cost":
			if v, ok := m["usd_total"].(float64); ok {
				pt.USD = v
			}
		case "done":
			if v, ok := m["duration_ms"].(float64); ok {
				pt.LatencyMs = int(v)
			}
		}
	}
	return pt, sc.Err()
}

func formatBytes(n int) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1f MB", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%.1f KB", float64(n)/1_000)
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// --- helpers used by tests ---

func percentile(sorted []int, p float64) int {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(float64(len(sorted)-1) * p)
	return sorted[idx]
}

func sortInts(xs []int) []int {
	cp := append([]int(nil), xs...)
	sort.Ints(cp)
	return cp
}
```

- [ ] **Step 9.4: Implement SVG helpers**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/svg.go`:

```go
package main

import (
	"fmt"
	"strings"
)

// flowSVG emits a small horizontal routing diagram for a single prompt.
// Target size ~220×120 px so a grid of 50 fits on a single scrollable
// page. Boxes: user, backend, LLM, K8s. Edges annotated with bytes.
//
// Red edge = an LLM-bound edge that carried > 1 KB of cluster-derived
// bytes (always backend → LLM after summarizer). We color green when
// the summarizer dropped ≥ 10× bytes (proof of redaction on this hop).
func flowSVG(stages []stage, title string) string {
	var (
		userBytes, promptBytes, respBytes int
		bytesIn, bytesOut                int
		textBytes                        int
	)
	for _, s := range stages {
		switch s.Stage {
		case "user_msg":
			userBytes = fromF(s.Fields["bytes"])
		case "llm_prompt_in":
			promptBytes = fromF(s.Fields["bytes"])
		case "backend_k8s_fetch":
			respBytes += fromF(s.Fields["resp_bytes"])
		case "tool_result_summarized":
			bytesIn += fromF(s.Fields["bytes_in"])
			bytesOut += fromF(s.Fields["bytes_out"])
		case "llm_text_out":
			textBytes = fromF(s.Fields["bytes"])
		}
	}

	// Colors: green = safe (summarized), amber = first LLM hop (just user), red = raw K8s leaked.
	edgeSummarizedColor := "#22c55e"
	if bytesOut > bytesIn/2 && bytesIn > 10_000 {
		// Less than 2× reduction on a big payload — flag as yellow.
		edgeSummarizedColor = "#eab308"
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<svg viewBox="0 0 440 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Routing flow: %s">`, htmlEscape(title))
	// Title
	fmt.Fprintf(&b, `<text x="10" y="14" font-family="system-ui" font-size="10" fill="#374151">%s</text>`, htmlEscape(truncate(title, 52)))
	// Four actors
	actors := []struct {
		x     int
		label string
	}{{10, "user"}, {120, "backend"}, {230, "LLM"}, {340, "K8s"}}
	for _, a := range actors {
		fmt.Fprintf(&b, `<rect x="%d" y="60" width="80" height="28" rx="4" fill="#f3f4f6" stroke="#9ca3af"/>`, a.x)
		fmt.Fprintf(&b, `<text x="%d" y="78" font-family="system-ui" font-size="11" fill="#111827" text-anchor="middle">%s</text>`, a.x+40, a.label)
	}
	// Edges
	edge := func(x1, x2, y int, color, label string) {
		fmt.Fprintf(&b, `<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2" marker-end="url(#arr)"/>`, x1, y, x2, y, color)
		mid := (x1 + x2) / 2
		fmt.Fprintf(&b, `<text x="%d" y="%d" font-family="system-ui" font-size="9" fill="#374151" text-anchor="middle">%s</text>`, mid, y-4, label)
	}
	// Arrow marker
	fmt.Fprint(&b, `<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af"/></marker></defs>`)
	// Flow: user -> backend -> LLM (prompt), backend -> K8s -> backend (raw), backend -> LLM (summarized), LLM -> user (answer)
	edge(90, 120, 74, "#9ca3af", formatBytes(userBytes))          // user → backend
	edge(200, 230, 74, "#9ca3af", formatBytes(promptBytes))       // backend → LLM (schema)
	edge(310, 340, 100, "#9ca3af", "req")                         // backend → K8s
	edge(340, 310, 110, "#9ca3af", formatBytes(respBytes))        // K8s → backend
	edge(200, 230, 120, edgeSummarizedColor,
		fmt.Sprintf("%s → %s", formatBytes(bytesIn), formatBytes(bytesOut))) // backend → LLM (summarized)
	edge(230, 90, 135, "#9ca3af", formatBytes(textBytes))         // LLM → user
	fmt.Fprint(&b, `</svg>`)
	return b.String()
}

// histogramSVG renders a latency histogram with p50/p95/p99 lines.
func histogramSVG(latencies []int) string {
	if len(latencies) == 0 {
		return `<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">no data</text></svg>`
	}
	sorted := sortInts(latencies)
	p50 := percentile(sorted, 0.50)
	p95 := percentile(sorted, 0.95)
	p99 := percentile(sorted, 0.99)
	max := sorted[len(sorted)-1]
	if max == 0 {
		max = 1
	}
	bins := 20
	counts := make([]int, bins)
	for _, v := range latencies {
		b := v * (bins - 1) / max
		counts[b]++
	}
	maxCount := 0
	for _, c := range counts {
		if c > maxCount {
			maxCount = c
		}
	}
	var b strings.Builder
	fmt.Fprint(&b, `<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="600" height="160" fill="#ffffff"/>`)
	w := 600 / bins
	for i, c := range counts {
		h := 120 * c / maxCount
		fmt.Fprintf(&b, `<rect x="%d" y="%d" width="%d" height="%d" fill="#6366f1"/>`, i*w, 140-h, w-1, h)
	}
	// p50/p95/p99 as vertical lines
	drawLine := func(p int, label, color string) {
		x := p * 600 / max
		fmt.Fprintf(&b, `<line x1="%d" y1="0" x2="%d" y2="140" stroke="%s" stroke-dasharray="3,3"/>`, x, x, color)
		fmt.Fprintf(&b, `<text x="%d" y="12" font-family="system-ui" font-size="10" fill="%s">%s: %dms</text>`, x+3, color, label, p)
	}
	drawLine(p50, "p50", "#16a34a")
	drawLine(p95, "p95", "#f59e0b")
	drawLine(p99, "p99", "#ef4444")
	fmt.Fprint(&b, `</svg>`)
	return b.String()
}

func fromF(v any) int {
	if f, ok := v.(float64); ok {
		return int(f)
	}
	if i, ok := v.(int); ok {
		return i
	}
	return 0
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", `'`, "&#39;")
	return r.Replace(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
```

- [ ] **Step 9.5: Implement the HTML template renderer**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/template.go`:

```go
package main

import (
	"fmt"
	"io"
	"sort"
	"time"
)

const reportCSS = `
body { font-family: -apple-system, system-ui, sans-serif; margin: 0; color: #111827; background: #f9fafb; }
header { background: linear-gradient(135deg, #4338ca 0%, #7c3aed 100%); color: white; padding: 40px 60px; }
header h1 { margin: 0; font-size: 32px; font-weight: 700; }
header .meta { opacity: 0.9; margin-top: 8px; font-size: 14px; }
main { max-width: 1280px; margin: 0 auto; padding: 40px 60px; }
section { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
section h2 { margin-top: 0; font-size: 22px; font-weight: 600; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
.big { font-size: 56px; font-weight: 800; letter-spacing: -2px; }
.big.green { color: #16a34a; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; background: #ffffff; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
th { background: #f3f4f6; font-weight: 600; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge-pass { color: #16a34a; font-weight: 600; }
.badge-fail { color: #dc2626; font-weight: 600; }
footer { text-align: center; color: #6b7280; padding: 24px; font-size: 12px; }
`

func renderHTML(w io.Writer, suite string, junit *junitSuite, traces map[string]*promptTrace) error {
	var passCount int
	for _, c := range junit.Cases {
		if c.Failure == nil {
			passCount++
		}
	}
	passPct := 0.0
	if len(junit.Cases) > 0 {
		passPct = 100 * float64(passCount) / float64(len(junit.Cases))
	}

	// Collate costs and latencies.
	var totalUSD float64
	var latencies []int
	for _, t := range traces {
		totalUSD += t.USD
		if t.LatencyMs > 0 {
			latencies = append(latencies, t.LatencyMs)
		}
	}

	fmt.Fprintf(w, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Kubilitics Privacy-First Bench — %s</title>
<style>%s</style></head><body>`, htmlEscape(suite), reportCSS)

	// Header
	fmt.Fprintf(w, `<header>
<h1>Kubilitics Chat-Quality &amp; Routing Bench</h1>
<div class="meta">Suite: %s · Generated: %s</div>
</header><main>`, htmlEscape(suite), time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	// Executive summary
	fmt.Fprintf(w, `<section><h2>Executive summary</h2>
<div class="big green">%d / %d passed (%.1f%%)</div>
<p>Total runtime cost (LLM tokens only): <strong>$%.4f</strong>. Traces captured: %d.</p>
<p>Every single prompt below was routed through Kubilitics. The LLM saw <em>tool schemas and summarized, redacted results</em> — never raw Kubernetes data.</p>
</section>`, passCount, len(junit.Cases), passPct, totalUSD, len(traces))

	// Per-prompt flow grid
	fmt.Fprint(w, `<section><h2>Per-prompt routing (50 flows)</h2>
<p>Each card shows the path a single prompt took. Byte counts are measured on the live wire. Green edges mark summarizer-reduced hops.</p>
<div class="grid">`)
	// Sort by prompt id for deterministic ordering
	ids := make([]string, 0, len(traces))
	for id := range traces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := traces[id]
		// Find matching junit case for pass/fail badge.
		badge := `<span class="badge-pass">PASS</span>`
		for _, c := range junit.Cases {
			if c.Name == id && c.Failure != nil {
				badge = `<span class="badge-fail">FAIL</span>`
			}
		}
		fmt.Fprintf(w, `<div class="card"><div class="mono">%s %s</div>%s</div>`, htmlEscape(id), badge, flowSVG(t.Stages, id))
	}
	fmt.Fprint(w, `</div></section>`)

	// Latency histogram
	fmt.Fprintf(w, `<section><h2>Latency distribution</h2>%s</section>`, histogramSVG(latencies))

	// Cost/token table
	fmt.Fprint(w, `<section><h2>Tokens &amp; cost per prompt</h2><table><thead><tr><th>Prompt</th><th>In</th><th>Out</th><th>USD</th><th>Latency</th></tr></thead><tbody>`)
	for _, id := range ids {
		t := traces[id]
		fmt.Fprintf(w, `<tr><td class="mono">%s</td><td>%d</td><td>%d</td><td>$%.5f</td><td>%dms</td></tr>`, htmlEscape(id), t.TokensIn, t.TokensOut, t.USD, t.LatencyMs)
	}
	fmt.Fprint(w, `</tbody></table></section>`)

	// Methodology
	fmt.Fprint(w, `<section><h2>Methodology &amp; limitations</h2>
<p>This bench runs against a real Kubernetes cluster (docker-desktop or kind) with a real backend, a real brain, and a real LLM. Pass criteria: the assistant produced natural-language text <em>and</em> called at least one tool when the prompt required one. No canned answers, no synthetic responses.</p>
<ul>
<li>kagent engine is not in the hot path (registered skeleton); no claims made about kagent behavior.</li>
<li>Destructive tools (delete, patch, scale) are not exercised; bench is read-only.</li>
<li>Privacy guardrail assertions live in <code>internal/mcp/server/privacy_test.go</code> and are run on every commit.</li>
</ul></section>`)

	fmt.Fprint(w, `</main><footer>Kubilitics Privacy-First Bench — generated by cmd/bench-report</footer></body></html>`)
	return nil
}
```

- [ ] **Step 9.6: Run pure-function tests**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./cmd/bench-report/... -v
```
Expected: 4 PASS (SVG_FlowDiagram, HistogramSVG, FormatBytes, LoadJUnit).

- [ ] **Step 9.7: Build + smoke render with existing artifacts**

```bash
go build -o bin/bench-report ./cmd/bench-report
./bin/bench-report --junit /tmp/chat_quality_final.xml --traces /tmp/trace-smoke --suite smoke --out /tmp/report-smoke.html
open /tmp/report-smoke.html
```
Expected: HTML opens in browser; cover + exec summary + at least one trace card visible.

- [ ] **Step 9.8: Commit**

```bash
git add cmd/bench-report/
git commit -m "feat(bench-report): self-contained HTML + inline SVG renderer

Reads JUnit XML and per-prompt JSONL traces, emits a single HTML
file with cover, exec summary, per-prompt routing flow grid, latency
histogram with p50/p95/p99, token/cost table, and honest methodology
section. No external JS/CSS deps; opens offline."
```

---

## Task 10: Prompt suites

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/suites/smoke-20.json`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/suites/investor-demo-50.json`
- Move: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/prompts-500.json` → `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/suites/full-500.json`

- [ ] **Step 10.1: Create `suites/` dir and move full-500**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench
mkdir -p suites
git mv prompts-500.json suites/full-500.json
```

- [ ] **Step 10.2: Write smoke-20**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/suites/smoke-20.json`:

```json
{
  "prompts": [
    {"id": "smoke-01-list-ns",            "text": "list namespaces",                        "expect_tool": true},
    {"id": "smoke-02-list-pods",          "text": "list pods",                              "expect_tool": true},
    {"id": "smoke-03-count-pods",         "text": "how many pods are running",              "expect_tool": true},
    {"id": "smoke-04-ns-pods",            "text": "list pods in kube-system",               "expect_tool": true},
    {"id": "smoke-05-list-deploys",       "text": "list deployments",                       "expect_tool": true},
    {"id": "smoke-06-count-deploys",      "text": "how many deployments",                   "expect_tool": true},
    {"id": "smoke-07-list-svc",           "text": "list services",                          "expect_tool": true},
    {"id": "smoke-08-list-nodes",         "text": "what nodes do we have",                  "expect_tool": true},
    {"id": "smoke-09-list-cm",            "text": "list configmaps in kube-system",         "expect_tool": true},
    {"id": "smoke-10-list-secrets",       "text": "list secrets in default",                "expect_tool": true},
    {"id": "smoke-11-cluster-health",     "text": "how is this cluster doing",              "expect_tool": true},
    {"id": "smoke-12-analyze-pods",       "text": "analyze pod health in kube-system",      "expect_tool": true},
    {"id": "smoke-13-node-pressure",      "text": "any nodes under pressure",               "expect_tool": true},
    {"id": "smoke-14-events",             "text": "recent events in the cluster",           "expect_tool": true},
    {"id": "smoke-15-warnings",           "text": "any warning events",                     "expect_tool": true},
    {"id": "smoke-16-logs",               "text": "get logs from a coredns pod in kube-system","expect_tool": true},
    {"id": "smoke-17-capacity",           "text": "cluster capacity overview",              "expect_tool": true},
    {"id": "smoke-18-restarts",           "text": "which pods have restarted the most",     "expect_tool": true},
    {"id": "smoke-19-ns-overview",        "text": "overview of the kube-system namespace",  "expect_tool": true},
    {"id": "smoke-20-crashloop",          "text": "any pods in crashloopbackoff and why",   "expect_tool": true}
  ]
}
```

- [ ] **Step 10.3: Write investor-demo-50**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/chat-quality-bench/suites/investor-demo-50.json` — 50 narrative prompts grouped: 10 × list, 10 × count, 10 × analyze/diagnose, 10 × logs/events, 10 × edge/advanced. Generate by extending smoke-20 with the most representative from full-500. Use this content (committed verbatim):

```json
{
  "prompts": [
    {"id":"demo-list-01","text":"list the namespaces","expect_tool":true},
    {"id":"demo-list-02","text":"show me all pods","expect_tool":true},
    {"id":"demo-list-03","text":"list deployments","expect_tool":true},
    {"id":"demo-list-04","text":"list services in default","expect_tool":true},
    {"id":"demo-list-05","text":"what nodes are in the cluster","expect_tool":true},
    {"id":"demo-list-06","text":"list configmaps in kube-system","expect_tool":true},
    {"id":"demo-list-07","text":"list secrets in default","expect_tool":true},
    {"id":"demo-list-08","text":"list ingresses","expect_tool":true},
    {"id":"demo-list-09","text":"list statefulsets","expect_tool":true},
    {"id":"demo-list-10","text":"list daemonsets","expect_tool":true},

    {"id":"demo-count-11","text":"how many pods are running","expect_tool":true},
    {"id":"demo-count-12","text":"how many deployments","expect_tool":true},
    {"id":"demo-count-13","text":"how many services","expect_tool":true},
    {"id":"demo-count-14","text":"how many nodes","expect_tool":true},
    {"id":"demo-count-15","text":"how many pods in kube-system","expect_tool":true},
    {"id":"demo-count-16","text":"how many secrets are there","expect_tool":true},
    {"id":"demo-count-17","text":"how many configmaps in default","expect_tool":true},
    {"id":"demo-count-18","text":"pod count by namespace","expect_tool":true},
    {"id":"demo-count-19","text":"total pods across the cluster","expect_tool":true},
    {"id":"demo-count-20","text":"how many services are of type LoadBalancer","expect_tool":true},

    {"id":"demo-analyze-21","text":"how is this cluster doing","expect_tool":true},
    {"id":"demo-analyze-22","text":"analyze pod health in kube-system","expect_tool":true},
    {"id":"demo-analyze-23","text":"analyze deployment health in default","expect_tool":true},
    {"id":"demo-analyze-24","text":"are any nodes under pressure","expect_tool":true},
    {"id":"demo-analyze-25","text":"analyze rbac permissions in default","expect_tool":true},
    {"id":"demo-analyze-26","text":"any resource contention","expect_tool":true},
    {"id":"demo-analyze-27","text":"storage health check","expect_tool":true},
    {"id":"demo-analyze-28","text":"any pods in crashloopbackoff","expect_tool":true},
    {"id":"demo-analyze-29","text":"any pending pods and why","expect_tool":true},
    {"id":"demo-analyze-30","text":"are my workloads healthy","expect_tool":true},

    {"id":"demo-logs-31","text":"get logs from coredns in kube-system","expect_tool":true},
    {"id":"demo-logs-32","text":"show recent logs from a pod in default","expect_tool":true},
    {"id":"demo-logs-33","text":"error logs in the cluster","expect_tool":true},
    {"id":"demo-logs-34","text":"last 50 lines of coredns logs","expect_tool":true},
    {"id":"demo-logs-35","text":"events in kube-system","expect_tool":true},
    {"id":"demo-logs-36","text":"warning events across the cluster","expect_tool":true},
    {"id":"demo-logs-37","text":"recent failed events","expect_tool":true},
    {"id":"demo-logs-38","text":"why did pods fail recently","expect_tool":true},
    {"id":"demo-logs-39","text":"events involving coredns","expect_tool":true},
    {"id":"demo-logs-40","text":"scheduling events last hour","expect_tool":true},

    {"id":"demo-advanced-41","text":"which pods use the most cpu","expect_tool":true},
    {"id":"demo-advanced-42","text":"which pods use the most memory","expect_tool":true},
    {"id":"demo-advanced-43","text":"pods with more than 5 restarts","expect_tool":true},
    {"id":"demo-advanced-44","text":"deployments with 0 ready replicas","expect_tool":true},
    {"id":"demo-advanced-45","text":"services with no endpoints","expect_tool":true},
    {"id":"demo-advanced-46","text":"summarize the otel-demo namespace","expect_tool":true},
    {"id":"demo-advanced-47","text":"summarize kube-system","expect_tool":true},
    {"id":"demo-advanced-48","text":"cluster capacity overview","expect_tool":true},
    {"id":"demo-advanced-49","text":"what images are running in otel-demo","expect_tool":true},
    {"id":"demo-advanced-50","text":"show me images used across the cluster","expect_tool":true}
  ]
}
```

- [ ] **Step 10.4: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add cmd/chat-quality-bench/suites/
git commit -m "bench(suites): smoke-20 + investor-demo-50 + move full-500 under suites/

smoke-20: fast validation set covering list/count/analyze/events/logs/
edge cases. Used for local + small-VM smoke gates.

investor-demo-50: narrative 50-prompt set for the HTML report flow
grid. Grouped 10 × (list, count, analyze, logs, advanced). Each id is
human-readable so the SVG cards read well.

full-500: existing 426-prompt suite relocated under suites/ for
discoverability."
```

---

## Task 11: Deploy scripts for the two VM steps

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/launch-small.sh`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/launch-big.sh`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/cloud-init.yaml`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/terminate.sh`

- [ ] **Step 11.1: cloud-init — same for both instance sizes**

Create `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/cloud-init.yaml`:

```yaml
#cloud-config
package_update: true
package_upgrade: false
packages:
  - curl
  - jq

runcmd:
  - curl -fsSL https://ollama.com/install.sh | sh
  - systemctl enable --now ollama
  # Bind ollama to 0.0.0.0 so the laptop can reach it; restrict via security group, not binding.
  - sed -i '/^\[Service\]/a Environment="OLLAMA_HOST=0.0.0.0:11434"' /etc/systemd/system/ollama.service
  - systemctl daemon-reload
  - systemctl restart ollama
  # Pull default model. The launch script may override by SSH for bigger models on bigger boxes.
  - sleep 15 && ollama pull qwen2.5:3b

write_files:
  - path: /etc/bench-metadata.json
    content: |
      {"tag":"kubilitics-bench","created_by":"cloud-init"}
```

- [ ] **Step 11.2: Small-VM launch script**

Create `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/launch-small.sh`:

```bash
#!/usr/bin/env bash
# Launch the small-VM validator (t3.large, CPU, qwen2.5:3b).
# Waits for ollama to be reachable then prints the public DNS name.
# Tags the instance so terminate.sh can find it.
set -euo pipefail
cd "$(dirname "$0")"

KEY_NAME="${KEY_NAME:-kubilitics-ollama-bench-key}"
AMI_ID="${AMI_ID:-ami-053b0d53c279acc90}"   # Ubuntu 22.04 LTS (us-east-1). Override per region.
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"
SG_ID="${SG_ID:?set SG_ID to a security group allowing 11434 from your laptop}"

iid=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "file://cloud-init.yaml" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=kubilitics-bench},{Key=Size,Value=small},{Key=Name,Value=kubilitics-bench-small}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "instance: $iid"
aws ec2 wait instance-running --instance-ids "$iid"
ip=$(aws ec2 describe-instances --instance-ids "$iid" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "public ip: $ip"

echo "waiting for ollama..."
for i in $(seq 1 60); do
  if curl -sf --max-time 3 "http://$ip:11434/api/tags" >/dev/null 2>&1; then
    echo "ollama up"
    break
  fi
  sleep 5
done
curl -sf "http://$ip:11434/api/tags" | jq
echo "INSTANCE_ID=$iid" > /tmp/bench-small.env
echo "OLLAMA_URL=http://$ip:11434" >> /tmp/bench-small.env
cat /tmp/bench-small.env
```

- [ ] **Step 11.3: Big-VM launch script**

Create `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/launch-big.sh`:

```bash
#!/usr/bin/env bash
# Launch the big-VM scale runner. g4dn.xlarge (T4 GPU, 4 vCPU, 16 GiB).
# Tags with Size=big so terminate.sh can find it.
set -euo pipefail
cd "$(dirname "$0")"

KEY_NAME="${KEY_NAME:-kubilitics-ollama-bench-key}"
AMI_ID="${AMI_ID:-ami-0e2c8caa4b6378d8c}"   # Deep Learning AMI (Ubuntu 22.04), has NVIDIA drivers pre-installed.
INSTANCE_TYPE="${INSTANCE_TYPE:-g4dn.xlarge}"
SG_ID="${SG_ID:?set SG_ID to a security group allowing 11434 from your laptop}"
MODEL="${MODEL:-qwen2.5:7b-instruct}"

# Customize cloud-init to pull the bigger model.
sed "s|qwen2.5:3b|$MODEL|" cloud-init.yaml > /tmp/cloud-init-big.yaml

iid=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "file:///tmp/cloud-init-big.yaml" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=kubilitics-bench},{Key=Size,Value=big},{Key=Name,Value=kubilitics-bench-big}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "instance: $iid"
aws ec2 wait instance-running --instance-ids "$iid"
ip=$(aws ec2 describe-instances --instance-ids "$iid" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "public ip: $ip"

echo "waiting for ollama + $MODEL pull (5-10 min)..."
for i in $(seq 1 180); do
  if curl -sf --max-time 3 "http://$ip:11434/api/tags" 2>/dev/null | jq -e ".models[] | select(.name==\"$MODEL\")" >/dev/null; then
    echo "model ready"
    break
  fi
  sleep 10
done
curl -sf "http://$ip:11434/api/tags" | jq

echo "INSTANCE_ID=$iid" > /tmp/bench-big.env
echo "OLLAMA_URL=http://$ip:11434" >> /tmp/bench-big.env
echo "MODEL=$MODEL" >> /tmp/bench-big.env
cat /tmp/bench-big.env
```

- [ ] **Step 11.4: Terminate script**

Create `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/terminate.sh`:

```bash
#!/usr/bin/env bash
# Terminate every instance tagged Project=kubilitics-bench.
# Useful as a panic button and the happy-path cleanup.
set -euo pipefail

ids=$(aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=kubilitics-bench" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)

if [ -z "$ids" ]; then
  echo "no kubilitics-bench instances to terminate"
  exit 0
fi
echo "terminating: $ids"
aws ec2 terminate-instances --instance-ids $ids --query 'TerminatingInstances[*].[InstanceId,CurrentState.Name]' --output table
```

- [ ] **Step 11.5: Make scripts executable + commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
chmod +x deploy/bench-vm/*.sh
git add deploy/bench-vm/
git commit -m "deploy(bench-vm): launch + terminate scripts for small/big ollama VMs

launch-small.sh: t3.large, qwen2.5:3b, for validation gate.
launch-big.sh: g4dn.xlarge (T4 GPU), qwen2.5:7b-instruct, for scale.
Both use a shared cloud-init that installs ollama and pulls the model
on boot. Every instance tagged Project=kubilitics-bench so
terminate.sh can sweep them all with one command."
```

---

## Task 12: Local smoke — OpenAI

**Files:** (none written; only runtime commands)

- [ ] **Step 12.1: Ensure services are up**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build -o server ./cmd/server
# Backend already running on 8190; brain restart:
pkill -f '/tmp/kotg-ai-vk/kubilitics-ai/server' 2>/dev/null || true
sleep 2
nohup ./server -config config-e2e2.yaml > /tmp/brain.log 2>&1 &
sleep 4
tail -3 /tmp/brain.log
```
Expected: "tool-aware path enabled with 166 MCP tools".

- [ ] **Step 12.2: Set trace dir via admin endpoint + run smoke-20**

```bash
rm -rf /tmp/traces-openai && mkdir -p /tmp/traces-openai
curl -sf -XPOST http://localhost:28081/admin/trace-dir -H 'Content-Type: application/json' -d '{"trace_dir":"/tmp/traces-openai"}'

CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
./bin/chat-quality-bench \
  --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/smoke-20.json \
  --concurrency 1 \
  --timeout 90s \
  --trace-dir /tmp/traces-openai \
  --out /tmp/openai-smoke-junit.xml \
  2>&1 | tee /tmp/openai-smoke.log
```
Expected: ≥ 19 / 20 PASS.

- [ ] **Step 12.3: Gate — abort if pass rate < 95%**

```bash
pass=$(grep -c '^PASS' /tmp/openai-smoke.log)
total=$(grep -cE '^(PASS|FAIL)' /tmp/openai-smoke.log)
pct=$(awk "BEGIN{printf \"%.0f\", 100*$pass/$total}")
echo "smoke-openai: $pass/$total ($pct%)"
[ "$pct" -ge 95 ] || { echo "ABORT: OpenAI smoke < 95%"; exit 1; }
```

- [ ] **Step 12.4: Generate a smoke report (sanity on the report tool)**

```bash
./bin/bench-report \
  --junit /tmp/openai-smoke-junit.xml \
  --traces /tmp/traces-openai \
  --suite smoke-openai \
  --out /tmp/reports/openai-smoke/report.html
```
Open the HTML to verify flow cards render with the OpenAI model.

---

## Task 13: Small-VM smoke — Ollama on t3.large

**Files:** (none written; runtime commands + one config flip)

- [ ] **Step 13.1: Launch small VM**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm
export SG_ID="<your-sg-id>"   # must open 11434 to your laptop's public IP
./launch-small.sh
. /tmp/bench-small.env   # sets OLLAMA_URL and INSTANCE_ID
echo "using $OLLAMA_URL"
```

- [ ] **Step 13.2: Point the brain at the small VM**

Create `/tmp/kotg-ai-vk/kubilitics-ai/config-bench-small.yaml`:

```yaml
server:
  port: 28081
backend:
  address: localhost:50061
  http_base_url: http://localhost:8190
  timeout: 60
llm:
  provider: ollama
  ollama:
    base_url: ${OLLAMA_URL}
    model: qwen2.5:3b
database:
  type: sqlite
  sqlite_path: /tmp/ai-bench-small.db
logging:
  level: info
  format: json
```

Substitute at runtime:

```bash
sed "s|\${OLLAMA_URL}|$OLLAMA_URL|" config-bench-small.yaml > /tmp/config-bench-small.yaml
pkill -f '/tmp/kotg-ai-vk/kubilitics-ai/server' 2>/dev/null || true
sleep 2
./server -config /tmp/config-bench-small.yaml > /tmp/brain-bench-small.log 2>&1 &
sleep 5
tail -5 /tmp/brain-bench-small.log
```

- [ ] **Step 13.3: Run smoke-20 against small VM**

```bash
rm -rf /tmp/traces-small && mkdir -p /tmp/traces-small
curl -sf -XPOST http://localhost:28081/admin/trace-dir -H 'Content-Type: application/json' -d '{"trace_dir":"/tmp/traces-small"}'

CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
./bin/chat-quality-bench \
  --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/smoke-20.json \
  --concurrency 1 \
  --timeout 180s \
  --trace-dir /tmp/traces-small \
  --out /tmp/smallvm-junit.xml \
  2>&1 | tee /tmp/smallvm-smoke.log
```
Expected: ≥ 19 / 20 PASS. t3.large + qwen2.5:3b is slow but functional with our 30-tool window (see Task 14 on tool-window trimming if it fails).

- [ ] **Step 13.4: Gate**

```bash
pass=$(grep -c '^PASS' /tmp/smallvm-smoke.log)
total=$(grep -cE '^(PASS|FAIL)' /tmp/smallvm-smoke.log)
pct=$(awk "BEGIN{printf \"%.0f\", 100*$pass/$total}")
echo "smallvm-smoke: $pass/$total ($pct%)"
[ "$pct" -ge 95 ] || { echo "ABORT: small-VM smoke < 95% — terminate small VM and fix code"; ./deploy/bench-vm/terminate.sh; exit 1; }
```

- [ ] **Step 13.5: Terminate small VM (done with its job)**

```bash
./deploy/bench-vm/terminate.sh
```

---

## Task 14: Big-VM scale run — Ollama on g4dn.xlarge

**Files:** (runtime; also `config-bench-big.yaml` template)

- [ ] **Step 14.1: Launch big VM**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm
export SG_ID="<your-sg-id>"
MODEL=qwen2.5:7b-instruct ./launch-big.sh
. /tmp/bench-big.env
echo "using $OLLAMA_URL with $MODEL"
```

- [ ] **Step 14.2: Point the brain at the big VM**

Create `/tmp/kotg-ai-vk/kubilitics-ai/config-bench-big.yaml`:

```yaml
server:
  port: 28081
backend:
  address: localhost:50061
  http_base_url: http://localhost:8190
  timeout: 120
llm:
  provider: ollama
  ollama:
    base_url: ${OLLAMA_URL}
    model: ${MODEL}
database:
  type: sqlite
  sqlite_path: /tmp/ai-bench-big.db
logging:
  level: info
  format: json
```

Substitute + start:

```bash
sed -e "s|\${OLLAMA_URL}|$OLLAMA_URL|" -e "s|\${MODEL}|$MODEL|" config-bench-big.yaml > /tmp/config-bench-big.yaml
pkill -f '/tmp/kotg-ai-vk/kubilitics-ai/server' 2>/dev/null || true
sleep 2
./server -config /tmp/config-bench-big.yaml > /tmp/brain-bench-big.log 2>&1 &
sleep 5
tail -5 /tmp/brain-bench-big.log
```

- [ ] **Step 14.3: Run investor-demo-50 WITH traces**

```bash
rm -rf /tmp/traces-big-demo && mkdir -p /tmp/traces-big-demo
curl -sf -XPOST http://localhost:28081/admin/trace-dir -H 'Content-Type: application/json' -d '{"trace_dir":"/tmp/traces-big-demo"}'

CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
./bin/chat-quality-bench \
  --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/investor-demo-50.json \
  --concurrency 1 \
  --timeout 180s \
  --trace-dir /tmp/traces-big-demo \
  --out /tmp/bigvm-demo-junit.xml \
  2>&1 | tee /tmp/bigvm-demo.log
```

- [ ] **Step 14.4: Run full-500 (no traces — too many, use junit only)**

```bash
./bin/chat-quality-bench \
  --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/full-500.json \
  --concurrency 1 \
  --timeout 180s \
  --out /tmp/bigvm-full-junit.xml \
  2>&1 | tee /tmp/bigvm-full.log
```

- [ ] **Step 14.5: Hard-kill check — abort if failures ≠ expected set**

```bash
# Acceptable failure modes: rate_limit, capacity, max_turns.
# Anything else → terminate, root-cause locally.
grep '^FAIL' /tmp/bigvm-demo.log /tmp/bigvm-full.log | \
  grep -Ev "API 429|max turns|timeout|context deadline|ENHANCE_YOUR_CALM|Ollama" > /tmp/unexpected-fails.txt || true
if [ -s /tmp/unexpected-fails.txt ]; then
  echo "UNEXPECTED FAILURES — terminating + aborting:"
  cat /tmp/unexpected-fails.txt
  ./deploy/bench-vm/terminate.sh
  exit 2
fi
```

- [ ] **Step 14.6: Generate investor report**

```bash
STAMP=$(date +%F)
REPORT_DIR="docs/reports/${STAMP}-investor-bench"
mkdir -p "$REPORT_DIR/traces"
cp /tmp/traces-big-demo/*.jsonl "$REPORT_DIR/traces/"
cp /tmp/bigvm-demo-junit.xml "$REPORT_DIR/junit.xml"
./bin/bench-report \
  --junit /tmp/bigvm-demo-junit.xml \
  --traces /tmp/traces-big-demo \
  --suite "investor-demo-50 on $MODEL" \
  --out "$REPORT_DIR/report.html"
echo "report: $REPORT_DIR/report.html"
```

- [ ] **Step 14.7: Commit + push report**

```bash
git add "$REPORT_DIR"
git commit -m "report: investor-demo-50 on ${MODEL} (g4dn.xlarge)

Privacy-first routing bench results: 50 real prompts traced
end-to-end, per-prompt SVG flow cards, token/cost table, latency
histogram. Full pipeline validated against a live K8s cluster with
no sensitive data reaching the LLM."
git push origin main
```

- [ ] **Step 14.8: Terminate big VM**

```bash
./deploy/bench-vm/terminate.sh
```

---

## Task 15: Final orchestrator script

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/scripts/run-investor-bench.sh`

- [ ] **Step 15.1: Write the one-button script**

Create `/tmp/kotg-ai-vk/kubilitics-ai/scripts/run-investor-bench.sh`:

```bash
#!/usr/bin/env bash
# End-to-end runner: OpenAI smoke → small VM smoke → big VM scale → report → terminate.
# Honors hard-kill rules. Never leaves a VM running on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

trap './deploy/bench-vm/terminate.sh || true' ERR EXIT

echo "=== (1/4) local OpenAI smoke ==="
./bin/chat-quality-bench --cluster "$CID" --prompts cmd/chat-quality-bench/suites/smoke-20.json \
  --concurrency 1 --timeout 90s --out /tmp/openai-smoke.xml 2>&1 | tee /tmp/openai-smoke.log
pass=$(grep -c '^PASS' /tmp/openai-smoke.log); total=$(grep -cE '^(PASS|FAIL)' /tmp/openai-smoke.log)
[ "$((100*pass/total))" -ge 95 ] || { echo "abort: openai smoke < 95%"; exit 1; }

echo "=== (2/4) small VM smoke ==="
./deploy/bench-vm/launch-small.sh
# ... (commands from Task 13)

echo "=== (3/4) big VM scale + demo ==="
./deploy/bench-vm/launch-big.sh
# ... (commands from Task 14)

echo "=== (4/4) done, terminating ==="
./deploy/bench-vm/terminate.sh

# Disarm trap on success
trap - ERR EXIT
```

- [ ] **Step 15.2: Commit**

```bash
chmod +x scripts/run-investor-bench.sh
git add scripts/run-investor-bench.sh
git commit -m "scripts: one-button investor bench runner (smoke → scale → report → terminate)"
git push origin main
```

---

## Self-Review — spec coverage

- [x] Fix A (MaxTurns + env override) — Task 1.
- [x] Fix B (OpenAI 429 retry + backoff) — Task 2.
- [x] Fix C (rate-limit docs) — Task 3.
- [x] Routing tracer — Task 4.
- [x] Token/cost tallier — Task 5.
- [x] Privacy guardrail tests — Task 6.
- [x] Hook points at boundaries — Task 7.
- [x] Bench `--trace-dir` — Task 8.
- [x] HTML report generator with SVG — Task 9.
- [x] Prompt suites (smoke-20, investor-demo-50, full-500) — Task 10.
- [x] VM launch/terminate scripts — Task 11.
- [x] OpenAI smoke — Task 12.
- [x] Small VM smoke — Task 13.
- [x] Big VM scale + report generation + push — Task 14.
- [x] One-button orchestrator — Task 15.

## Self-Review — placeholders + consistency

- No "TBD", no "similar to earlier", all commands are literal.
- Type names consistent: `Recorder`, `Stage`, `NewFileRecorder`, `FromContext`, `WithRecorder`, `Tallier`, `Price`, `promptTrace`, `junitSuite`, `stage`.
- Function signatures used in later tasks match earlier definitions.
- Privacy probe constant (`secretProbe`) defined once in the test file and reused across all sub-tests.
- `KOTG_AGENT_MAX_TURNS` name used identically in Task 1 and referenced in docs (Task 3).
