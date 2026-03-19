package custom

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

func TestNewCustomClient(t *testing.T) {
	tests := []struct {
		name      string
		baseURL   string
		apiKey    string
		model     string
		wantError bool
	}{
		{
			name:      "Missing base URL",
			baseURL:   "",
			apiKey:    "",
			model:     "test-model",
			wantError: true,
		},
		{
			name:      "Missing model",
			baseURL:   "http://localhost:8000/v1",
			apiKey:    "",
			model:     "",
			wantError: true,
		},
		{
			name:      "Valid configuration (connection will fail)",
			baseURL:   "http://localhost:8000/v1",
			apiKey:    "test-key",
			model:     "llama-2-7b",
			wantError: true, // Will fail to connect
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewCustomClient(tt.baseURL, tt.apiKey, tt.model)

			if tt.wantError && err == nil {
				t.Errorf("NewCustomClient() expected error but got none")
			}

			if !tt.wantError && err != nil {
				t.Errorf("NewCustomClient() unexpected error: %v", err)
			}

			if !tt.wantError && client == nil {
				t.Errorf("NewCustomClient() returned nil client")
			}
		})
	}
}

func TestGetCapabilities(t *testing.T) {
	// Create client without connection test
	client := &CustomClientImpl{
		baseURL:   "http://localhost:8000/v1",
		model:     "llama-2-7b",
		maxTokens: DefaultMaxTokens,
	}

	caps, err := client.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetCapabilities() error: %v", err)
	}

	capsMap, ok := caps.(map[string]interface{})
	if !ok {
		t.Fatal("Capabilities is not a map")
	}

	// Check provider
	if capsMap["provider"] != "custom" {
		t.Errorf("Expected provider 'custom', got '%v'", capsMap["provider"])
	}

	// Check base_url
	if capsMap["base_url"] != "http://localhost:8000/v1" {
		t.Errorf("Expected base_url 'http://localhost:8000/v1', got '%v'", capsMap["base_url"])
	}

	// Check model
	if capsMap["model"] != "llama-2-7b" {
		t.Errorf("Expected model 'llama-2-7b', got '%v'", capsMap["model"])
	}

	// Check streaming support
	if capsMap["supports_streaming"] != true {
		t.Error("Expected supports_streaming to be true")
	}

	// Check tools support
	if capsMap["supports_tools"] != true {
		t.Error("Expected supports_tools to be true")
	}

	// Check cost (should be zero by default)
	if capsMap["cost_per_1k_input"] != 0.0 {
		t.Errorf("Expected cost_per_1k_input to be 0.0, got %v", capsMap["cost_per_1k_input"])
	}

	if capsMap["cost_per_1k_output"] != 0.0 {
		t.Errorf("Expected cost_per_1k_output to be 0.0, got %v", capsMap["cost_per_1k_output"])
	}
}

func TestCountTokens(t *testing.T) {
	client := &CustomClientImpl{
		baseURL:   "http://localhost:8000/v1",
		model:     "llama-2-7b",
		maxTokens: DefaultMaxTokens,
	}

	messages := []types.Message{
		{Role: "user", Content: "Hello, how are you?"},
		{Role: "assistant", Content: "I'm doing well, thank you!"},
	}

	tools := []types.Tool{
		{
			Name:        "test_tool",
			Description: "A test tool",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"param1": map[string]interface{}{
						"type": "string",
					},
				},
			},
		},
	}

	tokens, err := client.CountTokens(context.Background(), messages, tools)
	if err != nil {
		t.Fatalf("CountTokens() error: %v", err)
	}

	// Should have some estimated tokens
	if tokens <= 0 {
		t.Errorf("Expected positive token count, got %d", tokens)
	}

	// Test with empty messages
	emptyTokens, err := client.CountTokens(context.Background(), []types.Message{}, []types.Tool{})
	if err != nil {
		t.Fatalf("CountTokens() error with empty messages: %v", err)
	}

	if emptyTokens != 0 {
		t.Errorf("Expected 0 tokens for empty messages, got %d", emptyTokens)
	}
}

func TestNormalizeToolCall(t *testing.T) {
	client := &CustomClientImpl{
		baseURL:   "http://localhost:8000/v1",
		model:     "llama-2-7b",
		maxTokens: DefaultMaxTokens,
	}

	toolCall := map[string]interface{}{
		"id":   "call_123",
		"type": "function",
		"function": map[string]interface{}{
			"name": "test_tool",
			"arguments": map[string]interface{}{
				"param1": "value1",
			},
		},
	}

	normalized, err := client.NormalizeToolCall(context.Background(), toolCall)
	if err != nil {
		t.Fatalf("NormalizeToolCall() error: %v", err)
	}

	if normalized["id"] != "call_123" {
		t.Errorf("Expected id 'call_123', got '%v'", normalized["id"])
	}

	if normalized["type"] != "function" {
		t.Errorf("Expected type 'function', got '%v'", normalized["type"])
	}

	function, ok := normalized["function"].(map[string]interface{})
	if !ok {
		t.Fatal("function is not a map")
	}

	if function["name"] != "test_tool" {
		t.Errorf("Expected function name 'test_tool', got '%v'", function["name"])
	}
}

func TestParseSSE(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "Single event",
			input:    "data: {\"test\":\"value\"}\n\n",
			expected: []string{"{\"test\":\"value\"}"},
		},
		{
			name:     "Multiple events",
			input:    "data: {\"test\":\"value1\"}\n\ndata: {\"test\":\"value2\"}\n\n",
			expected: []string{"{\"test\":\"value1\"}", "{\"test\":\"value2\"}"},
		},
		{
			name:     "DONE event",
			input:    "data: [DONE]\n\n",
			expected: []string{"[DONE]"},
		},
		{
			name:     "Empty input",
			input:    "",
			expected: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseSSE(tt.input)

			if len(result) != len(tt.expected) {
				t.Errorf("Expected %d events, got %d", len(tt.expected), len(result))
				return
			}

			for i, expected := range tt.expected {
				if result[i] != expected {
					t.Errorf("Event %d: expected '%s', got '%s'", i, expected, result[i])
				}
			}
		})
	}
}
