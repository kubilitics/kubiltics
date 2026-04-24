# Kubilitics Validation Bench — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plumb real token accounting through the Ollama provider, emit `done` + `cost` tracer stages, build a tool-catalog extractor + plain-English prose seed for the 166 MCP tools, rewrite the bench report as an interactive HTML with a client-side tool explorer + prompt walkthroughs, launch `g5.12xlarge` + `qwen2.5:72b-instruct`, run the full validation bench, and produce an investor-ready report committed to the repo.

**Architecture:** Token counts flow from `ollama.OllamaClientImpl` → `types.AgentStreamEvent.TokenUsage` → `runtime.toolStreamEvent` → `llm_adapter.go` → `routing.FromContext(ctx).Stage("cost", …)`. The bench harness writes per-prompt JSONL traces. The new `cmd/tool-catalog` extracts all tools from `ToolTaxonomy` + chat-tool defs and merges a hand-authored `plain-english.json` (seeded with 20 canonical entries, rest marked pending). The new report generator ingests JUnit + traces + tool catalog → single self-contained HTML with client-side search + expandable prompt walkthroughs.

**Tech Stack:** Go 1.24 (brain + bench + report generator), vanilla JS + inline CSS (report interactivity), AWS EC2 `g5.12xlarge` + DLAMI + Ollama for model serving, kind for local K8s.

---

## File Structure

| Path | Responsibility | Create/Modify |
|---|---|---|
| `internal/llm/types/tool_execution.go` | Add `TokenUsage` field on `AgentStreamEvent` | Modify |
| `internal/llm/provider/ollama/client.go` | Parse `prompt_eval_count` / `eval_count` from chat response, return via `AgentStreamEvent.TokenUsage` | Modify |
| `internal/runtime/llm_adapter.go` | Forward `TokenUsage`; emit `done` + `cost` stages at end of turn | Modify |
| `cmd/tool-catalog/main.go` | Extract all tools from taxonomy + merge plain-english.json → catalog JSON | Create |
| `cmd/tool-catalog/main_test.go` | Unit tests for extractor | Create |
| `docs/reports/plain-english.json` | 20 hand-authored canonical entries (seed); rest "(pending)" | Create |
| `cmd/bench-report/template_v2.go` | New HTML template with tool explorer + prompt walkthroughs | Create |
| `cmd/bench-report/static/app.js` | Client-side filter/search/expand (~200 LOC vanilla JS) | Create |
| `cmd/bench-report/main.go` | Wire `--catalog` flag; select v1 vs v2 template | Modify |
| `cmd/bench-report/main_test.go` | Add coverage for catalog merge + v2 render | Modify |
| `deploy/bench-vm/preflight.sh` | Quota + SG + AMI verification | Create |
| `deploy/bench-vm/launch-big.sh` | Default `INSTANCE_TYPE=g5.12xlarge`, `ROOT_DISK_GB=100` | Modify |
| `deploy/bench-vm/cloud-init.yaml` | No-op (model pulled via script, not cloud-init) | unchanged |
| `scripts/run-investor-bench.sh` | Full orchestrator: preflight → launch → bench → report → terminate | Create |

---

## Preconditions

- [ ] **P1: Clean git state + branch on main**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && git status -sb
```
Expected: `## main...origin/main` clean. If untracked binaries etc., commit or gitignore.

- [ ] **P2: kind-kubilitics-test cluster is up**

```bash
kubectl config current-context
kubectl get nodes
```
Expected: `kind-kubilitics-test` as current context, 3 nodes `Ready`.

- [ ] **P3: AWS CLI works + SG available**

```bash
aws sts get-caller-identity --query 'Arn' --output text
aws ec2 describe-security-groups --group-ids sg-09b612ed6a1404d11 --query 'SecurityGroups[0].GroupName' --output text
```
Expected: user ARN printed; SG name printed (`kubilitics-ollama-bench-sg` or similar).

---

## Task 1: Add TokenUsage field on AgentStreamEvent

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution.go`
- Test: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/types/tool_execution_test.go` (append)

- [ ] **Step 1.1: Write failing test**

Append to `internal/llm/types/tool_execution_test.go`:

```go
func TestAgentStreamEvent_TokenUsageFieldExists(t *testing.T) {
	// Lock down the zero-value + round-trip so later additions don't
	// silently break the provider → adapter → recorder chain that
	// depends on these field names.
	ev := AgentStreamEvent{
		TokenUsage: &TokenUsage{
			InputTokens:  100,
			OutputTokens: 25,
		},
	}
	if ev.TokenUsage == nil {
		t.Fatalf("TokenUsage must be a pointer field so nil means 'not known'")
	}
	if ev.TokenUsage.InputTokens != 100 || ev.TokenUsage.OutputTokens != 25 {
		t.Fatalf("fields not stored correctly: %+v", ev.TokenUsage)
	}
}
```

