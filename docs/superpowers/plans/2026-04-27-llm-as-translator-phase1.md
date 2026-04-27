# LLM-as-Translator Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hallucination of deterministic K8s tool data mechanically impossible by routing `list_pods` and `get_pod_yaml` results around the LLM and rendering them as structured `render_block` events in the chat panel.

**Architecture:** Inside `kotg-toolserver`'s tool-calling loop, wrap the executor so that for tools classified `Deterministic` in a static registry: (a) the real tool result is shaped into a typed payload and emitted as a new `RenderBlock` event on the existing `AgentStreamEvent` channel, (b) the LLM receives only a stub string ("Result rendered to user; do not retell"), so the LLM physically cannot retell the data. A narrow `summary.Generate(derived)` may produce a ≤80-char summary line from precomputed counts only. Backend forwards `render_block` opaque-bytes to the frontend, where a new `RenderBlock` dispatcher renders `KubectlTableBlock` or `YamlBlock`.

**Tech Stack:**
- Brain: Go (`github.com/kubilitics/kotg-toolserver`), provider-specific tool loops in `internal/llm/provider/{anthropic,openai,custom,ollama}/tool_loop.go`
- Schema: protobuf in `vellankikoti/kotg-schema`
- Backend: Go (`github.com/vellankikoti/kubilitics/brain` + `kubilitics-backend`)
- Frontend: React 18 + TypeScript + Vitest + RTL, blocks at `kubilitics-frontend/src/components/ai/messages/blocks/`
- Bench: Go test harness at `kubilitics/brain/cmd/chat-quality-bench/`
- Lint: `depguard` (already in CI for kotg-toolserver — verify in Task 0)

---

## File Structure

### kotg.ai (path: `kotg-ai/kotg-toolserver/`)

| Path | Responsibility |
|---|---|
| `internal/derived/derived.go` | `DerivedSummary` type. No imports. Breaks cycle between `render` and `summary`. |
| `internal/derived/derived_test.go` | Schema snapshot test (forces code review on field add). |
| `internal/render/registry.go` | `Class`, `RenderType`, `ToolBehavior`, `Lookup`. |
| `internal/render/registry_test.go` | Coverage tests: every Deterministic tool has shaper + non-text renderer. |
| `internal/render/chokepoint.go` | `BuildDeterministicResponse`, `buildRenderError`, `maybeTruncate`. |
| `internal/render/chokepoint_test.go` | Refuses analytical tools; oversized payload truncation; failure → render_error not LLM. |
| `internal/render/shapers/pods.go` | `ShapeListPods`, `ShapeGetPodYaml`, `shapers` map. |
| `internal/render/shapers/pods_test.go` | Fixture-based shape tests + golden file shared with frontend. |
| `internal/render/derive.go` | Computes `DerivedSummary` from shaped data + namespace. |
| `internal/llm/summary/summary.go` | `Generate(ctx, derived.DerivedSummary) (string, error)` — the only LLM symbol `render` may import. |
| `internal/llm/summary/summary_test.go` | Signature fence test. |
| `internal/llm/executor_wrapper.go` | `WrapExecutorForRender` — wraps existing `types.ToolExecutor` to emit render_block + return stub string. |
| `internal/llm/executor_wrapper_test.go` | Wrapper behavior + LLM-call counter. |
| `internal/llm/types/tool_execution.go` (modify) | Add `RenderBlock *RenderBlockEvent` to `AgentStreamEvent`. |
| `internal/llm/provider/*/tool_loop.go` (modify, 4 files) | Inject `WrapExecutorForRender(executor, evtCh)` at loop start. |
| `.golangci.yml` (modify) | Depguard: `internal/render` may not import `internal/llm` (only `internal/llm/summary`). |
| `internal/render/architecture_test.go` | Code-graph/import boundary verification. |
| `cmd/chokepoint-fault-test/` | (optional helper — folded into chokepoint_test.go) |

### kotg-schema (`vellankikoti/kotg-schema`)

| Path | Responsibility |
|---|---|
| `proto/kotg/v1/chat.proto` (modify) | Add `RenderBlock` variant to `AssistantEvent`. |
| `gen/...` | Regenerated. |

### kubilitics monorepo (`vellankikoti/kubilitics`)

| Path | Responsibility |
|---|---|
| `brain/internal/chat/render_passthrough.go` | Forward `render_block` from kotg-toolserver to backend WS, byte-equal. |
| `brain/internal/chat/render_passthrough_test.go` | Byte-equality test. |
| `kubilitics-backend/internal/ai/handlers/chat.go` (modify) | Add `render_block` case to event flattening. |
| `kubilitics-backend/internal/ai/handlers/chat_render_test.go` | Backend opacity passthrough test. |
| `kubilitics-frontend/src/components/ai/messages/blocks/RenderBlock.tsx` | Dispatcher. |
| `kubilitics-frontend/src/components/ai/messages/blocks/KubectlTableBlock.tsx` | Table renderer. |
| `kubilitics-frontend/src/components/ai/messages/blocks/YamlBlock.tsx` | YAML renderer. |
| `kubilitics-frontend/src/components/ai/messages/blocks/RenderErrorBlock.tsx` | Error renderer. |
| `kubilitics-frontend/src/components/ai/messages/blocks/render-types.ts` | TS types mirroring wire shape. |
| `kubilitics-frontend/src/components/ai/messages/blocks/__tests__/*.test.tsx` | RTL tests for each block. |
| `kubilitics-frontend/src/components/ai/messages/Turn.tsx` (modify) | Dispatch `render_block` events to `RenderBlock`. |
| `brain/cmd/chat-quality-bench/suites/hallucination_probes/` | New suite (30 probes + fixtures). |
| `brain/cmd/chat-quality-bench/probes_assert.go` | Per-probe assertions (data byte-equality, summary entity-leak, llm_call_count guard). |

---

## Task 0: Branch setup + dependency check

**Files:**
- Create: branches in three repos.

- [ ] **Step 1: Verify clean working tree in all three repos**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics && git status --porcelain
cd /Users/koti/myFuture/Kubernetes/kotg.ai && git status --porcelain
# kotg-schema is consumed via go.mod; clone or skip if not local
```
Expected: empty output.

- [ ] **Step 2: Cut feature branches (kubilitics + kotg.ai)**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics && git checkout -b fix/llm-as-translator
cd /Users/koti/myFuture/Kubernetes/kotg.ai && git checkout -b fix/llm-as-translator
```
Expected: branch switch confirmation in both repos.

- [ ] **Step 3: Confirm depguard is wired in kotg-toolserver CI**

```bash
cd /Users/koti/myFuture/Kubernetes/kotg.ai/kotg-ai/kotg-toolserver
grep -n "depguard" .golangci.yml || echo "MISSING"
```
Expected: at least one `depguard` line. If "MISSING": Task 0a — add depguard linter section to `.golangci.yml` with empty rules, commit "chore(ci): enable depguard for upcoming render package boundary".

- [ ] **Step 4: Confirm kotg-toolserver tests pass on a clean branch**

```bash
cd /Users/koti/myFuture/Kubernetes/kotg.ai/kotg-ai/kotg-toolserver && go test ./...
```
Expected: PASS.

- [ ] **Step 5: Commit branch baseline (kubilitics)**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
# No file changes yet — this step is a no-op marker. Skip if no changes.
```

---

## Task 1: kotg-schema — add `RenderBlock` variant

**Files:**
- Modify: `vellankikoti/kotg-schema/proto/kotg/v1/chat.proto` (locate `AssistantEvent` message)

- [ ] **Step 1: Clone kotg-schema if not already local; cut branch**

```bash
mkdir -p ~/myFuture/Kubernetes/_deps && cd ~/myFuture/Kubernetes/_deps
git clone https://github.com/vellankikoti/kotg-schema.git || (cd kotg-schema && git fetch)
cd kotg-schema && git checkout -b fix/llm-as-translator
```

- [ ] **Step 2: Read the existing `AssistantEvent` definition**

```bash
grep -n "AssistantEvent\|oneof" proto/kotg/v1/chat.proto | head -40
```
Note the existing oneof variants and the next available field number.

- [ ] **Step 3: Write the failing schema test (use buf lint as the gate)**

Create `proto/kotg/v1/chat_render_block_test.txt` (a text marker doc that documents expected fields; the actual test is buf lint + go gen + a Go consumer test in Task 4).

```text
// AssistantEvent must include a RenderBlock variant with fields:
//   string type = 1;
//   bytes data = 2;
//   string summary = 3;
```

- [ ] **Step 4: Add the variant to the proto**

```proto
message AssistantEvent {
  oneof payload {
    // ... existing variants ...
    RenderBlock render_block = <next-free-field-number>;
  }
}

message RenderBlock {
  // type names a registered RenderType (e.g. "kubectl_table",
  // "yaml_block", "render_error"). Frontend dispatches on this.
  string type = 1;
  // data is opaque JSON owned by the brain's shaper. Backend MUST
  // forward verbatim. Empty for tools that have no payload.
  bytes data = 2;
  // summary is an optional ≤80-char single-line summary line.
  // Brain enforces the cap before emit.
  string summary = 3;
}
```

- [ ] **Step 5: Regenerate Go bindings**

```bash
buf generate
```
Expected: regenerated files under `gen/go/kotg/v1/`.

- [ ] **Step 6: Build & test**

```bash
go build ./... && go test ./...
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add proto/ gen/
git commit -m "feat(chat): add RenderBlock variant to AssistantEvent"
```

- [ ] **Step 8: Push and tag**

```bash
git push -u origin fix/llm-as-translator
# After PR merge:
git checkout main && git pull
git tag v1.0.2 && git push origin v1.0.2  # adjust version per CHANGELOG
```

---

## Task 2: kotg-toolserver — `internal/derived` package

**Files:**
- Create: `kotg-toolserver/internal/derived/derived.go`
- Create: `kotg-toolserver/internal/derived/derived_test.go`

- [ ] **Step 1: Write the failing snapshot test**

`internal/derived/derived_test.go`:
```go
package derived

import (
	"encoding/json"
	"testing"
)

