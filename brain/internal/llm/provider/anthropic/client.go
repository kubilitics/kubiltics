// Package anthropic provides the Anthropic Claude API provider implementation.
//
// Responsibilities:
//   - Implement LLM adapter interface for Anthropic API
//   - Support Claude 3.5 Sonnet, Claude 3 Opus models
//   - Handle Anthropic messages API calls
//   - Support tool use (tool_use content blocks)
//   - Implement streaming via SSE (content_block_delta events)
//   - Token counting (character-based approximation)
//   - Cost tracking per request
//   - Error handling and rate limit detection
//   - System message extraction (Anthropic uses top-level system field)
//
// Supported Models:
//   - claude-3-5-sonnet-20241022: Latest, fastest, best cost/performance, recommended
//   - claude-3-opus-20240229: Most capable, larger context, higher cost
//   - claude-3-sonnet-20240229: Previous version of Sonnet
//   - claude-3-haiku-20240307: Smallest, fastest, lowest cost
//
// Configuration:
//   - ANTHROPIC_API_KEY: Required. API key from console.anthropic.com
//   - ANTHROPIC_MODEL: Optional. Model ID (defaults to claude-3-5-sonnet-20241022)
//   - ANTHROPIC_MAX_TOKENS: Optional. Maximum tokens in response (default 4096)
//   - ANTHROPIC_BASE_URL: Optional. Base URL override (for proxies)
//
// Tool Use Format:
//   - Anthropic uses "tool_use" content blocks in responses
//   - Tool inputs streamed as "input_json_delta" events
//   - Tool results sent back as "tool_result" content blocks
//
// Integration:
//   - AnthropicClientImpl is the exported struct used by the LLM adapter
//   - All methods accept []types.Message and []types.Tool (standard adapter types)
package anthropic
