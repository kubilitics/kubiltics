package custom

// tool_loop.go — agentic tool-calling loop for OpenAI-compatible custom endpoints.
//
// Reuses the existing wire types from client.go (customMessage, customToolCall,
// customChatRequest, customStreamChunk) so there are no redeclarations.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// CompleteWithTools implements the agentic loop for OpenAI-compatible endpoints.
func (c *CustomClientImpl) CompleteWithTools(
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

func (c *CustomClientImpl) runAgentLoop(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
	evtCh chan<- types.AgentStreamEvent,
) {
	msgs := makeCustomMessages(messages)
	toolsForAPI := types.CapToolsForAPI(tools)
	cTools := makeCustomTools(toolsForAPI)
	if len(cTools) > types.MaxToolsPerRequest {
		cTools = cTools[:types.MaxToolsPerRequest]
	}

	for turn := 0; turn < cfg.MaxTurns; turn++ {
		req := customChatRequest{
			Model:     c.model,
			MaxTokens: c.maxTokens,
			Messages:  msgs,
			Tools:     cTools,
			Stream:    true,
		}

		text, toolCalls, err := c.streamSingleTurn(ctx, req, evtCh, turn)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("LLM turn %d: %w", turn, err)}
			return
		}

		if len(toolCalls) == 0 {
			_ = text
			evtCh <- types.AgentStreamEvent{Done: true}
			return
		}

		msgs = append(msgs, customMessage{
			Role:      "assistant",
			Content:   text,
			ToolCalls: toolCalls,
		})

		results, err := c.executeAgentTools(ctx, toolCalls, executor, evtCh, turn, cfg.ParallelTools)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("tool execution turn %d: %w", turn, err)}
			return
		}

		for _, r := range results {
			msgs = append(msgs, customMessage{
				Role:       "tool",
				ToolCallID: r.toolCallID,
				Content:    r.content,
			})
		}
	}

	evtCh <- types.AgentStreamEvent{
		Err: fmt.Errorf("agentic loop exceeded max turns (%d)", cfg.MaxTurns),
	}
}

func (c *CustomClientImpl) streamSingleTurn(
	ctx context.Context,
	req customChatRequest,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
) (string, []customToolCall, error) {
	// Enforce 128-tool limit right before send; OpenAI-compatible APIs reject larger arrays.
	if len(req.Tools) > types.MaxToolsPerRequest {
		req.Tools = req.Tools[:types.MaxToolsPerRequest]
	}
	body, err := json.Marshal(req)
	if err != nil {
		return "", nil, fmt.Errorf("marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewBuffer(body))
	if err != nil {
		return "", nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	httpReq.Header.Set("Accept", "text/event-stream")

	streamClient := &http.Client{}
	httpResp, err := streamClient.Do(httpReq)
	if err != nil {
		return "", nil, fmt.Errorf("HTTP: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(httpResp.Body)
		return "", nil, fmt.Errorf("API %d: %s", httpResp.StatusCode, string(b))
	}

	type tcAcc struct {
		id      string
		name    string
		argsBuf strings.Builder
	}
	var (
		textBuf strings.Builder
		tcByIdx = map[int]*tcAcc{}
	)

	scanner := bufio.NewScanner(httpResp.Body)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return textBuf.String(), nil, ctx.Err()
		default:
		}
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var chunk customStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil || len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta
		if delta.Content != "" {
			textBuf.WriteString(delta.Content)
			select {
			case evtCh <- types.AgentStreamEvent{TextToken: delta.Content}:
			case <-ctx.Done():
				return textBuf.String(), nil, ctx.Err()
			}
		}
		for _, tc := range delta.ToolCalls {
			if tc.ID != "" {
				found := -1
				for k, v := range tcByIdx {
					if v.id == tc.ID {
						found = k
						break
					}
				}
				idx := found
				if found < 0 {
					idx = len(tcByIdx)
					tcByIdx[idx] = &tcAcc{id: tc.ID}
				}
				tcByIdx[idx].name = tc.Function.Name
				tcByIdx[idx].argsBuf.WriteString(tc.Function.Arguments)
			} else if len(tcByIdx) > 0 {
				idx := len(tcByIdx) - 1
				tcByIdx[idx].argsBuf.WriteString(tc.Function.Arguments)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return textBuf.String(), nil, fmt.Errorf("scanner: %w", err)
	}

	result := make([]customToolCall, len(tcByIdx))
	for i := 0; i < len(tcByIdx); i++ {
		acc := tcByIdx[i]
		args := acc.argsBuf.String()
		if args == "" {
			args = "{}"
		}
		result[i] = customToolCall{
			ID:   acc.id,
			Type: "function",
			Function: struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}{Name: acc.name, Arguments: args},
		}
	}
	return textBuf.String(), result, nil
}

type agentToolResult struct {
	toolCallID string
	content    string
}

func (c *CustomClientImpl) executeAgentTools(
	ctx context.Context,
	calls []customToolCall,
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
	parallel bool,
) ([]agentToolResult, error) {
	results := make([]agentToolResult, len(calls))

	exec := func(idx int, tc customToolCall) (agentToolResult, error) {
		var args map[string]interface{}
		_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
		if args == nil {
			args = map[string]interface{}{}
		}
		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "calling", CallID: tc.ID, ToolName: tc.Function.Name, Args: args, TurnIndex: turn,
		}}:
		case <-ctx.Done():
			return agentToolResult{toolCallID: tc.ID, content: "context cancelled"}, ctx.Err()
		}
		res, err := executor.Execute(ctx, tc.Function.Name, args)
		if err != nil {
			msg := fmt.Sprintf("Tool %q failed: %v", tc.Function.Name, err)
			select {
			case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
				Phase: "error", CallID: tc.ID, ToolName: tc.Function.Name, Error: msg, TurnIndex: turn,
			}}:
			case <-ctx.Done():
			}
			return agentToolResult{toolCallID: tc.ID, content: msg}, nil
		}
		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "result", CallID: tc.ID, ToolName: tc.Function.Name, Result: res, TurnIndex: turn,
		}}:
		case <-ctx.Done():
		}
		return agentToolResult{toolCallID: tc.ID, content: res}, nil
	}

	if parallel && len(calls) > 1 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var firstErr error
		for i, tc := range calls {
			wg.Add(1)
			go func(idx int, tc customToolCall) {
				defer wg.Done()
				r, err := exec(idx, tc)
				mu.Lock()
				defer mu.Unlock()
				results[idx] = r
				if err != nil && firstErr == nil {
					firstErr = err
				}
			}(i, tc)
		}
		wg.Wait()
		return results, firstErr
	}
	for i, tc := range calls {
		r, err := exec(i, tc)
		results[i] = r
		if err != nil {
			return results, err
		}
	}
	return results, nil
}

// makeCustomMessages converts generic messages to customMessage format.
func makeCustomMessages(msgs []types.Message) []customMessage {
	out := make([]customMessage, len(msgs))
	for i, m := range msgs {
		out[i] = customMessage{Role: m.Role, Content: m.Content}
	}
	return out
}

// makeCustomTools converts generic tools to customTool format.
func makeCustomTools(tools []types.Tool) []customTool {
	out := make([]customTool, len(tools))
	for i, t := range tools {
		out[i] = customTool{
			Type: "function",
			Function: customFunctionDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		}
	}
	return out
}
