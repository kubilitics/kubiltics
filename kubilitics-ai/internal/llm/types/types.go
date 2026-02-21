package types

// Message represents a message in a conversation
type Message struct {
	Role    string `json:"role"`    // user, assistant, system
	Content string `json:"content"` // message text
}

// Tool represents a tool/function definition that can be called by the LLM
type Tool struct {
	Name                  string                 `json:"name"`                              // tool name
	Description           string                 `json:"description"`                       // what the tool does
	Parameters            map[string]interface{} `json:"parameters"`                        // JSON schema for parameters
	RequiredAutonomyLevel int                    `json:"required_autonomy_level,omitempty"` // Minimum autonomy level required
}

// ToolCall represents a tool call made by the LLM
type ToolCall struct {
	ID        string                 `json:"id"`        // unique call ID
	Type      string                 `json:"type"`      // "function" or "tool_use"
	Name      string                 `json:"name"`      // tool name
	Arguments map[string]interface{} `json:"arguments"` // tool arguments
}

// CompletionRequest represents a request to complete text
type CompletionRequest struct {
	Messages []Message `json:"messages"` // conversation history
	Tools    []Tool    `json:"tools"`    // available tools
}

// CompletionResponse represents a completion response
type CompletionResponse struct {
	Content   string     `json:"content"`    // generated text
	ToolCalls []ToolCall `json:"tool_calls"` // tools called
	Usage     TokenUsage `json:"usage"`      // token usage
}

// MaxToolsPerRequest is the maximum number of tools to send in a single LLM API request.
// OpenAI and compatible APIs reject requests with more than 128 tools.
const MaxToolsPerRequest = 128

// CapToolsForAPI returns at most MaxToolsPerRequest tools so the API payload stays within limits.
// The executor may still have more handlers; only the list sent to the LLM is capped.
func CapToolsForAPI(tools []Tool) []Tool {
	if len(tools) <= MaxToolsPerRequest {
		return tools
	}
	return tools[:MaxToolsPerRequest]
}

// TokenUsage tracks token usage and cost
type TokenUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`     // input tokens
	CompletionTokens int     `json:"completion_tokens"` // output tokens
	TotalTokens      int     `json:"total_tokens"`      // total tokens
	EstimatedCost    float64 `json:"estimated_cost"`    // estimated cost in USD
}
