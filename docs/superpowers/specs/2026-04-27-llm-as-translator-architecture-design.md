# LLM-as-Translator Architecture (Phase 1)

**Date:** 2026-04-27
**Status:** Spec — pending implementation plan
**Branch:** `fix/llm-as-translator` (in `vellankikoti/kubilitics`, `kubilitics/kotg.ai`, `vellankikoti/kotg-schema`)
**Predecessor:** `dca5c20c` — AI layer foundation merged on `main`
**Successor (separate spec, not this one):** kagent runtime as planner

---

## 1. Problem

The current chat flow is:

```
user asks → LLM picks tool → brain executes tool → tool returns JSON →
LLM PARAPHRASES the JSON into prose → user sees prose
```

The paraphrase step is where hallucination happens. Reproduced today
with Qwen2.5-7B-Instruct-Turbo: "list pods in kube-system" returned a
confidently fabricated list of 10 fake `coredns-5644d7b6b6-XXXX` pods
with a fake replicaset hash, when the cluster actually had 13 pods
(only 2 coredns). The tool returned correct data; the LLM ignored it
and wrote plausible-looking placeholders.

We do not need a better prompt or a better model. We need an
architecture in which **the LLM never sees deterministic tool data on
the response path**, so hallucination of facts is not unlikely — it is
mechanically impossible.

---

## 2. Core invariant

> **No byte of tool result data is ever passed into any LLM prompt on
> the deterministic path.**

Phrased operationally: for tools classified `Deterministic`, the brain
renders the tool result into a structured `render_block` event and
emits it directly. The LLM is permitted, at most, to produce a single
≤80-char `summary` line generated from a strictly typed
`DerivedSummary` struct (`tool_name`, `namespace`, `row_count`,
`status_breakdown`) — never the rows themselves.

The LLM is no longer a renderer. The brain is a translator from
domain data to UI shape, not a narrator.

---

## 3. Architecture

### 3.1 Path split

```
chat request
  ↓
LLM picks tool                 (existing planner — unchanged in Phase 1)
  ↓
brain executes tool via MCP
  ↓
ToolBehavior lookup
  ↓
  Class == Deterministic?
  ├─ YES → BuildDeterministicResponse(toolResult)
  │         ├─ shaper transforms raw → wire shape
  │         ├─ derives DerivedSummary (counts only, no entities)
  │         ├─ optional generateSummary(derived) — narrow LLM call
  │         └─ emits render_block event
  │         NEVER passes raw data to LLM ◄── invariant
  │
  └─ NO  → existing analytical path (unchanged in Phase 1)
```

### 3.2 Repo boundaries

| Repo | Branch | Responsibility |
|---|---|---|
| `vellankikoti/kotg-schema` | `fix/llm-as-translator` | Add `RenderBlock` variant to `AssistantEvent`. Patch tag. |
| `kubilitics/kotg.ai` (path: `kotg-ai/kotg-toolserver`) | `fix/llm-as-translator` | Registry, chokepoint, shapers, summary generator, structural + behavioral tests, hallucination probe bench. |
| `vellankikoti/kubilitics` | `fix/llm-as-translator` | Backend WS passthrough; frontend `render-blocks/` namespace; e2e tests. |

PR sequencing: schema → brain → app. `kotg-schema` pushes to
`vellankikoti/kotg-schema`. `kotg.ai` pushes to its own origin
(`kubilitics/kotg.ai`) — allowed. `kubilitics` pushes **only** to
`vellankikoti/kubilitics`; the org repo `kubilitics/kubilitics`
remains frozen at v1.0.0/v0.3.0.

### 3.3 Out of scope (parking lot)

- Replacing the planner with kagent runtime — separate spec.
- `stream_logs` and the streaming render envelope.
- Additional list-* tools (`list_services`, `list_deployments`, etc.)
  — trivial followups once `KubectlTableBlock` is proven.
- Sortable columns, copy-as-kubectl, virtualization in tables.
- YAML syntax highlighting (defer to plan-time codebase scan; ship
  plain `<pre>` if no highlighter is already present).
- Renaming existing chat block files into `protocol-blocks/` directory
  (cosmetic).
