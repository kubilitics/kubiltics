package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/summary"
	"github.com/vellankikoti/kubilitics/brain/internal/render/shapers"
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
const MaxRenderDataBytes = 1_000_000 // 1 MB
const renderErrorRawCap = 200_000    // 200 KB

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
	if len(b) <= max {
		return b
	}
	suffix := []byte("...[truncated]")
	if max <= len(suffix) {
		return suffix[:max]
	}
	out := make([]byte, max)
	copy(out, b[:max-len(suffix)])
	copy(out[max-len(suffix):], suffix)
	return out
}
