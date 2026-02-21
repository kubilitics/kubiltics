package openai

// tool_loop.go — full multi-turn agentic tool-calling loop for OpenAI.
//
// Conversation turns for OpenAI's tool-use API:
//
//   Turn N (LLM returns tool calls):
//     response.choices[0].message: {role:"assistant", tool_calls:[{id:"X", function:{name:"get_pods", arguments:"{...}"}}]}
//     finish_reason: "tool_calls"
//
//   → Append to messages:
//     {role:"assistant", tool_calls:[{id:"X", ...}]}                       ← assistant turn
//     {role:"tool",      tool_call_id:"X", content:"<result>"}              ← tool result(s)
//
//   Turn N+1 (LLM continues with tool results in context):
//     response.choices[0].message: {role:"assistant", content:"Here is what I found..."}
//     finish_reason: "stop" → done

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// ─── OpenAI multi-turn message types ──────────────────────────────────────────

// oaiMessage is the wire format for a single message in the multi-turn loop.
// It intentionally overlaps with openAIMessage but carries ToolCalls and
// ToolCallID fields needed for the agentic loop.
type oaiMessage struct {
	Role       string        `json:"role"`
	Content    string        `json:"content,omitempty"`
	ToolCalls  []oaiToolCall `json:"tool_calls,omitempty"`
	ToolCallID string        `json:"tool_call_id,omitempty"`
}

type oaiToolCall struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"` // always "function"
	Function oaiToolFunction `json:"function"`
}

type oaiToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// oaiRequest is the full chat/completions request body.
type oaiRequest struct {
	Model     string       `json:"model"`
	Messages  []oaiMessage `json:"messages"`
	Tools     []openAITool `json:"tools,omitempty"`
	MaxTokens int          `json:"max_tokens"`
	Stream    bool         `json:"stream"`
}

// oaiDelta is the delta object inside an SSE chunk choice.
type oaiDelta struct {
	Role      string        `json:"role,omitempty"`
	Content   string        `json:"content,omitempty"`
	ToolCalls []oaiToolCall `json:"tool_calls,omitempty"`
}

// oaiStreamChunk is one SSE event from the streaming endpoint.
type oaiStreamChunk struct {
	Choices []struct {
		Index        int      `json:"index"`
		Delta        oaiDelta `json:"delta"`
		FinishReason string   `json:"finish_reason"`
	} `json:"choices"`
}

// ─── CompleteWithTools ────────────────────────────────────────────────────────

// CompleteWithTools implements the full agentic loop for OpenAI.
func (c *OpenAIClientImpl) CompleteWithTools(
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

// runAgentLoop is the core multi-turn loop for OpenAI.
func (c *OpenAIClientImpl) runAgentLoop(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
	evtCh chan<- types.AgentStreamEvent,
) {
	// Convert initial messages to OpenAI wire format.
	oaiMsgs := convertMessagesToOAI(messages)
	oaiTools := convertToolsToOAI(tools)

	for turn := 0; turn < cfg.MaxTurns; turn++ {
		req := oaiRequest{
			Model:     c.model,
			MaxTokens: c.maxTokens,
			Messages:  oaiMsgs,
			Tools:     oaiTools,
			Stream:    true,
		}

		text, toolCalls, err := c.streamSingleTurn(ctx, req, evtCh, turn)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("LLM turn %d: %w", turn, err)}
			return
		}

		// No tool calls → final answer.
		if len(toolCalls) == 0 {
			_ = text // already streamed token-by-token
			evtCh <- types.AgentStreamEvent{Done: true}
			return
		}

		// Append assistant message (with tool_calls).
		assistantMsg := oaiMessage{
			Role:      "assistant",
			Content:   text,
			ToolCalls: toolCalls,
		}
		oaiMsgs = append(oaiMsgs, assistantMsg)

		// Execute tool calls, collect results.
		toolResults, err := c.executeTools(ctx, toolCalls, executor, evtCh, turn, cfg.ParallelTools)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("tool execution turn %d: %w", turn, err)}
			return
		}

		// Append one "tool" message per result.
		for _, tr := range toolResults {
			oaiMsgs = append(oaiMsgs, oaiMessage{
				Role:       "tool",
				ToolCallID: tr.toolCallID,
				Content:    tr.content,
			})
		}
	}

	evtCh <- types.AgentStreamEvent{
		Err: fmt.Errorf("agentic loop exceeded max turns (%d) without final answer", cfg.MaxTurns),
	}
}

