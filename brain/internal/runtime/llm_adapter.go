// Bridge between the existing internal/llm/adapter.LLMAdapter
// (CompleteStream / CompleteWithTools signatures) and the runtime
// LLMProvider / LLMToolProvider interfaces.
package runtime

import (
	"context"
	"sync"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/accounting"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/adapter"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/toolrouter"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
	"github.com/vellankikoti/kubilitics/brain/internal/tracing/routing"
)

// LLMAdapterBridge wraps an existing LLMAdapter so it satisfies LLMProvider
// (text-only streaming) AND LLMToolProvider (the agentic loop). The engine
// picks the tool path when both Tools+Executor are configured; otherwise it
// falls back to the text-only path so existing tests keep working.
//
// The underlying adapter is held behind a RWMutex because the brain's
// HTTP POST /api/v1/config/provider endpoint lets the user change LLM
// provider at runtime (e.g. pasting a new key in AI Settings). Streaming
// calls from the gRPC engine happen concurrently with that hot-wire.
// Use .Adapter() to read and .SetAdapter() to swap; direct field access
// on A is preserved for backward compatibility but is NOT thread-safe —
// prefer the methods in new code.
type LLMAdapterBridge struct {
	mu sync.RWMutex
	A  adapter.LLMAdapter

	// Tools + Executor are optional. When both are set, the engine wires
	// CompleteWithTools as the streaming path. Set via cmd/server/main.go
	// after the MCP server has registered its tool taxonomy.
	Tools    []types.Tool
	Executor types.ToolExecutor

	// AgentCfg overrides the agentic-loop limits (MaxTurns, ParallelTools).
	// Zero value yields types.DefaultAgentConfig().
	AgentCfg types.AgentConfig

	// ToolRouter, when non-nil, filters b.Tools per request so the LLM
	// receives only the subset relevant to the latest user question. This
	// is the single largest lever we have against schema-token bloat: 163
	// tools × ~150 tokens each = ~25K tokens burned per turn before the
	// user's question even lands. A topic-aware filter trims that to a
	// handful of relevant tools plus the always-on core set.
	ToolRouter toolrouter.Router
}

// Adapter returns the current underlying adapter. Returns nil when no
// adapter has been configured yet — callers must nil-check before use.
// Safe for concurrent access with SetAdapter.
func (b *LLMAdapterBridge) Adapter() adapter.LLMAdapter {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.A
}

// SetAdapter swaps the underlying adapter. Called by the brain's
// runtime config endpoint when the user saves a new provider/key/model
// in AI Settings — the bridge picks up the new adapter on the next
// Stream* call without needing a full brain restart.
func (b *LLMAdapterBridge) SetAdapter(a adapter.LLMAdapter) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.A = a
}

// Complete is a one-shot text completion suitable for short auxiliary
// prompts (e.g. the summary line under render blocks — Phase 2 #5).
//
// Returns "" + nil (NOT an error) when no adapter is configured so
// best-effort callers like summary.NewLLMCompleter can fall back to
// their deterministic path without surfacing a confusing error to the
// chat UI.
//
// The bridge satisfies summary.SummaryLLM by virtue of having this
// method — no extra wrapper type needed in cmd/server/main.go.
func (b *LLMAdapterBridge) Complete(ctx context.Context, prompt string) (string, error) {
	a := b.Adapter()
	if a == nil {
		return "", nil
	}
	msgs := []types.Message{{Role: "user", Content: prompt}}
	text, _, err := a.Complete(ctx, msgs, nil)
	return text, err
}

