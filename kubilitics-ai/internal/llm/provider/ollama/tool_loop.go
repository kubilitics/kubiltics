package ollama

// tool_loop.go — agentic tool-calling loop for Ollama.
//
// Ollama's OpenAI-compatible endpoint supports function calling on newer
// models.  For models that don't support tools natively we fall back to a
// single turn and return Done immediately.
//
// The implementation reuses the existing Complete() method and runs
// synchronously (no SSE) so tool results are always returned correctly.

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// CompleteWithTools implements the agentic loop for Ollama.
func (c *OllamaClientImpl) CompleteWithTools(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
) (<-chan types.AgentStreamEvent, error) {
	if cfg.MaxTurns <= 0 {
		cfg.MaxTurns = 10
	}

	evtCh := make(chan types.AgentStreamEvent, 64)

	go func() {
		defer close(evtCh)
		c.runAgentLoop(ctx, messages, tools, executor, cfg, evtCh)
	}()

	return evtCh, nil
}

func (c *OllamaClientImpl) runAgentLoop(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
	evtCh chan<- types.AgentStreamEvent,
) {
	msgs := make([]types.Message, len(messages))
	copy(msgs, messages)
	toolsForAPI := types.CapToolsForAPI(tools)

	for turn := 0; turn < cfg.MaxTurns; turn++ {
		text, rawToolCalls, err := c.Complete(ctx, msgs, toolsForAPI)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("LLM turn %d: %w", turn, err)}
			return
		}

		// Stream the text token-by-token.
		if text != "" {
			select {
			case evtCh <- types.AgentStreamEvent{TextToken: text}:
			case <-ctx.Done():
				evtCh <- types.AgentStreamEvent{Err: ctx.Err()}
				return
			}
		}

		if len(rawToolCalls) == 0 {
			evtCh <- types.AgentStreamEvent{Done: true}
			return
		}

		// Append assistant message.
		msgs = append(msgs, types.Message{Role: "assistant", Content: text})

		// Execute tool calls.
		results, err := c.executeTools(ctx, rawToolCalls, executor, evtCh, turn, cfg.ParallelTools)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("tool execution turn %d: %w", turn, err)}
			return
		}

		// Append tool results as user messages (Ollama compatibility).
		for _, r := range results {
			msgs = append(msgs, types.Message{Role: "tool", Content: r.content})
		}
	}

	evtCh <- types.AgentStreamEvent{
		Err: fmt.Errorf("agentic loop exceeded max turns (%d)", cfg.MaxTurns),
	}
}

type ollamaToolResult struct {
	toolCallID string
	content    string
}

func (c *OllamaClientImpl) executeTools(
	ctx context.Context,
	rawCalls []interface{},
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
	parallel bool,
) ([]ollamaToolResult, error) {
	results := make([]ollamaToolResult, len(rawCalls))

	exec := func(idx int, raw interface{}) (ollamaToolResult, error) {
		m, ok := raw.(map[string]interface{})
		if !ok {
			return ollamaToolResult{content: "invalid tool call"}, nil
		}
		id, _ := m["id"].(string)
		fn, _ := m["function"].(map[string]interface{})
		name, _ := fn["name"].(string)
		var args map[string]interface{}
		switch v := fn["arguments"].(type) {
		case map[string]interface{}:
			args = v
		case string:
			_ = json.Unmarshal([]byte(v), &args)
		}

		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "calling", CallID: id, ToolName: name, Args: args, TurnIndex: turn,
		}}:
		case <-ctx.Done():
			return ollamaToolResult{toolCallID: id, content: "context cancelled"}, ctx.Err()
		}

		result, err := executor.Execute(ctx, name, args)
		if err != nil {
			msg := fmt.Sprintf("Tool %q failed: %v", name, err)
			select {
			case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
				Phase: "error", CallID: id, ToolName: name, Error: msg, TurnIndex: turn,
			}}:
			case <-ctx.Done():
			}
			return ollamaToolResult{toolCallID: id, content: msg}, nil
		}
		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "result", CallID: id, ToolName: name, Result: result, TurnIndex: turn,
		}}:
		case <-ctx.Done():
		}
		return ollamaToolResult{toolCallID: id, content: result}, nil
	}

	if parallel && len(rawCalls) > 1 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var firstErr error
		for i, raw := range rawCalls {
			wg.Add(1)
			go func(idx int, r interface{}) {
				defer wg.Done()
				res, err := exec(idx, r)
				mu.Lock()
				defer mu.Unlock()
				results[idx] = res
				if err != nil && firstErr == nil {
					firstErr = err
				}
			}(i, raw)
		}
		wg.Wait()
		return results, firstErr
	}
	for i, raw := range rawCalls {
		res, err := exec(i, raw)
		results[i] = res
		if err != nil {
			return results, err
		}
	}
	return results, nil
}
