// llmEngine wraps the existing LLMAdapterBridge as a router.Engine. v1
// ships with this as the only engine; 3c/3d will add kagent/Python
// engines alongside it.
package runtime

import (
	"context"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/router"
)

// llmEngine adapts an LLMProvider to router.Engine.
type llmEngine struct {
	llm LLMProvider
}

// NewLLMEngine returns an Engine that streams TextDelta events from a single
// LLM provider call. Used by cmd/server/main.go to register the LLM-direct
// path with the Router.
func NewLLMEngine(llm LLMProvider) router.Engine {
	return &llmEngine{llm: llm}
}

func (e *llmEngine) Name() string { return "llm" }

func (e *llmEngine) Stream(ctx context.Context, req router.Request) (<-chan router.Event, error) {
	out := make(chan router.Event, 16)

	prompt := req.Text
	if req.ContextHint != "" {
		prompt = req.Text + "\n\n[context: " + req.ContextHint + "]"
	}

	tokens, err := e.llm.StreamCompletion(ctx, prompt)
	if err != nil {
		out <- router.Event{Kind: router.KindError, Code: "llm_error", Message: err.Error()}
		out <- router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"}
		close(out)
		return out, nil
	}

	go func() {
		defer close(out)
		var partial bool
		for chunk := range tokens {
			if ctx.Err() != nil {
				partial = true
				break
			}
			select {
			case out <- router.Event{Kind: router.KindTextDelta, Text: chunk}:
			case <-ctx.Done():
				partial = true
			}
			if partial {
				break
			}
		}
		finish := "stop"
		if partial {
			finish = "cancel"
		}
		out <- router.Event{
			Kind:         router.KindDone,
			Partial:      partial,
			Cancelled:    partial,
			FinishReason: finish,
		}
	}()
	return out, nil
}