// ─── streamSingleTurn ─────────────────────────────────────────────────────────
// Makes one streaming call. Text tokens are forwarded to evtCh; assembled
// tool_calls are returned once the stream ends.
func (c *OpenAIClientImpl) streamSingleTurn(
	ctx context.Context,
	req oaiRequest,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
) (string, []oaiToolCall, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", nil, fmt.Errorf("marshal: %w", err)
	}
	fmt.Printf("[OpenAI] Sending tool request: %s\n", string(body))

	requestURL, err := url.JoinPath(c.baseURL, "/chat/completions")
	if err != nil {
		return "", nil, fmt.Errorf("failed to join url path: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", requestURL, bytes.NewBuffer(body))
	if err != nil {
		return "", nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
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

	// ── Parse SSE stream ──────────────────────────────────────────────────────
	// OpenAI streams tool_calls with deltas: each chunk carries a partial
	// arguments string keyed by index.  We accumulate them per index.
	type tcAccumulator struct {
		id      string
		name    string
		argsBuf strings.Builder
	}

	var (
		textBuf strings.Builder
		tcByIdx = map[int]*tcAccumulator{}
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

		var chunk oaiStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
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
			idx := 0 // index field not decoded above; use position in slice
			// OpenAI sends index explicitly; use tc.ID as key when present.
			// The delta slice always has exactly one entry per streamed delta.
			// We assign consecutive indices based on when we first see a new ID.
			if tc.ID != "" {
				// New tool call starting.
				found := -1
				for k, v := range tcByIdx {
					if v.id == tc.ID {
						found = k
						break
					}
				}
				if found >= 0 {
					idx = found
				} else {
					idx = len(tcByIdx)
					tcByIdx[idx] = &tcAccumulator{id: tc.ID}
				}
				tcByIdx[idx].name = tc.Function.Name
			} else {
				// Continuation delta — append to the last open slot.
				idx = len(tcByIdx) - 1
			}
			if acc, ok := tcByIdx[idx]; ok {
				acc.argsBuf.WriteString(tc.Function.Arguments)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return textBuf.String(), nil, fmt.Errorf("scanner: %w", err)
	}

	// Assemble final oaiToolCall list.
	toolCalls := make([]oaiToolCall, len(tcByIdx))
	for i := 0; i < len(tcByIdx); i++ {
		acc := tcByIdx[i]
		args := acc.argsBuf.String()
		if args == "" {
			args = "{}"
		}
		toolCalls[i] = oaiToolCall{
			ID:   acc.id,
			Type: "function",
			Function: oaiToolFunction{
				Name:      acc.name,
				Arguments: args,
			},
		}
	}

	return textBuf.String(), toolCalls, nil
}

// ─── Tool execution ───────────────────────────────────────────────────────────

type oaiToolResult struct {
	toolCallID string
	content    string
}

func (c *OpenAIClientImpl) executeTools(
	ctx context.Context,
	toolCalls []oaiToolCall,
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
	parallel bool,
) ([]oaiToolResult, error) {
	results := make([]oaiToolResult, len(toolCalls))

	if parallel && len(toolCalls) > 1 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var firstErr error

		for i, tc := range toolCalls {
			wg.Add(1)
			go func(idx int, tc oaiToolCall) {
				defer wg.Done()
				res, execErr := executeOAITool(ctx, tc, executor, evtCh, turn)
				mu.Lock()
				defer mu.Unlock()
				results[idx] = res
				if execErr != nil && firstErr == nil {
					firstErr = execErr
				}
			}(i, tc)
		}
		wg.Wait()
		if firstErr != nil {
			return results, firstErr
		}
	} else {
		for i, tc := range toolCalls {
			res, err := executeOAITool(ctx, tc, executor, evtCh, turn)
			results[i] = res
			if err != nil {
				return results, err
			}
		}
	}
	return results, nil
}

// executeOAITool runs one OpenAI tool call and emits lifecycle events.
func executeOAITool(
	ctx context.Context,
	tc oaiToolCall,
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
) (oaiToolResult, error) {
	// Parse arguments from JSON string.
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		args = map[string]interface{}{}
	}

	// Emit "calling" event.
	select {
	case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
		Phase: "calling", CallID: tc.ID, ToolName: tc.Function.Name, Args: args, TurnIndex: turn,
	}}:
	case <-ctx.Done():
		return oaiToolResult{toolCallID: tc.ID, content: "context cancelled"}, ctx.Err()
	}

	result, err := executor.Execute(ctx, tc.Function.Name, args)
	if err != nil {
		msg := fmt.Sprintf("Tool %q failed: %v", tc.Function.Name, err)
		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "error", CallID: tc.ID, ToolName: tc.Function.Name, Error: msg, TurnIndex: turn,
		}}:
		case <-ctx.Done():
		}
		return oaiToolResult{toolCallID: tc.ID, content: msg}, nil
	}

	// Emit "result" event.
	select {
	case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
		Phase: "result", CallID: tc.ID, ToolName: tc.Function.Name, Result: result, TurnIndex: turn,
	}}:
	case <-ctx.Done():
	}

	return oaiToolResult{toolCallID: tc.ID, content: result}, nil
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

// convertMessagesToOAI converts generic types.Message slice to OpenAI oaiMessages.
// It handles the "system" role and preserves existing assistant / tool messages.
func convertMessagesToOAI(messages []types.Message) []oaiMessage {
	out := make([]oaiMessage, 0, len(messages))
	for _, m := range messages {
		out = append(out, oaiMessage{
			Role:    m.Role,
			Content: m.Content,
		})
	}
	return out
}

// convertToolsToOAI converts generic tool definitions to OpenAI's function-tool format.
func convertToolsToOAI(tools []types.Tool) []openAITool {
	out := make([]openAITool, 0, len(tools))
	for _, t := range tools {
		out = append(out, openAITool{
			Type: "function",
			Function: openAIFunctionDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		})
	}
	return out
}
