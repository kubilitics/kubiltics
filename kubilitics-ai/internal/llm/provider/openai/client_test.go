package openai

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

func TestNewOpenAIClient(t *testing.T) {
	tests := []struct {
		name      string
		apiKey    string
		model     string
		wantError bool
	}{
		{
			name:      "Valid configuration",
			apiKey:    "sk-test123",
			model:     "gpt-4o",
			wantError: false,
		},
		{
			name:      "Empty API key",
			apiKey:    "",
			model:     "gpt-4o",
			wantError: true,
		},
		{
			name:      "Default model",
			apiKey:    "sk-test123",
			model:     "",
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewOpenAIClient(tt.apiKey, tt.model)

			if tt.wantError && err == nil {
				t.Errorf("NewOpenAIClient() expected error but got none")
			}

			if !tt.wantError && err != nil {
				t.Errorf("NewOpenAIClient() unexpected error: %v", err)
			}

			if !tt.wantError && client == nil {
				t.Errorf("NewOpenAIClient() returned nil client")
			}

			if !tt.wantError && tt.model == "" {
				if client.model != DefaultModel {
					t.Errorf("Expected default model %s, got %s", DefaultModel, client.model)
				}
			}
		})
	}
}

func TestGetCapabilities(t *testing.T) {
	client, err := NewOpenAIClient("sk-test123", "gpt-4o")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
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
	if capsMap["provider"] != "openai" {
		t.Errorf("Expected provider 'openai', got '%v'", capsMap["provider"])
	}

	// Check model
	if capsMap["model"] != "gpt-4o" {
		t.Errorf("Expected model 'gpt-4o', got '%v'", capsMap["model"])
	}

	// Check streaming support
	if capsMap["supports_streaming"] != true {
		t.Error("Expected supports_streaming to be true")
	}

	// Check tools support
	if capsMap["supports_tools"] != true {
		t.Error("Expected supports_tools to be true")
	}

	// Check context window
	contextWindow, ok := capsMap["context_window"].(int)
	if !ok {
		t.Error("context_window is not an int")
	}
	if contextWindow != 128000 {
		t.Errorf("Expected context_window 128000, got %d", contextWindow)
	}
}

func TestCountTokens(t *testing.T) {
	client, err := NewOpenAIClient("sk-test123", "gpt-4o")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
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
	client, err := NewOpenAIClient("sk-test123", "gpt-4o")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
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

func TestGetContextWindow(t *testing.T) {
	tests := []struct {
		model    string
		expected int
	}{
		{"gpt-4o", 128000},
		{"gpt-4-turbo", 128000},
		{"gpt-4", 8192},
		{"gpt-3.5-turbo", 16385},
		{"unknown-model", 4096}, // default
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			result := getContextWindow(tt.model)
			if result != tt.expected {
				t.Errorf("Expected context window %d for model %s, got %d",
					tt.expected, tt.model, result)
			}
		})
	}
}
