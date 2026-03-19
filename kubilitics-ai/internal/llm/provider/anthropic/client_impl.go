package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// Anthropic API constants
const (
	DefaultBaseURL    = "https://api.anthropic.com/v1"
	DefaultModel      = "claude-sonnet-4-5"
	DefaultMaxTokens  = 4096
	DefaultAPIVersion = "2023-06-01"
	DefaultTimeout    = 120 * time.Second
)

// Model costs per 1K tokens (as of Feb 2026)
var modelCosts = map[string]struct {
	InputCost  float64
	OutputCost float64
}{
	"claude-sonnet-4-5":          {0.003, 0.015},
	"claude-sonnet-4-5-20250929": {0.003, 0.015},
	"claude-sonnet-4-0":          {0.003, 0.015},
	"claude-sonnet-4-20250514":   {0.003, 0.015},
	"claude-haiku-4-5":           {0.00025, 0.00125},
	"claude-opus-4-5":            {0.015, 0.075},
	"claude-3-5-sonnet-20241022": {0.003, 0.015},
	"claude-3-opus-20240229":     {0.015, 0.075},
	"claude-3-sonnet-20240229":   {0.003, 0.015},
	"claude-3-haiku-20240307":    {0.00025, 0.00125},
}

// AnthropicClientImpl implements the Anthropic provider (exported for adapter)
type AnthropicClientImpl struct {
	apiKey          string
	model           string
	maxTokens       int
	budgetingTokens int
	baseURL         string
	httpClient      *http.Client
}

// anthMessage represents an Anthropic API message
type anthMessage struct {
	Role    string         `json:"role"`
	Content []ContentBlock `json:"content"`
}

// ContentBlock can be text or tool_use or tool_result
type ContentBlock struct {
	Type      string                 `json:"type"`
	Text      string                 `json:"text,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Name      string                 `json:"name,omitempty"`
	Input     map[string]interface{} `json:"input,omitempty"`
	ToolUseID string                 `json:"tool_use_id,omitempty"`
	Content   string                 `json:"content,omitempty"` // for tool_result
}

// anthTool represents an Anthropic tool definition
type anthTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// anthRequest represents an Anthropic API request
type anthRequest struct {
	Model     string        `json:"model"`
	MaxTokens int           `json:"max_tokens"`
	Messages  []anthMessage `json:"messages"`
	Tools     []anthTool    `json:"tools,omitempty"`
	System    string        `json:"system,omitempty"`
	Stream    bool          `json:"stream,omitempty"`
}

// anthResponse represents an Anthropic API response
type anthResponse struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Role       string         `json:"role"`
	Content    []ContentBlock `json:"content"`
	Model      string         `json:"model"`
	StopReason string         `json:"stop_reason"`
	Usage      anthUsage      `json:"usage"`
}

// anthUsage tracks token usage
type anthUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// SSE event types from Anthropic streaming API
type sseEvent struct {
	Type         string        `json:"type"`
	Index        int           `json:"index,omitempty"`
	Delta        *sseDelta     `json:"delta,omitempty"`
	Usage        *anthUsage    `json:"usage,omitempty"`
	ContentBlock *ContentBlock `json:"content_block,omitempty"`
}

type sseDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text,omitempty"`
	StopReason  string `json:"stop_reason,omitempty"`
	PartialJSON string `json:"partial_json,omitempty"`
}

// Capabilities represents model capabilities
type Capabilities struct {
	Streaming        bool    `json:"streaming"`
	ToolUse          bool    `json:"tool_use"`
	ExtendedThinking bool    `json:"extended_thinking"`
	MaxTokens        int     `json:"max_tokens"`
	InputCostPer1K   float64 `json:"input_cost_per_1k"`
	OutputCostPer1K  float64 `json:"output_cost_per_1k"`
}

