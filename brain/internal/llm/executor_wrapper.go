package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
	"github.com/vellankikoti/kubilitics/brain/internal/render"
)

// WrapExecutorForRender wraps a ToolExecutor so that for tools
// classified Deterministic in package render:
//  1. The real tool runs and its raw output is shaped + emitted as
//     a RenderBlockEvent on evtCh.
//  2. The string returned to the LLM is a fixed stub — never the
//     actual data. This is the type-system fence enforcing the
//     "LLM never sees deterministic tool data" invariant.
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
// shape of what was rendered + behaviour guidance.
//
// Phase 2 #2 redesign: the previous wording ("Result rendered to user
// as yaml_block...") let the LLM treat the surface as a hidden log and
// suggest "I would typically use kubectl get pod ..." as if the user
// hadn't seen anything. The new wording:
//
//   1. Affirms present-tense visibility ("the user is now viewing…")
//   2. Types the rendered shape humanly per render type
//   3. Explicitly forbids suggesting kubectl/CLI alternatives
//
// `kind` (e.g. "Pod") comes from the LLM's own tool args and is
// echoed back as plain English ("table of 13 pods"). Echoing the
// LLM's own input is not a hallucination vector.
func stubForLLM(renderType string, rowCount int, kind string) string {
	const guidance = "Acknowledge briefly in one short sentence — " +
		"do NOT restate the data, " +
		"do NOT suggest running kubectl or any other CLI, " +
		"the user has the full result on screen."

	var what string
	switch renderType {
	case "kubectl_table":
		if kind != "" {
			what = fmt.Sprintf("a table of %d %s", rowCount, pluralKind(kind, rowCount))
		} else {
			what = fmt.Sprintf("a table of %d rows", rowCount)
		}
	case "yaml_block":
		what = "the full YAML document"
	case "render_error":
		what = "an error message explaining what could not be rendered"
	default:
		// Forward-compat for future render types — name the type so the
		// LLM can react sensibly even before this switch is updated.
		what = fmt.Sprintf("a %s with %d rows", renderType, rowCount)
	}
	return fmt.Sprintf("The user is now viewing %s above this message. %s", what, guidance)
}

// pluralKind formats a Kubernetes kind for inline reading:
// "Pod" + 1 → "pod"; "Pod" + 13 → "pods"; "StatefulSet" + 2 →
// "statefulsets". Pure formatting — never leaks data.
func pluralKind(kind string, n int) string {
	s := strings.ToLower(kind)
	if n == 1 {
		return s
	}
	if strings.HasSuffix(s, "s") {
		return s
	}
	return s + "s"
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

	// Recover the K8s kind from the LLM's own tool args so the stub
	// can read naturally ("a table of 13 pods" vs "a table of 13 rows").
	// Echoing the LLM's input back to itself is not a hallucination
	// vector; row data is still gated by BuildDeterministicResponse.
	kind, _ := args["kind"].(string)
	return stubForLLM(ev.RenderType, countRows(ev.RenderData), kind), nil
}

// countRows is a best-effort row count for the LLM stub. It reads
// only "rows" array length — never names, never values. yaml_block
// has no rows; treat as 1 document. Errors silently → 0.
func countRows(shaped []byte) int {
	type rowCounter struct {
		Rows []struct{} `json:"rows"`
	}
	var rc rowCounter
	_ = json.Unmarshal(shaped, &rc)
	if len(rc.Rows) > 0 {
		return len(rc.Rows)
	}
	return 1
}
