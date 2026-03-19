package adapter

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/anthropic"
	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/custom"
	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/ollama"
	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/openai"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	"github.com/kubilitics/kubilitics-ai/internal/metrics"
)

// Package adapter provides unified LLM interface supporting ANY provider.
//
// Design Philosophy: TRUE BYO-LLM Architecture
//   - User brings their own API key (OpenAI, Anthropic, Ollama, custom)
//   - NO vendor lock-in: support ALL major LLM providers
//   - OpenAI-compatible APIs work out of the box
//   - Local models (Ollama) supported for privacy/cost
//   - Custom endpoints for vLLM, LocalAI, LM Studio, etc.
//
// Supported Providers:
//   1. OpenAI: gpt-4, gpt-4o, gpt-3.5-turbo (most popular)
//   2. Anthropic: claude-3-5-sonnet, claude-3-opus (premium)
//   3. Ollama: llama3, mistral, codellama, etc. (local/free)
//   4. Custom: ANY OpenAI-compatible endpoint (vLLM, LocalAI, etc.)
//
// Provider Selection (User Configures via UI):
//   - Settings → AI Configuration → Provider
//   - User selects: OpenAI | Anthropic | Ollama | Custom
//   - User enters API key (or endpoint URL for Ollama/Custom)
//   - Kubilitics stores config securely (encrypted at rest)
//   - NO default provider, NO bundled API keys
//
// Configuration Storage:
//   - Frontend: User selects provider + enters API key
//   - Backend: Stores in config.yaml (encrypted)
//   - Environment vars: KUBILITICS_LLM_PROVIDER, KUBILITICS_LLM_API_KEY
//   - For custom: KUBILITICS_LLM_BASE_URL
//
// Fallback Behavior (No LLM Configured):
//   - AI features show "Configure AI Provider" prompt
//   - Analytics engine works (no LLM needed)
//   - MCP tools work (observation/analysis)
//   - Only reasoning/recommendations disabled
//   - Clear user messaging: "Add your API key to enable AI insights"

// ProviderType identifies which LLM provider the user has configured
type ProviderType string

const (
	ProviderOpenAI    ProviderType = "openai"
	ProviderAnthropic ProviderType = "anthropic"
	ProviderOllama    ProviderType = "ollama"
	ProviderCustom    ProviderType = "custom"
	ProviderNone      ProviderType = "none" // No LLM configured
)

// ErrProviderNotConfigured is returned when an LLM operation is attempted without a configured provider
var ErrProviderNotConfigured = fmt.Errorf("LLM provider not configured")

// Config holds LLM provider configuration (from user settings)
type Config struct {
	Provider ProviderType `json:"provider"`
	APIKey   string       `json:"api_key"`  // For OpenAI/Anthropic
	BaseURL  string       `json:"base_url"` // For Ollama/Custom
	Model    string       `json:"model"`    // Model name
}

// llmAdapterImpl is the unified adapter implementation
type llmAdapterImpl struct {
	provider     ProviderType
	model        string      // Model name for metrics
	client       interface{} // Actual provider client
	capabilities interface{} // Cached capabilities
}