// NewAnthropicClient creates a new Anthropic client
func NewAnthropicClient(apiKey string, model string) (*AnthropicClientImpl, error) {
	if apiKey == "" {
		// Try environment variable
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
		if apiKey == "" {
			return nil, fmt.Errorf("ANTHROPIC_API_KEY is required")
		}
	}

	if model == "" {
		model = os.Getenv("ANTHROPIC_MODEL")
		if model == "" {
			model = DefaultModel
		}
	}
	model = strings.TrimSpace(model)

	maxTokens := DefaultMaxTokens
	if maxTokensStr := os.Getenv("ANTHROPIC_MAX_TOKENS"); maxTokensStr != "" {
		if mt, err := strconv.Atoi(maxTokensStr); err == nil {
			maxTokens = mt
		}
	}

	baseURL := os.Getenv("ANTHROPIC_BASE_URL")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	// Ensure the base URL includes the /v1 path segment.
	// The ANTHROPIC_BASE_URL env var from Claude Desktop is "https://api.anthropic.com"
	// (without /v1), which would cause 404 errors on /messages.
	baseURL = strings.TrimSuffix(baseURL, "/")
	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL = baseURL + "/v1"
	}

	return &AnthropicClientImpl{
		apiKey:    apiKey,
		model:     model,
		maxTokens: maxTokens,
		baseURL:   baseURL,
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}, nil
}

// Complete implements non-streaming completion using types.Message and types.Tool
func (c *AnthropicClientImpl) Complete(ctx context.Context, messages []types.Message, tools []types.Tool) (string, []interface{}, error) {
	// Extract system message if present
	system, filteredMessages := extractSystem(messages)

	// Convert to Anthropic message format
	anthMessages := convertMessages(filteredMessages)

	// Select tools relevant to the user's query (intent-aware, respects 128-tool API limit).
	latestUserMsg := ""
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			latestUserMsg = messages[i].Content
			break
		}
	}
	tools = types.SelectToolsForQuery(tools, latestUserMsg)
	anthTools := convertTools(tools)

	req := anthRequest{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		Messages:  anthMessages,
		Tools:     anthTools,
		System:    system,
		Stream:    false,
	}

	// Make API call
	resp, err := c.makeRequest(ctx, req)
	if err != nil {
		return "", nil, err
	}

	// Extract text and tool calls from response
	var text string
	var toolCalls []interface{}

	for _, block := range resp.Content {
		switch block.Type {
		case "text":
			text += block.Text
		case "tool_use":
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":    block.ID,
				"name":  block.Name,
				"input": block.Input,
			})
		}
	}

	return text, toolCalls, nil
}

// CompleteStream implements streaming completion with real SSE parsing
func (c *AnthropicClientImpl) CompleteStream(ctx context.Context, messages []types.Message, tools []types.Tool) (chan string, chan interface{}, error) {
	textChan := make(chan string, 100)
	toolChan := make(chan interface{}, 10)

	// Extract system message if present
	system, filteredMessages := extractSystem(messages)

	// Select tools relevant to the user's query (intent-aware, respects 128-tool API limit).
	latestUserMsgStream := ""
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			latestUserMsgStream = messages[i].Content
			break
		}
	}
	tools = types.SelectToolsForQuery(tools, latestUserMsgStream)
	anthMessages := convertMessages(filteredMessages)
	anthTools := convertTools(tools)

	req := anthRequest{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		Messages:  anthMessages,
		Tools:     anthTools,
		System:    system,
		Stream:    true,
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		close(textChan)
		close(toolChan)
		return nil, nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Ensure baseURL doesn't end with a slash to prevent double // in URL construction
	baseURL := strings.TrimSuffix(c.baseURL, "/")
	httpReq, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/messages", bytes.NewBuffer(reqBody))
	if err != nil {
		close(textChan)
		close(toolChan)
		return nil, nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", DefaultAPIVersion)

	// Use a client without timeout for streaming (rely on context cancellation)
	streamClient := &http.Client{}
	httpResp, err := streamClient.Do(httpReq)
	if err != nil {
		close(textChan)
		close(toolChan)
		return nil, nil, fmt.Errorf("streaming request failed: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		httpResp.Body.Close()
		close(textChan)
		close(toolChan)
		return nil, nil, fmt.Errorf("API error %d: %s", httpResp.StatusCode, string(body))
	}

	// Parse SSE stream in goroutine
	go func() {
		defer close(textChan)
		defer close(toolChan)
		defer httpResp.Body.Close()

		// Track current tool use block being assembled
		var currentToolID, currentToolName string
		var currentToolInputJSON strings.Builder

		scanner := bufio.NewScanner(httpResp.Body)
		var eventType string

		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
			}

			line := scanner.Text()

			if strings.HasPrefix(line, "event: ") {
				eventType = strings.TrimPrefix(line, "event: ")
				continue
			}

			if strings.HasPrefix(line, "data: ") {
				data := strings.TrimPrefix(line, "data: ")
				if data == "[DONE]" {
					return
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
							select {
							case textChan <- event.Delta.Text:
							case <-ctx.Done():
								return
							}
						}
					case "input_json_delta":
						currentToolInputJSON.WriteString(event.Delta.PartialJSON)
					}

				case "content_block_stop":
					// If we were building a tool call, emit it now
					if currentToolID != "" {
						var toolInput map[string]interface{}
						if jsonStr := currentToolInputJSON.String(); jsonStr != "" {
							_ = json.Unmarshal([]byte(jsonStr), &toolInput)
						}
						select {
						case toolChan <- map[string]interface{}{
							"id":    currentToolID,
							"name":  currentToolName,
							"input": toolInput,
						}:
						case <-ctx.Done():
							return
						}
						currentToolID = ""
						currentToolName = ""
						currentToolInputJSON.Reset()
					}

				case "message_stop":
					return
				}
			}
		}
	}()

	return textChan, toolChan, nil
}

