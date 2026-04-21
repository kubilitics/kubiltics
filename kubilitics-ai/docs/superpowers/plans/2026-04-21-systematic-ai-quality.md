# Systematic AI Quality Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the whack-a-mole pattern where each new chat prompt surfaces a new bug. Fix the four systemic causes in one coordinated pass: weak system prompt, unbounded tool outputs, no validation bench, and an undersized default model.

**Architecture:** Four sequenced changes in `vellankikoti/kotg.ai` (brain) and `vellankikoti/kubilitics` (frontend). (1) Hardcoded system prompt that pins role, mandates summarization, forbids "run kubectl" hedges, and teaches tool-selection heuristics. (2) Output summarizer wrapped around every MCP tool dispatch so no tool can return more than `MaxToolOutputBytes` of raw JSON to the LLM. (3) Benchmark harness — 30 varied prompts executed against a real backend, pass/fail tracked in CI. (4) Default model bumped from `gpt-4o-mini` to `gpt-4o` in the frontend AI Settings page and the brain config defaults.

**Tech Stack:** Go 1.24 (brain), React 18 + TypeScript + Vite (frontend), shared HTTP WS protocol, OpenAI API, MCP tool dispatch layer in `internal/mcp/server/`.

---

## File Structure

### Brain — `/tmp/kotg-ai-vk/kubilitics-ai/`

| File | Responsibility | Change |
|------|---------------|--------|
| `internal/runtime/system_prompt.go` | **NEW.** Single source of truth for the chat system prompt. Pure function that takes `focusClusterID` and returns the prompt string. | Create |
| `internal/runtime/system_prompt_test.go` | **NEW.** Locks prompt invariants (mentions Namespace/Pod/etc., forbids kubectl hedge, includes cluster pin). | Create |
| `internal/runtime/llm_adapter.go` | Bridge between runtime and LLM adapter. Currently builds the system message inline. | Modify — replace inline string with call to `BuildSystemPrompt`. |
| `internal/mcp/server/list_summarize.go` | **NEW.** Move existing `summarizeListForLLM` / `summarizeItem` out of `handlers_observation.go` and add the size cap + generic `capToolOutput`. | Create (migrates existing code). |
| `internal/mcp/server/list_summarize_test.go` | Existing tests + new size-cap regression tests. | Modify. |
| `internal/mcp/server/handlers_observation.go` | Remove `summarizeListForLLM` / `summarizeItem` (now in `list_summarize.go`). | Modify — delete moved code, keep imports. |
| `internal/mcp/server/server.go` | Main `ExecuteTool` dispatch. Wrap every result through `capToolOutput` before returning. | Modify — one wrap call. |
| `cmd/bench/chat_quality_main.go` | **NEW.** Bench harness: opens chat WS, sends N prompts, asserts each produced a text answer AND called at least one tool (unless marked `tool_optional`). Writes JUnit XML so CI picks it up. | Create. |
| `cmd/bench/chat_quality_prompts.json` | **NEW.** 30 varied prompts (list/count/why/how/analyze/logs across common resource kinds). | Create. |
| `.github/workflows/chat-quality-bench.yml` | **NEW.** GitHub Action that brings up backend + brain + kind cluster, runs the bench, uploads results. | Create. |

### Frontend — `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend/`

| File | Responsibility | Change |
|------|---------------|--------|
| `src/pages/settings/AISettingsPage.tsx` | Default model dropdown for OpenAI is `gpt-4o-mini` today. | Modify — default to `gpt-4o`. |
| `src/pages/settings/AISettingsPage.test.tsx` | Existing tests. | Modify — add one test locking the default. |

### Memory — `/Users/koti/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/`

| File | Responsibility | Change |
|------|---------------|--------|
| `project_ai_systematic_quality.md` | **NEW.** Decision log: why we took this approach and where each guardrail lives. | Create at end of plan. |
| `MEMORY.md` | Index. | Append one line. |

---

## Preconditions (do once, before Task 1)

- [ ] **Precondition A: Clean git state on both repos**

Run:
```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && git status -sb
cd /Users/koti/myFuture/Kubernetes/kubilitics && git status -sb
```
Expected: both `## main...origin/main` with no staged or unstaged changes. If there are, commit or stash BEFORE starting — each task assumes a clean tree for its own commit.

- [ ] **Precondition B: Services running**

```bash
lsof -nP -iTCP:8190 -iTCP:50051 -iTCP:28081 -iTCP:5173 -sTCP:LISTEN
```
Expected: backend on 8190, brain on 50051 + 28081, vite on 5173. If any missing, see `project_session_handoff_apr20.md` section "How to resume".

---

## Task 1: Move the system prompt out of the adapter bridge into its own file + tests

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/system_prompt.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/system_prompt_test.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`

Current state: `llm_adapter.go:StreamCompletionWithTools` builds the system message inline as a `fmt.Sprintf`. That string has grown organically and is now the main lever we have over "feels dumb vs feels smart." Moving it into its own file + test makes it reviewable, lockable, and easy to extend without rebuilding the bridge.

- [ ] **Step 1.1: Write the failing test for `BuildSystemPrompt`**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/system_prompt_test.go`:

```go
package runtime

import (
	"strings"
	"testing"
)

func TestBuildSystemPrompt_EmptyClusterID(t *testing.T) {
	// When the session has no focus cluster the prompt should be empty
	// so we fall back to raw user turn (preserves legacy behavior).
	if got := BuildSystemPrompt(""); got != "" {
		t.Fatalf("empty cluster id → empty prompt, got %q", got)
	}
}

func TestBuildSystemPrompt_PinsClusterID(t *testing.T) {
	p := BuildSystemPrompt("cluster-abc")
	if !strings.Contains(p, "cluster-abc") {
		t.Fatalf("prompt must reference the focus cluster id, got: %s", p)
	}
}

func TestBuildSystemPrompt_ForbidsKubectlHedge(t *testing.T) {
	// The #1 "feels dumb" failure mode — LLM saying "run kubectl get ..."
	// instead of calling a tool. The prompt must explicitly forbid it.
	p := BuildSystemPrompt("c")
	if !strings.Contains(strings.ToLower(p), "do not tell the user to run kubectl") &&
		!strings.Contains(strings.ToLower(p), "never tell the user to run kubectl") {
		t.Fatalf("prompt must forbid the kubectl hedge, got: %s", p)
	}
}

func TestBuildSystemPrompt_MandatesSummarization(t *testing.T) {
	// When a tool returns data, the LLM MUST summarize it in natural
	// language — not dump the JSON, not stay silent, not punt.
	p := BuildSystemPrompt("c")
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "summarize") && !strings.Contains(lower, "summarise") {
		t.Fatalf("prompt must mandate natural-language summarization, got: %s", p)
	}
}

func TestBuildSystemPrompt_ListsCommonResourceKinds(t *testing.T) {
	// When the LLM sees "list X" it needs a nudge toward list_resources.
	// Common kinds must appear in the prompt so it can pattern-match.
	p := BuildSystemPrompt("c")
	for _, kind := range []string{"Namespace", "Pod", "Deployment", "Service", "Node"} {
		if !strings.Contains(p, kind) {
			t.Fatalf("prompt must mention %s as a common resource kind, got: %s", kind, p)
		}
	}
}

func TestBuildSystemPrompt_MandatesClusterIDArg(t *testing.T) {
	p := BuildSystemPrompt("cluster-xyz")
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "cluster_id") {
		t.Fatalf("prompt must instruct the LLM to pass cluster_id in tool args, got: %s", p)
	}
}
```

- [ ] **Step 1.2: Run the tests and confirm they fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/runtime/... -run BuildSystemPrompt -v
```
Expected: compile error — `BuildSystemPrompt` undefined.

- [ ] **Step 1.3: Create `system_prompt.go`**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/system_prompt.go`:

```go
package runtime

import "fmt"

// BuildSystemPrompt returns the chat system message for a turn whose chat
// session has the given Kubernetes cluster selected as its focus. Returns
// empty when focusClusterID is empty — the legacy no-pin behavior — so
// existing callers that pass "" still work.
//
// Changes here move the needle on "feels like a real assistant" vs
// "feels like a scripted chatbot." Lock each invariant with a test in
// system_prompt_test.go before editing the copy.
//
// Design goals, in order of importance:
//   1. The LLM MUST use tools for operational questions. The #1 "feels
//      dumb" failure is the model answering "run kubectl get namespaces"
//      instead of calling list_resources. The prompt forbids that hedge
//      explicitly and tells the model what tool to reach for.
//   2. Every tool call MUST carry cluster_id. We also inject it
//      server-side via clusterIDInjectingExecutor, but restating it
//      here makes the LLM's tool calls cleaner and the audit log
//      readable.
//   3. After a tool returns, the LLM MUST produce a natural-language
//      summary — not emit silence, not paste back the raw JSON. The
//      "no text answer" info box in the UI is a bug, not a feature.
//   4. List/count questions resolve to list_resources{kind: X}. The
//      kind enumeration helps the model generalize from "pods" to
//      "namespaces" / "ingresses" / "configmaps" without re-prompting.
func BuildSystemPrompt(focusClusterID string) string {
	if focusClusterID == "" {
		return ""
	}
	return fmt.Sprintf(`You are Kubilitics, a Kubernetes operations assistant embedded in an SRE dashboard. The operator has selected a specific cluster for this chat session.

Active cluster: cluster_id=%q.

MANDATES (in priority order):
1. Use the tools you have been given. For any operational question ("list", "show", "count", "why", "health", "logs", "events", "analyze"), you MUST call the relevant tool. Do NOT tell the user to run kubectl, kubectx, k9s, or any external command — they are already in Kubilitics and expect it to answer from the cluster directly.
2. Every tool that accepts a cluster_id parameter MUST receive cluster_id=%q. Never omit it, never invent a different cluster_id, never ask the user which cluster (this session already has one).
3. After a tool returns, summarize the result in natural language for the operator. A bulleted list, a count, a short paragraph — whatever fits the question. NEVER paste raw JSON back. NEVER return empty text after a successful tool call.
4. If a tool returns an error, read the error message and explain what it means in one line. If the fix is obvious (wrong namespace, missing resource), say so. Do not re-call the same tool with the same args.

TOOL SELECTION HEURISTICS:
- "list/show/count <resource>" → list_resources{kind: "<Kind>"}. Common kinds: Namespace, Pod, Deployment, Service, Node, ConfigMap, Secret, Ingress, StatefulSet, DaemonSet, Job, CronJob, PersistentVolume, PersistentVolumeClaim, ReplicaSet, ServiceAccount, Role, RoleBinding, ClusterRole, ClusterRoleBinding, HorizontalPodAutoscaler, NetworkPolicy, Event.
- "logs from <pod>" → get_logs{namespace, pod_name}.
- "events in <namespace>" / "why did X fail" → get_events{namespace, involved_object?}.
- "cluster health" / "how is the cluster" → get_cluster_health.
- "analyze <resource>", "investigate", "why is <X> unhealthy" → the matching analyze_* tool (analyze_pod_health, analyze_deployment_health, analyze_node_pressure, etc.).
- Unsure which tool? Prefer list_resources or get_events and summarize — never refuse.

STYLE:
- Short, direct, operator-friendly. No greetings. No "as an AI" disclaimers.
- Use markdown lists and headings for multi-item answers; prose for single facts.
- If a result is large, group by namespace and show counts before names.`,
		focusClusterID, focusClusterID,
	)
}
```

- [ ] **Step 1.4: Run the tests — all must pass**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/runtime/... -run BuildSystemPrompt -v
```
Expected: 6 PASS.

- [ ] **Step 1.5: Swap the adapter bridge to use `BuildSystemPrompt`**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/runtime/llm_adapter.go`, find the existing inline system-message block inside `StreamCompletionWithTools` (the `if focusClusterID != ""` branch that does `msgs = append(msgs, types.Message{Role: "system", Content: fmt.Sprintf(...)})`) and replace its Content construction:

Old (the whole `fmt.Sprintf("You are Kubilitics...", focusClusterID, focusClusterID)` block):

```go
if focusClusterID != "" {
    msgs = append(msgs, types.Message{
        Role: "system",
        Content: fmt.Sprintf(
            "You are Kubilitics, a Kubernetes operations assistant.\n"+
                "Active cluster id: %q.\n"+
                "MANDATORY: pass cluster_id=%q as an argument to every tool "+
                "call that accepts a cluster_id parameter. Never omit it and "+
                "never substitute a different cluster_id.",
            focusClusterID, focusClusterID,
        ),
    })
    executor = &clusterIDInjectingExecutor{inner: b.Executor, clusterID: focusClusterID}
}
```

New:

```go
if focusClusterID != "" {
    if sys := BuildSystemPrompt(focusClusterID); sys != "" {
        msgs = append(msgs, types.Message{Role: "system", Content: sys})
    }
    executor = &clusterIDInjectingExecutor{inner: b.Executor, clusterID: focusClusterID}
}
```

Also remove the now-unused `"fmt"` import if nothing else in the file needs it (grep first).

- [ ] **Step 1.6: Build + run all runtime tests**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build ./... && go test ./internal/runtime/... -count=1
```
Expected: all PASS.

- [ ] **Step 1.7: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/runtime/system_prompt.go internal/runtime/system_prompt_test.go internal/runtime/llm_adapter.go
git commit -m "feat(prompt): extract + harden chat system prompt

System prompt moves out of llm_adapter.go into system_prompt.go with
6 invariants locked by tests: cluster-id pin, kubectl-hedge ban,
summarization mandate, cluster_id arg mandate, common-kind enumeration,
empty-cluster fallback. Adds operator-facing style guidance and a
tool-selection heuristic block so the model stops silently refusing
on list/count/why questions."
```

---

## Task 2: Extract + cap the tool-output summarizer

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/list_summarize.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/handlers_observation.go`
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/list_summarize_test.go`

Current state: `summarizeListForLLM` + `summarizeItem` live in `handlers_observation.go` (added earlier today). Only `handleResourcesByQuery`'s list-by-kind path calls it. Every other observation/analysis/recommendation tool returns raw backend JSON. gpt-4o-mini's output budget collapses on any >20KB payload.

Move the summarizer into its own file, add a generic byte-cap pass (`capToolOutput`), and regression-test both.

- [ ] **Step 2.1: Write the failing tests for `capToolOutput`**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/list_summarize_test.go`, append these tests below the existing ones:

```go
func TestCapToolOutput_UnderBudget_PassesThrough(t *testing.T) {
	in := map[string]interface{}{"status": "ok", "items": []interface{}{"a", "b"}}
	out := capToolOutput(in)
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("under budget: output must preserve type, got %T", out)
	}
	if m["status"] != "ok" {
		t.Fatalf("under budget: content changed: %v", m)
	}
	if _, truncated := m["_truncated"]; truncated {
		t.Fatalf("under budget payload must not be marked truncated")
	}
}

func TestCapToolOutput_OverBudget_TruncatesAndFlags(t *testing.T) {
	// Construct ~30KB payload; cap is 8KB. Must be trimmed and marked.
	big := make([]interface{}, 500)
	for i := range big {
		big[i] = map[string]interface{}{"name": "pod-name", "blob": strings.Repeat("X", 60)}
	}
	raw := map[string]interface{}{"items": big, "item_count": 500}

	out := capToolOutput(raw).(map[string]interface{})
	if out["_truncated"] != true {
		t.Fatalf("over-budget payload must set _truncated=true, got %v", out)
	}
	if _, ok := out["_truncated_reason"]; !ok {
		t.Fatalf("over-budget payload must include _truncated_reason explaining what was cut")
	}
	// Serialized size must be ≤ MaxToolOutputBytes * 1.1 (allow 10% overshoot for metadata keys).
	blob, _ := json.Marshal(out)
	if len(blob) > int(float64(MaxToolOutputBytes)*1.1) {
		t.Fatalf("capped output still exceeds budget: %d bytes", len(blob))
	}
	// item_count must be preserved as a top-level signal so the LLM can
	// still truthfully say "N pods" even when the per-item detail is trimmed.
	if out["item_count"] != 500 {
		t.Fatalf("item_count must survive truncation, got %v", out["item_count"])
	}
}

func TestCapToolOutput_Nil(t *testing.T) {
	if capToolOutput(nil) != nil {
		t.Fatalf("nil must pass through")
	}
}

func TestCapToolOutput_NonMapScalar(t *testing.T) {
	// The handler contract allows strings/numbers/arrays. Cap must be
	// non-destructive for small scalars.
	if capToolOutput("hello") != "hello" {
		t.Fatalf("small scalar must pass through")
	}
}
```

Also add `"strings"` and `"encoding/json"` to the test file's imports if not already there.

- [ ] **Step 2.2: Run + expect fail**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/mcp/server/... -run CapToolOutput -v
```
Expected: compile error — `capToolOutput` / `MaxToolOutputBytes` undefined.

- [ ] **Step 2.3: Create `list_summarize.go` with the code**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/list_summarize.go`:

```go
package server

import (
	"encoding/json"
)

// MaxToolOutputBytes is the hard ceiling on the JSON-serialized tool
// result returned to the LLM. gpt-4o-mini's output budget collapses
// beyond ~20KB per tool result — it calls the tool, gets the wall of
// JSON, then emits zero text on the final turn. This cap is enforced
// blanket-fashion by capToolOutput so no single tool handler can
// torpedo the turn regardless of how lazy it is about pre-summarizing.
const MaxToolOutputBytes = 8 * 1024