- Removing the "default Analytical" fallback for unmapped tools — it
  stays permanent.

---

## 4. Tool registry & classification

Located at `kotg-toolserver/internal/render/registry.go`.

```go
type Class string
type RenderType string

const (
    Deterministic Class = "deterministic"
    Analytical    Class = "analytical"
)

const (
    RenderKubectlTable RenderType = "kubectl_table"
    RenderYAMLBlock    RenderType = "yaml_block"
    RenderText         RenderType = "text"  // never emitted on deterministic path
)

type ToolBehavior struct {
    Class  Class
    Render RenderType
}

// Phase 1 registrations only.
var registry = map[string]ToolBehavior{
    "list_pods":    {Class: Deterministic, Render: RenderKubectlTable},
    "get_pod_yaml": {Class: Deterministic, Render: RenderYAMLBlock},
}

// Safe default: unknown → Analytical+Text. Preserves current behavior.
func Lookup(toolName string) ToolBehavior {
    if b, ok := registry[toolName]; ok { return b }
    return ToolBehavior{Class: Analytical, Render: RenderText}
}
```

The registry is the rollout throttle. Every new tool ships in
Analytical mode by default; flipping `Class: Deterministic` is the
explicit go-live action. Single-line rollback.

---

## 5. The chokepoint

```go
// Package render is the ONLY package permitted to construct render_block
// events. Importing this constructor from outside the chat dispatcher
// is enforced by an architecture test.
package render

type DeterministicResult struct {
    toolName   string
    renderType RenderType
    renderData json.RawMessage  // verbatim from the shaper, opaque to brain
    derived    DerivedSummary
}

// DerivedSummary lives in internal/derived (not render) to avoid an
// import cycle with internal/llm/summary. The type is the strict,
// exhaustive list of fields a summary LLM call may see. Adding a
// field requires updating the snapshot test.
//
// package derived
// type DerivedSummary struct {
//     ToolName        string         `json:"tool_name"`
//     Namespace       string         `json:"namespace,omitempty"`
//     RowCount        int            `json:"row_count"`
//     StatusBreakdown map[string]int `json:"status_breakdown,omitempty"`
// }

// BuildDeterministicResponse is the SINGLE chokepoint. No other function
// may emit a render_block event.
func BuildDeterministicResponse(
    ctx context.Context,
    toolName string,
    namespace string,
    toolResult json.RawMessage,
) (AssistantEvent, error) {
    behavior := Lookup(toolName)
    if behavior.Class != Deterministic {
        return AssistantEvent{}, ErrNotDeterministic
    }

    shaped, err := shape(toolName, toolResult)
    if err != nil {
        return buildRenderError(toolName, toolResult, err), nil  // §7
    }

    derived := derive(toolName, namespace, shaped)
    summary, _ := summary.Generate(ctx, derived)  // best-effort

    return AssistantEvent{
        Kind: KindRenderBlock,
        Render: RenderPayload{ Type: behavior.Render, Data: shaped },
        Summary: summary,
    }, nil
}
```

`namespace` comes from request context, never from the tool data.

---

## 6. LLM containment via package boundary

Three packages, depguard-enforced:

- `internal/derived` — defines `DerivedSummary` and nothing else. No
  imports. This breaks the would-be cycle between `render` and
  `summary` (both need the type).
- `internal/llm` — raw `Complete(ctx, prompt, opts...)`. Importable
  by the analytical path only. May NOT be imported by `render`,
  `summary`, or `derived`.
- `internal/llm/summary` — narrow API:
  `func Generate(ctx context.Context, d derived.DerivedSummary) (string, error)`.
  The only LLM symbol the `render` package may import. By type, this
  function physically cannot receive raw rows, YAML, or entity names.

Defense in depth:

| Layer | Mechanism | Catches |
|---|---|---|
| Type system | `DerivedSummary` is the only accepted input | Compile-time |
| Import boundary | `depguard` lint rule | Build/CI |
| Code-graph reachability | Test against code-review-graph MCP | CI |
| Behavioral bench | Hallucination probe suite | CI |

> "It should be harder to violate the invariant than to follow it."

---