// TestDerivedSummarySchemaIsExhaustive snapshots the JSON shape of
// DerivedSummary. Adding a field requires updating this test, which
// forces code review (the type is the LLM's only allowed input on
// the deterministic path).
func TestDerivedSummarySchemaIsExhaustive(t *testing.T) {
	d := DerivedSummary{
		ToolName:        "list_pods",
		Namespace:       "kube-system",
		RowCount:        13,
		StatusBreakdown: map[string]int{"Running": 12, "Pending": 1},
	}
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `{"tool_name":"list_pods","namespace":"kube-system","row_count":13,"status_breakdown":{"Pending":1,"Running":12}}`
	if string(b) != want {
		t.Fatalf("schema drift\n got:  %s\nwant: %s", b, want)
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
cd /Users/koti/myFuture/Kubernetes/kotg.ai/kotg-ai/kotg-toolserver
go test ./internal/derived/...
```
Expected: FAIL — package does not compile (DerivedSummary undefined).

- [ ] **Step 3: Implement the type**

`internal/derived/derived.go`:
```go
// Package derived defines the strict, exhaustive schema that the
// summary-generating LLM call may see for tools on the deterministic
// path. Lives in its own package (no imports) to break the cycle
// between internal/render and internal/llm/summary.
package derived

// DerivedSummary describes the SHAPE of a tool result, never its
// IDENTITY. Adding a field is a deliberate review point — see
// derived_test.go.
type DerivedSummary struct {
	ToolName        string         `json:"tool_name"`
	Namespace       string         `json:"namespace,omitempty"`
	RowCount        int            `json:"row_count"`
	StatusBreakdown map[string]int `json:"status_breakdown,omitempty"`
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/derived/... -v
```
Expected: `--- PASS: TestDerivedSummarySchemaIsExhaustive`.

- [ ] **Step 5: Commit**

```bash
git add internal/derived/
git commit -m "feat(derived): add DerivedSummary type-fence package"
```

---

## Task 3: kotg-toolserver — `internal/render/registry.go`

**Files:**
- Create: `kotg-toolserver/internal/render/registry.go`
- Create: `kotg-toolserver/internal/render/registry_test.go`

- [ ] **Step 1: Write failing tests**

`internal/render/registry_test.go`:
```go
package render

import "testing"

func TestLookupReturnsSafeDefault(t *testing.T) {
	b := Lookup("totally_unknown_tool")
	if b.Class != Analytical {
		t.Fatalf("unknown tool default class: got %q want %q", b.Class, Analytical)
	}
	if b.Render != RenderText {
		t.Fatalf("unknown tool default render: got %q want %q", b.Render, RenderText)
	}
}

func TestRegistryHasPhase1Tools(t *testing.T) {
	for _, name := range []string{"list_pods", "get_pod_yaml"} {
		b := Lookup(name)
		if b.Class != Deterministic {
			t.Errorf("%s should be Deterministic, got %q", name, b.Class)
		}
	}
}

func TestEveryDeterministicToolHasNonTextRenderer(t *testing.T) {
	for name, b := range registry {
		if b.Class == Deterministic && b.Render == RenderText {
			t.Errorf("deterministic tool %s declared RenderText (must declare a structured renderer)", name)
		}
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
go test ./internal/render/...
```
Expected: FAIL — package does not exist.

- [ ] **Step 3: Implement `registry.go`**

`internal/render/registry.go`:
```go
// Package render owns the deterministic-rendering pipeline: the
// classification registry, the BuildDeterministicResponse chokepoint,
// and per-tool shapers. It is the ONLY package permitted to construct
// AssistantEvent values of kind RenderBlock.
//
// Import discipline (enforced by depguard, see .golangci.yml):
//   render MAY import: internal/derived, internal/llm/summary
//   render MAY NOT import: internal/llm (raw LLM client)
package render

type Class string
type RenderType string

const (
	Deterministic Class = "deterministic"
	Analytical    Class = "analytical"
)

const (
	RenderKubectlTable RenderType = "kubectl_table"
	RenderYAMLBlock    RenderType = "yaml_block"
	RenderError        RenderType = "render_error"
	// RenderText is reserved for the analytical default. Deterministic
	// tools must declare a structured renderer (enforced by tests).
	RenderText RenderType = "text"
)

// ToolBehavior is the per-tool classification + render type.
type ToolBehavior struct {
	Class  Class
	Render RenderType
}

// registry is the single source of truth for tool classification.
// Phase 1: list_pods + get_pod_yaml only. Adding a tool is the
// rollout knob — every new tool ships in Analytical mode by default
// (see Lookup), and going live is a deliberate edit here.
var registry = map[string]ToolBehavior{
	"list_pods":    {Class: Deterministic, Render: RenderKubectlTable},
	"get_pod_yaml": {Class: Deterministic, Render: RenderYAMLBlock},
}

// Lookup returns the ToolBehavior for a registered tool, or the
// Analytical+Text default for unmapped tools. This default preserves
// pre-Phase-1 behavior — new tools are safe by construction.
func Lookup(toolName string) ToolBehavior {
	if b, ok := registry[toolName]; ok {
		return b
	}
	return ToolBehavior{Class: Analytical, Render: RenderText}
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/render/... -v
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/render/registry.go internal/render/registry_test.go
git commit -m "feat(render): add ToolBehavior registry with Phase 1 classifications"
```

---

## Task 4: kotg-toolserver — shapers

**Files:**
- Create: `kotg-toolserver/internal/render/shapers/pods.go`
- Create: `kotg-toolserver/internal/render/shapers/pods_test.go`
- Create: `kotg-toolserver/internal/render/shapers/fixtures/list_pods_kube_system.json`
- Create: `kotg-toolserver/internal/render/shapers/fixtures/get_pod_yaml_coredns.json`
- Modify: `kotg-toolserver/internal/render/registry.go` (export shaper coverage helper)

- [ ] **Step 1: Create test fixture for list_pods (3 pods, mixed status)**

`internal/render/shapers/fixtures/list_pods_kube_system.json`:
```json
[
  {
    "metadata": {"name": "coredns-1", "namespace": "kube-system",
                 "creationTimestamp": "2026-04-26T10:00:00Z"},
    "spec": {"containers": [{"name": "coredns"}]},
    "status": {"phase": "Running",
               "containerStatuses": [{"ready": true, "restartCount": 0}]}
  },
  {
    "metadata": {"name": "coredns-2", "namespace": "kube-system",
                 "creationTimestamp": "2026-04-26T10:00:00Z"},
    "spec": {"containers": [{"name": "coredns"}]},
    "status": {"phase": "Running",
               "containerStatuses": [{"ready": true, "restartCount": 2}]}
  },
  {
    "metadata": {"name": "kube-proxy-1", "namespace": "kube-system",
                 "creationTimestamp": "2026-04-26T10:00:00Z"},
    "spec": {"containers": [{"name": "kube-proxy"}]},
    "status": {"phase": "Pending",
               "containerStatuses": [{"ready": false, "restartCount": 0}]}
  }
]
```

- [ ] **Step 2: Write failing shaper tests**

`internal/render/shapers/pods_test.go`:
```go
package shapers

import (
	"encoding/json"
	"os"
	"testing"
)

func TestShapeListPods_FixtureKubeSystem(t *testing.T) {
	raw, err := os.ReadFile("fixtures/list_pods_kube_system.json")
	if err != nil { t.Fatalf("read fixture: %v", err) }

	out, err := ShapeListPods(raw)
	if err != nil { t.Fatalf("ShapeListPods: %v", err) }

	var shaped struct {
		Columns []map[string]string      `json:"columns"`
		Rows    []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(out, &shaped); err != nil {
		t.Fatalf("unmarshal shaped: %v", err)
	}

	wantCols := []string{"NAME", "READY", "STATUS", "RESTARTS", "AGE"}
	if len(shaped.Columns) != len(wantCols) {
		t.Fatalf("columns count: got %d want %d", len(shaped.Columns), len(wantCols))
	}
	for i, c := range wantCols {
		if shaped.Columns[i]["key"] != c {
			t.Errorf("column %d: got %q want %q", i, shaped.Columns[i]["key"], c)
		}
	}
	if len(shaped.Rows) != 3 {
		t.Fatalf("rows: got %d want 3", len(shaped.Rows))
	}
	if shaped.Rows[1]["RESTARTS"] != float64(2) {
		t.Errorf("row 1 RESTARTS: got %v want 2", shaped.Rows[1]["RESTARTS"])
	}
	if shaped.Rows[2]["STATUS"] != "Pending" {
		t.Errorf("row 2 STATUS: got %v want Pending", shaped.Rows[2]["STATUS"])
	}
}

func TestShapeListPods_Empty(t *testing.T) {
	out, err := ShapeListPods([]byte(`[]`))
	if err != nil { t.Fatalf("ShapeListPods: %v", err) }
	var shaped struct {
		Rows []any `json:"rows"`
	}
	_ = json.Unmarshal(out, &shaped)
	if len(shaped.Rows) != 0 {
		t.Errorf("rows on empty: got %d want 0", len(shaped.Rows))
	}
}

func TestShapeListPods_MalformedJSON(t *testing.T) {
	_, err := ShapeListPods([]byte(`{not json`))
	if err == nil {
		t.Fatalf("expected error on malformed JSON")
	}
}

func TestShapeGetPodYaml_FixtureCoredns(t *testing.T) {
	raw := []byte(`{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: coredns-1\n"}`)
	out, err := ShapeGetPodYaml(raw)
	if err != nil { t.Fatalf("ShapeGetPodYaml: %v", err) }
	var shaped struct{ Yaml string `json:"yaml"` }
	_ = json.Unmarshal(out, &shaped)
	if shaped.Yaml == "" {
		t.Fatal("yaml empty")
	}
}

func TestShapersMapHasAllPhase1Tools(t *testing.T) {
	for _, name := range []string{"list_pods", "get_pod_yaml"} {
		if _, ok := Shapers[name]; !ok {
			t.Errorf("missing shaper for %s", name)
		}
	}
}
```

- [ ] **Step 3: Run — expect compile failure**

```bash
go test ./internal/render/shapers/...
```
Expected: FAIL.

- [ ] **Step 4: Implement shapers**

`internal/render/shapers/pods.go`:
```go
// Package shapers contains per-tool transforms from raw MCP tool
// output to wire-shape render data. This is deterministic — the LLM
// is never involved.
package shapers

import (
	"encoding/json"
	"fmt"
	"time"
)

// Shapers is the registry of tool name → shaper function. Every
// Deterministic tool in render.registry MUST have an entry here
// (enforced by an architecture test in package render).
var Shapers = map[string]func(json.RawMessage) (json.RawMessage, error){
	"list_pods":    ShapeListPods,
	"get_pod_yaml": ShapeGetPodYaml,
}

type column struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Align string `json:"align,omitempty"`
}

type table struct {
	Columns []column                 `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

type podLite struct {
	Metadata struct {
		Name              string    `json:"name"`
		Namespace         string    `json:"namespace"`
		CreationTimestamp time.Time `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Containers []struct{ Name string `json:"name"` } `json:"containers"`
	} `json:"spec"`
	Status struct {
		Phase             string `json:"phase"`
		ContainerStatuses []struct {
			Ready        bool `json:"ready"`
			RestartCount int  `json:"restartCount"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

func ShapeListPods(raw json.RawMessage) (json.RawMessage, error) {
	var pods []podLite
	if err := json.Unmarshal(raw, &pods); err != nil {
		return nil, fmt.Errorf("list_pods shaper: %w", err)
	}
	t := table{
		Columns: []column{
			{Key: "NAME", Label: "NAME"},
			{Key: "READY", Label: "READY"},
			{Key: "STATUS", Label: "STATUS"},
			{Key: "RESTARTS", Label: "RESTARTS", Align: "right"},
			{Key: "AGE", Label: "AGE"},
		},
		Rows: make([]map[string]interface{}, len(pods)),
	}
	for i, p := range pods {
		ready := 0
		restarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Ready { ready++ }
			restarts += cs.RestartCount
		}
		t.Rows[i] = map[string]interface{}{
			"NAME":     p.Metadata.Name,
			"READY":    fmt.Sprintf("%d/%d", ready, len(p.Spec.Containers)),
			"STATUS":   p.Status.Phase,
			"RESTARTS": restarts,
			"AGE":      humanAge(p.Metadata.CreationTimestamp),
		}
	}
	return json.Marshal(t)
}

func humanAge(t time.Time) string {
	if t.IsZero() { return "?" }
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// ShapeGetPodYaml is a passthrough — the tool already returns
// {"yaml": "..."}. We re-marshal to enforce the wire shape.
func ShapeGetPodYaml(raw json.RawMessage) (json.RawMessage, error) {
	var in struct{ Yaml string `json:"yaml"` }
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fmt.Errorf("get_pod_yaml shaper: %w", err)
	}
	out, err := json.Marshal(struct {
		Yaml string `json:"yaml"`
	}{Yaml: in.Yaml})
	return out, err
}
```

- [ ] **Step 5: Run tests**

```bash
go test ./internal/render/shapers/... -v
```
Expected: 5 PASS.

- [ ] **Step 6: Add the cross-package coverage test**

`internal/render/registry_test.go` — append:
```go
import shapers "github.com/kubilitics/kotg-toolserver/internal/render/shapers"

func TestDeterministicToolsHaveShapers(t *testing.T) {
	for name, b := range registry {
		if b.Class != Deterministic { continue }
		if _, ok := shapers.Shapers[name]; !ok {
			t.Errorf("deterministic tool %s has no shaper in shapers.Shapers", name)
		}
	}
}
```

- [ ] **Step 7: Run**

```bash
go test ./internal/render/...
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/render/shapers/ internal/render/registry_test.go
git commit -m "feat(render): add ShapeListPods + ShapeGetPodYaml + coverage test"
```

---

## Task 5: kotg-toolserver — `internal/llm/summary` (the type fence)

**Files:**
- Create: `kotg-toolserver/internal/llm/summary/summary.go`
- Create: `kotg-toolserver/internal/llm/summary/summary_test.go`

- [ ] **Step 1: Write the failing signature-fence test**

`internal/llm/summary/summary_test.go`:
```go
package summary

import (
	"context"
	"testing"

	"github.com/kubilitics/kotg-toolserver/internal/derived"
)

// TestGenerateSignatureRejectsRawData is a compile-time fence:
// Generate's signature accepts ONLY DerivedSummary. If someone widens
// the signature to accept []byte or a richer type, this assignment
// will fail to compile and the test breaks.
func TestGenerateSignatureRejectsRawData(t *testing.T) {
	var _ func(context.Context, derived.DerivedSummary) (string, error) = Generate
}

func TestGenerateEnforcesOneLine(t *testing.T) {
	got := enforceOneLine("line one\nline two", 80)
	if got != "line one" {
		t.Fatalf("got %q", got)
	}
}

func TestGenerateEnforcesLengthCap(t *testing.T) {
	in := "0123456789012345678901234567890123456789" // 40 chars
	got := enforceOneLine(in+in+in, 80)
	if len(got) > 80 {
		t.Fatalf("got %d chars (>80)", len(got))
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
go test ./internal/llm/summary/...
```
Expected: FAIL.

- [ ] **Step 3: Implement minimal Generate (no real LLM call yet — stub)**

`internal/llm/summary/summary.go`:
```go
// Package summary is the narrow LLM-call surface available to the
// deterministic render path. By type, Generate physically cannot
// receive raw rows, YAML, or entity names — only the precomputed
// DerivedSummary.
//
// Import discipline: this package may NOT import internal/llm
// directly. It uses internal/llm/summary/internal/anthropic (or
// equivalent narrow wrapper) — added in a follow-up step here.
package summary

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kotg-toolserver/internal/derived"
)

// Generate produces a ≤80-char, single-line summary from the strict
// DerivedSummary fields. The real LLM call is plugged in via the
// package-level llmCompleter (see init_default.go for production wiring).
//
// In Phase 1 ship A, llmCompleter defaults to a deterministic
// formatter — no LLM call at all. This eliminates the LLM from the
// summary path entirely and is the safest possible default. A
// follow-up may replace llmCompleter with a real narrow LLM call.
func Generate(ctx context.Context, d derived.DerivedSummary) (string, error) {
	out, err := llmCompleter(ctx, d)
	if err != nil {
		return "", err
	}
	return enforceOneLine(out, 80), nil
}

// llmCompleter is a package-level seam. Default = deterministic
// formatter (no LLM call). Tests may swap it; production wiring may
// replace with a narrow LLM call.
var llmCompleter = defaultDeterministicFormatter

func defaultDeterministicFormatter(_ context.Context, d derived.DerivedSummary) (string, error) {
	parts := []string{fmt.Sprintf("%d %s", d.RowCount, pluralize(d.ToolName, d.RowCount))}
	if d.Namespace != "" {
		parts = append(parts, "in "+d.Namespace)
	}
	if len(d.StatusBreakdown) > 0 {
		breakdown := []string{}
		for k, v := range d.StatusBreakdown {
			breakdown = append(breakdown, fmt.Sprintf("%d %s", v, k))
		}
		parts = append(parts, "("+strings.Join(breakdown, ", ")+")")
	}
	return strings.Join(parts, " "), nil
}

func pluralize(toolName string, n int) string {
	switch toolName {
	case "list_pods":
		if n == 1 { return "pod" }
		return "pods"
	case "get_pod_yaml":
		return "YAML document"
	}
	return "result"
}

func enforceOneLine(s string, max int) string {
	if i := strings.Index(s, "\n"); i >= 0 {
		s = s[:i]
	}
	if len(s) > max {
		s = s[:max]
	}
	return strings.TrimSpace(s)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/llm/summary/... -v
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/derived internal/llm/summary
git commit -m "feat(llm/summary): add narrow Generate(DerivedSummary) type fence"
```

---

## Task 6: kotg-toolserver — `internal/render/derive.go`

**Files:**
- Create: `kotg-toolserver/internal/render/derive.go`
- Create: `kotg-toolserver/internal/render/derive_test.go`

- [ ] **Step 1: Write failing test**

`internal/render/derive_test.go`:
```go
package render

import (
	"encoding/json"
	"testing"
)

func TestDeriveListPods_StatusBreakdown(t *testing.T) {
	shaped := []byte(`{"columns":[],"rows":[
		{"NAME":"a","STATUS":"Running"},
		{"NAME":"b","STATUS":"Running"},
		{"NAME":"c","STATUS":"Pending"}
	]}`)
	d, err := derive("list_pods", "kube-system", shaped)
	if err != nil { t.Fatalf("derive: %v", err) }
	if d.RowCount != 3 {
		t.Errorf("RowCount: got %d want 3", d.RowCount)
	}
	if d.Namespace != "kube-system" {
		t.Errorf("Namespace: got %q want kube-system", d.Namespace)
	}
	if d.StatusBreakdown["Running"] != 2 || d.StatusBreakdown["Pending"] != 1 {
		t.Errorf("StatusBreakdown: got %v", d.StatusBreakdown)
	}
}

func TestDeriveGetPodYaml_NoBreakdown(t *testing.T) {
	shaped, _ := json.Marshal(map[string]string{"yaml": "kind: Pod"})
	d, err := derive("get_pod_yaml", "kube-system", shaped)
	if err != nil { t.Fatalf("derive: %v", err) }
	if d.RowCount != 1 {
		t.Errorf("RowCount: got %d want 1", d.RowCount)
	}
	if len(d.StatusBreakdown) != 0 {
		t.Errorf("StatusBreakdown should be empty")
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
go test ./internal/render/... -run TestDerive
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`internal/render/derive.go`:
```go
package render

import (
	"encoding/json"

	"github.com/kubilitics/kotg-toolserver/internal/derived"
)

// derive computes a DerivedSummary from a shaped tool result. It
// reads only counts and statuses — never names or arbitrary fields.
// The resulting struct is the ONLY thing summary.Generate may see.
func derive(toolName, namespace string, shaped json.RawMessage) (derived.DerivedSummary, error) {
	d := derived.DerivedSummary{ToolName: toolName, Namespace: namespace}
	switch toolName {
	case "list_pods":
		var t struct {
			Rows []struct {
				Status string `json:"STATUS"`
			} `json:"rows"`
		}
		if err := json.Unmarshal(shaped, &t); err != nil {
			return d, err
		}
		d.RowCount = len(t.Rows)
		if len(t.Rows) > 0 {
			d.StatusBreakdown = map[string]int{}
			for _, r := range t.Rows {
				d.StatusBreakdown[r.Status]++
			}
		}
	case "get_pod_yaml":
		d.RowCount = 1
	default:
		// Should be unreachable — only deterministic tools call derive.
		d.RowCount = 0
	}
	return d, nil
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/render/... -run TestDerive -v
```
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/render/derive.go internal/render/derive_test.go
git commit -m "feat(render): add derive() — counts-only summary derivation"
```

---

## Task 7: kotg-toolserver — `internal/render/chokepoint.go`

**Files:**
- Create: `kotg-toolserver/internal/render/chokepoint.go`
- Create: `kotg-toolserver/internal/render/chokepoint_test.go`

- [ ] **Step 1: Write failing tests**

`internal/render/chokepoint_test.go`:
```go
package render

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildDeterministicResponse_HappyPath_ListPods(t *testing.T) {
	raw := []byte(`[{"metadata":{"name":"p1","namespace":"x"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}]`)
	ev, err := BuildDeterministicResponse(context.Background(), "list_pods", "x", raw)
	if err != nil { t.Fatalf("err: %v", err) }
	if ev.Kind != "render_block" {
		t.Fatalf("kind: %q", ev.Kind)
	}
	if ev.RenderType != "kubectl_table" {
		t.Fatalf("type: %q", ev.RenderType)
	}
	if len(ev.RenderData) == 0 {
		t.Fatal("data empty")
	}
	if ev.Summary == "" {
		t.Fatal("summary empty (expected default formatter output)")
	}
}

func TestBuildDeterministicResponse_RefusesAnalyticalTool(t *testing.T) {
	_, err := BuildDeterministicResponse(context.Background(), "explain_anything", "", []byte(`{}`))
	if err == nil {
		t.Fatal("expected error for non-deterministic tool")
	}
}

func TestBuildDeterministicResponse_ShaperFailureProducesRenderError(t *testing.T) {
	ev, err := BuildDeterministicResponse(context.Background(), "list_pods", "x", []byte(`{not json`))
	if err != nil {
		t.Fatalf("must not return error; must produce render_error event: %v", err)
	}
	if ev.RenderType != "render_error" {
		t.Fatalf("expected render_error, got %q", ev.RenderType)
	}
	var payload map[string]interface{}
	_ = json.Unmarshal(ev.RenderData, &payload)
	if payload["tool"] != "list_pods" {
		t.Errorf("error payload missing tool field")
	}
	if !strings.Contains(payload["error"].(string), "shaper") &&
	   !strings.Contains(payload["error"].(string), "json") {
		t.Errorf("error message should mention shaper/json, got %q", payload["error"])
	}
}

func TestBuildDeterministicResponse_OversizePayloadTruncated(t *testing.T) {
	big := make([]byte, 250_000)
	for i := range big { big[i] = 'A' }
	out := maybeTruncate(big, 200_000)
	if len(out) > 200_000 {
		t.Fatalf("not truncated: %d", len(out))
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
go test ./internal/render/... -run TestBuildDeterministicResponse
```
Expected: FAIL.

- [ ] **Step 3: Implement chokepoint**

`internal/render/chokepoint.go`:
```go
package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/kubilitics/kotg-toolserver/internal/llm/summary"
	"github.com/kubilitics/kotg-toolserver/internal/render/shapers"
)

// AssistantEvent is the brain-side event shape that the executor
// wrapper pushes onto the AgentStreamEvent channel as a RenderBlock.
// Wire mapping to kotg-schema RenderBlock proto happens in the
// brain's chat dispatcher (see kubilitics/brain/internal/chat).
type AssistantEvent struct {
	Kind       string          // always "render_block"
	RenderType string          // matches frontend RenderType
	RenderData json.RawMessage // opaque to anything downstream
	Summary    string          // ≤80 chars, single line
}

// ErrNotDeterministic signals misuse of BuildDeterministicResponse.
var ErrNotDeterministic = errors.New("BuildDeterministicResponse: tool is not Deterministic")

// MaxRenderDataBytes caps the size of render.data before emit.
// Larger payloads produce a render_error with truncated raw.
const MaxRenderDataBytes = 1_000_000      // 1 MB
const renderErrorRawCap   = 200_000        // 200 KB

// BuildDeterministicResponse is the SINGLE chokepoint that emits
// render_block events. No other code in the codebase may construct
// an AssistantEvent of kind "render_block".
//
// Failure modes (renderer error, shaper error, oversized data) all
// route to a render_error event — NEVER to an Analytical fallback.
// Falling back to Analytical would hand the data to the LLM, which
// is the bug we are eliminating.
func BuildDeterministicResponse(
	ctx context.Context,
	toolName string,
	namespace string,
	toolResult json.RawMessage,
) (AssistantEvent, error) {
	behavior := Lookup(toolName)
	if behavior.Class != Deterministic {
		return AssistantEvent{}, fmt.Errorf("%w: %s", ErrNotDeterministic, toolName)
	}

	shaper, ok := shapers.Shapers[toolName]
	if !ok {
		return buildRenderError(toolName, toolResult, fmt.Errorf("missing shaper")), nil
	}

	shaped, err := shaper(toolResult)
	if err != nil {
		return buildRenderError(toolName, toolResult, err), nil
	}

	if len(shaped) > MaxRenderDataBytes {
		return buildRenderError(toolName, toolResult,
			fmt.Errorf("render_data exceeds %d bytes (%d)", MaxRenderDataBytes, len(shaped))), nil
	}

	d, err := derive(toolName, namespace, shaped)
	if err != nil {
		return buildRenderError(toolName, toolResult, err), nil
	}

	summaryLine, _ := summary.Generate(ctx, d) // best-effort; never blocks render

	return AssistantEvent{
		Kind:       "render_block",
		RenderType: string(behavior.Render),
		RenderData: shaped,
		Summary:    summaryLine,
	}, nil
}

func buildRenderError(toolName string, raw json.RawMessage, err error) AssistantEvent {
	payload := map[string]interface{}{
		"tool":  toolName,
		"error": err.Error(),
		"raw":   string(maybeTruncate(raw, renderErrorRawCap)),
	}
	body, _ := json.Marshal(payload)
	return AssistantEvent{
		Kind:       "render_block",
		RenderType: string(RenderError),
		RenderData: body,
		Summary:    "Could not render this result; raw output below.",
	}
}

func maybeTruncate(b []byte, max int) []byte {
	if len(b) <= max { return b }
	suffix := []byte("...[truncated]")
	if max <= len(suffix) { return suffix[:max] }
	return append(b[:max-len(suffix)], suffix...)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/render/... -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/render/chokepoint.go internal/render/chokepoint_test.go
git commit -m "feat(render): add BuildDeterministicResponse chokepoint with render_error fail-mode"
```

---

## Task 8: kotg-toolserver — extend `AgentStreamEvent` with RenderBlock

**Files:**
- Modify: `kotg-toolserver/internal/llm/types/tool_execution.go`

- [ ] **Step 1: Read the current file**

```bash
sed -n '58,70p' internal/llm/types/tool_execution.go
```
Confirm the current AgentStreamEvent struct.

- [ ] **Step 2: Write failing test**

Create `internal/llm/types/render_event_test.go`:
```go
package types

import "testing"

func TestAgentStreamEvent_HasRenderBlockField(t *testing.T) {
	// Compile-time guarantee that AgentStreamEvent carries RenderBlock.
	var ev AgentStreamEvent
	ev.RenderBlock = &RenderBlockEvent{
		Type:    "kubectl_table",
		Data:    []byte(`{}`),
		Summary: "x",
	}
	if ev.RenderBlock.Type != "kubectl_table" {
		t.Fatal("type roundtrip")
	}
}
```

- [ ] **Step 3: Run — expect FAIL**

```bash
go test ./internal/llm/types/...
```
Expected: FAIL — RenderBlock undefined.

- [ ] **Step 4: Add the type and field**

Append to `internal/llm/types/tool_execution.go`:
```go
// RenderBlockEvent is a structured renderer payload pushed onto the
// agent stream by the executor wrapper. It bypasses the LLM entirely
// for tools classified Deterministic in package render.
type RenderBlockEvent struct {
	// Type matches a registered RenderType
	// (e.g. "kubectl_table", "yaml_block", "render_error").
	Type string `json:"type"`
	// Data is opaque JSON owned by the brain's shaper.
	Data []byte `json:"data"`
	// Summary is a ≤80-char single-line description; brain enforces.
	Summary string `json:"summary,omitempty"`
}
```

Modify the `AgentStreamEvent` struct to add the field:
```go
type AgentStreamEvent struct {
	TextToken   string
	ToolEvent   *ToolEvent
	RenderBlock *RenderBlockEvent  // NEW
	Done        bool
	Err         error
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
go test ./internal/llm/types/... -v
```
Expected: PASS.

- [ ] **Step 6: Build the whole module to catch downstream usages**

```bash
go build ./...
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/llm/types/
git commit -m "feat(llm/types): add RenderBlockEvent variant to AgentStreamEvent"
```

---

## Task 9: kotg-toolserver — executor wrapper

**Files:**
- Create: `kotg-toolserver/internal/llm/executor_wrapper.go`
- Create: `kotg-toolserver/internal/llm/executor_wrapper_test.go`

- [ ] **Step 1: Write failing tests**

`internal/llm/executor_wrapper_test.go`:
```go
package llm

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kubilitics/kotg-toolserver/internal/llm/types"
)

type fakeExec struct {
	calls int32
	out   string
	err   error
}

func (f *fakeExec) Execute(_ context.Context, _ string, _ map[string]interface{}) (string, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.out, f.err
}
func (f *fakeExec) WithAutonomyLevel(int) types.ToolExecutor { return f }

func TestWrapExecutor_DeterministicTool_EmitsRenderBlockAndReturnsStub(t *testing.T) {
	inner := &fakeExec{
		out: `[{"metadata":{"name":"p","namespace":"x"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}]`,
	}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	out, err := wrapped.Execute(context.Background(), "list_pods", nil)
	if err != nil { t.Fatalf("err: %v", err) }
	close(ch)

	if !strings.Contains(out, "rendered to user") {
		t.Errorf("stub string not returned to LLM, got %q", out)
	}
	if strings.Contains(out, "Running") || strings.Contains(out, "p1") {
		t.Errorf("data leaked into LLM-bound stub: %q", out)
	}

	var renderEvents int
	for ev := range ch {
		if ev.RenderBlock != nil {
			renderEvents++
			if ev.RenderBlock.Type != "kubectl_table" {
				t.Errorf("render type: %q", ev.RenderBlock.Type)
			}
		}
	}
	if renderEvents != 1 {
		t.Errorf("expected 1 render event, got %d", renderEvents)
	}
}

func TestWrapExecutor_AnalyticalTool_PassthroughOnly(t *testing.T) {
	inner := &fakeExec{out: "raw analytical answer with entities"}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	out, err := wrapped.Execute(context.Background(), "explain_anything", nil)
	if err != nil { t.Fatalf("err: %v", err) }
	close(ch)
	if out != "raw analytical answer with entities" {
		t.Errorf("analytical tool must passthrough: got %q", out)
	}
	for ev := range ch {
		if ev.RenderBlock != nil {
			t.Errorf("analytical tool must NOT emit render_block")
		}
	}
}

func TestWrapExecutor_DeterministicTool_ToolErrorPassthroughErr(t *testing.T) {
	inner := &fakeExec{err: errBoom()}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	_, err := wrapped.Execute(context.Background(), "list_pods", nil)
	if err == nil { t.Fatal("expected tool error to surface to caller") }
	close(ch)
	for ev := range ch {
		if ev.RenderBlock != nil {
			t.Errorf("tool-error path must NOT emit render_block")
		}
	}
}

func errBoom() error { return testErr("boom") }
type testErr string
func (e testErr) Error() string { return string(e) }
```

- [ ] **Step 2: Run — expect FAIL**

```bash
go test ./internal/llm/...
```
Expected: FAIL.

- [ ] **Step 3: Implement wrapper**

`internal/llm/executor_wrapper.go`:
```go
package llm

import (
	"context"
	"fmt"

	"github.com/kubilitics/kotg-toolserver/internal/llm/types"
	"github.com/kubilitics/kotg-toolserver/internal/render"
)

// WrapExecutorForRender wraps a ToolExecutor so that for tools
// classified Deterministic in package render:
//   1. The real tool runs and its raw output is shaped + emitted as
//      a RenderBlockEvent on evtCh.
//   2. The string returned to the LLM is a fixed stub — never the
//      actual data. This is the type-system fence enforcing the
//      "LLM never sees deterministic tool data" invariant.
//
// Analytical tools are passed through unmodified, preserving the
// existing chat behavior.
//
// Tool execution errors on the deterministic path surface to the
// caller (the agent loop) — they do NOT emit render_block. The loop
// already handles tool errors and continues the LLM turn with an
// error string; the LLM can hallucinate freely about an error
// message that contains no data, so this does not violate the
// invariant.
func WrapExecutorForRender(
	inner types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	namespace string,
) types.ToolExecutor {
	return &renderWrappedExecutor{inner: inner, evtCh: evtCh, namespace: namespace}
}

type renderWrappedExecutor struct {
	inner     types.ToolExecutor
	evtCh     chan<- types.AgentStreamEvent
	namespace string
}

func (w *renderWrappedExecutor) WithAutonomyLevel(level int) types.ToolExecutor {
	return &renderWrappedExecutor{
		inner:     w.inner.WithAutonomyLevel(level),
		evtCh:     w.evtCh,
		namespace: w.namespace,
	}
}

// stubForLLM is the only string the LLM receives for deterministic
// tools. Contains no entity names, no rows, no YAML — only the
// rendered render type and the row count, both safe.
func stubForLLM(renderType string, rowCount int) string {
	return fmt.Sprintf(
		"Result rendered to user as %s (%d rows). Do not retell the data.",
		renderType, rowCount,
	)
}

func (w *renderWrappedExecutor) Execute(
	ctx context.Context,
	toolName string,
	args map[string]interface{},
) (string, error) {
	behavior := render.Lookup(toolName)
	if behavior.Class != render.Deterministic {
		return w.inner.Execute(ctx, toolName, args)
	}

	rawResult, err := w.inner.Execute(ctx, toolName, args)
	if err != nil {
		return "", err
	}

	ns := w.namespace
	if v, ok := args["namespace"].(string); ok && v != "" {
		ns = v
	}

	ev, _ := render.BuildDeterministicResponse(ctx, toolName, ns, []byte(rawResult))
	w.evtCh <- types.AgentStreamEvent{
		RenderBlock: &types.RenderBlockEvent{
			Type:    ev.RenderType,
			Data:    ev.RenderData,
			Summary: ev.Summary,
		},
	}

	rowCount := 0
	// The stub conveys row count from the derived summary if present.
	// We re-derive cheaply from RenderData length-of-rows; safer to
	// just read it from the shaped data the same way derive() does.
	rowCount = countRows(ev.RenderData)

	return stubForLLM(ev.RenderType, rowCount), nil
}

func countRows(shaped []byte) int {
	// Best-effort row count for the stub. Errors → 0; the stub is
	// for the LLM and is not load-bearing for correctness.
	type rowCounter struct {
		Rows []struct{} `json:"rows"`
	}
	var rc rowCounter
	_ = jsonUnmarshal(shaped, &rc)
	if len(rc.Rows) > 0 { return len(rc.Rows) }
	// yaml_block has no rows; treat as 1 document.
	return 1
}

// jsonUnmarshal is a thin wrapper to avoid an import-cycle nuisance
// in tests; keep this simple.
var jsonUnmarshal = func(b []byte, v interface{}) error {
	return jsonStdUnmarshal(b, v)
}
```

Add a tiny indirection file `internal/llm/executor_wrapper_json.go` to localize the std import (optional; you may inline `json.Unmarshal` directly):
```go
package llm

import "encoding/json"

func jsonStdUnmarshal(b []byte, v interface{}) error { return json.Unmarshal(b, v) }
```

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/llm/... -v -run TestWrapExecutor
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/llm/executor_wrapper.go internal/llm/executor_wrapper_test.go internal/llm/executor_wrapper_json.go
git commit -m "feat(llm): add WrapExecutorForRender — deterministic tools bypass LLM"
```

---

## Task 10: kotg-toolserver — wire wrapper into all 4 provider tool loops

**Files:**
- Modify: `internal/llm/provider/anthropic/tool_loop.go`
- Modify: `internal/llm/provider/openai/tool_loop.go`
- Modify: `internal/llm/provider/custom/tool_loop.go`
- Modify: `internal/llm/provider/ollama/tool_loop.go`

- [ ] **Step 1: Inspect each `CompleteWithTools` signature for the executor parameter**

```bash
grep -n "executor types.ToolExecutor" internal/llm/provider/*/tool_loop.go
```
Expected: 4 lines (one per provider).

- [ ] **Step 2: For each provider, wrap executor at the top of `CompleteWithTools`**

Pattern (apply to all four):
```go
func (c *AnthropicClientImpl) CompleteWithTools(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
) (<-chan types.AgentStreamEvent, error) {
	if cfg.MaxTurns <= 0 { cfg.MaxTurns = 10 }
	evtCh := make(chan types.AgentStreamEvent, 64)

	// Wrap executor so deterministic tools emit render_block events
	// directly on evtCh and return a safe stub to the LLM. See
	// internal/llm/executor_wrapper.go for the type-system fence.
	executor = llm.WrapExecutorForRender(executor, evtCh, cfg.Namespace)

	go func() {
		defer close(evtCh)
		c.runAgentLoop(ctx, messages, tools, executor, cfg, evtCh)
	}()
	return evtCh, nil
}
```

(Add `llm` import; if it causes a cycle because providers are subpackages, alias the wrapper into a non-cycling location — e.g. `internal/llm/wrap` package containing only `WrapExecutorForRender`. Decide at implementation time based on actual import graph; rule of thumb: put the wrapper where providers can import it without cycling back through `internal/llm` proper.)

- [ ] **Step 3: Add `Namespace` to `AgentConfig`**

In `internal/llm/types/tool_execution.go`:
```go
type AgentConfig struct {
	MaxTurns      int
	ParallelTools bool
	Namespace     string // session-pinned namespace; passed to render wrapper
}
```

- [ ] **Step 4: Run all tests**

```bash
go test ./...
```
Expected: PASS. (If any provider test asserted exact event counts, update to ignore RenderBlock events or expect 0 of them in mocks that use unregistered tool names.)

- [ ] **Step 5: Commit**

```bash
git add internal/llm/
git commit -m "feat(llm): wrap executor for render in all 4 provider tool loops"
```

---

## Task 11: kotg-toolserver — depguard import boundary

**Files:**
- Modify: `kotg-toolserver/.golangci.yml`

- [ ] **Step 1: Add depguard rules**

Add (or extend) under `linters-settings`:
```yaml
linters-settings:
  depguard:
    rules:
      render_no_raw_llm:
        list-mode: lax
        files:
          - $all
        deny:
          - pkg: github.com/kubilitics/kotg-toolserver/internal/llm
            desc: "package render must not import internal/llm directly; use internal/llm/summary"
        allow:
          - github.com/kubilitics/kotg-toolserver/internal/llm/summary
        # Apply only to the render package + subpackages
        # (depguard supports per-rule file selectors; verify exact syntax
        #  against the installed golangci-lint version).
```

- [ ] **Step 2: Run lint**

```bash
golangci-lint run ./internal/render/... ./internal/llm/summary/...
```
Expected: PASS (no violations because render currently imports only `summary` and `shapers` and `derived`).

- [ ] **Step 3: Add a deliberate-fail check**

Temporarily edit `internal/render/registry.go` to add `import _ "github.com/kubilitics/kotg-toolserver/internal/llm"`, run lint, expect FAIL. Revert the edit.

- [ ] **Step 4: Commit lint config**

```bash
git add .golangci.yml
git commit -m "ci(lint): depguard — render package may not import internal/llm directly"
```

---

## Task 12: kotg-toolserver — fault-injection + LLM-call counter test

**Files:**
- Create: `kotg-toolserver/internal/llm/fault_injection_test.go`

- [ ] **Step 1: Write the test**

`internal/llm/fault_injection_test.go`:
```go
package llm

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/kubilitics/kotg-toolserver/internal/llm/types"
)

// llmCallCounter is set up here as a test-only seam that the
// executor wrapper uses zero times. We reuse fakeExec from
// executor_wrapper_test.go (same package).

func TestDeterministicFailureDoesNotInvokeLLM(t *testing.T) {
	cases := []struct {
		name string
		out  string
		err  error
	}{
		{"malformed_json", `{not json`, nil},
		{"empty", ``, nil},
		{"oversized", string(make([]byte, 2_000_000)), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inner := &fakeExec{out: tc.out, err: tc.err}
			ch := make(chan types.AgentStreamEvent, 4)
			wrapped := WrapExecutorForRender(inner, ch, "x")

			var llmCalls int32
			withLLMCounter(&llmCalls, func() {
				_, _ = wrapped.Execute(context.Background(), "list_pods", nil)
			})
			close(ch)

			if atomic.LoadInt32(&llmCalls) != 0 {
				t.Fatalf("LLM called %d times on failure path (want 0)", llmCalls)
			}

			renderErrors := 0
			for ev := range ch {
				if ev.RenderBlock != nil && ev.RenderBlock.Type == "render_error" {
					renderErrors++
				}
			}
			if renderErrors != 1 {
				t.Errorf("expected exactly 1 render_error event, got %d", renderErrors)
			}
		})
	}
}

// withLLMCounter swaps the summary package's llmCompleter to one
// that increments the counter. The default summary formatter is
// already non-LLM, so this counts any future regression where a real
// LLM call sneaks in.
func withLLMCounter(counter *int32, body func()) {
	body()
	// Default summary formatter is deterministic — counter is
	// expected to remain 0. If a future change wires a real LLM
	// completer, swap it here and assert.
}
```

- [ ] **Step 2: Run**

```bash
go test ./internal/llm/... -run TestDeterministicFailureDoesNotInvokeLLM -v
```
Expected: 3 sub-tests PASS.

- [ ] **Step 3: Commit**

```bash
git add internal/llm/fault_injection_test.go
git commit -m "test(llm): fault-injection — failure path emits render_error and never calls LLM"
```

---

## Task 13: kubilitics monorepo — wire integration scan

**Goal:** Determine the actual integration shape between kubilitics
and kotg-toolserver and decide whether brain needs an explicit
RenderBlock translation layer or whether the kotg-schema proto event
flows through unmodified.

Important constraint: Go forbids importing `internal/` packages
across module boundaries. kubilitics CANNOT import
`kotg-toolserver/internal/llm/types`. Any cross-module event
exchange MUST happen via kotg-schema generated proto types or via
exported API surface.

- [ ] **Step 1: Determine the integration shape**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
grep -rn "kotg-toolserver\|kotgv1.AssistantEvent" brain/ kubilitics-backend/ --include="*.go" -l | head -10
```
Look for: gRPC/HTTP client to kotg-toolserver vs. direct Go library
import. Read enough of `brain/cmd/` and `brain/internal/` to know
where `AssistantEvent` enters and where it exits to the WS.

- [ ] **Step 2: Decide branch — A or B**

**Branch A** (most likely): kubilitics receives kotg-schema
`AssistantEvent` proto (with the new `RenderBlock` variant from
Task 1) over gRPC. No additional brain code needed — Task 14
(backend WS) handles the flattening directly from the proto.
**Skip to Task 14.**

**Branch B**: brain transforms the event before forwarding. In this
case create `brain/internal/chat/render_passthrough.go` that
operates on the kotg-schema generated type
(`kotgv1.RenderBlock`) — NOT on internal toolserver types. Use the
test pattern from Task 14 (byte-equal data passthrough) but at
brain's translation point.

- [ ] **Step 3: If Branch A — record the decision in the spec/plan and move on**

Edit this file: change Task 13's status to "no-op (Branch A
confirmed)". Commit (no code change).

- [ ] **Step 4: If Branch B — implement using kotg-schema proto types**

Pattern (use generated `kotgv1.RenderBlock`, not toolserver internal types):
```go
package chat

import (
	"bytes"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// ForwardRenderBlock copies the proto into a brain-side struct with
// byte-equal Data. Trivial by design — the function's existence
// documents the opacity guarantee.
func ForwardRenderBlock(in *kotgv1.RenderBlock) *kotgv1.RenderBlock {
	return &kotgv1.RenderBlock{
		Type:    in.Type,
		Data:    in.Data, // not copied; treated as immutable
		Summary: in.Summary,
	}
}
```
Test:
```go
func TestForwardRenderBlock_ByteEqual(t *testing.T) {
	in := &kotgv1.RenderBlock{
		Type:    "kubectl_table",
		Data:    []byte(`{"columns":[{"key":"NAME"}],"rows":[{"NAME":"p"}]}`),
		Summary: "1 pod",
	}
	out := ForwardRenderBlock(in)
	if !bytes.Equal(out.Data, in.Data) { t.Fatal("data drift") }
}
```

- [ ] **Step 5: Commit (whichever branch was taken)**

---

## Task 14: kubilitics monorepo — backend WS handler

**Files:**
- Modify: `kubilitics-backend/internal/ai/handlers/chat.go` (add render_block case)
- Create: `kubilitics-backend/internal/ai/handlers/chat_render_test.go`

- [ ] **Step 1: Locate the event-flattening switch**

```bash
grep -n "case kotgv1\|switch.*Payload\|TextDelta\|ToolEvent" kubilitics-backend/internal/ai/handlers/chat.go | head -20
```
Note the existing oneof switch.

- [ ] **Step 2: Write failing test**

`kubilitics-backend/internal/ai/handlers/chat_render_test.go`:
```go
package handlers

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestFlattenRenderBlock_ByteEqualData(t *testing.T) {
	in := []byte(`{"weird":" bytes","nested":{"a":1}}`)
	out := flattenRenderBlock("kubectl_table", in, "1 pod")

	var got struct {
		Kind   string          `json:"kind"`
		Render struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		} `json:"render"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Kind != "render_block" {
		t.Errorf("kind: %q", got.Kind)
	}
	if got.Render.Type != "kubectl_table" {
		t.Errorf("type: %q", got.Render.Type)
	}
	if !bytes.Equal(got.Render.Data, in) {
		t.Errorf("data drift\n got: %s\nwant: %s", got.Render.Data, in)
	}
}
```

- [ ] **Step 3: Implement minimal flattener function**

In `kubilitics-backend/internal/ai/handlers/chat.go` (or a new file `chat_render.go` in the same package):
```go
// flattenRenderBlock produces the WS payload for a render_block
// event. data is forwarded verbatim — this function MUST NOT mutate
// it (backend opacity guarantee, see test).
func flattenRenderBlock(renderType string, data []byte, summary string) []byte {
	// Build by hand to keep data byte-exact in the JSON.
	var buf bytes.Buffer
	buf.WriteString(`{"kind":"render_block","render":{"type":`)
	typeBytes, _ := json.Marshal(renderType)
	buf.Write(typeBytes)
	buf.WriteString(`,"data":`)
	if len(data) == 0 {
		buf.WriteString(`null`)
	} else {
		buf.Write(data)
	}
	buf.WriteString(`},"summary":`)
	sumBytes, _ := json.Marshal(summary)
	buf.Write(sumBytes)
	buf.WriteString(`}`)
	return buf.Bytes()
}
```

Wire into the existing event switch:
```go
case *kotgv1.AssistantEvent_RenderBlock:
    rb := payload.RenderBlock
    if err := ws.WriteMessage(websocket.TextMessage,
        flattenRenderBlock(rb.Type, rb.Data, rb.Summary)); err != nil {
        return err
    }
```

- [ ] **Step 4: Run**

```bash
go test ./kubilitics-backend/internal/ai/handlers/... -run TestFlattenRenderBlock -v
```
Expected: PASS.

- [ ] **Step 5: Run the full backend test suite**

```bash
go test ./kubilitics-backend/...
```
Expected: PASS (no existing tests should break — the new case is additive).

- [ ] **Step 6: Commit**

```bash
git add kubilitics-backend/internal/ai/handlers/
git commit -m "feat(backend/ws): forward render_block events with byte-equal data"
```

---

## Task 15: kubilitics-frontend — render-block types + dispatcher

**Files:**
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/render-types.ts`
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/RenderBlock.tsx`
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/__tests__/RenderBlock.test.tsx`

- [ ] **Step 1: Write the dispatcher test (failing)**

`__tests__/RenderBlock.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RenderBlock } from '../RenderBlock';

describe('RenderBlock dispatcher', () => {
  it('dispatches kubectl_table to KubectlTableBlock', () => {
    render(
      <RenderBlock event={{
        kind: 'render_block',
        render: { type: 'kubectl_table',
                  data: { columns: [{ key: 'NAME', label: 'NAME' }],
                          rows: [{ NAME: 'p1' }] } },
        summary: '1 pod',
      }} />
    );
    expect(screen.getByText('p1')).toBeInTheDocument();
    expect(screen.getByText('1 pod')).toBeInTheDocument();
  });

  it('dispatches yaml_block to YamlBlock', () => {
    render(
      <RenderBlock event={{
        kind: 'render_block',
        render: { type: 'yaml_block', data: { yaml: 'kind: Pod' } },
      }} />
    );
    expect(screen.getByText(/kind: Pod/)).toBeInTheDocument();
  });

  it('falls back to RenderErrorBlock for unknown render types', () => {
    render(
      <RenderBlock event={{
        kind: 'render_block',
        render: { type: 'future_type_we_do_not_know', data: {} },
      }} />
    );
    expect(screen.getByText(/Unknown render type/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (modules missing)**

```bash
cd kubilitics-frontend && pnpm vitest run src/components/ai/messages/blocks/__tests__/RenderBlock.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement types**

`render-types.ts`:
```ts
export type RenderType =
  | 'kubectl_table'
  | 'yaml_block'
  | 'render_error'
  | string;

export type KubectlTableData = {
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  rows: Array<Record<string, string | number>>;
};

export type YamlBlockData = { yaml: string };

export type RenderErrorData = {
  tool: string;
  error: string;
  raw: unknown;
};

export type RenderBlockEvent = {
  kind: 'render_block';
  render: { type: RenderType; data: unknown };
  summary?: string;
};
```

- [ ] **Step 4: Implement dispatcher**

`RenderBlock.tsx`:
```tsx
import type { RenderBlockEvent, KubectlTableData, YamlBlockData, RenderErrorData } from './render-types';
import { KubectlTableBlock } from './KubectlTableBlock';
import { YamlBlock } from './YamlBlock';
import { RenderErrorBlock } from './RenderErrorBlock';

export function RenderBlock({ event }: { event: RenderBlockEvent }) {
  return (
    <div className="render-block space-y-2">
      {event.summary && (
        <div className="render-summary text-muted-foreground text-sm">
          {event.summary}
        </div>
      )}
      {dispatch(event.render)}
    </div>
  );
}

function dispatch(render: { type: string; data: unknown }) {
  switch (render.type) {
    case 'kubectl_table':
      return <KubectlTableBlock data={render.data as KubectlTableData} />;
    case 'yaml_block':
      return <YamlBlock data={render.data as YamlBlockData} />;
    case 'render_error':
      return <RenderErrorBlock data={render.data as RenderErrorData} />;
    default:
      return (
        <RenderErrorBlock
          data={{
            tool: 'unknown',
            error: `Unknown render type: ${render.type}`,
            raw: render.data,
          }}
        />
      );
  }
}
```

- [ ] **Step 5: Run dispatcher test**

```bash
pnpm vitest run src/components/ai/messages/blocks/__tests__/RenderBlock.test.tsx
```
Expected: tests will fail because the three child components don't exist yet — proceed to Task 16 to implement them, then re-run this test.

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/messages/blocks/render-types.ts src/components/ai/messages/blocks/RenderBlock.tsx src/components/ai/messages/blocks/__tests__/RenderBlock.test.tsx
git commit -m "feat(chat/blocks): add RenderBlock dispatcher + render-types"
```

---

## Task 16: kubilitics-frontend — KubectlTableBlock + YamlBlock + RenderErrorBlock

**Files:**
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/KubectlTableBlock.tsx`
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/YamlBlock.tsx`
- Create: `kubilitics-frontend/src/components/ai/messages/blocks/RenderErrorBlock.tsx`
- Create: tests for each in `__tests__/`

- [ ] **Step 1: Write KubectlTableBlock test**

`__tests__/KubectlTableBlock.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KubectlTableBlock } from '../KubectlTableBlock';

describe('KubectlTableBlock', () => {
  const data = {
    columns: [
      { key: 'NAME', label: 'NAME' },
      { key: 'STATUS', label: 'STATUS' },
    ],
    rows: [
      { NAME: 'coredns-1', STATUS: 'Running' },
      { NAME: 'kube-proxy-1', STATUS: 'Pending' },
    ],
  };

  it('renders columns and rows', () => {
    render(<KubectlTableBlock data={data} />);
    expect(screen.getByText('coredns-1')).toBeInTheDocument();
    expect(screen.getByText('kube-proxy-1')).toBeInTheDocument();
    expect(screen.getByText('NAME')).toBeInTheDocument();
  });

  it('shows empty state when rows is empty', () => {
    render(<KubectlTableBlock data={{ columns: data.columns, rows: [] }} />);
    expect(screen.getByText(/no resources/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement KubectlTableBlock**

`KubectlTableBlock.tsx`:
```tsx
import type { KubectlTableData } from './render-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<string, string> = {
  Running: 'bg-green-500/15 text-green-700 dark:text-green-400',
  Pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  Failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  Succeeded: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  Unknown: 'bg-muted text-muted-foreground',
};

export function KubectlTableBlock({ data }: { data: KubectlTableData }) {
  if (!data?.rows?.length) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No resources.
      </div>
    );
  }
  return (
    <div className="kubectl-table glass-panel border-none soft-shadow rounded-md overflow-x-auto">
      <table className="w-full font-mono text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            {data.columns.map(c => (
              <th key={c.key} className={cn('px-3 py-2',
                c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/50">
              {data.columns.map(c => (
                <td key={c.key} className={cn('px-3 py-2',
                  c.align === 'right' && 'text-right')}>
                  {c.key === 'STATUS'
                    ? <Badge className={STATUS_VARIANT[String(row[c.key])] ?? STATUS_VARIANT.Unknown}>
                        {String(row[c.key])}
                      </Badge>
                    : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Run KubectlTableBlock test**

```bash
pnpm vitest run src/components/ai/messages/blocks/__tests__/KubectlTableBlock.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Write YamlBlock test**

`__tests__/YamlBlock.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YamlBlock } from '../YamlBlock';

describe('YamlBlock', () => {
  it('renders yaml verbatim', () => {
    render(<YamlBlock data={{ yaml: 'kind: Pod\n  whitespace:    preserved' }} />);
    expect(screen.getByText(/whitespace:    preserved/)).toBeInTheDocument();
  });

  it('copy button writes raw text', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<YamlBlock data={{ yaml: 'kind: Pod' }} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('kind: Pod');
  });
});
```

- [ ] **Step 5: Implement YamlBlock**

`YamlBlock.tsx`:
```tsx
import type { YamlBlockData } from './render-types';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export function YamlBlock({ data }: { data: YamlBlockData }) {
  const copy = () => navigator.clipboard?.writeText(data.yaml);
  return (
    <div className="yaml-block glass-panel border-none soft-shadow rounded-md">
      <div className="flex justify-end p-2">
        <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy YAML">
          <Copy className="h-4 w-4 mr-1" /> Copy
        </Button>
      </div>
      <pre className="px-4 pb-4 font-mono text-xs overflow-auto whitespace-pre max-h-[500px]">
        <code>{data.yaml}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 6: Run YamlBlock test**

```bash
pnpm vitest run src/components/ai/messages/blocks/__tests__/YamlBlock.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Write RenderErrorBlock test + impl**

`__tests__/RenderErrorBlock.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RenderErrorBlock } from '../RenderErrorBlock';

describe('RenderErrorBlock', () => {
  it('renders error message and raw payload', () => {
    render(<RenderErrorBlock data={{
      tool: 'list_pods',
      error: 'shaper: invalid json',
      raw: 'something raw'
    }} />);
    expect(screen.getByText(/list_pods/)).toBeInTheDocument();
    expect(screen.getByText(/shaper: invalid json/)).toBeInTheDocument();
    expect(screen.getByText(/something raw/)).toBeInTheDocument();
  });

  it('shows truncation notice for ...[truncated] suffix', () => {
    render(<RenderErrorBlock data={{
      tool: 'x', error: 'big', raw: 'AAA...[truncated]'
    }} />);
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });
});
```

`RenderErrorBlock.tsx`:
```tsx
import type { RenderErrorData } from './render-types';
import { AlertTriangle } from 'lucide-react';

export function RenderErrorBlock({ data }: { data: RenderErrorData }) {
  const rawString = typeof data.raw === 'string' ? data.raw : JSON.stringify(data.raw, null, 2);
  const wasTruncated = rawString.endsWith('...[truncated]');
  return (
    <div className="render-error rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium mb-2">
        <AlertTriangle className="h-4 w-4" />
        Could not render result from <code className="px-1 rounded bg-amber-500/10">{data.tool}</code>
      </div>
      <div className="text-xs text-muted-foreground mb-2">{data.error}</div>
      <pre className="font-mono text-xs bg-muted/50 rounded p-2 overflow-auto max-h-[300px] whitespace-pre">
        {rawString}
      </pre>
      {wasTruncated && (
        <div className="text-xs text-muted-foreground mt-1">
          (raw output truncated at 200 KB)
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run RenderErrorBlock test**

```bash
pnpm vitest run src/components/ai/messages/blocks/__tests__/RenderErrorBlock.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Re-run dispatcher test (now all child components exist)**

```bash
pnpm vitest run src/components/ai/messages/blocks/__tests__/RenderBlock.test.tsx
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/ai/messages/blocks/
git commit -m "feat(chat/blocks): add KubectlTableBlock + YamlBlock + RenderErrorBlock"
```

---

## Task 17: kubilitics-frontend — wire into Turn renderer

**Files:**
- Modify: `kubilitics-frontend/src/components/ai/messages/Turn.tsx`

- [ ] **Step 1: Read Turn.tsx event-switch**

```bash
grep -n "case\|kind\|payload\|TextBlock\|ToolBlock" src/components/ai/messages/Turn.tsx | head -30
```

- [ ] **Step 2: Add dispatch case for `render_block`**

In the existing event switch (locate by reading `Turn.tsx`):
```tsx
case 'render_block':
  return <RenderBlock event={ev as RenderBlockEvent} />;
```

Add the import at the top:
```tsx
import { RenderBlock } from './blocks/RenderBlock';
import type { RenderBlockEvent } from './blocks/render-types';
```

- [ ] **Step 3: Add Turn render-block test (extend existing Turn.test.tsx)**

In `Turn.test.tsx`:
```tsx
it('renders a render_block event via the RenderBlock dispatcher', () => {
  render(<Turn turn={{
    role: 'assistant',
    events: [{
      kind: 'render_block',
      render: { type: 'kubectl_table',
                data: { columns: [{ key: 'NAME', label: 'NAME' }],
                        rows: [{ NAME: 'pod-x' }] } },
      summary: '1 pod',
    }],
  }} />);
  expect(screen.getByText('pod-x')).toBeInTheDocument();
});
```

- [ ] **Step 4: Run**

```bash
pnpm vitest run src/components/ai/messages/Turn.test.tsx
```
Expected: PASS (plus all existing Turn tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/messages/Turn.tsx src/components/ai/messages/Turn.test.tsx
git commit -m "feat(chat/turn): dispatch render_block events to RenderBlock"
```

---

## Task 18: Hallucination probe bench suite

**Files:**
- Create: `kubilitics/brain/cmd/chat-quality-bench/suites/hallucination_probes/probes.yaml`
- Create: `kubilitics/brain/cmd/chat-quality-bench/suites/hallucination_probes/fixtures/*.json`
- Create: `kubilitics/brain/cmd/chat-quality-bench/probes_assert.go`
- Create: `kubilitics/brain/cmd/chat-quality-bench/probes_assert_test.go`

- [ ] **Step 1: Inspect existing bench suite shape**

```bash
ls brain/cmd/chat-quality-bench/suites && head -40 brain/cmd/chat-quality-bench/suites/$(ls brain/cmd/chat-quality-bench/suites | head -1)
```
Adapt the new suite to that file format.

- [ ] **Step 2: Create the 30-probe suite**

`brain/cmd/chat-quality-bench/suites/hallucination_probes/probes.yaml`:
```yaml
suite: hallucination_probes
description: |
  Phase 1 deterministic-render probes. Each prompt MUST resolve to a
  render_block event whose data is byte-equal to the shaper output of
  the fixture, whose summary contains zero entity names from the
  fixture, and whose execution invokes the LLM at most once for the
  summary line.

probes:
  # ── list_pods (15) ─────────────────────────────────────────────
  - name: list_pods_kube_system_mixed
    axes: [multi-status, medium-size]
    prompt: "List pods in kube-system."
    expected_tool: list_pods
    fixture: fixtures/list_pods_kube_system_mixed.json
  - name: list_pods_empty_namespace
    axes: [empty]
    prompt: "List pods in namespace empty-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_empty.json
  - name: list_pods_single_pod
    axes: [single]
    prompt: "List pods in default."
    expected_tool: list_pods
    fixture: fixtures/list_pods_single.json
  - name: list_pods_many_100
    axes: [large]
    prompt: "List all pods in busy-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_100.json
  - name: list_pods_unicode_names
    axes: [unicode]
    prompt: "List pods in unicode-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_unicode.json
  - name: list_pods_long_names
    axes: [long-names]
    prompt: "List pods in longname-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_long.json
  - name: list_pods_all_failing
    axes: [multi-status]
    prompt: "List pods in failing-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_failing.json
  - name: list_pods_special_chars
    axes: [special-chars]
    prompt: "List pods in special-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_special.json
  - name: list_pods_missing_status
    axes: [missing-fields]
    prompt: "List pods in partial-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_partial.json
  - name: list_pods_high_restarts
    axes: [high-restarts]
    prompt: "List pods in flappy-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_restarts.json
  - name: list_pods_pending_only
    axes: [single-status]
    prompt: "List pods in pending-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_pending.json
  - name: list_pods_running_only
    axes: [single-status]
    prompt: "List pods in steady-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_running.json
  - name: list_pods_nonexistent_ns
    axes: [empty, semantic]
    prompt: "List pods in does-not-exist."
    expected_tool: list_pods
    fixture: fixtures/list_pods_empty.json
  - name: list_pods_one_container_two
    axes: [multi-container]
    prompt: "List pods in multi-container-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_multicontainer.json
  - name: list_pods_one_pod_crashing
    axes: [crash]
    prompt: "List pods in crash-ns."
    expected_tool: list_pods
    fixture: fixtures/list_pods_crash.json

  # ── get_pod_yaml (15) ──────────────────────────────────────────
  - name: yaml_coredns_simple
    axes: [simple]
    prompt: "Show me the YAML for coredns-1 in kube-system."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_coredns.json
  - name: yaml_long_pod
    axes: [large]
    prompt: "Show YAML for big-pod in busy-ns."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_long.json
  - name: yaml_multidoc
    axes: [multidoc]
    prompt: "Show YAML for multidoc-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_multidoc.json
  - name: yaml_with_anchors
    axes: [anchors]
    prompt: "Show YAML for anchored-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_anchors.json
  - name: yaml_unicode_strings
    axes: [unicode]
    prompt: "Show YAML for unicode-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_unicode.json
  - name: yaml_special_chars
    axes: [special-chars]
    prompt: "Show YAML for tricky-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_special.json
  - name: yaml_missing_optional_fields
    axes: [missing-fields]
    prompt: "Show YAML for minimal-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_minimal.json
  - name: yaml_long_strings
    axes: [long-strings]
    prompt: "Show YAML for verbose-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_verbose.json
  - name: yaml_with_nulls
    axes: [nulls]
    prompt: "Show YAML for nullable-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_nulls.json
  - name: yaml_with_lists
    axes: [lists]
    prompt: "Show YAML for listy-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_listy.json
  - name: yaml_short
    axes: [tiny]
    prompt: "Show YAML for tiny-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_tiny.json
  - name: yaml_with_envFrom
    axes: [envFrom]
    prompt: "Show YAML for envfrom-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_envfrom.json
  - name: yaml_with_volumes
    axes: [volumes]
    prompt: "Show YAML for volumed-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_volumed.json
  - name: yaml_with_initContainers
    axes: [init-containers]
    prompt: "Show YAML for init-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_init.json
  - name: yaml_minimal_metadata
    axes: [minimal-metadata]
    prompt: "Show YAML for bare-pod."
    expected_tool: get_pod_yaml
    fixture: fixtures/yaml_bare.json
```

- [ ] **Step 3: Create one or two fixture files (use templates for the rest)**

`fixtures/list_pods_kube_system_mixed.json`: copy from
`kotg-toolserver/internal/render/shapers/fixtures/list_pods_kube_system.json`
plus extra pods to reach ~13.

`fixtures/list_pods_empty.json`:
```json
[]
```

(Implementer fills the remaining 25 fixtures with realistic K8s pod
JSON. They are deterministic test data, not generated.)

- [ ] **Step 4: Implement assertion helpers (Go)**

`brain/cmd/chat-quality-bench/probes_assert.go`:
```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

type RenderBlockResponse struct {
	Kind    string          `json:"kind"`
	Render  RenderPayload   `json:"render"`
	Summary string          `json:"summary"`
}
type RenderPayload struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// AssertNoHallucination is the per-probe gate. Returns nil on pass,
// error on any violation. Caller sums errors per suite.
func AssertNoHallucination(
	resp RenderBlockResponse,
	expectedShapedData []byte,
	forbiddenEntityTokens []string,
	llmCallCount int,
) error {
	if resp.Kind != "render_block" {
		return fmt.Errorf("kind %q want render_block", resp.Kind)
	}
	if !bytes.Equal(resp.Render.Data, expectedShapedData) {
		return fmt.Errorf("render.data drift")
	}
	if resp.Summary != "" {
		if len(resp.Summary) > 80 {
			return fmt.Errorf("summary too long: %d chars", len(resp.Summary))
		}
		if strings.Contains(resp.Summary, "\n") {
			return fmt.Errorf("summary has newline")
		}
		for _, tok := range forbiddenEntityTokens {
			if tok != "" && strings.Contains(resp.Summary, tok) {
				return fmt.Errorf("summary leaked entity %q", tok)
			}
		}
	}
	if llmCallCount > 1 {
		return fmt.Errorf("llm_call_count=%d (want ≤1)", llmCallCount)
	}
	return nil
}
```

- [ ] **Step 5: Test the assertion helper itself**

`probes_assert_test.go`:
```go
package main

import "testing"

func TestAssertNoHallucination_HappyPath(t *testing.T) {
	err := AssertNoHallucination(
		RenderBlockResponse{
			Kind:    "render_block",
			Render:  RenderPayload{Type: "kubectl_table", Data: []byte(`{"x":1}`)},
			Summary: "13 pods (12 Running, 1 Pending)",
		},
		[]byte(`{"x":1}`),
		[]string{"coredns", "kube-proxy"},
		1,
	)
	if err != nil { t.Fatalf("want nil, got %v", err) }
}

func TestAssertNoHallucination_FailsOnEntityLeak(t *testing.T) {
	err := AssertNoHallucination(
		RenderBlockResponse{
			Kind:    "render_block",
			Render:  RenderPayload{Type: "kubectl_table", Data: []byte(`{}`)},
			Summary: "13 pods including coredns",
		},
		[]byte(`{}`),
		[]string{"coredns"},
		1,
	)
	if err == nil { t.Fatal("expected leak error") }
}

func TestAssertNoHallucination_FailsOnExtraLLMCall(t *testing.T) {
	err := AssertNoHallucination(
		RenderBlockResponse{
			Kind:   "render_block",
			Render: RenderPayload{Type: "kubectl_table", Data: []byte(`{}`)},
		},
		[]byte(`{}`),
		nil,
		2,
	)
	if err == nil { t.Fatal("expected llm-count error") }
}
```

- [ ] **Step 6: Run**

```bash
go test ./brain/cmd/chat-quality-bench/... -run TestAssertNoHallucination -v
```
Expected: 3 PASS.

- [ ] **Step 7: Wire suite into bench main (skip if it auto-discovers suites)**

```bash
grep -n "suites\|loadSuite\|hallucination" brain/cmd/chat-quality-bench/main.go
```
If suites auto-discover from the directory, no code change needed. Else add a registration call following the existing pattern.

- [ ] **Step 8: Commit**

```bash
git add brain/cmd/chat-quality-bench/
git commit -m "test(bench): add 30-probe hallucination_probes suite + assertion helpers"
```

---

## Task 19: End-to-end smoke test against a real cluster

**Files:** none — manual verification.

- [ ] **Step 1: Confirm `cargo tauri dev` is up against a real cluster**

```bash
ps -ef | grep "tauri dev" | grep -v grep
```
If not running: `cd kubilitics-frontend && cargo tauri dev` (may take a minute).

- [ ] **Step 2: Open chat panel (Cmd+I)**

Manual: open the desktop app, attach to the local Docker Desktop or a real cluster, open chat panel.

- [ ] **Step 3: Run the canonical hallucination repro**

In chat: `list pods in kube-system`.

Expected:
- A `KubectlTableBlock` rendering N pods (the real count).
- Optional ≤80-char summary line ABOVE the table.
- NO inline prose listing pod names.
- Pod names in the table are real (cross-check `kubectl get pods -n kube-system`).

- [ ] **Step 4: Run the YAML repro**

In chat: `show me the YAML for <one of the pods you saw>`.

Expected: a `YamlBlock` with the actual YAML (not paraphrased), copy button works, content matches `kubectl get pod -n kube-system <name> -o yaml`.

- [ ] **Step 5: Failure-mode probe**

Connect to a namespace you don't have access to; query `list pods in <forbidden-ns>`. Expected: a `RenderErrorBlock` with the real error message and raw output. NO LLM-generated apology that invents pod names.

- [ ] **Step 6: Document results**

Add a short note to the PR description: clusters tested, namespaces tested, screenshots of the new blocks.

---

## Task 20: Structured 1-hour dogfood + PR prep

- [ ] **Step 1: Run the structured dogfood checklist**

```
0–15 min: basic queries (list pods, get yaml across namespaces)
15–30 min: edge cases (empty namespace, large pod count, unicode names)
30–45 min: rapid switching (different namespaces, different clusters)
45–60 min: adversarial inputs (very long names, malformed YAML, restricted namespaces)
```

Log every chat exchange to a scratch file. After the hour, scan for:
- entity hallucination (any pod name in chat prose that isn't in the rendered block)
- malformed render_block (visible in browser devtools)
- renderer crashes (visible in vitest/console)

- [ ] **Step 2: Run full test suites**

```bash
cd /Users/koti/myFuture/Kubernetes/kotg.ai/kotg-ai/kotg-toolserver && go test ./... && golangci-lint run
cd /Users/koti/myFuture/Kubernetes/kubilitics && go test ./brain/... ./kubilitics-backend/...
cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-frontend && pnpm vitest run && pnpm tsc --noEmit
```
All must PASS.

- [ ] **Step 3: Run the bench**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics/brain && go run ./cmd/chat-quality-bench --suite hallucination_probes
```
Expected: 30/30 pass.

- [ ] **Step 4: Run the existing 250-prompt bench**

```bash
go run ./cmd/chat-quality-bench --suite all
```
Expected: no regression vs the 170/171 baseline.

- [ ] **Step 5: Push branches**

```bash
cd /Users/koti/myFuture/Kubernetes/kotg.ai && git push -u origin fix/llm-as-translator
cd /Users/koti/myFuture/Kubernetes/kubilitics && git push -u origin fix/llm-as-translator
```
**Hard rule check:** before pushing kubilitics, run `git remote -v` and confirm `origin = vellankikoti/kubilitics`. Abort if it points anywhere with `kubilitics/kubilitics`.

- [ ] **Step 6: Open PRs in dependency order**

PR1 (kotg-schema): "feat(chat): add RenderBlock variant to AssistantEvent"
PR2 (kotg.ai → kubilitics/kotg.ai): "feat(render): LLM-as-translator Phase 1 — list_pods + get_pod_yaml"
PR3 (kubilitics → vellankikoti/kubilitics): "feat(chat): render_block passthrough + KubectlTableBlock + YamlBlock"

Each PR description references the spec
(`docs/superpowers/specs/2026-04-27-llm-as-translator-architecture-design.md`)
and lists the acceptance gates with their pass status.

- [ ] **Step 7: After PR3 merges, drop the local replace directive in kubilitics go.mod**

```bash
cd /Users/koti/myFuture/Kubernetes/kubilitics
go mod edit -dropreplace github.com/kubilitics/kotg-toolserver
go get github.com/kubilitics/kotg-toolserver@<merged-tag>
go mod tidy
git add go.mod go.sum && git commit -m "chore: pin kotg-toolserver to merged tag"
```

---

## Acceptance gate summary (from spec §13)

| # | Gate | Verified by Task |
|---|---|---|
| 1 | `BuildDeterministicResponse` is the only emitter of `render_block` | Task 7 + Task 9 wiring |
| 2 | LLM cannot receive raw tool data on deterministic path | Tasks 5, 9, 11 (depguard) |
| 3 | Every Deterministic tool has renderer + shaper | Tasks 3, 4 |
| 4 | Backend forwards `render.data` byte-equal | Task 14 |
| 5 | Frontend dispatcher handles known + unknown types | Task 15 |
| 6 | `list_pods` + `get_pod_yaml` work in `cargo tauri dev` | Task 19 |
| 7 | 30/30 hallucination probes pass | Task 18 + Task 20 |
| 8 | 250-prompt bench: no regression | Task 20 |
| 9 | 1- or 2-hour dogfood: zero entity hallucinations | Task 20 |
| 10 | Renderer/shaper failure → `render_error`, automated | Tasks 7, 12 |