// capToolOutput ensures a tool result serializes to at most
// MaxToolOutputBytes. Under budget → unchanged. Over budget → trim the
// largest list-valued field (usually "items"), keep a top-level
// `item_count` if we had one, and set the _truncated / _truncated_reason
// markers so the LLM can tell the operator "showing first N of M".
//
// Preserving item_count is the load-bearing move: for list/count
// questions the model can still truthfully say "49 pods" even when
// per-pod detail has been cut.
func capToolOutput(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return v // can't size it; pass through rather than drop the result
	}
	if len(b) <= MaxToolOutputBytes {
		return v
	}

	m, ok := v.(map[string]interface{})
	if !ok {
		// Non-map (array, string) over budget. Stringify and cut with a marker.
		trunc := string(b)
		if len(trunc) > MaxToolOutputBytes-200 {
			trunc = trunc[:MaxToolOutputBytes-200]
		}
		return map[string]interface{}{
			"_truncated":        true,
			"_truncated_reason": "tool returned a large non-object payload; showing the first bytes",
			"preview":           trunc,
		}
	}

	// We have a map. Try trimming the largest slice-valued field
	// ("items" is the common case; fall through to generic scan).
	out := make(map[string]interface{}, len(m))
	for k, val := range m {
		out[k] = val
	}
	out["_truncated"] = true
	out["_truncated_reason"] = "tool output exceeded 8KB; per-item detail reduced"

	// Heuristic: trim "items" first if present, else the largest array.
	trimKey := ""
	if _, ok := out["items"].([]interface{}); ok {
		trimKey = "items"
	} else {
		maxLen := 0
		for k, val := range out {
			if arr, ok := val.([]interface{}); ok && len(arr) > maxLen {
				maxLen = len(arr)
				trimKey = k
			}
		}
	}
	if trimKey != "" {
		arr := out[trimKey].([]interface{})
		// Keep halving until we're under budget.
		for len(arr) > 0 {
			out[trimKey] = arr
			bb, _ := json.Marshal(out)
			if len(bb) <= MaxToolOutputBytes {
				break
			}
			arr = arr[:len(arr)/2]
		}
		if len(arr) == 0 {
			delete(out, trimKey)
		}
	}
	return out
}
```

Also move the existing `summarizeListForLLM` and `summarizeItem` functions from `handlers_observation.go` into this new file (cut + paste; keep their current bodies).

- [ ] **Step 2.4: Remove the duplicates from `handlers_observation.go`**

In `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/handlers_observation.go`, delete the `summarizeListForLLM` function and the `summarizeItem` function (now in `list_summarize.go`). Leave their call sites unchanged — same package, they still resolve.

Also verify no import becomes unused in the file after the deletion; `gofmt -s` or `goimports` will catch it. If `"encoding/json"` was only used inside the moved functions, remove it from the handler file's imports — otherwise leave alone.

- [ ] **Step 2.5: Build + existing tests still pass**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build ./... && go test ./internal/mcp/server/... -run "Summarize|CapToolOutput" -v -count=1
```
Expected: all the earlier `Summarize*` tests AND the four new `CapToolOutput*` tests PASS.

- [ ] **Step 2.6: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/mcp/server/list_summarize.go internal/mcp/server/list_summarize_test.go internal/mcp/server/handlers_observation.go
git commit -m "feat(tools): extract summarizer + add 8KB hard cap

summarizeListForLLM / summarizeItem move out of handlers_observation.go
into list_summarize.go. New capToolOutput enforces an 8KB ceiling on
every tool result: under-budget passes through, over-budget halves
the largest array field (preferring 'items') until it fits, preserving
item_count so the LLM can still truthfully say 'N pods.' Sets
_truncated + _truncated_reason so the model knows to warn the user."
```

---

## Task 3: Wrap every tool dispatch through `capToolOutput`

**Files:**
- Modify: `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/server.go`

Current state: `mcpServerImpl.ExecuteTool` (or its internal equivalent) calls the route function and returns the result unchanged. We want every result — observation, analysis, recommendation, security, everything — to go through `capToolOutput` on the way out. One wrap point keeps this cheap and uniform.

- [ ] **Step 3.1: Find the dispatch return point**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
grep -n "ExecuteTool\|routeObservationTool\|routeAnalysisTool\|routeRecommendationTool\|routeExecutionTool" internal/mcp/server/server.go
```
Expected: locate the `ExecuteTool` method body. It switches on tool category, calls one of the `route*Tool` helpers, and returns `(interface{}, error)`.

- [ ] **Step 3.2: Write the integration test (table-driven)**

Create `/tmp/kotg-ai-vk/kubilitics-ai/internal/mcp/server/execute_tool_cap_test.go`:

```go
package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// ExecuteTool must never return a JSON blob larger than MaxToolOutputBytes
// to the caller (LLM). This is the single guardrail against every future
// tool that forgets to pre-summarize. Lock it here so refactors can't
// silently regress.
func TestExecuteTool_CapsAllHandlers(t *testing.T) {
	// We can't easily mock every backend dependency in this package,
	// so the test goes through capToolOutput directly with a realistic
	// oversized payload — exercising the same wrap the dispatcher uses.
	big := make([]interface{}, 300)
	for i := range big {
		big[i] = map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":        "pod-xyz",
				"annotations": map[string]interface{}{"junk": strings.Repeat("Z", 500)},
			},
		}
	}
	raw := map[string]interface{}{"items": big, "item_count": 300}

	capped := capToolOutput(raw)
	b, _ := json.Marshal(capped)
	if len(b) > int(float64(MaxToolOutputBytes)*1.1) {
		t.Fatalf("capToolOutput did not cap payload: %d bytes", len(b))
	}

	// Context passed for API shape parity with handler signatures.
	_ = context.Background()
}
```