## 7. Failure mode: render_error, never Analytical fallback

If the shaper fails, the derived computation panics, or the renderer
cannot construct, the response is a `render_error` block — **not** a
fallback to the Analytical (LLM-paraphrasing) path. Falling back to
Analytical would route the failed tool data through the LLM, which is
the bug we are eliminating.

```go
func buildRenderError(toolName string, raw json.RawMessage, err error) AssistantEvent {
    return AssistantEvent{
        Kind: KindRenderBlock,
        Render: RenderPayload{
            Type: "render_error",
            Data: mustJSON(map[string]any{
                "tool":  toolName,
                "error": err.Error(),
                "raw":   maybeTruncate(raw, 200_000),  // 200 KB cap
            }),
        },
        Summary: "Could not render this result; raw output below.",
    }
}
```

Frontend renders `render_error` as a code block with the raw JSON +
copy affordance. The user sees correct (if ugly) data. The LLM never
gets a chance to make up nicer-looking wrong data.

**Renderer bugs degrade UX, not correctness.**

---

## 8. Wire envelope

```json
{
  "kind": "render_block",
  "render": {
    "type": "kubectl_table",
    "data": { "columns": [...], "rows": [...] }
  },
  "summary": "13 pods in kube-system (12 Running, 1 Pending)."
}
```

`render.data` is `json.RawMessage` end-to-end. The kubilitics backend
WS handler MUST NOT unmarshal or mutate `render.data` — it forwards
the bytes verbatim. A backend test asserts byte-equality through the
passthrough.

---

## 9. Shapers

Per-tool transforms from raw K8s data → wire `data` field. Live in
`kotg-toolserver/internal/render/shapers/`. The only place per-tool
formatting lives. Deterministic — no LLM.

```go
// Phase 1 shapers
func ShapeListPods(raw json.RawMessage) (json.RawMessage, error) { ... }
func ShapeGetPodYaml(raw json.RawMessage) (json.RawMessage, error) { ... }

var shapers = map[string]func(json.RawMessage) (json.RawMessage, error){
    "list_pods":    ShapeListPods,
    "get_pod_yaml": ShapeGetPodYaml,
}
```

Coverage: every `Deterministic` tool MUST have a registered shaper.
Enforced by `TestDeterministicToolsHaveShapers`. Missing shaper at
runtime → `render_error` (not panic, not Analytical fallback).

`list_pods` shaper produces:
- columns: `NAME, READY, STATUS, RESTARTS, AGE`
- rows: one per pod, `READY` formatted as `n/m`, `AGE` humanized

`get_pod_yaml` shaper produces: `{ "yaml": "<string>" }`.

---

## 10. Frontend

### 10.1 Module layout

```
kubilitics-frontend/src/components/chat/render-blocks/
  RenderBlock.tsx          // dispatcher
  KubectlTableBlock.tsx
  YamlBlock.tsx
  RenderErrorBlock.tsx
  types.ts
  __tests__/
```

Existing `ToolBlock`, `PlanBlock`, `ActionPendingBlock` are
**protocol blocks** (agent/system thinking). The new namespace is for
**render blocks** (user-facing data output). They evolve
independently. Renaming the existing files into a `protocol-blocks/`
directory is a cosmetic followup, not blocking.

### 10.2 Dispatcher

```tsx
export function RenderBlock({ event }: { event: RenderBlockEvent }) {
  return (
    <div className="render-block">
      {event.summary && (
        <div className="render-summary text-muted-foreground text-sm mb-2">
          {event.summary}
        </div>
      )}
      {dispatch(event.render)}
    </div>
  );
}

function dispatch(render: { type: string; data: unknown }) {
  switch (render.type) {
    case 'kubectl_table': return <KubectlTableBlock data={render.data as KubectlTableData} />;
    case 'yaml_block':    return <YamlBlock data={render.data as YamlBlockData} />;
    case 'render_error':  return <RenderErrorBlock data={render.data as RenderErrorData} />;
    default:
      return <RenderErrorBlock data={{
        tool: 'unknown',
        error: `Unknown render type: ${render.type}`,
        raw: render.data,
      }} />;
  }
}
```

