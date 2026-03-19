package ollama

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

func TestNewOllamaClient(t *testing.T) {
	// Use an unreachable URL so connection test always fails and the test is deterministic
	// (no dependency on Ollama actually running). Port 1 is typically not listening.
	unreachableURL := "http://127.0.0.1:1"

	tests := []struct {
		name      string
		baseURL   string
		model     string
		wantError bool
	}{
		{
			name:      "Unreachable URL with default model",
			baseURL:   unreachableURL,
			model:     "",
			wantError: true,
		},
		{
			name:      "Unreachable URL with custom model",
			baseURL:   unreachableURL,
			model:     "mistral",
			wantError: true,
		},
		{
			name:      "Unreachable custom base URL",
			baseURL:   unreachableURL,
			model:     "llama3",
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewOllamaClient(tt.baseURL, tt.model)

			if tt.wantError && err == nil {
				t.Errorf("NewOllamaClient() expected error but got none")
			}

			if !tt.wantError && err != nil {
				t.Errorf("NewOllamaClient() unexpected error: %v", err)
			}

			if !tt.wantError && client == nil {
				t.Errorf("NewOllamaClient() returned nil client")
			}

			if !tt.wantError && client != nil {
				expectedURL := tt.baseURL
				if expectedURL == "" {
					expectedURL = DefaultBaseURL
				}
				if client.baseURL != expectedURL {
					t.Errorf("Expected baseURL %s, got %s", expectedURL, client.baseURL)
				}

				expectedModel := tt.model
				if expectedModel == "" {
					expectedModel = DefaultModel
				}
				if client.model != expectedModel {
					t.Errorf("Expected model %s, got %s", expectedModel, client.model)
				}
			}
		})
	}
}

func TestGetCapabilities(t *testing.T) {
	// Create client without connection test
	client := &OllamaClientImpl{
		baseURL:   DefaultBaseURL,
		model:     "llama3",
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
	if capsMap["provider"] != "ollama" {
		t.Errorf("Expected provider 'ollama', got '%v'", capsMap["provider"])
	}

	// Check model
	if capsMap["model"] != "llama3" {
		t.Errorf("Expected model 'llama3', got '%v'", capsMap["model"])
	}

	// Check streaming support
	if capsMap["supports_streaming"] != true {
		t.Error("Expected supports_streaming to be true")
	}

	// Check tools support
	if capsMap["supports_tools"] != true {
		t.Error("Expected supports_tools to be true")
	}

	// Check cost (should be zero for local)
	if capsMap["cost_per_1k_input"] != 0.0 {
		t.Errorf("Expected cost_per_1k_input to be 0.0, got %v", capsMap["cost_per_1k_input"])
	}

	if capsMap["cost_per_1k_output"] != 0.0 {
		t.Errorf("Expected cost_per_1k_output to be 0.0, got %v", capsMap["cost_per_1k_output"])
	}

	// Check context window
	contextWindow, ok := capsMap["context_window"].(int)
	if !ok {
		t.Error("context_window is not an int")
	}
	if contextWindow != 8192 {
		t.Errorf("Expected context_window 8192 for llama3, got %d", contextWindow)
	}
}

func TestCountTokens(t *testing.T) {
	client := &OllamaClientImpl{
		baseURL:   DefaultBaseURL,
		model:     "llama3",
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
	client := &OllamaClientImpl{
		baseURL:   DefaultBaseURL,
		model:     "llama3",
		maxTokens: DefaultMaxTokens,
	}

	toolCall := map[string]interface{}{
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

func TestGetContextWindow(t *testing.T) {
	tests := []struct {
		model    string
		expected int
	}{
		{"llama3", 8192},
		{"llama2", 4096},
		{"mistral", 8192},
		{"mixtral", 32768},
		{"codellama", 16384},
		{"neural-chat", 4096},
		{"dolphin", 16384},
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

func TestContains(t *testing.T) {
	tests := []struct {
		s      string
		substr string
		want   bool
	}{
		{"llama3", "llama3", true},
		{"llama3-8b", "llama3", true},
		{"mistral", "mistral", true},
		{"unknown", "llama", false},
		{"", "test", false},
		{"test", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.s+"_"+tt.substr, func(t *testing.T) {
			result := contains(tt.s, tt.substr)
			if result != tt.want {
				t.Errorf("contains(%q, %q) = %v, want %v", tt.s, tt.substr, result, tt.want)
			}
		})
	}
}
