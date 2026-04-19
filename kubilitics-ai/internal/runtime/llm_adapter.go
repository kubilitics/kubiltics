// Bridge between the existing internal/llm/adapter.LLMAdapter
// (CompleteStream signature) and the runtime.LLMProvider interface.
package runtime

import (
	"context"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/adapter"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/types"
)

// LLMAdapterBridge wraps an existing LLMAdapter so it satisfies LLMProvider.
type LLMAdapterBridge struct {
	A adapter.LLMAdapter
}

func (b *LLMAdapterBridge) StreamCompletion(ctx context.Context, prompt string) (<-chan string, error) {
	textCh, toolCh, err := b.A.CompleteStream(ctx, []types.Message{{Role: "user", Content: prompt}}, nil)
	if err != nil {
		return nil, err
	}
	// Drain unused tool channel to avoid blocking the producer.
	if toolCh != nil {
		go func() {
			for range toolCh {
			}
		}()
	}
	return textCh, nil
}