// NewLLMAdapter creates adapter based on user configuration
func NewLLMAdapter(cfg *Config) (LLMAdapter, error) {
	if cfg == nil {
		// Try environment variables as fallback
		cfg = &Config{
			Provider: ProviderType(os.Getenv("KUBILITICS_LLM_PROVIDER")),
			APIKey:   os.Getenv("KUBILITICS_LLM_API_KEY"),
			BaseURL:  os.Getenv("KUBILITICS_LLM_BASE_URL"),
			Model:    os.Getenv("KUBILITICS_LLM_MODEL"),
		}
	}

	// If no provider or no credentials, return an unconfigured adapter (not an error).
	// The service starts in degraded mode — LLM endpoints return HTTP 503 until the
	// user supplies credentials via Settings → AI Configuration.
	if cfg.Provider == "" || cfg.Provider == ProviderNone {
		return &llmAdapterImpl{provider: ProviderNone, client: nil}, nil
	}

	// Create provider-specific client. Missing credentials yield an unconfigured adapter.
	var client interface{}
	var err error

	switch cfg.Provider {
	case ProviderOpenAI:
		if cfg.APIKey == "" {
			return &llmAdapterImpl{provider: ProviderNone, client: nil}, nil
		}
		client, err = openai.NewOpenAIClient(cfg.APIKey, cfg.Model)
		if err != nil {
			return nil, fmt.Errorf("failed to create OpenAI client: %w", err)
		}

	case ProviderAnthropic:
		if cfg.APIKey == "" {
			return &llmAdapterImpl{provider: ProviderNone, client: nil}, nil
		}
		anthClient, err := anthropic.NewAnthropicClient(cfg.APIKey, cfg.Model)
		if err != nil {
			return nil, fmt.Errorf("failed to create Anthropic client: %w", err)
		}
		if cfg.BaseURL != "" {
			anthClient.SetBaseURL(cfg.BaseURL)
		}
		client = anthClient

	case ProviderOllama:
		if cfg.BaseURL == "" {
			cfg.BaseURL = "http://localhost:11434"
		}
		client, err = ollama.NewOllamaClient(cfg.BaseURL, cfg.Model)
		if err != nil {
			return nil, fmt.Errorf("failed to create Ollama client: %w", err)
		}

	case ProviderCustom:
		if cfg.BaseURL == "" {
			return &llmAdapterImpl{provider: ProviderNone, client: nil}, nil
		}
		client, err = custom.NewCustomClient(cfg.BaseURL, cfg.APIKey, cfg.Model)
		if err != nil {
			return nil, fmt.Errorf("failed to create Custom client: %w", err)
		}

	default:
		return nil, fmt.Errorf("unsupported provider: %s", cfg.Provider)
	}

	return &llmAdapterImpl{
		provider: cfg.Provider,
		model:    cfg.Model,
		client:   client,
	}, nil
}

// Complete delegates to provider-specific client
func (a *llmAdapterImpl) Complete(ctx context.Context, messages []types.Message, tools []types.Tool) (string, []interface{}, error) {
	if a.provider == ProviderNone {
		return "", nil, ErrProviderNotConfigured
	}

	start := time.Now()
	defer func() {
		duration := time.Since(start).Seconds()
		metrics.LLMRequestDuration.WithLabelValues(string(a.provider), a.model).Observe(duration)
	}()

	var err error
	var resp string
	var toolCalls []interface{}

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		resp, toolCalls, err = client.Complete(ctx, messages, tools)
	case *openai.OpenAIClientImpl:
		resp, toolCalls, err = client.Complete(ctx, messages, tools)
	case *ollama.OllamaClientImpl:
		resp, toolCalls, err = client.Complete(ctx, messages, tools)
	case *custom.CustomClientImpl:
		resp, toolCalls, err = client.Complete(ctx, messages, tools)
	default:
		err = fmt.Errorf("unknown client type")
	}

	status := "success"
	if err != nil {
		status = "error"
	}
	metrics.LLMRequestsTotal.WithLabelValues(string(a.provider), a.model, status).Inc()

	return resp, toolCalls, err
}

// CompleteStream delegates to provider-specific client
func (a *llmAdapterImpl) CompleteStream(ctx context.Context, messages []types.Message, tools []types.Tool) (chan string, chan interface{}, error) {
	if a.provider == ProviderNone {
		return nil, nil, ErrProviderNotConfigured
	}

	start := time.Now()
	// Note: We record duration when stream starts, effectively measuring TTFT (Time To First Token) + overhead
	// Ideally we'd wrap valid channels to measure full stream duration, but that's complex.
	// For now, let's measure init time.
	// actually, let's keep it simple: record request total here. Duration is hard for streams without wrapping.
	// We'll rely on the caller/wrapper (BudgetedAdapter) for full duration if needed, or just count calls here.

	var err error
	var textCh chan string
	var toolCh chan interface{}

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		textCh, toolCh, err = client.CompleteStream(ctx, messages, tools)
	case *openai.OpenAIClientImpl:
		textCh, toolCh, err = client.CompleteStream(ctx, messages, tools)
	case *ollama.OllamaClientImpl:
		textCh, toolCh, err = client.CompleteStream(ctx, messages, tools)
	case *custom.CustomClientImpl:
		textCh, toolCh, err = client.CompleteStream(ctx, messages, tools)
	default:
		err = fmt.Errorf("unknown client type")
	}

	status := "success"
	if err != nil {
		status = "error"
	}
	metrics.LLMRequestsTotal.WithLabelValues(string(a.provider), a.model, status).Inc()

	// We don't record duration for stream init as it's negligible usually.
	// A better place for stream duration is in the loop consuming the stream.
	metrics.LLMRequestDuration.WithLabelValues(string(a.provider), a.model).Observe(time.Since(start).Seconds())

	return textCh, toolCh, err
}

