package runtime

import (
	"context"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/adapter"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/types"
)

// LLMAdapterBridge adapts the existing internal/llm/adapter.LLMAdapter (which
// has a tool-aware multi-message API) into the minimal runtime.LLMProvider
// surface (single prompt → token stream) needed by the v1 AgentRuntimeService
// stub.
type LLMAdapterBridge struct {
	A adapter.LLMAdapter
}

// StreamCompletion implements LLMProvider by wrapping the prompt as a single
// user message with no tools and forwarding the underlying text channel.
func (b *LLMAdapterBridge) StreamCompletion(ctx context.Context, prompt string) (<-chan string, error) {
	msgs := []types.Message{{Role: "user", Content: prompt}}
	textCh, toolCh, err := b.A.CompleteStream(ctx, msgs, nil)
	if err != nil {
		return nil, err
	}
	// Drain (and discard) the tool channel so the underlying stream does not
	// block on an unconsumed buffered send.
	go func() {
		for range toolCh {
		}
	}()
	return textCh, nil
}