func (b *LLMAdapterBridge) StreamCompletion(ctx context.Context, prompt string) (<-chan string, error) {
	a := b.Adapter()
	if a == nil {
		return nil, adapter.ErrProviderNotConfigured
	}
	textCh, toolCh, err := a.CompleteStream(ctx, []types.Message{{Role: "user", Content: prompt}}, nil)
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
	a := b.Adapter()
	if a == nil {
		// No provider configured yet (user hasn't saved AI Settings).
		// Return a clear error; the engine surfaces this to the chat stream.
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
	promptBytes := 0
	for _, m := range msgs {
		promptBytes += len(m.Content)
	}

	tools := b.Tools
	if b.ToolRouter != nil && len(tools) > 0 {
		sel := b.ToolRouter.SelectTools(prompt, tools)
		topicNames := make([]string, len(sel.Topics))
		for i, t := range sel.Topics {
			topicNames[i] = string(t)
		}
		routing.FromContext(ctx).Stage("tool_filter", map[string]any{
			"selected_topics": topicNames,
			"tool_count":      len(sel.Tools),
			"total_available": len(tools),
		})
		tools = sel.Tools
	}
	routing.FromContext(ctx).Stage("llm_prompt_in", map[string]any{
		"messages":      len(msgs),
		"bytes":         promptBytes,
		"has_system":    focusClusterID != "",
		"focus_cluster": focusClusterID,
	})
	src, err := a.CompleteWithTools(
		ctx,
		msgs,
		tools,
		executor,
		cfg,
	)
	if err != nil {
		return nil, err
	}
	out := make(chan toolStreamEvent, 16)
	go func() {
		defer close(out)
		start := time.Now()
		var textBytes int
		// Capture the first ~4 KB of assistant text so the bench report can
		// show the actual answer a user would have seen, not just a byte
		// count. Bounded to keep traces small.
		const textPreviewCap = 4096
		var textPreview []byte
		var lastUsage *toolTokenUsage
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
			if ev.RenderBlock != nil {
				te.RenderBlock = &renderBlockEvent{
					Type:    ev.RenderBlock.Type,
					Data:    ev.RenderBlock.Data,
					Summary: ev.RenderBlock.Summary,
				}
			}
			if ev.TokenUsage != nil {
				te.TokenUsage = &toolTokenUsage{
					InputTokens:  ev.TokenUsage.PromptTokens,
					OutputTokens: ev.TokenUsage.CompletionTokens,
				}
				lastUsage = te.TokenUsage
			}
			if ev.TextToken != "" {
				textBytes += len(ev.TextToken)
				if len(textPreview) < textPreviewCap {
					remaining := textPreviewCap - len(textPreview)
					if len(ev.TextToken) <= remaining {
						textPreview = append(textPreview, ev.TextToken...)
					} else {
						textPreview = append(textPreview, ev.TextToken[:remaining]...)
					}
				}
			}
			select {
			case out <- te:
			case <-ctx.Done():
				return
			}
		}
		textOut := map[string]any{"bytes": textBytes}
		if len(textPreview) > 0 {
			textOut["preview"] = string(textPreview)
		}
		routing.FromContext(ctx).Stage("llm_text_out", textOut)

		durationMs := time.Since(start).Milliseconds()
		routing.FromContext(ctx).Stage("done", map[string]any{
			"duration_ms":   durationMs,
			"finish_reason": "stop",
		})
		if lastUsage != nil {
			// Best-available pricing identifier: the provider type string
			// (e.g. "openai", "ollama"). Per-model pricing goes through the
			// Tallier's priceTable; unknown ids cleanly yield $0.
			var providerID string
			if gp, ok := a.(interface{ GetProvider() adapter.ProviderType }); ok {
				providerID = string(gp.GetProvider())
			}
			t := accounting.NewTallier(providerID)
			t.AddInput(lastUsage.InputTokens)
			t.AddOutput(lastUsage.OutputTokens)
			routing.FromContext(ctx).Stage("cost", map[string]any{
				"input_tokens":  lastUsage.InputTokens,
				"output_tokens": lastUsage.OutputTokens,
				"usd_total":     t.USD(),
			})
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
	// Record a redacted view of the dispatch. cluster_id is kept verbatim
	// (it's a UUID, not sensitive); everything else is summarized to arg
	// keys only so user-provided selectors don't leak into the trace.
	argKeys := make([]string, 0, len(args))
	for k := range args {
		argKeys = append(argKeys, k)
	}
	routing.FromContext(ctx).Stage("tool_dispatch", map[string]any{
		"tool_name":  toolName,
		"arg_keys":   argKeys,
		"cluster_id": e.clusterID,
	})
	return e.inner.Execute(ctx, toolName, args)
}

func (e *clusterIDInjectingExecutor) WithAutonomyLevel(level int) types.ToolExecutor {
	return &clusterIDInjectingExecutor{inner: e.inner.WithAutonomyLevel(level), clusterID: e.clusterID}
}
