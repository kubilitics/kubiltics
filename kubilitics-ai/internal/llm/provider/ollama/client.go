package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// Package ollama provides Ollama provider implementation for LLM adapter.
//
// Responsibilities:
//   - Implement LLM adapter interface for Ollama API
//   - Support any Ollama-hosted model (llama3, mistral, codellama, neural-chat, etc.)
//   - Handle Ollama generate and chat API calls
//   - Approximate token counting (Ollama doesn't expose tokenizer)
//   - Cost tracking (zero cost, runs on user's machine)
//   - Error handling and connection management
//   - Model-specific configuration
//
// Key Advantage:
//   - Zero cost - runs entirely on user's machine
//   - Complete privacy - no data sent to external services
//   - Can use smaller models effectively
//
// Supported Models (examples, any Ollama model works):
//   - llama3: 7B/70B, general purpose, good reasoning
//   - mistral: 7B, fast, lightweight
//   - neural-chat: 7B, optimized for conversation
//   - codellama: 7B/13B/34B, code generation and reasoning
//   - openhermes: 2.5 model, instruction-following
//   - dolphin-mixtral: High quality, larger context
//
// Configuration:
//   - OLLAMA_BASE_URL: Required. URL to Ollama instance (defaults to http://localhost:11434)
//   - OLLAMA_MODEL: Required. Model name to use
//   - OLLAMA_TEMPERATURE: Optional. Sampling temperature (0.0-2.0)
//   - OLLAMA_NUM_PREDICT: Optional. Maximum tokens in response
//   - OLLAMA_NUM_THREADS: Optional. CPU threads to use
//
// Token Counting:
//   - Ollama doesn't expose tokenizer
//   - Approximate using char-to-token ratio (1 token ≈ 4 characters)
//   - Less accurate than OpenAI/Anthropic, but sufficient for budgeting
//
// Function Calling Support:
//   - Many Ollama models support function calling
//   - Format typically matches OpenAI format (function calling)
//   - Some models may not support tool calling (graceful degradation)
//
// Integration Points:
//   - LLM Adapter: Implements adapter interface
//   - Budget Tracker: Reports token usage (zero cost)
//   - Reasoning Engine: Calls Complete/CompleteStream
//   - MCP Server: Receives tool calls from LLM (if supported by model)

const (
	DefaultBaseURL   = "http://localhost:11434"
	DefaultModel     = "llama3"
	DefaultMaxTokens = 4096
	DefaultTimeout   = 180 * time.Second // Longer for local inference
)

// Ollama API structures
type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaTool struct {
	Type     string                   `json:"type"`
	Function ollamaFunctionDefinition `json:"function"`
}

type ollamaFunctionDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type ollamaChatRequest struct {
	Model    string                 `json:"model"`
	Messages []ollamaMessage        `json:"messages"`
	Tools    []ollamaTool           `json:"tools,omitempty"`
	Stream   bool                   `json:"stream,omitempty"`
	Options  map[string]interface{} `json:"options,omitempty"`
}

