package llm

import (
	"context"
	"encoding/json"
	"fmt"

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

	return stubForLLM(ev.RenderType, countRows(ev.RenderData)), nil
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
