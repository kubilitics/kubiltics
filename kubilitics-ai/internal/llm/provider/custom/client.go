package custom

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// Package custom provides Custom provider implementation for LLM adapter.
//
// Responsibilities:
//   - Implement LLM adapter interface for ANY OpenAI-compatible API
//   - Support vLLM, LocalAI, LM Studio, text-generation-webui, and more
//   - Handle chat completions using OpenAI API format
//   - Support function calling if endpoint supports it
//   - Token counting via estimation
//   - Cost tracking (configurable, typically zero for self-hosted)
//   - Error handling and connection management
//
// Key Use Cases:
//   - Self-hosted vLLM instances (production scale)
//   - LocalAI for local inference
//   - LM Studio for desktop inference
//   - text-generation-webui with OpenAI extension
//   - Any custom OpenAI-compatible API
//
// Supported Endpoints:
//   - vLLM: High-performance LLM serving (production)
//   - LocalAI: Local inference with multiple backends
//   - LM Studio: Desktop app for running LLMs
//   - text-generation-webui: Popular UI with OpenAI API
//   - Together AI: Cloud inference
//   - Anyscale Endpoints: Ray-based serving
//   - Any other OpenAI-compatible endpoint
//
// Configuration:
//   - CUSTOM_BASE_URL: Required. URL to OpenAI-compatible endpoint
//   - CUSTOM_API_KEY: Optional. API key if endpoint requires auth
//   - CUSTOM_MODEL: Required. Model name to use
//   - CUSTOM_MAX_TOKENS: Optional. Max tokens in response
//
// API Compatibility:
//   - Must support /v1/chat/completions endpoint
//   - Must accept OpenAI chat completion format
//   - Optional: streaming via SSE
//   - Optional: function calling (tools parameter)
//
// Example Endpoints:
//   - vLLM: http://localhost:8000/v1
//   - LocalAI: http://localhost:8080/v1
//   - LM Studio: http://localhost:1234/v1
//   - text-generation-webui: http://localhost:5000/v1
//
// Integration Points:
//   - LLM Adapter: Implements adapter interface
//   - Budget Tracker: Reports token usage (configurable cost)
//   - Reasoning Engine: Calls Complete/CompleteStream
//   - MCP Server: Receives tool calls from LLM

const (
	DefaultMaxTokens = 4096
	DefaultTimeout   = 180 * time.Second
)

// CustomClientImpl implements the LLM adapter interface for custom OpenAI-compatible APIs.
type CustomClientImpl struct {
	baseURL    string
	apiKey     string
	model      string
	maxTokens  int
	httpClient *http.Client
}

// Custom API structures (OpenAI-compatible)
type customMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCalls  []customToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type customTool struct {
	Type     string                   `json:"type"`
	Function customFunctionDefinition `json:"function"`
}

type customFunctionDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

type customToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type customChatRequest struct {
	Model       string          `json:"model"`
	Messages    []customMessage `json:"messages"`
	Tools       []customTool    `json:"tools,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
}

type customChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role      string           `json:"role"`
			Content   string           `json:"content"`
			ToolCalls []customToolCall `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

type customStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role      string           `json:"role,omitempty"`
			Content   string           `json:"content,omitempty"`
			ToolCalls []customToolCall `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// NewCustomClient creates a new custom OpenAI-compatible client.
func NewCustomClient(baseURL, apiKey, model string) (*CustomClientImpl, error) {
	if baseURL == "" {
		return nil, fmt.Errorf("custom provider requires base URL")
	}

	if model == "" {
		return nil, fmt.Errorf("custom provider requires model name")
	}

	client := &CustomClientImpl{
		baseURL:   baseURL,
		apiKey:    apiKey,
		model:     model,
		maxTokens: DefaultMaxTokens,
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}

	// Test connection to endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.testConnection(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to custom endpoint at %s: %w", baseURL, err)
	}

	return client, nil
}

// testConnection verifies endpoint is reachable
func (c *CustomClientImpl) testConnection(ctx context.Context) error {
	// Try to make a simple request to /v1/models or just check if endpoint responds
	testURL, err := url.JoinPath(c.baseURL, "/models")
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", testURL, nil)
	if err != nil {
		return err
	}

	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Accept any 2xx or 404 (some endpoints don't have /models)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if resp.StatusCode == 404 {
		return nil // Endpoint exists but doesn't have /models endpoint
	}

	return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
}

// Complete implements LLMAdapter.Complete for custom OpenAI-compatible API.
func (c *CustomClientImpl) Complete(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (string, []interface{}, error) {
	// Convert messages to custom format
	customMessages := make([]customMessage, len(messages))
	for i, msg := range messages {
		customMessages[i] = customMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Convert tools to custom format (cap at 128 for API limit)
	tools = types.CapToolsForAPI(tools)
	var customTools []customTool
	if len(tools) > 0 {
		customTools = make([]customTool, len(tools))
		for i, tool := range tools {
			customTools[i] = customTool{
				Type: "function",
				Function: customFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request
	request := customChatRequest{
		Model:     c.model,
		Messages:  customMessages,
		Tools:     customTools,
		MaxTokens: c.maxTokens,
	}

	// Make HTTP request
	response, err := c.makeRequest(ctx, "/chat/completions", request)
	if err != nil {
		return "", nil, fmt.Errorf("custom API request failed: %w", err)
	}

	// Parse response
	var chatResponse customChatResponse
	if err := json.Unmarshal(response, &chatResponse); err != nil {
		return "", nil, fmt.Errorf("failed to parse custom response: %w", err)
	}

	if len(chatResponse.Choices) == 0 {
		return "", nil, fmt.Errorf("no choices in custom response")
	}

	content := chatResponse.Choices[0].Message.Content

	// Extract tool calls if present
	var toolCalls []interface{}
	if len(chatResponse.Choices[0].Message.ToolCalls) > 0 {
		toolCalls = make([]interface{}, len(chatResponse.Choices[0].Message.ToolCalls))
		for i, tc := range chatResponse.Choices[0].Message.ToolCalls {
			// Parse arguments JSON
			var args map[string]interface{}
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				return "", nil, fmt.Errorf("failed to parse tool call arguments: %w", err)
			}

			toolCalls[i] = map[string]interface{}{
				"id":   tc.ID,
				"type": tc.Type,
				"function": map[string]interface{}{
					"name":      tc.Function.Name,
					"arguments": args,
				},
			}
		}
	}

	return content, toolCalls, nil
}

// CompleteStream implements LLMAdapter.CompleteStream for custom OpenAI-compatible API.
func (c *CustomClientImpl) CompleteStream(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (chan string, chan interface{}, error) {
	// Convert messages
	customMessages := make([]customMessage, len(messages))
	for i, msg := range messages {
		customMessages[i] = customMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Convert tools (cap at 128 for API limit)
	tools = types.CapToolsForAPI(tools)
	var customTools []customTool
	if len(tools) > 0 {
		customTools = make([]customTool, len(tools))
		for i, tool := range tools {
			customTools[i] = customTool{
				Type: "function",
				Function: customFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request with stream=true
	request := customChatRequest{
		Model:     c.model,
		Messages:  customMessages,
		Tools:     customTools,
		MaxTokens: c.maxTokens,
		Stream:    true,
	}

	// Create channels
	textChan := make(chan string, 10)
	toolChan := make(chan interface{}, 10)

	// Start streaming in goroutine
	go func() {
		defer close(textChan)
		defer close(toolChan)

		if err := c.streamRequest(ctx, "/chat/completions", request, textChan, toolChan); err != nil {
			textChan <- fmt.Sprintf("ERROR: %v", err)
		}
	}()

	return textChan, toolChan, nil
}

// CountTokens estimates token count.
func (c *CustomClientImpl) CountTokens(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (int, error) {
	// Simple estimation: ~4 characters per token
	totalChars := 0
	for _, msg := range messages {
		totalChars += len(msg.Content)
	}

	// Add tool definitions size
	if len(tools) > 0 {
		toolsJSON, _ := json.Marshal(tools)
		totalChars += len(toolsJSON)
	}

	estimatedTokens := totalChars / 4
	return estimatedTokens, nil
}

// GetCapabilities returns custom endpoint capabilities.
func (c *CustomClientImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	return map[string]interface{}{
		"provider":           "custom",
		"base_url":           c.baseURL,
		"model":              c.model,
		"supports_streaming": true,
		"supports_tools":     true,
		"max_tokens":         c.maxTokens,
		"context_window":     8192, // Conservative default
		"cost_per_1k_input":  0.0,  // Configurable, defaults to zero
		"cost_per_1k_output": 0.0,  // Configurable, defaults to zero
	}, nil
}

// NormalizeToolCall converts custom tool call format to standard format.
func (c *CustomClientImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	tcMap, ok := toolCall.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid tool call format")
	}

	return map[string]interface{}{
		"id":       tcMap["id"],
		"type":     tcMap["type"],
		"function": tcMap["function"],
	}, nil
}

// makeRequest makes an HTTP request to custom API
func (c *CustomClientImpl) makeRequest(ctx context.Context, endpoint string, payload interface{}) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	requestURL, err := url.JoinPath(c.baseURL, endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to join url path: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", requestURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("custom API error (status %d): %s", resp.StatusCode, string(responseBody))
	}

	return responseBody, nil
}

// streamRequest makes a streaming HTTP request to custom API
func (c *CustomClientImpl) streamRequest(
	ctx context.Context,
	endpoint string,
	payload interface{},
	textChan chan string,
	toolChan chan interface{},
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	requestURL, err := url.JoinPath(c.baseURL, endpoint)
	if err != nil {
		return fmt.Errorf("failed to join url path: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", requestURL, bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("custom API error (status %d): %s", resp.StatusCode, string(responseBody))
	}

	// Read SSE stream
	reader := io.Reader(resp.Body)
	buffer := make([]byte, 8192)

	for {
		n, err := reader.Read(buffer)
		if err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("failed to read stream: %w", err)
		}

		// Process SSE data
		data := string(buffer[:n])
		lines := parseSSE(data)

		for _, line := range lines {
			if line == "[DONE]" {
				return nil
			}

			var chunk customStreamChunk
			if err := json.Unmarshal([]byte(line), &chunk); err != nil {
				continue
			}

			if len(chunk.Choices) == 0 {
				continue
			}

			delta := chunk.Choices[0].Delta

			if delta.Content != "" {
				textChan <- delta.Content
			}

			if len(delta.ToolCalls) > 0 {
				for _, tc := range delta.ToolCalls {
					var args map[string]interface{}
					json.Unmarshal([]byte(tc.Function.Arguments), &args)

					toolChan <- map[string]interface{}{
						"id":   tc.ID,
						"type": tc.Type,
						"function": map[string]interface{}{
							"name":      tc.Function.Name,
							"arguments": args,
						},
					}
				}
			}
		}
	}

	return nil
}

// parseSSE parses Server-Sent Events format
func parseSSE(data string) []string {
	var lines []string
	current := ""

	for _, line := range bytes.Split([]byte(data), []byte("\n")) {
		lineStr := string(line)

		if bytes.HasPrefix(line, []byte("data: ")) {
			content := lineStr[6:]
			current += content
		} else if lineStr == "" && current != "" {
			lines = append(lines, current)
			current = ""
		}
	}

	return lines
}