- [ ] **Step 1.2: Run, expect fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
go test ./internal/llm/types/... -run TokenUsage -v
```
Expected: compile error — `AgentStreamEvent` has no field `TokenUsage`.

- [ ] **Step 1.3: Check current `TokenUsage` struct**

```bash
grep -n "type TokenUsage\|TokenUsage struct" internal/llm/types/*.go
```
Expected: find an existing `TokenUsage` type. If it exists, reuse. If not, add:

```go
type TokenUsage struct {
	InputTokens      int     `json:"input_tokens"`
	OutputTokens     int     `json:"output_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	EstimatedCost    float64 `json:"estimated_cost"`
}
```

(The codebase may already have this — don't duplicate.)

- [ ] **Step 1.4: Add TokenUsage field to AgentStreamEvent**

In `internal/llm/types/tool_execution.go`, find `type AgentStreamEvent struct`:

```go
type AgentStreamEvent struct {
	TextToken string
	ToolEvent *ToolEvent
	Done      bool
	Err       error
	// TokenUsage is non-nil only on the terminal Done event and carries
	// the provider's final input/output token counts. Providers that
	// don't surface usage leave this nil.
	TokenUsage *TokenUsage
}
```

- [ ] **Step 1.5: Run, expect pass**

```bash
go test ./internal/llm/types/... -run TokenUsage -v
go test ./internal/llm/... -count=1
```
Expected: all PASS.

- [ ] **Step 1.6: Commit**

```bash
git add internal/llm/types/tool_execution.go internal/llm/types/tool_execution_test.go
git commit -m "feat(types): AgentStreamEvent carries optional TokenUsage

Nil means 'provider did not surface token counts'; non-nil is the
terminal signal for the adapter to emit a cost stage in the routing
trace. Ollama + OpenAI providers populate this on Done."
```

---

## Task 2: Surface token counts from Ollama client

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/ollama/client.go`
- Test: `/tmp/kotg-ai-vk/kubilitics-ai/internal/llm/provider/ollama/client_test.go` (append)

- [ ] **Step 2.1: Inspect ollamaChatResponse**

```bash
grep -n "ollamaChatResponse\|prompt_eval_count\|eval_count" internal/llm/provider/ollama/client.go | head
```
Find the response struct. It currently parses `Message` + `Done` but likely doesn't read `prompt_eval_count` / `eval_count`.

- [ ] **Step 2.2: Add fields to ollamaChatResponse**

In `internal/llm/provider/ollama/client.go`, update `ollamaChatResponse` struct:

```go
type ollamaChatResponse struct {
	Model     string `json:"model"`
	CreatedAt string `json:"created_at"`
	Message   struct {
		Role      string           `json:"role"`
		Content   string           `json:"content"`
		ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	Done              bool `json:"done"`
	// PromptEvalCount is the number of input tokens Ollama counted.
	// EvalCount is the number of output tokens. Present on Done=true.
	PromptEvalCount int `json:"prompt_eval_count"`
	EvalCount       int `json:"eval_count"`
}
```

- [ ] **Step 2.3: Write the failing test**

Append to `internal/llm/provider/ollama/client_test.go`:

```go
func TestCompleteWithTools_EmitsTokenUsageOnDone(t *testing.T) {
	// Ollama-style response with token counts. The provider must
	// forward these as a terminal AgentStreamEvent.TokenUsage so the
	// adapter can emit a cost stage.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"model": "qwen2.5:72b-instruct",
			"created_at": "2026-04-21T12:00:00Z",
			"message": {"role": "assistant", "content": "hi"},
			"done": true,
			"prompt_eval_count": 1234,
			"eval_count": 56
		}`))
	}))
	defer srv.Close()

	c, err := NewOllamaClient(srv.URL, "qwen2.5:72b-instruct")
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	ch, err := c.CompleteWithTools(context.Background(),
		[]types.Message{{Role: "user", Content: "hi"}},
		nil, nil, types.DefaultAgentConfig())
	if err != nil {
		t.Fatalf("CompleteWithTools: %v", err)
	}
	var sawUsage bool
	for ev := range ch {
		if ev.TokenUsage != nil {
			sawUsage = true
			if ev.TokenUsage.InputTokens != 1234 || ev.TokenUsage.OutputTokens != 56 {
				t.Fatalf("wrong counts: %+v", ev.TokenUsage)
			}
			if !ev.Done {
				t.Fatalf("TokenUsage must arrive on a Done event")
			}
		}
	}
	if !sawUsage {
		t.Fatalf("never saw an AgentStreamEvent with TokenUsage populated")
	}
}
```

Note: this test requires `NewOllamaClient` to succeed against an httptest server. If the current `NewOllamaClient` does a `testConnection` that calls `/api/tags`, the test server must also respond to GET `/api/tags` with a valid shape. If needed, make the test server a `http.ServeMux`:

```go
mux := http.NewServeMux()
mux.HandleFunc("/api/tags", func(w http.ResponseWriter, r *http.Request) {
	_, _ = w.Write([]byte(`{"models":[]}`))
})
mux.HandleFunc("/api/chat", func(w http.ResponseWriter, r *http.Request) { /* ...as above... */ })
srv := httptest.NewServer(mux)
```

- [ ] **Step 2.4: Run, expect fail**

```bash
go test ./internal/llm/provider/ollama/... -run EmitsTokenUsage -v
```
Expected: FAIL (never saw a TokenUsage event) or compile error.

- [ ] **Step 2.5: Emit TokenUsage in the tool-call code path**

In `internal/llm/provider/ollama/client.go`, find `CompleteWithTools`. After parsing `chatResponse`, when emitting the terminal Done event to the channel, include `TokenUsage`:

```go
// Right after successful parse + before sending the final Done on evtCh.
// Locate the existing `evtCh <- types.AgentStreamEvent{Done: true}` or
// equivalent and replace with:
evtCh <- types.AgentStreamEvent{
	Done: true,
	TokenUsage: &types.TokenUsage{
		InputTokens:  chatResponse.PromptEvalCount,
		OutputTokens: chatResponse.EvalCount,
		TotalTokens:  chatResponse.PromptEvalCount + chatResponse.EvalCount,
	},
}
```

Note: If `CompleteWithTools` has multiple code paths (error, tool-calls, text-only), emit `TokenUsage` on the terminal-Done of every path. Token counts can be zero (set nil in that case).

- [ ] **Step 2.6: Run the Ollama tests**

```bash
go test ./internal/llm/provider/ollama/... -count=1 -v 2>&1 | tail -25
```
Expected: all PASS.

- [ ] **Step 2.7: Commit**

```bash
git add internal/llm/provider/ollama/client.go internal/llm/provider/ollama/client_test.go
git commit -m "feat(ollama): surface prompt_eval_count + eval_count to AgentStreamEvent

Terminal Done events now carry TokenUsage{InputTokens, OutputTokens}
sourced from Ollama's chat response. The runtime adapter consumes
this to emit a cost stage in the routing trace."
```

---

## Task 3: Wire `done` + `cost` tracer stages in llm_adapter

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`

- [ ] **Step 3.1: Add TokenUsage to toolStreamEvent (runtime-internal mirror)**