// CountTokens estimates token count for the messages and tools
func (c *AnthropicClientImpl) CountTokens(ctx context.Context, messages []types.Message, tools []types.Tool) (int, error) {
	totalChars := 0
	for _, msg := range messages {
		totalChars += len(msg.Content)
	}
	for _, tool := range tools {
		if toolJSON, err := json.Marshal(tool); err == nil {
			totalChars += len(toolJSON)
		}
	}
	// Rough estimate: 4 characters per token
	return totalChars / 4, nil
}

// GetCapabilities returns model capabilities
func (c *AnthropicClientImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	costs, ok := modelCosts[c.model]
	if !ok {
		// Default to Sonnet costs
		costs = modelCosts[DefaultModel]
	}

	caps := Capabilities{
		Streaming:        true,
		ToolUse:          true,
		ExtendedThinking: c.model == "claude-3-5-sonnet-20241022",
		MaxTokens:        200000, // Claude 3.5 Sonnet has 200K context
		InputCostPer1K:   costs.InputCost,
		OutputCostPer1K:  costs.OutputCost,
	}

	return caps, nil
}

// ValidateToolCall validates a tool call
func (c *AnthropicClientImpl) ValidateToolCall(ctx context.Context, toolName string, args interface{}) error {
	if toolName == "" {
		return fmt.Errorf("tool name is required")
	}
	return nil
}

// NormalizeToolCall converts Anthropic tool_use format to standard format
func (c *AnthropicClientImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	tcMap, ok := toolCall.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("tool call must be a map")
	}

	// Anthropic format: {id, name, input}
	// Standard format: {tool_name, args}
	name, _ := tcMap["name"].(string)
	input, _ := tcMap["input"].(map[string]interface{})

	return map[string]interface{}{
		"tool_name": name,
		"args":      input,
	}, nil
}

// extractSystem pulls out any system message and returns it separately,
// along with the remaining messages (Anthropic requires system as a top-level field).
func extractSystem(messages []types.Message) (string, []types.Message) {
	var system string
	filtered := make([]types.Message, 0, len(messages))
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
		} else {
			filtered = append(filtered, m)
		}
	}
	return system, filtered
}

// convertMessages converts []types.Message to Anthropic anthMessage format
func convertMessages(messages []types.Message) []anthMessage {
	result := make([]anthMessage, 0, len(messages))
	for _, m := range messages {
		result = append(result, anthMessage{
			Role: m.Role,
			Content: []ContentBlock{
				{Type: "text", Text: m.Content},
			},
		})
	}
	return result
}

// convertTools converts []types.Tool to Anthropic anthTool format
func convertTools(tools []types.Tool) []anthTool {
	if len(tools) == 0 {
		return nil
	}
	result := make([]anthTool, 0, len(tools))
	for _, t := range tools {
		schema := t.Parameters
		if schema == nil {
			schema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		result = append(result, anthTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return result
}

// makeRequest makes a non-streaming HTTP request to the Anthropic API
func (c *AnthropicClientImpl) makeRequest(ctx context.Context, req anthRequest) (*anthResponse, error) {
	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Ensure baseURL doesn't end with a slash
	baseURL := strings.TrimSuffix(c.baseURL, "/")
	httpReq, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/messages", bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", DefaultAPIVersion)

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer httpResp.Body.Close()

	body, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error %d: %s", httpResp.StatusCode, string(body))
	}

	var resp anthResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &resp, nil
}

// SetBaseURL overrides the Anthropic API base URL.  Used in tests.
func (c *AnthropicClientImpl) SetBaseURL(url string) { c.baseURL = url }