Unknown render types fall through to `RenderErrorBlock` —
forward-compatible, never silently dropped.

### 10.3 KubectlTableBlock

Phase 1 = correctness + visual parity with `kubectl get pods`.
Sortable columns, virtualization, copy-as-kubectl are followups.

Reuses existing design tokens (`glass-panel`, `soft-shadow`,
`border-none`) per `CLAUDE.md`. Status column uses the existing
`Badge` UI primitive with the K8s status color map.

### 10.4 YamlBlock

Plain `<pre>` with horizontal scroll, monospaced, max-height 500px,
copy button. Syntax highlighting decision deferred to plan-time
codebase scan: reuse if a highlighter (prism / shiki / highlight.js)
is already a project dependency; otherwise ship `<pre>`.

### 10.5 RenderErrorBlock

Renders `error` message + truncated `raw` JSON in a code block.
Truncation notice when payload was capped at 200 KB.

---

## 11. Backend passthrough

```go
case kotgv1.AssistantEvent_RenderBlock:
    // Opaque passthrough. We do NOT unmarshal render.data.
    ws.Write(flattenRenderBlock(ev))
```

Backend remains dumb. All transformation lives in the brain. All
rendering lives in the frontend. Backend exists only to move bytes.

---

## 12. Testing pyramid

| Layer | Tool | Catches | Blocking |
|---|---|---|---|
| Type system | `go build` | LLM seeing raw data | Yes (compile) |
| Import boundary | `depguard` lint | `render` importing `internal/llm` | Yes (CI) |
| Architecture invariants | Go unit tests | Coverage gaps | Yes (CI) |
| Code-graph reachability | code-review-graph MCP | Forbidden call edges | Yes (CI) |
| Behavioral bench | Hallucination probe suite | Drift, regressions | Yes (CI) |

### 12.1 Go architecture tests

1. `TestEveryDeterministicToolHasRenderer` — registry coverage.
2. `TestDeterministicToolsHaveShapers` — shaper coverage.
3. `TestGenerateSummarySignatureRejectsRawData` — type-fence
   documentation test (compile-time guarantee).
4. `TestDeterministicPathHasNoEdgeToLLMClient` — code-graph
   reachability via code-review-graph MCP.
5. `TestRenderBlockBackendIsByteEqualPassthrough` — backend opacity.
6. `TestBuildDeterministicResponseRefusesAnalyticalTools` — chokepoint
   refuses misuse.
7. `TestDerivedSummarySchemaIsExhaustive` — DerivedSummary fields
   snapshot; new field requires snapshot update (forces code review).
8. `TestDeterministicFailureDoesNotFallbackToLLM` — automated fault
   injection: malformed tool result, shaper error, oversized payload,
   each must produce `render_error` AND record zero LLM calls.
9. `TestRenderDataSizeLimitEnforced` — brain caps `render.data`
   payload size before emit; oversized → `render_error` with
   truncated raw.

### 12.2 Frontend tests (Vitest + RTL)

1. `RenderBlock.test.tsx` — dispatches each known type to the correct
   renderer; unknown types render `RenderErrorBlock`.
2. `KubectlTableBlock.test.tsx` — columns/rows fixture; empty state;
   `StatusBadge` for known statuses; snapshot vs golden shaper output
   shared with brain.
3. `YamlBlock.test.tsx` — verbatim render; copy button copies raw
   text (not innerText, which mangles whitespace).
4. `RenderErrorBlock.test.tsx` — error + raw payload; truncation
   notice when payload >200 KB.

### 12.3 Hallucination probe bench

Lives at `kubilitics/brain/cmd/chat-quality-bench/suites/hallucination_probes/`.
Extends the existing 250-prompt bench (per
`project_chat_quality_bench_results`).

**30 probes for Phase 1** — 15 `list_pods`, 15 `get_pod_yaml`. Each
probe is tagged with coverage axes so future expansion to 50+ is gap-aware.

```python
{
  "name": "pods_mixed_status",
  "axes": ["multi-status", "medium-size"],
  "prompt": "...",
  "expected_tool": "list_pods",
  "fixture": "fixtures/pods_mixed.json",
}
```

