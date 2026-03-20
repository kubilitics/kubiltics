package anthropic

import (
	"context"
	"os"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

func TestNewAnthropicClient(t *testing.T) {
	// Test with explicit API key and model
	client, err := NewAnthropicClient("test-key", "claude-3-5-sonnet-20241022")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	if client.apiKey != "test-key" {
		t.Errorf("Expected API key 'test-key', got '%s'", client.apiKey)
	}
	if client.model != "claude-3-5-sonnet-20241022" {
		t.Errorf("Expected model 'claude-3-5-sonnet-20241022', got '%s'", client.model)
	}
	if client.maxTokens != DefaultMaxTokens {
		t.Errorf("Expected default max tokens %d, got %d", DefaultMaxTokens, client.maxTokens)
	}
	if client.baseURL != DefaultBaseURL {
		t.Errorf("Expected default base URL %s, got %s", DefaultBaseURL, client.baseURL)
	}
}

func TestNewAnthropicClientDefaults(t *testing.T) {
	// Test with defaults (will use env vars or fallback)
	client, err := NewAnthropicClient("test-key", "")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	if client.model != DefaultModel {
		t.Logf("Model set to: %s", client.model)
	}
}

func TestNewAnthropicClientValidation(t *testing.T) {
	// Empty API key should fail
	_, err := NewAnthropicClient("", "")
	if err == nil {
		t.Error("Expected error for empty API key")
	}
}

func TestConvertMessages(t *testing.T) {
	messages := []types.Message{
		{
			Role:    "user",
			Content: "Hello",
		},
		{
			Role:    "assistant",
			Content: "Hi there",
		},
		{
			Role:    "user",
			Content: "How are you?",
		},
	}

	anthMessages := convertMessages(messages)

	if len(anthMessages) != 3 {
		t.Errorf("Expected 3 messages, got %d", len(anthMessages))
	}

	if anthMessages[0].Role != "user" {
		t.Errorf("Expected role 'user', got '%s'", anthMessages[0].Role)
	}
	if len(anthMessages[0].Content) != 1 {
		t.Errorf("Expected 1 content block, got %d", len(anthMessages[0].Content))
	}
	if anthMessages[0].Content[0].Type != "text" {
		t.Errorf("Expected type 'text', got '%s'", anthMessages[0].Content[0].Type)
	}
	if anthMessages[0].Content[0].Text != "Hello" {
		t.Errorf("Expected text 'Hello', got '%s'", anthMessages[0].Content[0].Text)
	}
}

func TestConvertSystemMessage(t *testing.T) {
	// extractSystem tests
	messages := []types.Message{
		{
			Role:    "system",
			Content: "You are a helpful assistant",
		},
		{
			Role:    "user",
			Content: "Hi",
		},
	}

	system, filtered := extractSystem(messages)

	if system != "You are a helpful assistant" {
		t.Errorf("Expected system message extracted, got '%s'", system)
	}
	if len(filtered) != 1 {
		t.Errorf("Expected 1 filtered message, got %d", len(filtered))
	}
	if filtered[0].Role != "user" {
		t.Errorf("Expected user message remaining, got '%s'", filtered[0].Role)
	}
}

func TestConvertTools(t *testing.T) {
	tools := []types.Tool{
		{
			Name:        "get_weather",
			Description: "Get weather for a location",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"location": map[string]interface{}{
						"type": "string",
					},
				},
			},
		},
	}

	anthTools := convertTools(tools)

	if len(anthTools) != 1 {
		t.Errorf("Expected 1 tool, got %d", len(anthTools))
	}

	if anthTools[0].Name != "get_weather" {
		t.Errorf("Expected name 'get_weather', got '%s'", anthTools[0].Name)
	}
	if anthTools[0].Description != "Get weather for a location" {
		t.Errorf("Unexpected description: %s", anthTools[0].Description)
	}
}

func TestConvertToolsEmpty(t *testing.T) {
	anthTools := convertTools([]types.Tool{})

	if anthTools != nil {
		t.Errorf("Expected nil for empty tools, got %v", anthTools)
	}
}

func TestCountTokens(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	messages := []types.Message{
		{
			Role:    "user",
			Content: "Hello, how are you?",
		},
	}

	tokens, err := client.CountTokens(context.Background(), messages, nil)
	if err != nil {
		t.Fatalf("Failed to count tokens: %v", err)
	}

	// Should be roughly 5-6 tokens (rough estimate: 4 chars/token)
	if tokens < 3 || tokens > 10 {
		t.Errorf("Expected ~5 tokens, got %d", tokens)
	}
}

func TestCompleteStream(t *testing.T) {
	// This test tries to make a real network request if not mocked.
	// Since we don't have a mock HTTP client injection easily exposed here (it's inside NewAnthropicClient),
	// this test will likely fail or timeout if we run it without network/API key.
	// However, to fix the compilation error, we just need to fix the types.
	// Ideally we should mock the HTTP client or skip if no API key.

	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("Skipping integration test: ANTHROPIC_API_KEY not set")
	}

	client, _ := NewAnthropicClient(os.Getenv("ANTHROPIC_API_KEY"), DefaultModel)

	messages := []types.Message{
		{
			Role:    "user",
			Content: "Hello",
		},
	}

	textChan, toolChan, err := client.CompleteStream(context.Background(), messages, nil)
	if err != nil {
		t.Fatalf("Failed to start stream: %v", err)
	}

	// Consume channels
	for text := range textChan {
		t.Logf("Received text: %s", text)
	}

	for tool := range toolChan {
		t.Logf("Received tool: %v", tool)
	}
}

func TestModelCosts(t *testing.T) {
	models := []string{
		"claude-3-5-sonnet-20241022",
		"claude-3-opus-20240229",
		"claude-3-sonnet-20240229",
		"claude-3-haiku-20240307",
	}

	for _, model := range models {
		costs, ok := modelCosts[model]
		if !ok {
			t.Errorf("Model %s not found in cost table", model)
			continue
		}

		if costs.InputCost <= 0 {
			t.Errorf("Model %s has invalid input cost: %f", model, costs.InputCost)
		}
		if costs.OutputCost <= 0 {
			t.Errorf("Model %s has invalid output cost: %f", model, costs.OutputCost)
		}

		t.Logf("Model %s: Input=$%.5f/1K, Output=$%.5f/1K", model, costs.InputCost, costs.OutputCost)
	}
}