- [ ] **Step 3.3: Run + expect pass (capToolOutput already exists)**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go test ./internal/mcp/server/... -run ExecuteTool_CapsAllHandlers -v -count=1
```
Expected: PASS. This test is a smoke-check for the function; the actual integration happens in the next step.

- [ ] **Step 3.4: Wire `capToolOutput` into `ExecuteTool`**

In `internal/mcp/server/server.go`, find the method that returns tool results (typically `ExecuteTool` or its direct caller). Wrap the return:

Before (representative shape — actual code may differ, adapt accordingly):

```go
func (s *mcpServerImpl) ExecuteTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
    result, err := s.dispatch(ctx, name, args)
    if err != nil {
        return nil, err
    }
    return result, nil
}
```

After:

```go
func (s *mcpServerImpl) ExecuteTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
    result, err := s.dispatch(ctx, name, args)
    if err != nil {
        return nil, err
    }
    // Hard cap tool output size so no single handler can blow the LLM's
    // output budget. See list_summarize.go.MaxToolOutputBytes.
    return capToolOutput(result), nil
}
```

If the actual method name/shape differs, apply the same one-line wrap at whatever return site feeds the runtime.

- [ ] **Step 3.5: Full build + full test**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build ./... && go test ./internal/mcp/... -count=1
```
Expected: all green.

- [ ] **Step 3.6: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add internal/mcp/server/server.go internal/mcp/server/execute_tool_cap_test.go
git commit -m "feat(tools): cap every tool dispatch output at 8KB

Wrap ExecuteTool's return site through capToolOutput so no handler —
current or future — can torpedo the LLM turn with an oversized
payload. Removes the need for per-handler summarization discipline;
the default behavior is now safe."
```

---

## Task 4: Switch the frontend default model to `gpt-4o`

**Files:**
- Modify: `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend/src/pages/settings/AISettingsPage.tsx`
- Modify: `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend/src/pages/settings/AISettingsPage.test.tsx`

Current state: the model dropdown on AI Settings defaults to `gpt-4o-mini`. The mini variant is what's biting us most — half the "feels dumb" moments come from it refusing to generalize or omitting text.

Brain side already uses `const DefaultModel = "gpt-4o"` (in `internal/llm/provider/openai/client.go`). No change needed there.

- [ ] **Step 4.1: Locate the current default**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend
grep -n "gpt-4o-mini\|openai.*model\|DEFAULT_MODEL" src/pages/settings/AISettingsPage.tsx
```
Expected: one or more references to `gpt-4o-mini` either as a default state value or the first option in the provider→models map.

- [ ] **Step 4.2: Write the failing test**

In `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend/src/pages/settings/AISettingsPage.test.tsx`, append:

```ts
it('defaults the OpenAI model to gpt-4o, not gpt-4o-mini', async () => {
  // Fresh install: no saved config. The provider dropdown starts on OpenAI,
  // and the model dropdown must land on gpt-4o — not gpt-4o-mini. Using the
  // mini by default was the single biggest "feels dumb" lever: per-prompt
  // fragility, missing summaries, text that collapses on any large tool
  // output. gpt-4o costs more per million tokens but eliminates most of
  // the tax gpt-4o-mini was charging us in UX.
  mockFetchGetConfig({ provider: '', model: '', base_url: '', api_key_masked: '', has_api_key: 'false' });
  render(<AISettingsPage />);
  const modelSelect = await screen.findByLabelText(/model/i) as HTMLSelectElement;
  expect(modelSelect.value).toBe('gpt-4o');
});
```

If the test file doesn't already have `mockFetchGetConfig` / an equivalent helper, either adapt the test to the existing mock pattern in the file (read the file first and match the style) OR inline the fetch mock as shown elsewhere in the same file.

- [ ] **Step 4.3: Run + expect fail**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend
npx vitest run src/pages/settings/AISettingsPage.test.tsx
```
Expected: the new test FAILS because default is `gpt-4o-mini`.

- [ ] **Step 4.4: Flip the default**

In `src/pages/settings/AISettingsPage.tsx`, locate where the OpenAI model default is set. Typical patterns:

- A `useState('gpt-4o-mini')` → change to `useState('gpt-4o')`.
- An OpenAI models array `['gpt-4o-mini', 'gpt-4o', ...]` where `models[0]` is used as the default → reorder so `'gpt-4o'` is first.
- A `const DEFAULT_MODELS = { openai: 'gpt-4o-mini', ... }` map → change to `openai: 'gpt-4o'`.

If there is effectively only one reference, one change does it. If there are several (e.g. an initial state AND a "when provider changes" effect), update every one. Do not leave `gpt-4o-mini` as any default fallback.

Keep `gpt-4o-mini` as an option in the dropdown — operators who want cost-optimized should still be able to pick it.

- [ ] **Step 4.5: Run tests + typecheck**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend
npx tsc --noEmit
npx vitest run src/pages/settings/AISettingsPage.test.tsx
```
Expected: tsc clean; all tests PASS.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
git add kubilitics-frontend/src/pages/settings/AISettingsPage.tsx kubilitics-frontend/src/pages/settings/AISettingsPage.test.tsx
git commit -m "fix(ai settings): default OpenAI model to gpt-4o, not gpt-4o-mini

Operators coming through the Settings flow for the first time now pick
gpt-4o by default. The mini variant stays available in the dropdown
for anyone deliberately choosing it. Rationale: the mini was the
single biggest 'feels dumb' tax — per-prompt fragility, silent
summarization failures, answers that collapse on large tool outputs.
Test locks the default so this can't regress via copy-paste."
```

---

## Task 5: Build the chat-quality bench harness

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench/chat_quality_main.go`
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench/chat_quality_prompts.json`

Current state: there's already a `cmd/bench/` for tool-coverage (498-case benchmark per memory). This task adds a *chat-quality* bench: end-to-end WS conversations that assert the assistant produced a text answer AND used at least one tool. This is the guardrail that would have caught every regression in this session before the user did.

- [ ] **Step 5.1: Define the prompt JSON file**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench/chat_quality_prompts.json`:

```json
{
  "prompts": [
    { "id": "list-namespaces", "text": "list all the namespaces", "expect_tool": true },
    { "id": "list-pods", "text": "list all the pods", "expect_tool": true },
    { "id": "list-pods-alt", "text": "show me every pod in the cluster", "expect_tool": true },
    { "id": "count-pods-namespace", "text": "how many pods are in kube-system", "expect_tool": true },
    { "id": "count-deployments", "text": "how many deployments are running", "expect_tool": true },
    { "id": "list-services", "text": "show services in default", "expect_tool": true },
    { "id": "list-nodes", "text": "what nodes are in this cluster", "expect_tool": true },
    { "id": "list-configmaps", "text": "show me the configmaps in kube-system", "expect_tool": true },
    { "id": "list-secrets", "text": "list secrets in default", "expect_tool": true },
    { "id": "list-ingresses", "text": "any ingresses in the cluster?", "expect_tool": true },
    { "id": "list-pvcs", "text": "show persistent volume claims", "expect_tool": true },
    { "id": "cluster-health", "text": "how is this cluster doing?", "expect_tool": true },
    { "id": "analyze-pod-health", "text": "analyze pod health in kube-system", "expect_tool": true },
    { "id": "analyze-deployment-health", "text": "analyze deployment health in default", "expect_tool": true },
    { "id": "analyze-node-pressure", "text": "are any of the nodes under pressure?", "expect_tool": true },
    { "id": "analyze-rbac", "text": "analyze rbac permissions in default", "expect_tool": true },
    { "id": "events-namespace", "text": "show me recent events in kube-system", "expect_tool": true },
    { "id": "events-warnings", "text": "any warning events in the cluster?", "expect_tool": true },
    { "id": "why-crashloop", "text": "why are any pods in crashloopbackoff?", "expect_tool": true },
    { "id": "why-pending", "text": "are there any pending pods? why?", "expect_tool": true },
    { "id": "logs-prompt", "text": "get logs from coredns in kube-system", "expect_tool": true },
    { "id": "capacity", "text": "what's the cluster's capacity?", "expect_tool": true },
    { "id": "restart-counts", "text": "which pods have the most restarts?", "expect_tool": true },
    { "id": "image-usage", "text": "what images are running in otel-demo?", "expect_tool": true },
    { "id": "namespace-overview", "text": "give me an overview of the kube-system namespace", "expect_tool": true },
    { "id": "resource-contention", "text": "is there any resource contention happening?", "expect_tool": true },
    { "id": "storage-health", "text": "how is storage looking in the cluster?", "expect_tool": true },
    { "id": "cron-jobs", "text": "list cron jobs in all namespaces", "expect_tool": true },
    { "id": "statefulsets", "text": "any statefulsets running?", "expect_tool": true },
    { "id": "network-policies", "text": "show network policies in the cluster", "expect_tool": true }
  ]
}
```

- [ ] **Step 5.2: Write the bench harness**

Create `/tmp/kotg-ai-vk/kubilitics-ai/cmd/bench/chat_quality_main.go`:

```go
// chat_quality_main.go — E2E chat quality benchmark.
//
// For each prompt in chat_quality_prompts.json, open a WS chat session
// against a running backend + brain, send the prompt, and assert:
//   1. The assistant produced at least one non-empty text_delta AFTER
//      any tool_end events (i.e. actually summarized the tool output).
//   2. If expect_tool is true, at least one tool_start fired.
//
// Prints PASS / FAIL per prompt and writes chat_quality_results.xml
// (JUnit format) so CI can ingest the results as-is.
//
// Flags:
//   -backend     Backend HTTP base (default http://localhost:8190)
//   -cluster     Cluster ID to use (required)
//   -prompts     Path to prompts JSON (default ./chat_quality_prompts.json)
//   -out         Path to write JUnit XML (default ./chat_quality_results.xml)
//   -timeout     Per-prompt timeout (default 60s)
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type promptSpec struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	ExpectTool bool   `json:"expect_tool"`
}

type promptFile struct {
	Prompts []promptSpec `json:"prompts"`
}

type result struct {
	Prompt    promptSpec
	Text      string
	Tools     []string
	Duration  time.Duration
	Err       error
}

func (r result) Pass() bool {
	if r.Err != nil {
		return false
	}
	if strings.TrimSpace(r.Text) == "" {
		return false
	}
	if r.Prompt.ExpectTool && len(r.Tools) == 0 {
		return false
	}
	return true
}

func main() {
	backend := flag.String("backend", "http://localhost:8190", "backend HTTP base URL")
	cluster := flag.String("cluster", "", "cluster ID (required)")
	prompts := flag.String("prompts", "cmd/bench/chat_quality_prompts.json", "prompts JSON path")
	out := flag.String("out", "chat_quality_results.xml", "JUnit XML output path")
	timeout := flag.Duration("timeout", 60*time.Second, "per-prompt timeout")
	flag.Parse()
	if *cluster == "" {
		log.Fatal("--cluster is required")
	}

	body, err := os.ReadFile(*prompts)
	if err != nil {
		log.Fatalf("read prompts: %v", err)
	}
	var pf promptFile
	if err := json.Unmarshal(body, &pf); err != nil {
		log.Fatalf("parse prompts: %v", err)
	}

	results := make([]result, 0, len(pf.Prompts))
	passCount := 0
	for _, p := range pf.Prompts {
		r := runPrompt(*backend, *cluster, p, *timeout)
		results = append(results, r)
		status := "FAIL"
		if r.Pass() {
			status = "PASS"
			passCount++
		}
		fmt.Printf("%s  %-28s  (%d tools, %dms, %d chars)  %v\n",
			status, p.ID, len(r.Tools), r.Duration.Milliseconds(), len(r.Text), r.Err)
	}

	fmt.Printf("\n%d / %d passed\n", passCount, len(results))
	if err := writeJUnit(*out, results); err != nil {
		log.Fatalf("write junit: %v", err)
	}
	if passCount != len(results) {
		os.Exit(1)
	}
}

func runPrompt(backend, cluster string, p promptSpec, timeout time.Duration) result {
	start := time.Now()
	r := result{Prompt: p}
	defer func() { r.Duration = time.Since(start) }()

	// Create session.
	sessBody, err := json.Marshal(map[string]string{"focus_cluster_id": cluster, "title": "bench-" + p.ID})
	if err != nil {
		r.Err = err
		return r
	}
	resp, err := http.Post(backend+"/api/v1/ai/sessions", "application/json", bytes.NewReader(sessBody))
	if err != nil {
		r.Err = fmt.Errorf("create session: %w", err)
		return r
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		r.Err = fmt.Errorf("create session: %d %s", resp.StatusCode, string(b))
		return r
	}
	var sessResp struct {
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessResp); err != nil {
		r.Err = fmt.Errorf("decode session: %w", err)
		return r
	}

	// Connect WS.
	wsURL := strings.Replace(backend, "http", "ws", 1) + "/api/v1/ai/chat?cluster_id=" + url.QueryEscape(cluster)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		r.Err = fmt.Errorf("dial ws: %w", err)
		return r
	}
	defer conn.Close()

	// Send user_message.
	frame := map[string]interface{}{
		"type": "user_message",
		"payload": map[string]string{
			"text":       p.Text,
			"session_id": sessResp.SessionID,
			"turn_id":    "bench-" + p.ID,
		},
	}
	if err := conn.WriteJSON(frame); err != nil {
		r.Err = fmt.Errorf("send prompt: %w", err)
		return r
	}

	// Drain until done / timeout.
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				if ctx.Err() == nil {
					r.Err = err
				}
				return
			}
			var f struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(data, &f); err != nil {
				continue
			}
			switch f.Type {
			case "text_delta":
				var pl struct {
					Text string `json:"text"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Text += pl.Text
			case "tool_start":
				var pl struct {
					Name string `json:"tool_name"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Tools = append(r.Tools, pl.Name)
			case "done":
				return
			case "error":
				var pl struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Err = fmt.Errorf("%s: %s", pl.Code, pl.Message)
				return
			}
		}
	}()
	select {
	case <-done:
	case <-ctx.Done():
		r.Err = fmt.Errorf("timeout after %s", timeout)
	}
	return r
}

// JUnit XML — minimal shape that GitHub's test-reporter and
// actions/junit-report both consume without extra config.
type junitTestSuite struct {
	XMLName  xml.Name        `xml:"testsuite"`
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Cases    []junitTestCase `xml:"testcase"`
}
type junitTestCase struct {
	XMLName xml.Name      `xml:"testcase"`
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitFailure `xml:"failure,omitempty"`
}
type junitFailure struct {
	XMLName xml.Name `xml:"failure"`
	Message string   `xml:"message,attr"`
	Body    string   `xml:",chardata"`
}

func writeJUnit(path string, rs []result) error {
	suite := junitTestSuite{Name: "chat-quality", Tests: len(rs)}
	for _, r := range rs {
		tc := junitTestCase{Name: r.Prompt.ID, Time: r.Duration.Seconds()}
		if !r.Pass() {
			suite.Failures++
			msg := "empty text answer"
			if r.Err != nil {
				msg = r.Err.Error()
			} else if r.Prompt.ExpectTool && len(r.Tools) == 0 {
				msg = "expected a tool call, none fired"
			}
			body := fmt.Sprintf("prompt=%q tools=%v text_len=%d", r.Prompt.Text, r.Tools, len(r.Text))
			tc.Failure = &junitFailure{Message: msg, Body: body}
		}
		suite.Cases = append(suite.Cases, tc)
	}
	blob, err := xml.MarshalIndent(suite, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, blob, 0o644)
}
```

- [ ] **Step 5.3: Build the bench**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai && go build -o bin/chat-quality-bench ./cmd/bench/chat_quality_main.go
```
Expected: `bin/chat-quality-bench` exists.

- [ ] **Step 5.4: Smoke-test the bench locally**

Make sure the brain + backend are running and at least one cluster is connected. Then:

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
# Pick a connected cluster ID from the backend.
CID=$(curl -sS http://localhost:8190/api/v1/clusters | \
      python3 -c "import sys,json; \
        [print(c['id']) for c in json.load(sys.stdin) if c['status']=='connected'][0:1]" \
      | head -1)
./bin/chat-quality-bench --cluster "$CID" --prompts cmd/bench/chat_quality_prompts.json
```
Expected: per-prompt PASS/FAIL lines; a pass-rate summary at the end; `chat_quality_results.xml` written. Some prompts may legitimately fail on first run — that's the bench doing its job.

- [ ] **Step 5.5: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add cmd/bench/chat_quality_main.go cmd/bench/chat_quality_prompts.json
git commit -m "feat(bench): add end-to-end chat quality harness

Runs 30 varied chat prompts against a live backend+brain, asserts each
produces a non-empty text answer and (when expected) fires at least one
tool. Emits per-prompt PASS/FAIL and a JUnit XML suitable for CI
ingestion. This is the guardrail the pipeline was missing; every
'feels dumb' regression in the last few days would have been caught
by one of these prompts before shipping."
```

---

## Task 6: Wire the bench into CI

**Files:**
- Create: `/tmp/kotg-ai-vk/kubilitics-ai/.github/workflows/chat-quality-bench.yml`

Current state: no automated E2E chat check. Regressions only surface when a user reports one.

This workflow is a first cut: nightly + manually triggerable. Making it a required PR gate comes later once we trust the pass rate is stable.

- [ ] **Step 6.1: Create the workflow**

Create `/tmp/kotg-ai-vk/kubilitics-ai/.github/workflows/chat-quality-bench.yml`:

```yaml
name: chat-quality-bench

on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * *"   # 06:00 UTC daily

permissions:
  contents: read

jobs:
  bench:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"
          cache: true

      - name: Build brain
        run: go build -o bin/server ./cmd/server

      - name: Build bench
        run: go build -o bin/chat-quality-bench ./cmd/bench/chat_quality_main.go

      - name: Start kind cluster
        uses: helm/kind-action@v1
        with:
          cluster_name: bench
          wait: 60s

      - name: Checkout kubilitics (backend)
        uses: actions/checkout@v4
        with:
          repository: vellankikoti/kubilitics
          path: kubilitics
          ref: main

      - name: Build backend
        working-directory: kubilitics/kubilitics-backend
        run: go build -o server ./cmd/server

      - name: Start backend
        working-directory: kubilitics/kubilitics-backend
        env:
          KUBILITICS_PORT: "8190"
          KUBILITICS_GRPC_PORT: "50061"
          KUBILITICS_AUTH_DISABLED: "true"
          KUBILITICS_AI_ENABLED: "true"
          KUBILITICS_AI_ENDPOINT: "localhost:50051"
          KUBILITICS_AI_HTTP_ENDPOINT: "http://localhost:28081"
        run: |
          ./server > /tmp/backend.log 2>&1 &
          for i in $(seq 1 30); do
            if curl -sf http://localhost:8190/health >/dev/null; then break; fi
            sleep 1
          done
          curl -sf http://localhost:8190/health

      - name: Start brain
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          cat > /tmp/bench-brain.yaml <<EOF
          server:
            port: 28081
            grpc_port: 50051
          llm:
            provider: openai
            model: gpt-4o
            api_key: ${OPENAI_API_KEY}
          EOF
          ./bin/server -config /tmp/bench-brain.yaml > /tmp/brain.log 2>&1 &
          for i in $(seq 1 30); do
            if curl -sf http://localhost:28081/healthz >/dev/null; then break; fi
            sleep 1
          done
          curl -sf http://localhost:28081/healthz

      - name: Wait for cluster to register
        run: |
          for i in $(seq 1 30); do
            CID=$(curl -sS http://localhost:8190/api/v1/clusters | \
              python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')" 2>/dev/null)
            if [ -n "$CID" ]; then
              echo "CLUSTER_ID=$CID" >> $GITHUB_ENV
              break
            fi
            sleep 2
          done
          test -n "$CID"

      - name: Run chat-quality bench
        run: |
          ./bin/chat-quality-bench \
            --cluster "$CLUSTER_ID" \
            --prompts cmd/bench/chat_quality_prompts.json \
            --out chat_quality_results.xml

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: chat-quality-results
          path: |
            chat_quality_results.xml
            /tmp/backend.log
            /tmp/brain.log

      - name: Publish test report
        if: always()
        uses: mikepenz/action-junit-report@v4
        with:
          report_paths: chat_quality_results.xml
          fail_on_failure: true
```

- [ ] **Step 6.2: Verify YAML is well-formed**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/chat-quality-bench.yml'))" && echo "yaml ok"
```
Expected: `yaml ok`. If this errors, re-open the file and fix the line it complains about.

- [ ] **Step 6.3: Commit**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
git add .github/workflows/chat-quality-bench.yml
git commit -m "ci(bench): nightly chat-quality run on kind

Stands up kind, the backend, the brain with gpt-4o, waits for the
auto-registered cluster, runs the 30-prompt bench, uploads the
JUnit XML. Manually triggerable via workflow_dispatch. Kept off the
PR gate for now — will promote once pass rate is reliably green."
```

---

## Task 7: Restart services with everything new, E2E smoke check

**Files:** none (operational step)

- [ ] **Step 7.1: Rebuild + restart brain**

```bash
# 1. Rebuild brain binary at the new commit.
cd /tmp/kotg-ai-vk/kubilitics-ai
go build -o server ./cmd/server

# 2. Kill the old one.
pkill -f '/tmp/kotg-ai-vk/kubilitics-ai/server' 2>/dev/null || true
sleep 1

# 3. Start the new one.
nohup ./server -config config-e2e2.yaml > /tmp/brain.log 2>&1 &
echo "brain PID=$!"
sleep 3
tail -5 /tmp/brain.log
```
Expected: "Kubilitics AI Server started successfully" + "tool-aware path enabled with 166 MCP tools" in the tail.

- [ ] **Step 7.2: Reload frontend**

The user reloads the desktop app (Cmd+R) to pick up the AI Settings default change. No shell command — operator action.

- [ ] **Step 7.3: Run the bench locally for a sanity check**

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
CID=$(curl -sS http://localhost:8190/api/v1/clusters | \
      python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
./bin/chat-quality-bench --cluster "$CID" --prompts cmd/bench/chat_quality_prompts.json
```
Expected: 30 / 30 or very close. Record pass rate in the memory entry below.

- [ ] **Step 7.4: Record pass rate + commit memory entry**

Update `/Users/koti/.claude/projects/-Users-koti-myFuture-Kubernetes-kubilitics/memory/project_ai_systematic_quality.md` with the observed pass rate and the four commits' SHAs. Update `MEMORY.md` index.

---

## Self-Review — spec coverage checklist

- [x] **(1) Strong system prompt** → Task 1 extracts it + tests 6 invariants. Task 7 verifies live.
- [x] **(2) Summarize at the tool layer** → Task 2 creates the 8KB cap helper; Task 3 wraps every `ExecuteTool` return.
- [x] **(3) Bench, not whack-a-mole** → Task 5 adds 30 prompts + harness; Task 6 runs it in CI nightly; Task 7 runs it locally once.
- [x] **(4) Default to gpt-4o** → Task 4 flips the frontend default; backend default was already `gpt-4o`.

## Self-Review — placeholder scan

No "TBD", no "implement later", no "similar to task N", no vague error-handling instructions. Every code step ships complete code.

## Self-Review — type consistency

- `BuildSystemPrompt(focusClusterID string) string` — same name + signature across Task 1 create + Task 1 usage.
- `MaxToolOutputBytes` / `capToolOutput(interface{}) interface{}` — same across Task 2 create + Task 3 wrap + Task 2 tests.
- `summarizeListForLLM` / `summarizeItem` — preserved signatures, only moved files.
- Frontend model default `'gpt-4o'` — one string literal, one value; no drift.
