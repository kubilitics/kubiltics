// Bridge between the existing internal/llm/adapter.LLMAdapter
// (CompleteStream / CompleteWithTools signatures) and the runtime
// LLMProvider / LLMToolProvider interfaces.
package runtime

import (
	"context"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/adapter"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/types"
)

// LLMAdapterBridge wraps an existing LLMAdapter so it satisfies LLMProvider
// (text-only streaming) AND LLMToolProvider (the agentic loop). The engine
// picks the tool path when both Tools+Executor are configured; otherwise it
// falls back to the text-only path so existing tests keep working.
type LLMAdapterBridge struct {
	A adapter.LLMAdapter

	// Tools + Executor are optional. When both are set, the engine wires
	// CompleteWithTools as the streaming path. Set via cmd/server/main.go
	// after the MCP server has registered its tool taxonomy.
	Tools    []types.Tool
	Executor types.ToolExecutor

	// AgentCfg overrides the agentic-loop limits (MaxTurns, ParallelTools).
	// Zero value yields types.DefaultAgentConfig().
	AgentCfg types.AgentConfig
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

// StreamCompletionWithTools runs the multi-turn agentic loop via
// adapter.CompleteWithTools and translates its AgentStreamEvent values into
// runtime.toolStreamEvent so the engine never imports internal/llm/types.
func (b *LLMAdapterBridge) StreamCompletionWithTools(
	ctx context.Context,
	prompt string,
) (<-chan toolStreamEvent, error) {
	if b.Executor == nil {
		// Should never happen — engine guards before calling this method.
		return nil, adapter.ErrProviderNotConfigured
	}
	cfg := b.AgentCfg
	if cfg.MaxTurns == 0 {
		cfg = types.DefaultAgentConfig()
	}
	src, err := b.A.CompleteWithTools(
		ctx,
		[]types.Message{{Role: "user", Content: prompt}},
		b.Tools,
		b.Executor,
		cfg,
	)
	if err != nil {
		return nil, err
	}
	out := make(chan toolStreamEvent, 16)
	go func() {
		defer close(out)
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
			select {
			case out <- te:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}
