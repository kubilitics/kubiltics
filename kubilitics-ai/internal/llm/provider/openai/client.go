package openai

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

// Package openai provides OpenAI provider implementation for LLM adapter.
//
// Responsibilities:
//   - Implement LLM adapter interface for OpenAI API
//   - Support GPT-4, GPT-4o, GPT-3.5-turbo models
//   - Handle OpenAI chat completions API calls
//   - Support function calling (tool use) via OpenAI format
//   - Implement streaming responses
//   - Token counting via estimation (cl100k_base approximation)
//   - Cost tracking per request
//   - Error handling and rate limit detection
//   - Model-specific configuration (temperature, top_p, frequency_penalty, etc.)
//
// Supported Models:
//   - gpt-4: 8k context, excellent reasoning, high cost
//   - gpt-4-turbo: 128k context, faster, lower cost
//   - gpt-4o: Latest multimodal, fast, moderate cost
//   - gpt-3.5-turbo: Fast, low cost, suitable for simple tasks

const (
	DefaultBaseURL   = "https://api.openai.com/v1"
	DefaultModel     = "gpt-4o"
	DefaultMaxTokens = 4096
	DefaultTimeout   = 120 * time.Second
)

// OpenAIClientImpl implements the LLM adapter interface for OpenAI.
type OpenAIClientImpl struct {
	apiKey     string
	model      string
	maxTokens  int
	baseURL    string
	httpClient *http.Client
}

// OpenAI API structures
type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAITool struct {
	Type     string                   `json:"type"`
	Function openAIFunctionDefinition `json:"function"`
}

type openAIFunctionDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Tools       []openAITool    `json:"tools,omitempty"`
	MaxTokens   int             `json:"max_tokens"`
	Temperature float64         `json:"temperature,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
}

type openAIChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role      string           `json:"role"`
			Content   string           `json:"content"`
			ToolCalls []openAIToolCall `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

type openAIStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role      string           `json:"role,omitempty"`
			Content   string           `json:"content,omitempty"`
			ToolCalls []openAIToolCall `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// NewOpenAIClient creates a new OpenAI client with configuration.
func NewOpenAIClient(apiKey, model string) (*OpenAIClientImpl, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("OpenAI API key is required")
	}

	if model == "" {
		model = DefaultModel
	}

	return &OpenAIClientImpl{
		apiKey:    apiKey,
		model:     model,
		maxTokens: DefaultMaxTokens,
		baseURL:   DefaultBaseURL,
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}, nil
}

// Complete implements LLMAdapter.Complete for OpenAI API.
func (c *OpenAIClientImpl) Complete(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (string, []interface{}, error) {
	// Convert messages to OpenAI format
	openAIMessages := make([]openAIMessage, len(messages))
	for i, msg := range messages {
		openAIMessages[i] = openAIMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Select tools relevant to the user's query (intent-aware, respects 128-tool API limit).
	// Extract the latest user message for intent scoring.
	latestUserMsg := ""
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			latestUserMsg = messages[i].Content
			break
		}
	}
	tools = types.SelectToolsForQuery(tools, latestUserMsg)

	var openAITools []openAITool
	if len(tools) > 0 {
		openAITools = make([]openAITool, len(tools))
		for i, tool := range tools {
			openAITools[i] = openAITool{
				Type: "function",
				Function: openAIFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request
	request := openAIChatRequest{
		Model:     c.model,
		Messages:  openAIMessages,
		Tools:     openAITools,
		MaxTokens: c.maxTokens,
	}

	// Make HTTP request
	response, err := c.makeRequest(ctx, "/chat/completions", request)
	if err != nil {
		return "", nil, fmt.Errorf("OpenAI API request failed: %w", err)
	}

	// Parse response
	var chatResponse openAIChatResponse
	if err := json.Unmarshal(response, &chatResponse); err != nil {
		return "", nil, fmt.Errorf("failed to parse OpenAI response: %w", err)
	}

	if len(chatResponse.Choices) == 0 {
		return "", nil, fmt.Errorf("no choices in OpenAI response")
	}

	choice := chatResponse.Choices[0]
	content := choice.Message.Content

	// Extract tool calls if present
	var toolCalls []interface{}
	if len(choice.Message.ToolCalls) > 0 {
		toolCalls = make([]interface{}, len(choice.Message.ToolCalls))
		for i, tc := range choice.Message.ToolCalls {
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

// CompleteStream implements LLMAdapter.CompleteStream for OpenAI API.
func (c *OpenAIClientImpl) CompleteStream(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (chan string, chan interface{}, error) {
	// Convert messages
	openAIMessages := make([]openAIMessage, len(messages))
	for i, msg := range messages {
		openAIMessages[i] = openAIMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Select tools relevant to the user's query (intent-aware, respects 128-tool API limit).
	latestUserMsgStream := ""
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			latestUserMsgStream = messages[i].Content
			break
		}
	}
	tools = types.SelectToolsForQuery(tools, latestUserMsgStream)

	var openAITools []openAITool
	if len(tools) > 0 {
		openAITools = make([]openAITool, len(tools))
		for i, tool := range tools {
			openAITools[i] = openAITool{
				Type: "function",
				Function: openAIFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request with stream=true
	request := openAIChatRequest{
		Model:     c.model,
		Messages:  openAIMessages,
		Tools:     openAITools,
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

// CountTokens estimates token count (OpenAI doesn't expose tiktoken publicly)
func (c *OpenAIClientImpl) CountTokens(
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

// GetCapabilities returns OpenAI model capabilities.
func (c *OpenAIClientImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	return map[string]interface{}{
		"provider":           "openai",
		"model":              c.model,
		"supports_streaming": true,
		"supports_tools":     true,
		"max_tokens":         c.maxTokens,
		"context_window":     getContextWindow(c.model),
	}, nil
}

// NormalizeToolCall converts OpenAI tool call format to standard format.
func (c *OpenAIClientImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	tcMap, ok := toolCall.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid tool call format")
	}

	return map[string]interface{}{
		"id":   tcMap["id"],
		"type": tcMap["type"],
		"function": map[string]interface{}{
			"name":      tcMap["function"].(map[string]interface{})["name"],
			"arguments": tcMap["function"].(map[string]interface{})["arguments"],
		},
	}, nil
}

// makeRequest makes an HTTP request to OpenAI API
func (c *OpenAIClientImpl) makeRequest(ctx context.Context, endpoint string, payload interface{}) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := c.baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

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
		return nil, fmt.Errorf("OpenAI API error (status %d): %s", resp.StatusCode, string(responseBody))
	}

	return responseBody, nil
}

// streamRequest makes a streaming HTTP request to OpenAI API
func (c *OpenAIClientImpl) streamRequest(
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
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("OpenAI API error (status %d): %s", resp.StatusCode, string(responseBody))
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

			var chunk openAIStreamChunk
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

// getContextWindow returns the context window size for a given model
func getContextWindow(model string) int {
	switch model {
	case "gpt-4o":
		return 128000
	case "gpt-4-turbo", "gpt-4-turbo-preview":
		return 128000
	case "gpt-4":
		return 8192
	case "gpt-3.5-turbo":
		return 16385
	default:
		return 4096
	}
}

// SetBaseURL overrides the OpenAI API base URL.  Used in tests.
func (c *OpenAIClientImpl) SetBaseURL(url string) { c.baseURL = url }