Coverage axes covered in the 30:
- cardinality: empty, single, many (100+)
- status diversity: all-running, mixed, all-failing
- formatting: long names, special chars, unicode
- structural: missing optional fields, multi-doc YAML, anchors
- semantics: non-existent namespace, restricted namespace

**Per-prompt assertions (all must pass, 100% threshold, CI-blocking):**

```python
def assert_no_hallucination(response, tool_result, llm_call_count):
    assert response.kind == "render_block"

    # Byte-equal data passthrough.
    expected = shape(response.tool_name, tool_result)
    assert response.render.data == expected, "data drift"

    # Summary constraints.
    if response.summary:
        assert len(response.summary) <= 80
        assert "\n" not in response.summary

        forbidden = extract_entity_names(tool_result)
        for token in forbidden:
            assert token not in response.summary, f"summary leaked entity: {token}"

        allowed_numbers = {response.derived.row_count,
                           *response.derived.status_breakdown.values()}
        for num in extract_numbers(response.summary):
            assert num in allowed_numbers, f"summary mentions unknown number: {num}"

    # Hidden-LLM-call guard.
    assert llm_call_count <= 1, "deterministic path made >1 LLM call"
```

The `llm_call_count` assertion is the hidden-regression guard: any
future code path that smuggles an extra LLM call into the deterministic
flow trips this.

---

## 13. Acceptance gates

The spec is shippable when ALL hold:

| # | Gate | Verified by |
|---|---|---|
| 1 | `BuildDeterministicResponse` is the only emitter of `render_block` events | Architecture test |
| 2 | LLM cannot receive raw tool data on the deterministic path | Type system + depguard + arch test |
| 3 | Every `Deterministic` tool has a renderer + shaper | Tests |
| 4 | Backend forwards `render.data` byte-equal | Test |
| 5 | Frontend dispatcher handles all known types + `RenderErrorBlock` for unknown | Frontend test |
| 6 | `list_pods` and `get_pod_yaml` work end-to-end in `cargo tauri dev` against a real cluster | Manual e2e |
| 7 | Hallucination probe bench: 30/30 pass | CI bench job |
| 8 | Existing 250-prompt bench: no regression vs baseline (170/171) | CI bench job |
| 9 | 2-hour live dogfood (or structured 1-hour) — zero hallucinated entity names in deterministic responses | Logged session review |
| 10 | Renderer/shaper failure → `render_error` block, automated fault injection passes | Test #8 |

Structured 1-hour dogfood, if used:

```
0–15 min: basic queries (list pods, get yaml across namespaces)
15–30 min: edge cases (empty namespace, large pod count, unicode names)
30–45 min: rapid switching (different namespaces, different clusters)
45–60 min: adversarial inputs (very long names, malformed YAML, restricted namespaces)
```

Every deterministic response logged. Post-session scan for entity
hallucination, malformed render_block, renderer crashes.

---

## 14. Cross-repo PR sequencing

```
1. kotg-schema  →  add render_block variant to AssistantEvent → patch tag
2. kotg.ai      →  registry + chokepoint + shapers + tests + bench
3. kubilitics   →  backend passthrough + frontend render-blocks + e2e
```

All three branches named `fix/llm-as-translator`. Merge in order;
each downstream consumer pins the upstream tag. `kubilitics` pushes
ONLY to `vellankikoti/kubilitics`. Org repo
`github.com/kubilitics/kubilitics` remains frozen until explicit
unfreeze.

---

## 15. What this unlocks

- **Today's user-visible bug (hallucinated coredns pods) is impossible
  by construction.** Not "rare" — impossible.
- **A foundation kagent inherits for free.** When Problem 2 (kagent as
  planner) is built in a future spec, the rendering contract is
  already defined. kagent just becomes another producer of tool calls;
  the deterministic path renders its results identically.
- **A clean home for every future renderer.** `stream_logs`, topology
  graphs, metrics charts, alert tables — they all become
  `RenderType`s in a registry that already enforces correctness.
- **Operator-grade UI.** Tool data flows to the user as structured,
  copyable, exact data. The chat is no longer "AI prose" — it is
  `kubectl` with conversational intent on top.