type ollamaChatResponse struct {
	Model     string `json:"model"`
	CreatedAt string `json:"created_at"`
	Message   struct {
		Role      string           `json:"role"`
		Content   string           `json:"content"`
		ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	Done bool `json:"done"`
}

type ollamaStreamChunk struct {
	Model     string `json:"model"`
	CreatedAt string `json:"created_at"`
	Message   struct {
		Role      string           `json:"role,omitempty"`
		Content   string           `json:"content,omitempty"`
		ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	Done bool `json:"done"`
}

// OllamaClientImpl implements the LLM adapter interface for Ollama.
type OllamaClientImpl struct {
	baseURL    string
	model      string
	maxTokens  int
	httpClient *http.Client
}

// NewOllamaClient creates a new Ollama client with configuration.
func NewOllamaClient(baseURL, model string) (*OllamaClientImpl, error) {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}

	if model == "" {
		model = DefaultModel
	}

	client := &OllamaClientImpl{
		baseURL:   baseURL,
		model:     model,
		maxTokens: DefaultMaxTokens,
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}

	// Test connection to Ollama
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.testConnection(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to Ollama at %s: %w", baseURL, err)
	}

	return client, nil
}

// testConnection verifies Ollama is reachable
func (c *OllamaClientImpl) testConnection(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/tags", nil)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// Complete implements LLMAdapter.Complete for Ollama API.
func (c *OllamaClientImpl) Complete(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (string, []interface{}, error) {
	// Convert messages to Ollama format
	ollamaMessages := make([]ollamaMessage, len(messages))
	for i, msg := range messages {
		ollamaMessages[i] = ollamaMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Convert tools to Ollama format (cap at 128 for API limit)
	tools = types.CapToolsForAPI(tools)
	var ollamaTools []ollamaTool
	if len(tools) > 0 {
		ollamaTools = make([]ollamaTool, len(tools))
		for i, tool := range tools {
			ollamaTools[i] = ollamaTool{
				Type: "function",
				Function: ollamaFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request
	request := ollamaChatRequest{
		Model:    c.model,
		Messages: ollamaMessages,
		Tools:    ollamaTools,
		Options: map[string]interface{}{
			"num_predict": c.maxTokens,
		},
	}

	// Make HTTP request
	response, err := c.makeRequest(ctx, "/api/chat", request)
	if err != nil {
		return "", nil, fmt.Errorf("Ollama API request failed: %w", err)
	}

	// Parse response
	var chatResponse ollamaChatResponse
	if err := json.Unmarshal(response, &chatResponse); err != nil {
		return "", nil, fmt.Errorf("failed to parse Ollama response: %w", err)
	}

	content := chatResponse.Message.Content

	// Extract tool calls if present
	var toolCalls []interface{}
	if len(chatResponse.Message.ToolCalls) > 0 {
		toolCalls = make([]interface{}, len(chatResponse.Message.ToolCalls))
		for i, tc := range chatResponse.Message.ToolCalls {
			// Parse arguments JSON
			var args map[string]interface{}
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				return "", nil, fmt.Errorf("failed to parse tool call arguments: %w", err)
			}

			toolCalls[i] = map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name":      tc.Function.Name,
					"arguments": args,
				},
			}
		}
	}

	return content, toolCalls, nil
}

// CompleteStream implements LLMAdapter.CompleteStream for Ollama API.
func (c *OllamaClientImpl) CompleteStream(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
) (chan string, chan interface{}, error) {
	// Convert messages
	ollamaMessages := make([]ollamaMessage, len(messages))
	for i, msg := range messages {
		ollamaMessages[i] = ollamaMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Convert tools (cap at 128 for API limit)
	tools = types.CapToolsForAPI(tools)
	var ollamaTools []ollamaTool
	if len(tools) > 0 {
		ollamaTools = make([]ollamaTool, len(tools))
		for i, tool := range tools {
			ollamaTools[i] = ollamaTool{
				Type: "function",
				Function: ollamaFunctionDefinition{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			}
		}
	}

	// Build request with stream=true
	request := ollamaChatRequest{
		Model:    c.model,
		Messages: ollamaMessages,
		Tools:    ollamaTools,
		Stream:   true,
		Options: map[string]interface{}{
			"num_predict": c.maxTokens,
		},
	}

	// Create channels
	textChan := make(chan string, 10)
	toolChan := make(chan interface{}, 10)

	// Start streaming in goroutine
	go func() {
		defer close(textChan)
		defer close(toolChan)

		if err := c.streamRequest(ctx, "/api/chat", request, textChan, toolChan); err != nil {
			textChan <- fmt.Sprintf("ERROR: %v", err)
		}
	}()

	return textChan, toolChan, nil
}

// CountTokens approximates token count using char-to-token ratio.
func (c *OllamaClientImpl) CountTokens(
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

// GetCapabilities returns Ollama model capabilities.
func (c *OllamaClientImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	return map[string]interface{}{
		"provider":           "ollama",
		"model":              c.model,
		"supports_streaming": true,
		"supports_tools":     true, // Most modern models support this
		"max_tokens":         c.maxTokens,
		"context_window":     getContextWindow(c.model),
		"cost_per_1k_input":  0.0, // Free - runs locally
		"cost_per_1k_output": 0.0, // Free - runs locally
	}, nil
}

// NormalizeToolCall converts Ollama tool call format to standard format.
func (c *OllamaClientImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	tcMap, ok := toolCall.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid tool call format")
	}

	return map[string]interface{}{
		"type":     tcMap["type"],
		"function": tcMap["function"],
	}, nil
}

// makeRequest makes an HTTP request to Ollama API
func (c *OllamaClientImpl) makeRequest(ctx context.Context, endpoint string, payload interface{}) ([]byte, error) {
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
		return nil, fmt.Errorf("Ollama API error (status %d): %s", resp.StatusCode, string(responseBody))
	}

	return responseBody, nil
}

// streamRequest makes a streaming HTTP request to Ollama API
func (c *OllamaClientImpl) streamRequest(
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

	url := c.baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Ollama API error (status %d): %s", resp.StatusCode, string(responseBody))
	}

	// Read newline-delimited JSON stream
	decoder := json.NewDecoder(resp.Body)

	for {
		var chunk ollamaStreamChunk
		if err := decoder.Decode(&chunk); err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("failed to decode stream: %w", err)
		}

		if chunk.Message.Content != "" {
			textChan <- chunk.Message.Content
		}

		if len(chunk.Message.ToolCalls) > 0 {
			for _, tc := range chunk.Message.ToolCalls {
				var args map[string]interface{}
				json.Unmarshal([]byte(tc.Function.Arguments), &args)

				toolChan <- map[string]interface{}{
					"type": "function",
					"function": map[string]interface{}{
						"name":      tc.Function.Name,
						"arguments": args,
					},
				}
			}
		}

		if chunk.Done {
			break
		}
	}

	return nil
}

// getContextWindow returns the context window size for a given model
func getContextWindow(model string) int {
	// Common Ollama models and their context windows
	switch {
	case contains(model, "llama3"):
		return 8192
	case contains(model, "llama2"):
		return 4096
	case contains(model, "mistral"):
		return 8192
	case contains(model, "mixtral"):
		return 32768
	case contains(model, "codellama"):
		return 16384
	case contains(model, "neural-chat"):
		return 4096
	case contains(model, "dolphin"):
		return 16384
	default:
		return 4096 // Conservative default
	}
}

// contains checks if a string contains a substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && s[:len(substr)] == substr || len(s) > len(substr) && s[len(s)-len(substr):] == substr)
}
