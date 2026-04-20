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
//
// When focusClusterID is non-empty, two things happen:
//  1. A system message is prepended instructing the LLM to always pass
//     cluster_id on tool calls that accept one.
//  2. The executor is wrapped with clusterIDInjectingExecutor so that any
//     tool call missing a cluster_id gets the focus id injected BEFORE the
//     tool handler runs. This is the authoritative defense — gpt-4o-mini
//     ignores the schema-level "optional" description enough that we cannot
//     rely on the LLM alone.
func (b *LLMAdapterBridge) StreamCompletionWithTools(
	ctx context.Context,
	focusClusterID string,
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
	msgs := make([]types.Message, 0, 2)
	executor := b.Executor
	if focusClusterID != "" {
		if sys := BuildSystemPrompt(focusClusterID); sys != "" {
			msgs = append(msgs, types.Message{Role: "system", Content: sys})
		}
		executor = &clusterIDInjectingExecutor{inner: b.Executor, clusterID: focusClusterID}
	}
	msgs = append(msgs, types.Message{Role: "user", Content: prompt})
	src, err := b.A.CompleteWithTools(
		ctx,
		msgs,
		b.Tools,
		executor,
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

// clusterIDInjectingExecutor wraps a ToolExecutor and guarantees that every
// tool call carries a non-empty cluster_id argument. If the LLM omits
// cluster_id (or passes an empty string), the focus cluster from the chat
// session is injected before the inner handler runs. This prevents the
// handler's "first registered cluster" fallback from silently routing tool
// calls to the wrong cluster when the LLM ignores the schema hint.
type clusterIDInjectingExecutor struct {
	inner     types.ToolExecutor
	clusterID string
}

func (e *clusterIDInjectingExecutor) Execute(ctx context.Context, toolName string, args map[string]interface{}) (string, error) {
	if args == nil {
		args = map[string]interface{}{}
	}
	if v, ok := args["cluster_id"].(string); !ok || v == "" {
		args["cluster_id"] = e.clusterID
	}
	return e.inner.Execute(ctx, toolName, args)
}

func (e *clusterIDInjectingExecutor) WithAutonomyLevel(level int) types.ToolExecutor {
	return &clusterIDInjectingExecutor{inner: e.inner.WithAutonomyLevel(level), clusterID: e.clusterID}
}
