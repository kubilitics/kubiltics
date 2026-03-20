package anthropic

// tool_loop.go — full multi-turn agentic tool-calling loop for Anthropic.
//
// Conversation turns for Anthropic's tool-use API:
//
//   Turn N (LLM returns tool calls):
//     response.content: [{type:"tool_use", id:"X", name:"get_pods", input:{...}}]
//     stop_reason: "tool_use"
//
//   → Append to messages:
//     {role:"assistant", content:[{type:"tool_use", id:"X", ...}]}
//     {role:"user",      content:[{type:"tool_result", tool_use_id:"X", content:"<result>"}]}
//
//   Turn N+1 (LLM continues with tool results in context):
//     response.content: [{type:"text", text:"Here is what I found..."}]
//     stop_reason: "end_turn"  → done

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

// CompleteWithTools implements the full agentic loop for Anthropic.
func (c *AnthropicClientImpl) CompleteWithTools(
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

// runAgentLoop is the core agentic loop. It runs until the LLM stops calling
// tools, an error occurs, or cfg.MaxTurns is exceeded.
func (c *AnthropicClientImpl) runAgentLoop(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
	evtCh chan<- types.AgentStreamEvent,
) {
	system, filtered := extractSystem(messages)
	// Build a mutable copy of the Anthropic message list.
	anthMsgs := convertMessages(filtered)
	toolsForAPI := types.CapToolsForAPI(tools)
	anthTools := convertTools(toolsForAPI)

	for turn := 0; turn < cfg.MaxTurns; turn++ {
		req := anthRequest{
			Model:     c.model,
			MaxTokens: c.maxTokens,
			Messages:  anthMsgs,
			Tools:     anthTools,
			System:    system,
			Stream:    true,
		}

		text, toolUses, err := c.streamSingleTurn(ctx, req, evtCh, turn)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("LLM turn %d: %w", turn, err)}
			return
		}

		// No tool calls → this is the final answer.
		if len(toolUses) == 0 {
			_ = text // already sent token-by-token to evtCh
			evtCh <- types.AgentStreamEvent{Done: true}
			return
		}

		// Append assistant turn (text + tool_use blocks).
		assistantBlocks := make([]ContentBlock, 0, len(toolUses)+1)
		if text != "" {
			assistantBlocks = append(assistantBlocks, ContentBlock{Type: "text", Text: text})
		}
		for _, tu := range toolUses {
			assistantBlocks = append(assistantBlocks, ContentBlock{
				Type:  "tool_use",
				ID:    tu.id,
				Name:  tu.name,
				Input: tu.input,
			})
		}
		anthMsgs = append(anthMsgs, anthMessage{Role: "assistant", Content: assistantBlocks})

		// Execute tool calls, collect results.
		toolResults, err := c.executeTools(ctx, toolUses, executor, evtCh, turn, cfg.ParallelTools)
		if err != nil {
			evtCh <- types.AgentStreamEvent{Err: fmt.Errorf("tool execution turn %d: %w", turn, err)}
			return
		}

		// Append user turn with tool_result blocks.
		resultBlocks := make([]ContentBlock, 0, len(toolResults))
		for _, tr := range toolResults {
			resultBlocks = append(resultBlocks, ContentBlock{
				Type:      "tool_result",
				ToolUseID: tr.toolUseID,
				Content:   tr.content,
			})
		}
		anthMsgs = append(anthMsgs, anthMessage{Role: "user", Content: resultBlocks})
	}

	evtCh <- types.AgentStreamEvent{
		Err: fmt.Errorf("agentic loop exceeded max turns (%d) without final answer", cfg.MaxTurns),
	}
}