// CountTokens delegates to provider-specific client
func (a *llmAdapterImpl) CountTokens(ctx context.Context, messages []types.Message, tools []types.Tool) (int, error) {
	if a.provider == ProviderNone {
		return 0, ErrProviderNotConfigured
	}

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		return client.CountTokens(ctx, messages, tools)
	case *openai.OpenAIClientImpl:
		return client.CountTokens(ctx, messages, tools)
	case *ollama.OllamaClientImpl:
		return client.CountTokens(ctx, messages, tools)
	case *custom.CustomClientImpl:
		return client.CountTokens(ctx, messages, tools)
	default:
		return 0, fmt.Errorf("unknown client type")
	}
}

// GetCapabilities delegates to provider-specific client
func (a *llmAdapterImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	if a.provider == ProviderNone {
		return map[string]interface{}{
			"provider":           "none",
			"model":              "none",
			"supports_streaming": false,
			"supports_tools":     false,
		}, nil
	}

	if a.capabilities != nil {
		return a.capabilities, nil
	}

	var caps interface{}
	var err error

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		caps, err = client.GetCapabilities(ctx)
	case *openai.OpenAIClientImpl:
		caps, err = client.GetCapabilities(ctx)
	case *ollama.OllamaClientImpl:
		caps, err = client.GetCapabilities(ctx)
	case *custom.CustomClientImpl:
		caps, err = client.GetCapabilities(ctx)
	default:
		return nil, fmt.Errorf("unknown client type")
	}

	if err != nil {
		return nil, err
	}

	a.capabilities = caps
	return caps, nil
}

// NormalizeToolCall converts provider-specific format to standard
func (a *llmAdapterImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	if a.provider == ProviderNone {
		return nil, ErrProviderNotConfigured
	}

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		return client.NormalizeToolCall(ctx, toolCall)
	case *openai.OpenAIClientImpl:
		return client.NormalizeToolCall(ctx, toolCall)
	case *ollama.OllamaClientImpl:
		return client.NormalizeToolCall(ctx, toolCall)
	case *custom.CustomClientImpl:
		return client.NormalizeToolCall(ctx, toolCall)
	default:
		return nil, fmt.Errorf("unknown client type")
	}
}

// CompleteWithTools runs the full multi-turn agentic loop by delegating to the
// provider-specific implementation.
func (a *llmAdapterImpl) CompleteWithTools(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
) (<-chan types.AgentStreamEvent, error) {
	if a.provider == ProviderNone {
		ch := make(chan types.AgentStreamEvent, 1)
		ch <- types.AgentStreamEvent{
			Err: ErrProviderNotConfigured,
		}
		close(ch)
		return ch, ErrProviderNotConfigured
	}

	// Enforce API limit (e.g. OpenAI/Anthropic max 128 tools) so no provider receives more.
	tools = types.CapToolsForAPI(tools)

	switch client := a.client.(type) {
	case *anthropic.AnthropicClientImpl:
		return client.CompleteWithTools(ctx, messages, tools, executor, cfg)
	case *openai.OpenAIClientImpl:
		return client.CompleteWithTools(ctx, messages, tools, executor, cfg)
	case *ollama.OllamaClientImpl:
		return client.CompleteWithTools(ctx, messages, tools, executor, cfg)
	case *custom.CustomClientImpl:
		return client.CompleteWithTools(ctx, messages, tools, executor, cfg)
	default:
		return nil, fmt.Errorf("unknown client type")
	}
}

// GetProvider returns the configured provider type
func (a *llmAdapterImpl) GetProvider() ProviderType {
	return a.provider
}

// IsConfigured returns true if an LLM provider is configured
func IsLLMConfigured() bool {
	provider := os.Getenv("KUBILITICS_LLM_PROVIDER")
	apiKey := os.Getenv("KUBILITICS_LLM_API_KEY")
	return provider != "" && apiKey != ""
}