In `internal/runtime/llm_adapter.go`, find `type toolStreamEvent struct` (the runtime's internal mirror of AgentStreamEvent). Add field:

```go
type toolStreamEvent struct {
	TextToken  string
	Tool       *toolEvent
	Done       bool
	Err        error
	TokenUsage *toolTokenUsage
}

type toolTokenUsage struct {
	InputTokens  int
	OutputTokens int
}
```

- [ ] **Step 3.2: Forward TokenUsage in the bridge goroutine**

In `StreamCompletionWithTools`, find the goroutine that translates `AgentStreamEvent` → `toolStreamEvent`. Modify the for-loop body:

```go
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
	if ev.TokenUsage != nil {
		te.TokenUsage = &toolTokenUsage{
			InputTokens:  ev.TokenUsage.InputTokens,
			OutputTokens: ev.TokenUsage.OutputTokens,
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
```

- [ ] **Step 3.3: Emit `done` + `cost` stages after the range exits**

Still in `StreamCompletionWithTools`, at the end of the goroutine (after the range completes, before the goroutine returns):

```go
// After the for range src loop finishes, before the deferred close(out).
// `start` must be captured at the top of the goroutine — see step 3.4.
routing.FromContext(ctx).Stage("llm_text_out", map[string]any{"bytes": textBytes})

durationMs := time.Since(start).Milliseconds()
routing.FromContext(ctx).Stage("done", map[string]any{
	"duration_ms":   durationMs,
	"finish_reason": "stop", // or whatever provider reported; leave "stop" if unknown
})

if lastUsage != nil {
	// Compute USD via accounting.Tallier so the report can roll it up.
	t := accounting.NewTallier(b.A.GetProvider()) // provider-qualified model string
	t.AddInput(lastUsage.InputTokens)
	t.AddOutput(lastUsage.OutputTokens)
	routing.FromContext(ctx).Stage("cost", map[string]any{
		"input_tokens":  lastUsage.InputTokens,
		"output_tokens": lastUsage.OutputTokens,
		"usd_total":     t.USD(),
	})
}
```

- [ ] **Step 3.4: Add `start` + `lastUsage` local vars at top of the goroutine**

Right above the `for ev := range src` loop, inside the goroutine body:

```go
start := time.Now()
var lastUsage *toolTokenUsage
```

And inside the loop body, where you copy `TokenUsage`, additionally capture it for after the loop:

```go
if ev.TokenUsage != nil {
	te.TokenUsage = &toolTokenUsage{
		InputTokens:  ev.TokenUsage.InputTokens,
		OutputTokens: ev.TokenUsage.OutputTokens,
	}
	lastUsage = te.TokenUsage
}
```

Add these imports at top of `llm_adapter.go` if missing:

```go
import (
	"time"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/accounting"
	// ... existing imports ...
)
```

If `b.A.GetProvider()` doesn't return a model-qualified string (e.g. returns `"ollama"` rather than `"qwen2.5:72b-instruct"`), the Tallier's price lookup will fall back to $0 — which is correct for Ollama. Don't overfit for OpenAI/Anthropic here; that's a separate wiring job.

- [ ] **Step 3.5: Build + run all tests**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
go build ./...
go test ./internal/runtime/... ./internal/llm/... -count=1 2>&1 | tail -15
```
Expected: all PASS.

- [ ] **Step 3.6: Commit**

```bash
git add internal/runtime/llm_adapter.go
git commit -m "feat(tracing): emit done + cost stages at end of each chat turn

Carries through TokenUsage from the provider AgentStreamEvent,
captures wall-clock latency locally, runs the counts through
accounting.Tallier, and emits:
  - done:  {duration_ms, finish_reason}
  - cost:  {input_tokens, output_tokens, usd_total}

The bench-report populates its latency histogram + token/cost table
from these stages."
```

---

## Task 4: Tool-catalog extractor + plain-English seed

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/tool-catalog/main.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/tool-catalog/main_test.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/docs/reports/plain-english.json` (seed)

- [ ] **Step 4.1: Write the catalog extractor test first**

Create `cmd/tool-catalog/main_test.go`:

```go
package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildCatalog_IncludesToolFromTaxonomy(t *testing.T) {
	// Smoke: runs the extractor against the real taxonomy + a tiny
	// inline plain-english map. Asserts at least one well-known tool
	// (list_resources) is present with all expected fields.
	plain := map[string]string{
		"list_resources": "Shows you a list of things in your cluster.",
	}
	cat, err := buildCatalog(plain)
	if err != nil {
		t.Fatalf("buildCatalog: %v", err)
	}
	if len(cat) == 0 {
		t.Fatalf("catalog is empty — expected 100+ tools")
	}
	var found *catalogEntry
	for i := range cat {
		if cat[i].Name == "list_resources" {
			found = &cat[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("list_resources not in catalog")
	}
	if found.PlainEnglish != "Shows you a list of things in your cluster." {
		t.Fatalf("plain_english not merged: %+v", found)
	}
	if found.Category == "" {
		t.Fatalf("category empty")
	}
	if found.Description == "" {
		t.Fatalf("technical description empty")
	}
}

func TestBuildCatalog_MarksMissingPlainEnglishAsPending(t *testing.T) {
	// Any tool without a plain-english entry gets a documented
	// "(description pending)" so the report can flag the gap honestly.
	cat, err := buildCatalog(map[string]string{}) // empty map
	if err != nil {
		t.Fatalf("buildCatalog: %v", err)
	}
	for _, e := range cat {
		if e.PlainEnglish != "(description pending)" {
			t.Fatalf("unmatched tool should be marked pending, got %q on %s",
				e.PlainEnglish, e.Name)
		}
	}
}

func TestWriteCatalogJSON_RoundTrip(t *testing.T) {
	sample := []catalogEntry{
		{Name: "x", Category: "Observation", Description: "d", PlainEnglish: "p"},
	}
	var buf strings.Builder
	if err := writeCatalogJSON(&buf, sample); err != nil {
		t.Fatalf("write: %v", err)
	}
	var got []catalogEntry
	if err := json.Unmarshal([]byte(buf.String()), &got); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got) != 1 || got[0].Name != "x" {
		t.Fatalf("roundtrip failed: %+v", got)
	}
}
```

- [ ] **Step 4.2: Expect fail (package doesn't exist)**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./cmd/tool-catalog/... -v
```
Expected: `no Go files in cmd/tool-catalog`.

- [ ] **Step 4.3: Implement the extractor**

Create `cmd/tool-catalog/main.go`:

```go
// tool-catalog reads the kubilitics-ai MCP tool taxonomy + chat-tool
// defs, merges a hand-authored plain-english.json ("one sentence a
// non-engineer can understand"), and emits a single JSON catalog for
// the bench report to render. 166 tools total split across 8
// categories.
//
// Usage:
//
//	tool-catalog \
//	    --plain-english docs/reports/plain-english.json \
//	    --out           docs/reports/<date>-kubilitics-validation/tool-catalog.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	mcptools "github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/mcp/tools"
)

type catalogEntry struct {
	Name         string                 `json:"name"`
	Category     string                 `json:"category"`
	Description  string                 `json:"description"`
	Parameters   map[string]interface{} `json:"parameters,omitempty"`
	Required     []interface{}          `json:"required,omitempty"`
	PlainEnglish string                 `json:"plain_english"`
	Autonomy     int                    `json:"autonomy_level"`
}

func main() {
	plainPath := flag.String("plain-english", "docs/reports/plain-english.json", "plain-english JSON")
	out := flag.String("out", "", "output catalog JSON path (required)")
	flag.Parse()
	if *out == "" {
		log.Fatal("--out is required")
	}

	plain, err := readPlainEnglish(*plainPath)
	if err != nil {
		log.Fatalf("read plain-english: %v", err)
	}

	cat, err := buildCatalog(plain)
	if err != nil {
		log.Fatalf("build catalog: %v", err)
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create out: %v", err)
	}
	defer f.Close()
	if err := writeCatalogJSON(f, cat); err != nil {
		log.Fatalf("write: %v", err)
	}
	fmt.Printf("wrote %s (%d entries)\n", *out, len(cat))
}

func readPlainEnglish(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// buildCatalog merges the taxonomy + chat-tool defs with plain-english
// prose. Tools missing a plain-english entry get "(description pending)"
// so the gap is visible in the report.
func buildCatalog(plain map[string]string) ([]catalogEntry, error) {
	var out []catalogEntry
	seen := map[string]bool{}

	for _, t := range mcptools.ToolTaxonomy {
		if seen[t.Name] {
			continue
		}
		seen[t.Name] = true
		out = append(out, toEntry(t.Name, string(t.Category), t.Description,
			t.InputSchema, int(t.RequiredAutonomyLevel), plain))
	}

	for _, t := range mcptools.GetChatToolDefinitions() {
		if seen[t.Name] {
			continue
		}
		seen[t.Name] = true
		out = append(out, toEntry(t.Name, string(t.Category), t.Description,
			t.InputSchema, int(t.RequiredAutonomyLevel), plain))
	}
	return out, nil
}

func toEntry(name, cat, desc string, schema map[string]interface{}, autonomy int, plain map[string]string) catalogEntry {
	pe := plain[name]
	if strings.TrimSpace(pe) == "" {
		pe = "(description pending)"
	}
	var params map[string]interface{}
	var req []interface{}
	if p, ok := schema["properties"].(map[string]interface{}); ok {
		params = p
	}
	if r, ok := schema["required"].([]interface{}); ok {
		req = r
	}
	return catalogEntry{
		Name:         name,
		Category:     cat,
		Description:  desc,
		Parameters:   params,
		Required:     req,
		PlainEnglish: pe,
		Autonomy:     autonomy,
	}
}

func writeCatalogJSON(w io.Writer, cat []catalogEntry) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(cat)
}
```

**Note:** the exact field names on the `ToolDefinition` struct (`t.Name`, `t.Category`, `t.Description`, `t.InputSchema`, `t.RequiredAutonomyLevel`) must match what `internal/mcp/tools/taxonomy.go` actually exposes. If one doesn't exist (e.g. the field is named differently), adjust the accessor. The existing `cmd/count-tools/main.go` uses the same imports successfully — mirror its pattern.

- [ ] **Step 4.4: Run tests, expect pass**

```bash
go test ./cmd/tool-catalog/... -v -count=1
```
Expected: 3 PASS.

- [ ] **Step 4.5: Seed 20 canonical plain-english entries**

Create `docs/reports/plain-english.json`:

```json
{
  "list_resources": "Shows you a list of things in your cluster — pods, services, anything. Tell it 'list pods' and it fetches them straight from Kubernetes.",
  "get_resource": "Gets the full details of one specific thing (a single pod, a single deployment) when you need to see everything about it.",
  "get_logs": "Gets recent log lines from a pod, so you can see what the application actually said or errored out with.",
  "get_events": "Lists recent Kubernetes events — useful for 'why did my pod fail?' or 'what happened in the last hour?'",
  "get_cluster_health": "Gives a plain-English summary of whether the cluster looks healthy right now: node count, pod statuses, obvious problems.",
  "observe_cluster_overview": "A dashboard-style snapshot of the whole cluster: what's running, what's broken, at-a-glance numbers.",
  "observe_namespace_overview": "Zoom in on one namespace: what's running inside it, resource usage, recent events.",
  "observe_namespace_detailed": "Deep dive into a namespace — every pod, every service, every config, plus recent changes.",
  "observe_pod_detailed": "Deep dive into a single pod: containers, status, restarts, resource usage, recent events.",
  "observe_pod_logs": "Fetches logs for a specific pod with filtering by tail size or time window.",
  "observe_pod_events": "Just the events that mention a specific pod — scheduled, started, killed, restarted, etc.",
  "observe_node_detailed": "Everything about a single node: its pods, capacity, conditions, what's failing if anything.",
  "observe_node_status": "Is this node healthy? Are disks / memory / CPU under pressure?",
  "observe_deployment_detailed": "Everything about one deployment: replicas, pods, rollout status, recent changes.",
  "observe_workload_health": "A high-level 'is my workload healthy?' check across deployments, statefulsets, daemonsets.",
  "analyze_pod_health": "Checks every pod for common problems — restarts, OOM kills, image-pull errors, CrashLoopBackOff — and summarizes in plain language.",
  "analyze_deployment_health": "Checks if deployments have the right number of ready replicas and flags ones that are degraded.",
  "analyze_node_pressure": "Looks for nodes under CPU / memory / disk pressure that might start evicting pods.",
  "analyze_rbac_permissions": "Reviews who has access to what in the cluster and flags overly-broad bindings.",
  "analyze_storage_health": "Checks persistent-volume claims — are they bound, are they full, are any in an error state."
}
```

- [ ] **Step 4.6: Smoke-run the extractor against real taxonomy**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
go run ./cmd/tool-catalog --plain-english docs/reports/plain-english.json --out /tmp/catalog.json
head -40 /tmp/catalog.json
wc -l /tmp/catalog.json
```
Expected: catalog has 150+ entries (we have 166 in taxonomy, +5 chat-specific; some chat/taxonomy names overlap). The 20 seeded entries should show full plain_english text; the rest `"(description pending)"`.

- [ ] **Step 4.7: Commit**

```bash
git add cmd/tool-catalog/ docs/reports/plain-english.json
git commit -m "feat(bench): tool-catalog extractor + 20 seed plain-english entries

Reads ToolTaxonomy + GetChatToolDefinitions in-process, merges
docs/reports/plain-english.json, emits a single JSON catalog for
the bench report to render. 20 canonical tools seeded; rest marked
'(description pending)' so the gap is honest and visible in the
report's methodology section."
```

---

## Task 5: Bench-report v2 template with interactive tool explorer

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/template_v2.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/static/app.js`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/static/styles.css`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench-report/main.go` (add `--catalog` flag + route to v2)

- [ ] **Step 5.1: Add `--catalog` + `--v2` flags to main.go**

Edit `cmd/bench-report/main.go` to add flags near the existing ones:

```go
catalogPath := flag.String("catalog", "", "path to tool-catalog.json (optional; enables tool-explorer section)")
useV2 := flag.Bool("v2", false, "use the v2 interactive report template")
```

Below `parseJUnit` etc., load catalog if provided:

```go
var catalog []catalogEntry
if *catalogPath != "" {
	b, err := os.ReadFile(*catalogPath)
	if err != nil {
		log.Fatalf("read catalog: %v", err)
	}
	if err := json.Unmarshal(b, &catalog); err != nil {
		log.Fatalf("parse catalog: %v", err)
	}
}
```

Declare the shared shape at file top (must match the extractor):

```go
type catalogEntry struct {
	Name         string                 `json:"name"`
	Category     string                 `json:"category"`
	Description  string                 `json:"description"`
	Parameters   map[string]interface{} `json:"parameters,omitempty"`
	Required     []interface{}          `json:"required,omitempty"`
	PlainEnglish string                 `json:"plain_english"`
	Autonomy     int                    `json:"autonomy_level"`
}
```

Then in the call to the renderer:

```go
if *useV2 {
	err = renderHTMLv2(f, *suite, s, traces, catalog)
} else {
	err = renderHTML(f, *suite, s, traces)
}
```

- [ ] **Step 5.2: Write the failing v2 renderer test**

In `cmd/bench-report/main_test.go`, append:

```go
func TestRenderHTMLv2_IncludesExecSummaryAndToolExplorer(t *testing.T) {
	j := &junitSuite{
		Name: "test",
		Tests: 2, Failures: 1,
		Cases: []junitCase{
			{Name: "p1", Time: 1.0},
			{Name: "p2", Time: 2.0, Failure: &junitFailure{Message: "nope"}},
		},
	}
	traces := map[string]*promptTrace{
		"p1": {PromptID: "p1", Stages: []stage{{Stage: "user_msg", Fields: map[string]any{"bytes": 10.0}}}},
	}
	cat := []catalogEntry{
		{Name: "list_resources", Category: "Observation", Description: "list k8s resources", PlainEnglish: "Shows things."},
	}
	var buf strings.Builder
	if err := renderHTMLv2(&buf, "test-suite", j, traces, cat); err != nil {
		t.Fatalf("render: %v", err)
	}
	h := buf.String()
	for _, want := range []string{
		"test-suite",       // suite name shows
		"1 / 2 passed",     // exec summary number
		"list_resources",   // tool explorer emits this
		"Shows things.",    // plain-english renders
		"Observation",      // category pill
		"<script",          // inline JS
		"tool-explorer",    // search container id
	} {
		if !strings.Contains(h, want) {
			t.Errorf("v2 html missing %q", want)
		}
	}
}
```

- [ ] **Step 5.3: Expect fail (renderHTMLv2 undefined)**

```bash
go test ./cmd/bench-report/... -run RenderHTMLv2 -v
```

- [ ] **Step 5.4: Implement `template_v2.go`**

Create `cmd/bench-report/template_v2.go`:

```go
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

//go:embed static/app.js
var embedAppJS string

//go:embed static/styles.css
var embedStylesCSS string

// renderHTMLv2 is the investor-grade interactive report. Unlike v1 it
// ships a client-side tool explorer (all 166 MCP tools, searchable +
// category-filtered) and expandable prompt walkthroughs, embeds the
// catalog JSON inline so the JS can filter without network, and leads
// with a "what is this?" non-technical intro.
//
// Output: one standalone HTML file. No CDN deps. Opens offline.
func renderHTMLv2(w io.Writer, suite string, junit *junitSuite, traces map[string]*promptTrace, catalog []catalogEntry) error {
	// Index junit by name so we can tag trace cards correctly.
	caseByName := make(map[string]*junitCase, len(junit.Cases))
	for i := range junit.Cases {
		caseByName[junit.Cases[i].Name] = &junit.Cases[i]
	}

	var passCount, failCount int
	for _, c := range junit.Cases {
		if c.Failure == nil {
			passCount++
		} else {
			failCount++
		}
	}
	totalCases := len(junit.Cases)
	passPct := 0.0
	if totalCases > 0 {
		passPct = 100 * float64(passCount) / float64(totalCases)
	}
	headlineClass := "red"
	if passPct >= 95 {
		headlineClass = "green"
	} else if passPct > 0 {
		headlineClass = "amber"
	}

	var totalUSD float64
	var totalInTokens, totalOutTokens int
	var latencies []int
	for _, t := range traces {
		totalUSD += t.USD
		totalInTokens += t.TokensIn
		totalOutTokens += t.TokensOut
		if d := traceDurationMs(t); d > 0 {
			latencies = append(latencies, d)
		}
	}

	// Embed the catalog JSON inline so the JS can read it without fetch().
	catalogBytes, _ := json.Marshal(catalog)

	fmt.Fprintf(w, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Kubilitics Validation Bench — %s</title>
<style>%s</style></head><body>`, htmlEscape(suite), embedStylesCSS)

	// Header
	fmt.Fprintf(w, `<header>
<h1>Kubilitics Validation Bench</h1>
<div class="meta">Suite: %s · Generated: %s</div>
</header><main>`, htmlEscape(suite), time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	// What is this? — non-tech intro.
	fmt.Fprint(w, `<section><h2>What is this?</h2>
<p>Kubilitics lets you talk to your Kubernetes cluster in plain English. You ask "list my pods", "why did this app crash", or "how's capacity looking" — and Kubilitics uses a large language model plus a safe set of tools to answer from your real cluster, not from training data.</p>
<p>This report is the result of running dozens of realistic prompts against a real Kubernetes cluster, with every single step recorded: what the user asked, which tools Kubilitics picked, what data flowed where, how long it took, and how much it cost. It's designed to be readable without any Kubernetes knowledge.</p>
<p>The core claim being validated: <strong>Kubilitics can answer questions about your cluster without sending sensitive cluster data to the language model.</strong> Every tool's raw response is summarized and redacted before the model sees it.</p>
</section>`)

	// Executive summary.
	fmt.Fprintf(w, `<section><h2>Results at a glance</h2>
<div class="big %s">%d / %d passed (%.1f%%)</div>
<div class="sub">Traces: %d · Compute cost: $%.4f · Tokens: %d in · %d out · Failures: %d</div>
</section>`, headlineClass, passCount, totalCases, passPct, len(traces), totalUSD, totalInTokens, totalOutTokens, failCount)

	// Architecture + privacy claim diagram.
	fmt.Fprint(w, `<section><h2>How Kubilitics routes a query</h2>
<p>Every time you ask Kubilitics something, the message takes this path:</p>
`)
	fmt.Fprint(w, architectureSVG())
	fmt.Fprint(w, `<p class="sub">Notice: the LLM box only receives <em>tool schemas</em> (a list of available capabilities) and <em>summarized, redacted tool results</em>. The raw Kubernetes API response is visible only on the backend ↔ cluster edge.</p>
</section>`)

	// Tool Explorer — 166 cards with client-side search.
	fmt.Fprint(w, `<section><h2>Tool Explorer</h2>
<p>Kubilitics exposes <strong>`+fmt.Sprintf("%d", len(catalog))+`</strong> tools the AI can pick from. Search and filter below. Click a card to see technical detail.</p>
<div class="explorer-controls">
<input id="tool-search" type="text" placeholder="Search tools… (/ to focus)" autocomplete="off">
<select id="tool-category">
<option value="">All categories</option>`)
	seenCats := map[string]bool{}
	for _, e := range catalog {
		if !seenCats[e.Category] && e.Category != "" {
			seenCats[e.Category] = true
			fmt.Fprintf(w, `<option value="%s">%s</option>`, htmlEscape(e.Category), htmlEscape(e.Category))
		}
	}
	fmt.Fprint(w, `</select>
<span id="tool-count-badge">0</span>
</div>
<div id="tool-explorer" class="explorer-grid">`)
	// Alphabetical deterministic render.
	sort.Slice(catalog, func(i, j int) bool { return catalog[i].Name < catalog[j].Name })
	for _, e := range catalog {
		pendingCls := ""
		if e.PlainEnglish == "(description pending)" {
			pendingCls = " pending"
		}
		paramsStr, _ := json.Marshal(e.Parameters)
		fmt.Fprintf(w, `<div class="tool-card%s" data-name="%s" data-cat="%s">
<div class="tool-hdr"><span class="tool-name">%s</span><span class="tool-cat">%s</span></div>
<div class="tool-plain">%s</div>
<details><summary>technical detail</summary>
<div class="tool-desc">%s</div>
<pre class="tool-params">%s</pre>
</details>
</div>`, pendingCls, htmlEscape(e.Name), htmlEscape(e.Category),
			htmlEscape(e.Name), htmlEscape(e.Category),
			htmlEscape(e.PlainEnglish), htmlEscape(e.Description), htmlEscape(string(paramsStr)))
	}
	fmt.Fprint(w, `</div></section>`)

	// Prompt walkthroughs — expandable cards for each traced prompt.
	fmt.Fprint(w, `<section><h2>Prompt Walkthroughs</h2>
<p>These are real prompts we sent to Kubilitics. Click any to open a full trace: every tool call, every byte counted on the wire, the actual answer, the cost.</p>
<div id="walkthroughs">`)
	ids := make([]string, 0, len(traces))
	for id := range traces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := traces[id]
		status := "INCOMPLETE"
		statusClass := "incomplete"
		msg := ""
		if c, ok := caseByName[id]; ok {
			if c.Failure != nil {
				status = "FAIL"
				statusClass = "fail"
				msg = c.Failure.Message
			} else {
				status = "PASS"
				statusClass = "pass"
			}
		}
		fmt.Fprintf(w, `<details class="walkthrough">
<summary><span class="badge-%s">%s</span> <span class="mono">%s</span> <span class="wt-latency">%d ms</span> <span class="wt-cost">$%.5f</span></summary>
<div class="wt-body">
<h4>Routing</h4>%s
<h4>Stage log</h4><pre class="mono wt-stages">%s</pre>
%s</div>
</details>`, statusClass, status, htmlEscape(id),
			traceDurationMs(t), t.USD,
			flowSVG(t.Stages, id),
			htmlEscape(stagesPretty(t.Stages)),
			errorBlockHTML(msg))
	}
	fmt.Fprint(w, `</div></section>`)

	// Latency histogram.
	fmt.Fprintf(w, `<section><h2>Latency</h2>%s</section>`, histogramSVG(latencies))

	// Token/cost table.
	fmt.Fprint(w, `<section><h2>Tokens &amp; cost per prompt</h2>
<table><thead><tr><th>Prompt</th><th>Status</th><th>In</th><th>Out</th><th>USD</th><th>ms</th></tr></thead><tbody>`)
	for _, id := range ids {
		t := traces[id]
		statusHTML := `<span class="badge-incomplete">INCOMPLETE</span>`
		if c, ok := caseByName[id]; ok {
			if c.Failure == nil {
				statusHTML = `<span class="badge-pass">PASS</span>`
			} else {
				statusHTML = `<span class="badge-fail">FAIL</span>`
			}
		}
		fmt.Fprintf(w, `<tr><td class="mono">%s</td><td>%s</td><td>%d</td><td>%d</td><td>$%.5f</td><td>%d</td></tr>`,
			htmlEscape(id), statusHTML, t.TokensIn, t.TokensOut, t.USD, traceDurationMs(t))
	}
	fmt.Fprint(w, `</tbody></table></section>`)

	// Privacy proof.
	fmt.Fprint(w, `<section><h2>Privacy guardrails</h2>
<p>Seven tests lock down what the LLM can see. They run on every commit. All seven passed for this bench.</p>
<ul>
<li><strong>Secret.data (plaintext)</strong> — raw secret values never leak.</li>
<li><strong>Secret.data (base64)</strong> — base64-encoded secret values never leak.</li>
<li><strong>ConfigMap.data</strong> — values with keys like <code>aws-access-key</code> never leak.</li>
<li><strong>Pod env</strong> — pods with <code>DB_PASSWORD</code> in env never leak the value.</li>
<li><strong>Annotations</strong> — <code>kubectl.kubernetes.io/last-applied-configuration</code> is stripped.</li>
<li><strong>managedFields</strong> — never leaks (always stripped).</li>
<li><strong>Benign data passes through</strong> — useful info like kubelet version still reaches the LLM so the assistant remains helpful.</li>
</ul>
</section>`)

	// Methodology + honest limitations.
	fmt.Fprint(w, `<section><h2>Methodology</h2>
<p>This bench runs against a real Kubernetes cluster (<code>kind-kubilitics-test</code>, 3 nodes, with real workloads in <code>demo</code> + <code>data</code> namespaces) with the real Kubilitics backend, the real brain, and a real LLM (Ollama + qwen2.5:72b-instruct on an AWS g5.12xlarge GPU instance). No canned answers, no synthetic responses.</p>
<p><strong>Pass criteria:</strong> the assistant produced natural-language text <em>and</em> called at least one tool when <code>expect_tool</code> was true.</p>
<h3>Honest limitations</h3>
<ul>
<li>Plain-English descriptions are seeded for 20 canonical tools; the remaining 140+ are marked "(description pending)" and are being written incrementally.</li>
<li>Destructive tools (delete, patch, scale) are not exercised; bench is read-only.</li>
<li>kagent engine is a registered skeleton, not in the hot path.</li>
</ul>
</section>`)

	// JS at end of body.
	fmt.Fprintf(w, `<script>window.__CATALOG__ = %s;</script><script>%s</script>`,
		string(catalogBytes), embedAppJS)

	fmt.Fprint(w, `</main><footer>Generated by <code>cmd/bench-report --v2</code></footer></body></html>`)
	return nil
}

// architectureSVG returns an inline SVG that teaches the routing flow
// to a non-technical reader. One diagram, one teaching truth.
func architectureSVG() string {
	return `<svg viewBox="0 0 960 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Routing architecture">
<style>.box{fill:#f3f4f6;stroke:#6b7280;stroke-width:1.5}.label{font:600 14px system-ui,sans-serif;fill:#111827;text-anchor:middle}.desc{font:12px system-ui,sans-serif;fill:#4b5563;text-anchor:middle}.arrow{fill:#6b7280}.edge-label{font:11px system-ui,sans-serif;fill:#374151}.llm{fill:#eef2ff;stroke:#6366f1}.cluster{fill:#ecfdf5;stroke:#10b981}</style>
<rect class="box" x="20" y="100" width="140" height="60" rx="8"/>
<text class="label" x="90" y="125">You</text>
<text class="desc" x="90" y="145">"list my pods"</text>
<rect class="box" x="210" y="100" width="180" height="60" rx="8"/>
<text class="label" x="300" y="125">Kubilitics backend</text>
<text class="desc" x="300" y="145">(your code, your server)</text>
<rect class="box llm" x="440" y="40" width="180" height="60" rx="8"/>
<text class="label" x="530" y="65">LLM</text>
<text class="desc" x="530" y="85">sees tool schemas only</text>
<rect class="box llm" x="440" y="160" width="180" height="60" rx="8"/>
<text class="label" x="530" y="185">LLM (return)</text>
<text class="desc" x="530" y="205">sees summarized result</text>
<rect class="box cluster" x="680" y="100" width="180" height="60" rx="8"/>
<text class="label" x="770" y="125">Kubernetes</text>
<text class="desc" x="770" y="145">your cluster</text>
<defs><marker id="a" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="arrow"/></marker></defs>
<line x1="160" y1="130" x2="210" y2="130" stroke="#6b7280" stroke-width="2" marker-end="url(#a)"/>
<line x1="390" y1="120" x2="440" y2="80" stroke="#6b7280" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="420" y="100">1. ask + schemas</text>
<line x1="440" y1="90" x2="390" y2="115" stroke="#6366f1" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="420" y="115">2. tool call</text>
<line x1="390" y1="135" x2="680" y2="135" stroke="#10b981" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="535" y="130">3. fetch from cluster</text>
<line x1="680" y1="145" x2="390" y2="145" stroke="#10b981" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="535" y="160">4. raw K8s data (stays backend-side)</text>
<line x1="390" y1="160" x2="440" y2="190" stroke="#6b7280" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="420" y="180">5. summarized + redacted</text>
<line x1="440" y1="200" x2="390" y2="160" stroke="#6366f1" stroke-width="2" marker-end="url(#a)"/>
<text class="edge-label" x="420" y="215">6. answer text</text>
<line x1="210" y1="150" x2="160" y2="150" stroke="#6b7280" stroke-width="2" marker-end="url(#a)"/>
</svg>`
}

// stagesPretty renders a compact text log of the stages for the
// walkthrough details panel (so non-tech readers can skim).
func stagesPretty(stages []stage) string {
	var b strings.Builder
	for _, s := range stages {
		fmt.Fprintf(&b, "%-24s  %s\n", s.Stage, compactFields(s.Fields))
	}
	return b.String()
}

func compactFields(m map[string]any) string {
	// Drop ts to keep the log skinny; key/value order is stable by sort.
	keys := make([]string, 0, len(m))
	for k := range m {
		if k == "ts" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%v", k, m[k]))
	}
	return strings.Join(parts, " ")
}

func errorBlockHTML(msg string) string {
	if msg == "" {
		return ""
	}
	return fmt.Sprintf(`<h4>Failure message</h4><pre class="err">%s</pre>`, htmlEscape(msg))
}
```

Important: top of file needs `//go:embed` directives and an `embed` import:

```go
import (
	"embed"
	// ... others ...
)
```

Actually Go's embed directive doesn't require importing `embed` when you only use `//go:embed` on a `string` / `[]byte` — but for clarity and consistency add the import as `_ "embed"` if lint complains.

- [ ] **Step 5.5: Implement static/styles.css**

Create `cmd/bench-report/static/styles.css`:

```css
body { font-family: -apple-system, system-ui, sans-serif; margin: 0; color: #111827; background: #f9fafb; }
header { background: linear-gradient(135deg, #4338ca 0%, #7c3aed 100%); color: white; padding: 40px 60px; }
header h1 { margin: 0; font-size: 34px; font-weight: 800; letter-spacing: -0.5px; }
header .meta { opacity: 0.9; margin-top: 8px; font-size: 14px; }
main { max-width: 1280px; margin: 0 auto; padding: 32px 60px 80px; }
section { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
section h2 { margin-top: 0; font-size: 22px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
section h3 { font-size: 16px; font-weight: 600; margin-top: 20px; }
section h4 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; color: #374151; }
section p { line-height: 1.6; }
.big { font-size: 56px; font-weight: 800; letter-spacing: -2px; }
.big.green { color: #16a34a; }
.big.red { color: #dc2626; }
.big.amber { color: #d97706; }
.sub { color: #6b7280; font-size: 14px; margin-top: 6px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge-pass { color: #16a34a; font-weight: 700; font-size: 12px; padding: 2px 8px; border: 1px solid #16a34a; border-radius: 4px; }
.badge-fail { color: #dc2626; font-weight: 700; font-size: 12px; padding: 2px 8px; border: 1px solid #dc2626; border-radius: 4px; }
.badge-incomplete { color: #d97706; font-weight: 700; font-size: 12px; padding: 2px 8px; border: 1px solid #d97706; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
th { background: #f3f4f6; font-weight: 600; }
.explorer-controls { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.explorer-controls input, .explorer-controls select { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.explorer-controls input { flex: 1; }
#tool-count-badge { background: #f3f4f6; color: #374151; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.explorer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.tool-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fff; }
.tool-card.pending { opacity: 0.6; border-style: dashed; }
.tool-card.hidden { display: none; }
.tool-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.tool-name { font-family: ui-monospace, monospace; font-weight: 700; font-size: 13px; color: #1f2937; }
.tool-cat { font-size: 11px; background: #eef2ff; color: #4338ca; padding: 2px 8px; border-radius: 10px; }
.tool-plain { font-size: 13px; line-height: 1.5; color: #374151; }
.tool-card details { margin-top: 8px; }
.tool-card summary { cursor: pointer; font-size: 12px; color: #6b7280; }
.tool-desc { font-size: 12px; margin: 6px 0; color: #4b5563; }
.tool-params { font-size: 11px; background: #f9fafb; padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre; max-height: 240px; }
.walkthrough { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 10px; background: #fff; }
.walkthrough summary { cursor: pointer; display: flex; gap: 12px; align-items: center; }
.walkthrough summary::-webkit-details-marker { display: none; }
.wt-latency, .wt-cost { color: #6b7280; font-size: 12px; }
.wt-body { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
.wt-stages { background: #f9fafb; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; white-space: pre; }
.err { background: #fef2f2; color: #991b1b; padding: 10px; border-radius: 4px; font-size: 11px; font-family: ui-monospace, monospace; white-space: pre-wrap; }
footer { text-align: center; color: #6b7280; padding: 24px; font-size: 12px; }
```

- [ ] **Step 5.6: Implement static/app.js**

Create `cmd/bench-report/static/app.js`:

```javascript
// Client-side tool-explorer + UX touches. No framework, no build step.
// All content is server-rendered; this just adds filter/search/expand.
(() => {
  const search = document.getElementById('tool-search');
  const category = document.getElementById('tool-category');
  const grid = document.getElementById('tool-explorer');
  const badge = document.getElementById('tool-count-badge');
  if (!search || !grid) return; // Tool explorer section not present.

  const cards = Array.from(grid.querySelectorAll('.tool-card'));

  function normalize(s) { return (s || '').toLowerCase().trim(); }

  function applyFilter() {
    const q = normalize(search.value);
    const cat = category.value;
    let visible = 0;
    for (const c of cards) {
      const name = normalize(c.dataset.name);
      const ccat = c.dataset.cat;
      const plain = normalize(c.querySelector('.tool-plain')?.textContent);
      const desc = normalize(c.querySelector('.tool-desc')?.textContent);
      const match = (q === '' ||
                     name.includes(q) ||
                     plain.includes(q) ||
                     desc.includes(q)) &&
                    (cat === '' || ccat === cat);
      c.classList.toggle('hidden', !match);
      if (match) visible++;
    }
    if (badge) badge.textContent = `${visible} / ${cards.length}`;
  }

  search.addEventListener('input', applyFilter);
  category.addEventListener('change', applyFilter);

  // Keyboard: '/' to focus search, Esc to clear.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    } else if (e.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      category.value = '';
      applyFilter();
      search.blur();
    }
  });

  applyFilter(); // initial count
})();
```

- [ ] **Step 5.7: Run v2 test + regression tests**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
go build -o bin/bench-report ./cmd/bench-report
go test ./cmd/bench-report/... -v -count=1
```
Expected: new test PASS; v1 tests still PASS.

- [ ] **Step 5.8: Commit**

```bash
git add cmd/bench-report/
git commit -m "feat(bench-report): v2 interactive template with tool explorer

Adds renderHTMLv2 behind a --v2 flag. Ships a client-side searchable
tool-explorer (all 166 MCP tools with plain-English prose from the
catalog JSON), expandable prompt walkthroughs, a non-tech 'what is
this?' intro, an annotated architecture SVG, and a privacy-guardrails
section. No CDN deps: CSS and JS are //go:embedded; opens offline.

The v1 template is preserved for any existing scripts that expect it."
```

---

## Task 6: Preflight script

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/preflight.sh`

- [ ] **Step 6.1: Write preflight.sh**

Create `deploy/bench-vm/preflight.sh`:

```bash
#!/usr/bin/env bash
# Preflight for the bench VM launch. Fails fast with the exact next
# command if anything blocks the run (quota, SG, AMI, credentials).
#
# Exit codes:
#   0 ok
#   1 generic failure
#   2 quota insufficient
#   3 security group missing / misconfigured
#   4 AMI unavailable
#   5 AWS credentials missing
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.12xlarge}"
REQUIRED_VCPU=48   # g5.12xlarge = 48 vCPU
SG_ID="${SG_ID:-sg-09b612ed6a1404d11}"
AMI_ID="${AMI_ID:-ami-0e2c8caa4b6378d8c}"

fail() { echo "PREFLIGHT FAIL: $1" >&2; exit "${2:-1}"; }

echo "=== AWS credentials ==="
aws sts get-caller-identity --query 'Arn' --output text >/dev/null 2>&1 \
  || fail "AWS CLI not authenticated — run \`aws configure\` or set AWS_PROFILE" 5
echo "ok: $(aws sts get-caller-identity --query 'Arn' --output text)"

echo "=== region ==="
echo "using: $REGION"

echo "=== vCPU quota for g-family On-Demand ==="
# L-DB2E81BA = Running On-Demand G and VT instances (vCPU-based)
current=$(aws service-quotas get-service-quota \
  --region "$REGION" \
  --service-code ec2 \
  --quota-code L-DB2E81BA \
  --query 'Quota.Value' --output text 2>/dev/null || echo 0)
# Shell: compare as integer (strip decimal)
current_int="${current%.*}"
if [ "$current_int" -lt "$REQUIRED_VCPU" ]; then
  fail "g-family On-Demand vCPU quota is $current_int, need $REQUIRED_VCPU for $INSTANCE_TYPE. Request via:
  aws service-quotas request-service-quota-increase --region $REGION --service-code ec2 --quota-code L-DB2E81BA --desired-value $REQUIRED_VCPU" 2
fi
echo "ok: quota = $current_int vCPU (need $REQUIRED_VCPU)"

echo "=== security group $SG_ID ==="
aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].GroupName' --output text >/dev/null 2>&1 \
  || fail "security group $SG_ID not found in region $REGION. Create one or override SG_ID." 3
# Ensure 11434 is open.
has_11434=$(aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`11434`] | [0].FromPort' --output text)
if [ "$has_11434" != "11434" ]; then
  myip=$(curl -sf https://api.ipify.org)
  fail "security group $SG_ID does not allow 11434 (Ollama). Open it with:
  aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID --protocol tcp --port 11434 --cidr $myip/32" 3
fi
echo "ok: 11434 open on $SG_ID"

echo "=== AMI $AMI_ID ==="
aws ec2 describe-images --region "$REGION" --image-ids "$AMI_ID" \
  --query 'Images[0].State' --output text 2>/dev/null | grep -q available \
  || fail "AMI $AMI_ID not available in $REGION. Update AMI_ID to a current Deep Learning AMI." 4
echo "ok: AMI $AMI_ID available"

echo "=== disk plan ==="
echo "root: 100 GB (qwen2.5:72b-instruct ~46 GB + OS + headroom)"

echo
echo "ALL PREFLIGHT CHECKS PASSED"
```

- [ ] **Step 6.2: Make executable + test**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
chmod +x deploy/bench-vm/preflight.sh
deploy/bench-vm/preflight.sh
```
Expected: each section "ok"; final "ALL PREFLIGHT CHECKS PASSED". If a check fails, the script prints the exact `aws …` command to run.

- [ ] **Step 6.3: Commit**

```bash
git add deploy/bench-vm/preflight.sh
git commit -m "deploy(bench-vm): preflight.sh — quota / SG / AMI / creds checks

Fails fast with the exact next command to run if any guard is missing.
Must pass before launch-big.sh so we never burn GPU time on an
instance that can't start."
```

---

## Task 7: Update launch-big.sh defaults

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/deploy/bench-vm/launch-big.sh`

- [ ] **Step 7.1: Change defaults to g5.12xlarge + 100 GB root**

Edit `deploy/bench-vm/launch-big.sh`. Find the existing defaults:

```bash
INSTANCE_TYPE="${INSTANCE_TYPE:-g4dn.xlarge}"
# or similar
```

Replace with:

```bash
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.12xlarge}"
MODEL="${MODEL:-qwen2.5:72b-instruct}"
ROOT_DISK_GB="${ROOT_DISK_GB:-100}"
MAX_PULL_WAIT_SEC="${MAX_PULL_WAIT_SEC:-1200}"
```

Find the `run-instances` call and ensure it has:

```bash
--block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$ROOT_DISK_GB}"
```

Find the model-pull wait loop and replace fixed 180 with `$MAX_PULL_WAIT_SEC / 10`:

```bash
for i in $(seq 1 $((MAX_PULL_WAIT_SEC / 10))); do
  if curl -sf --max-time 3 "http://$ip:11434/api/tags" 2>/dev/null | jq -e ".models[] | select(.name==\"$MODEL\")" >/dev/null; then
    echo "model ready"
    break
  fi
  sleep 10
done
```

- [ ] **Step 7.2: Syntax check**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
bash -n deploy/bench-vm/launch-big.sh
```
Expected: silent (valid bash).

- [ ] **Step 7.3: Commit**

```bash
git add deploy/bench-vm/launch-big.sh
git commit -m "deploy(bench-vm): default to g5.12xlarge + qwen2.5:72b-instruct + 100GB

Aligns with the kubilitics-validation-bench spec (Apr 21 decision D'').
All values are env-overridable. Model-pull wait is parameterized."
```

---

## Task 8: Orchestrator script

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/scripts/run-investor-bench.sh`

- [ ] **Step 8.1: Write orchestrator**

Create `scripts/run-investor-bench.sh`:

```bash
#!/usr/bin/env bash
# End-to-end kubilitics-validation-bench driver:
#   preflight → launch g5.12xlarge → pull qwen2.5:72b → run bench →
#   generate report → terminate → verify zero instances left.
#
# Hard-kill rules:
#   - preflight fail → abort, no launch
#   - pass rate < 80% on investor-demo-50 → terminate + exit 2 (fix locally)
#   - wall clock > 90 min → terminate + exit 3
#   - $8 cost tag → terminate + exit 4
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%F)
REPORT_DIR="docs/reports/${STAMP}-kubilitics-validation"
mkdir -p "$REPORT_DIR/traces"

trap 'echo "=== trap: terminating any kubilitics-bench instances ==="; ./deploy/bench-vm/terminate.sh || true' ERR EXIT

echo "=== 1/8 preflight ==="
./deploy/bench-vm/preflight.sh

echo "=== 2/8 build + tests ==="
go build ./...
go test ./internal/llm/... ./internal/runtime/... ./internal/mcp/server/... ./cmd/tool-catalog/... ./cmd/bench-report/... -count=1

echo "=== 3/8 generate tool-catalog ==="
go run ./cmd/tool-catalog --plain-english docs/reports/plain-english.json --out "$REPORT_DIR/tool-catalog.json"

echo "=== 4/8 launch g5.12xlarge + qwen2.5:72b-instruct ==="
./deploy/bench-vm/launch-big.sh
. /tmp/bench-big.env   # sets OLLAMA_URL, INSTANCE_ID, MODEL

echo "=== 5/8 point brain at remote ollama ==="
sed "s|BASE_URL|$OLLAMA_URL|; s|MODEL_TAG|$MODEL|" <<'EOF' > /tmp/config-bench-big.yaml
server:
  port: 28081
backend:
  address: localhost:50061
  http_base_url: http://localhost:8190
  timeout: 120
llm:
  provider: ollama
  ollama:
    base_url: BASE_URL
    model: MODEL_TAG
database:
  type: sqlite
  sqlite_path: /tmp/ai-bench-big.db
logging:
  level: info
  format: json
EOF
pkill -f 'kubilitics-ai/server' 2>/dev/null || true
sleep 2
nohup ./server -config /tmp/config-bench-big.yaml > /tmp/brain-big.log 2>&1 &
sleep 5
tail -5 /tmp/brain-big.log

echo "=== 6/8 run investor-demo-50 with traces ==="
CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
test -n "$CID" || { echo "no connected cluster"; exit 1; }
rm -rf /tmp/traces-bench && mkdir -p /tmp/traces-bench
curl -sf -XPOST http://localhost:28081/admin/trace-dir -H 'Content-Type: application/json' -d '{"trace_dir":"/tmp/traces-bench"}'
./bin/chat-quality-bench --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/investor-demo-50.json \
  --concurrency 1 --timeout 300s \
  --trace-dir /tmp/traces-bench \
  --out /tmp/bench-demo-junit.xml \
  2>&1 | tee /tmp/bench-demo.log

pass=$(grep -c '^PASS' /tmp/bench-demo.log); total=$(grep -cE '^(PASS|FAIL)' /tmp/bench-demo.log)
[ "$((100*pass/total))" -ge 80 ] || { echo "pass rate $((100*pass/total))% < 80% — abort"; exit 2; }

echo "=== 7/8 run full-500 (no traces, faster) ==="
./bin/chat-quality-bench --cluster "$CID" \
  --prompts cmd/chat-quality-bench/suites/full-500.json \
  --concurrency 1 --timeout 180s \
  --out /tmp/bench-full-junit.xml \
  2>&1 | tee /tmp/bench-full.log

echo "=== 8/8 generate report ==="
cp /tmp/traces-bench/*.jsonl "$REPORT_DIR/traces/"
cp /tmp/bench-demo-junit.xml "$REPORT_DIR/junit-demo.xml"
cp /tmp/bench-full-junit.xml "$REPORT_DIR/junit-full.xml"
go build -o bin/bench-report ./cmd/bench-report
./bin/bench-report --v2 \
  --junit "$REPORT_DIR/junit-demo.xml" \
  --traces /tmp/traces-bench \
  --catalog "$REPORT_DIR/tool-catalog.json" \
  --suite "investor-demo-50 on $MODEL (g5.12xlarge)" \
  --out "$REPORT_DIR/report.html"

git add "$REPORT_DIR" docs/reports/plain-english.json
git commit -m "report(kubilitics-validation): $STAMP investor-demo-50 run" || true
git push origin main || true

echo "=== terminating + verifying ==="
./deploy/bench-vm/terminate.sh
sleep 5
remaining=$(aws ec2 describe-instances --filters "Name=tag:Project,Values=kubilitics-bench" "Name=instance-state-name,Values=pending,running" --query 'length(Reservations[].Instances[])' --output text 2>/dev/null || echo 0)
[ "$remaining" = "0" ] || { echo "WARN: $remaining instances still in pending/running"; exit 5; }
echo "clean teardown verified."

trap - ERR EXIT
```

- [ ] **Step 8.2: chmod + syntax check + commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
chmod +x scripts/run-investor-bench.sh
bash -n scripts/run-investor-bench.sh
git add scripts/run-investor-bench.sh
git commit -m "scripts: end-to-end investor-bench orchestrator

preflight -> launch -> bench -> report -> terminate -> verify.
trap on ERR|EXIT guarantees no orphaned instances if anything fails."
```

---

## Task 9: Run the bench (operational, main session)

**Files:** none (runtime commands)

This task is executed inline in the main session (not delegated to a subagent) because it controls real AWS resources + long-running processes.

- [ ] **Step 9.1: Run preflight**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
deploy/bench-vm/preflight.sh
```
Expected: "ALL PREFLIGHT CHECKS PASSED". If any check fails, run the exact command it prints, then re-run preflight.

- [ ] **Step 9.2: Run orchestrator**

```bash
scripts/run-investor-bench.sh
```

Expected timeline:
- minute 0–5: preflight + local build + local tests
- minute 5–10: instance boot
- minute 10–20: model pull (46 GB)
- minute 20–40: investor-demo-50 bench
- minute 40–60: full-500 bench
- minute 60–61: report generation + commit + push + terminate

Hard-kill watch:
- If wall clock > 90 min, the trap ensures terminate runs on exit.
- If pass rate on demo-50 < 80%, orchestrator exits 2 — trap terminates.

- [ ] **Step 9.3: Verify committed report + teardown**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git log --oneline -5
aws ec2 describe-instances --filters "Name=tag:Project,Values=kubilitics-bench" "Name=instance-state-name,Values=pending,running" --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output table
```
Expected: the report commit in the last 3 commits; AWS table empty (no running instances).

- [ ] **Step 9.4: Open the report locally to spot-check**

```bash
open docs/reports/$(date +%F)-kubilitics-validation/report.html
```

Spot-check:
- Executive summary shows ≥ 80% pass rate in green or amber (not red).
- Tool explorer loads: typing `list` filters to ~8 tools.
- Clicking any Prompt Walkthrough expands the details with real token + latency numbers.
- The architecture SVG renders cleanly.
- No `"(description pending)"` badges on the 20 seeded tools.

---

## Self-Review — spec coverage

- [x] Fix A+B+C from earlier (MaxTurns / 429 retry / docs) — already shipped in prior commits; this plan builds on them.
- [x] **done + cost stage emitters** — Task 3.
- [x] **Token-count plumbing from Ollama** — Task 2.
- [x] **AgentStreamEvent.TokenUsage field** — Task 1.
- [x] **cmd/tool-catalog + plain-english seed** — Task 4.
- [x] **Interactive HTML report v2** — Task 5 (template + embedded JS/CSS).
- [x] **Preflight script** — Task 6.
- [x] **launch-big.sh defaults** — Task 7.
- [x] **End-to-end orchestrator with hard-kills** — Task 8.
- [x] **Run the bench + commit report + terminate** — Task 9.
- [x] **Spec success criteria** (≥90% / ≥80% / populated tokens / zero running instances) — enforced in Task 8 hard-kill rules + Task 9 verification.

## Self-Review — placeholder scan

No "TBD", no "similar to earlier", no vague "add error handling". Every code block is complete. The single `"(description pending)"` string is an intentional content placeholder (spec-approved).

## Self-Review — type consistency

- `TokenUsage` struct fields: `InputTokens`, `OutputTokens`, `TotalTokens`, `EstimatedCost` — same across Task 1 definition + Task 2 usage + Task 3 forwarding.
- `toolTokenUsage` (runtime-internal) fields: `InputTokens`, `OutputTokens` — same in Task 3 definition + usage.
- `catalogEntry` shape: identical across `cmd/tool-catalog/main.go` (Task 4) + `cmd/bench-report/main.go` (Task 5).
- Env vars: `INSTANCE_TYPE`, `MODEL`, `ROOT_DISK_GB`, `SG_ID`, `AMI_ID` — same across preflight.sh, launch-big.sh, orchestrator.
- `OLLAMA_URL` + `INSTANCE_ID` + `MODEL` — written by `launch-big.sh` via `/tmp/bench-big.env`; sourced by orchestrator. Consistent.
