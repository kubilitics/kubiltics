package adapter

import (
	"context"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// Package adapter provides a unified interface for different LLM providers.
//
// Responsibilities:
//   - Abstract differences between LLM providers (OpenAI, Anthropic, Ollama, custom)
//   - Provide single interface for all LLM operations
//   - Handle streaming and non-streaming completion modes
//   - Normalize tool/function calling across providers
//   - Token counting and budget tracking
//   - Error handling and retry logic
//   - Provider-specific capability detection
//   - Model selection and configuration
//
// Supported Providers:
//   1. OpenAI: GPT-4, GPT-4o, GPT-3.5-turbo
//   2. Anthropic: Claude 3.5 Sonnet, Claude 3 Opus
//   3. Ollama: Local models (llama3, mistral, codellama, neural-chat, etc.)
//   4. Custom: OpenAI-compatible endpoints (vLLM, LocalAI, LM Studio, etc.)
//
// Capabilities Abstraction:
//   - streaming: Supports streaming responses
//   - function_calling: Supports tool/function calling
//   - vision: Supports image inputs (if needed)
//   - token_counting: Can accurately count tokens
//   - max_tokens: Maximum context window size
//   - cost_per_1k_input: Cost per 1000 input tokens
//   - cost_per_1k_output: Cost per 1000 output tokens
//
// Tool/Function Calling Normalization:
//   OpenAI:     {"type": "function", "function": {"name": "...", "arguments": "..."}}
//   Anthropic:  {"type": "tool_use", "name": "...", "input": {...}}
//   Ollama:     {"type": "function", "function": {"name": "...", "arguments": "..."}}
//   Custom:     Provider-dependent (defaults to OpenAI format)
//
// Token Counting Methods:
//   OpenAI:     Use cl100k_base tokenizer
//   Anthropic:  Use internal tokenizer API
//   Ollama:     Approximate with char/token ratio
//   Custom:     Approximate or delegate to provider if supported
//
// Integration Points:
//   - Budget Tracker: Track token usage and costs
//   - MCP Server: Execute tools returned by LLM
//   - Reasoning Engine: Get completions for investigations
//   - Analytics Engine: Track model performance

// LLMAdapter defines the unified interface for LLM providers.
type LLMAdapter interface {
	// Complete sends a prompt and returns a completion (non-streaming).
	// messages: list of {role: "user"|"assistant"|"system", content: "..."}
	// tools: optional list of tool schemas the LLM can call
	// Returns the completion text and any tool calls made
	Complete(ctx context.Context, messages []types.Message, tools []types.Tool) (string, []interface{}, error)

	// CompleteStream sends a prompt and streams a completion.
	// Returns a channel of completion tokens and a channel for tool calls.
	// Caller must consume both channels to completion.
	CompleteStream(ctx context.Context, messages []types.Message, tools []types.Tool) (chan string, chan interface{}, error)

	// CountTokens estimates token usage for messages and tools.
	// Used for budget tracking and context window management.
	CountTokens(ctx context.Context, messages []types.Message, tools []types.Tool) (int, error)

	// GetCapabilities returns supported features and limits for this provider/model.
	GetCapabilities(ctx context.Context) (interface{}, error)

	// NormalizeToolCall converts provider-specific tool call format to standard format.
	NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error)

	// CompleteWithTools runs the full agentic loop:
	//   LLM call → tool execution → LLM call (with results) → ... → final answer
	// The returned channel receives AgentStreamEvents containing streamed text
	// tokens, tool lifecycle notifications, and a final Done event.
	//
	// executor: implementation that executes tool calls (MCP server).
	// cfg: controls loop limits and parallel execution (use DefaultAgentConfig()).
	//
	// The caller MUST consume all events until Done==true or Err!=nil.
	// The channel is closed after the terminal event is sent.
	CompleteWithTools(
		ctx context.Context,
		messages []types.Message,
		tools []types.Tool,
		executor types.ToolExecutor,
		cfg types.AgentConfig,
	) (<-chan types.AgentStreamEvent, error)
}