// ─── streamSingleTurn ─────────────────────────────────────────────────────────
// Makes one streaming Anthropic API call.  Text tokens are forwarded to evtCh
// as they arrive; collected tool_use records are returned when the turn ends.
func (c *AnthropicClientImpl) streamSingleTurn(
	ctx context.Context,
	req anthRequest,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
) (string, []toolUseRecord, error) {
	// Enforce 128-tool limit right before send; API rejects larger arrays.
	if len(req.Tools) > types.MaxToolsPerRequest {
		req.Tools = req.Tools[:types.MaxToolsPerRequest]
	}
	// ── Build and send HTTP request ───────────────────────────────────────────
	reqBody, err := json.Marshal(req)
	if err != nil {
		return "", nil, fmt.Errorf("marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/messages", bytes.NewBuffer(reqBody))
	if err != nil {
		return "", nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", DefaultAPIVersion)

	// Use a client without a hard timeout; cancellation is via ctx.
	streamClient := &http.Client{}
	httpResp, err := streamClient.Do(httpReq)
	if err != nil {
		return "", nil, fmt.Errorf("HTTP: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		return "", nil, fmt.Errorf("API %d: %s", httpResp.StatusCode, string(body))
	}

	// ── Parse SSE stream ──────────────────────────────────────────────────────
	var (
		collectedText        strings.Builder
		toolUses             []toolUseRecord
		currentToolID        string
		currentToolName      string
		currentToolInputJSON strings.Builder
		eventType            string
	)

	scanner := bufio.NewScanner(httpResp.Body)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return collectedText.String(), toolUses, ctx.Err()
		default:
		}

		line := scanner.Text()

		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event sseEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch eventType {
		case "content_block_start":
			if event.ContentBlock != nil && event.ContentBlock.Type == "tool_use" {
				currentToolID = event.ContentBlock.ID
				currentToolName = event.ContentBlock.Name
				currentToolInputJSON.Reset()
			}

		case "content_block_delta":
			if event.Delta == nil {
				continue
			}
			switch event.Delta.Type {
			case "text_delta":
				if event.Delta.Text != "" {
					collectedText.WriteString(event.Delta.Text)
					select {
					case evtCh <- types.AgentStreamEvent{TextToken: event.Delta.Text}:
					case <-ctx.Done():
						return collectedText.String(), toolUses, ctx.Err()
					}
				}
			case "input_json_delta":
				currentToolInputJSON.WriteString(event.Delta.PartialJSON)
			}

		case "content_block_stop":
			if currentToolID != "" {
				var toolInput map[string]interface{}
				if jsonStr := currentToolInputJSON.String(); jsonStr != "" {
					_ = json.Unmarshal([]byte(jsonStr), &toolInput)
				}
				toolUses = append(toolUses, toolUseRecord{
					id:    currentToolID,
					name:  currentToolName,
					input: toolInput,
				})
				currentToolID = ""
				currentToolName = ""
				currentToolInputJSON.Reset()
			}

		case "message_stop":
			goto done
		}
	}
done:
	if err := scanner.Err(); err != nil {
		return collectedText.String(), toolUses, fmt.Errorf("scanner: %w", err)
	}

	return collectedText.String(), toolUses, nil
}

// ─── Tool execution ───────────────────────────────────────────────────────────

type toolUseRecord struct {
	id    string
	name  string
	input map[string]interface{}
}

type toolResultRecord struct {
	toolUseID string
	content   string
}

// executeTools runs all tool calls, optionally in parallel, and returns results.
func (c *AnthropicClientImpl) executeTools(
	ctx context.Context,
	toolUses []toolUseRecord,
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
	parallel bool,
) ([]toolResultRecord, error) {
	results := make([]toolResultRecord, len(toolUses))

	if parallel && len(toolUses) > 1 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var firstErr error

		for i, tu := range toolUses {
			wg.Add(1)
			go func(idx int, tu toolUseRecord) {
				defer wg.Done()
				res, execErr := executeSingleTool(ctx, tu, executor, evtCh, turn)
				mu.Lock()
				defer mu.Unlock()
				results[idx] = res
				if execErr != nil && firstErr == nil {
					firstErr = execErr
				}
			}(i, tu)
		}
		wg.Wait()
		if firstErr != nil {
			return results, firstErr
		}
	} else {
		for i, tu := range toolUses {
			res, err := executeSingleTool(ctx, tu, executor, evtCh, turn)
			results[i] = res
			if err != nil {
				return results, err
			}
		}
	}
	return results, nil
}

// executeSingleTool runs one tool call and emits lifecycle events to evtCh.
// Errors from the executor are returned as tool content (not fatal) so the
// LLM can reason about the failure.
func executeSingleTool(
	ctx context.Context,
	tu toolUseRecord,
	executor types.ToolExecutor,
	evtCh chan<- types.AgentStreamEvent,
	turn int,
) (toolResultRecord, error) {
	// Emit "calling" event.
	select {
	case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
		Phase: "calling", CallID: tu.id, ToolName: tu.name, Args: tu.input, TurnIndex: turn,
	}}:
	case <-ctx.Done():
		return toolResultRecord{toolUseID: tu.id, content: "context cancelled"}, ctx.Err()
	}

	result, err := executor.Execute(ctx, tu.name, tu.input)
	if err != nil {
		msg := fmt.Sprintf("Tool %q failed: %v", tu.name, err)
		select {
		case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
			Phase: "error", CallID: tu.id, ToolName: tu.name, Error: msg, TurnIndex: turn,
		}}:
		case <-ctx.Done():
		}
		// Return error as content — the LLM will see what went wrong.
		return toolResultRecord{toolUseID: tu.id, content: msg}, nil
	}

	// Emit "result" event.
	select {
	case evtCh <- types.AgentStreamEvent{ToolEvent: &types.ToolEvent{
		Phase: "result", CallID: tu.id, ToolName: tu.name, Result: result, TurnIndex: turn,
	}}:
	case <-ctx.Done():
	}

	return toolResultRecord{toolUseID: tu.id, content: result}, nil
}
