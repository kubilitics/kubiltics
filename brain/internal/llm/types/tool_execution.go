package types

import (
	"context"
	"os"
	"strconv"
)

// ToolExecutor is the interface that MCP tool handlers must implement.
// It is the bridge between the LLM (which decides what to call) and the
// MCP server (which executes the tool against the real cluster).
type ToolExecutor interface {
	// Execute runs a named tool with the given arguments and returns the result.
	// The result is a string that will be fed back to the LLM as the tool output.
	// Implementations must be safe for concurrent execution (parallel tool calls).
	// Execute runs a named tool with the given arguments and returns the result.
	// The result is a string that will be fed back to the LLM as the tool output.
	// Implementations must be safe for concurrent execution (parallel tool calls).
	Execute(ctx context.Context, toolName string, args map[string]interface{}) (string, error)

	// WithAutonomyLevel returns a copy of the executor with the specified autonomy level.
	WithAutonomyLevel(level int) ToolExecutor
}

// ToolEvent is sent to the WebSocket client during a tool-calling turn,
// providing real-time visibility into what the AI agent is doing.
type ToolEvent struct {
	// Phase is the lifecycle phase: "calling" | "result" | "error"
	Phase string `json:"phase"`
	// CallID is the LLM-assigned ID for this specific tool call.
	CallID string `json:"call_id"`
	// ToolName is the name of the tool being called.
	ToolName string `json:"tool_name"`
	// Args are the arguments the LLM passed to the tool.
	Args map[string]interface{} `json:"args,omitempty"`
	// Result is the tool output (set when Phase == "result").
	Result string `json:"result,omitempty"`
	// Error is the error message (set when Phase == "error").
	Error string `json:"error,omitempty"`
	// TurnIndex is which agentic turn this tool call belongs to (0-based).
	TurnIndex int `json:"turn_index"`
}

// AgentConfig controls the agentic loop behaviour.
type AgentConfig struct {
	// MaxTurns caps the number of LLM→tool→LLM rounds (default 10).
	// Prevents infinite loops if the LLM keeps calling tools.
	MaxTurns int
	// ParallelTools enables concurrent execution of multiple tool calls
	// returned in a single LLM response (default true).
	ParallelTools bool
	// Namespace is the session-pinned K8s namespace; the executor
	// wrapper (see internal/llm/executor_wrapper.go) passes it to
	// the deterministic-render path so DerivedSummary.Namespace is
	// populated without reading raw tool data.
	Namespace string
}

// RenderBlockEvent is a structured renderer payload pushed onto the
// agent stream by the executor wrapper. It bypasses the LLM entirely
// for tools classified Deterministic in package render.
type RenderBlockEvent struct {
	// Type matches a registered RenderType
	// (e.g. "kubectl_table", "yaml_block", "render_error").
	Type string `json:"type"`
	// Data is opaque JSON owned by the brain's shaper.
	Data []byte `json:"data"`
	// Summary is a ≤80-char single-line description; brain enforces.
	Summary string `json:"summary,omitempty"`
}

// DefaultAgentConfig returns safe production defaults.
//
// MaxTurns was 10 historically. Bench on Apr 21 showed 14/250 prompts hit
// that cap when the LLM walked resource lists one namespace at a time.
// Bumped to 20. Overridable via KOTG_AGENT_MAX_TURNS for ops who want to
// tune without a rebuild.
func DefaultAgentConfig() AgentConfig {
	max := 20
	if v := os.Getenv("KOTG_AGENT_MAX_TURNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			max = n
		}
	}
	return AgentConfig{
		MaxTurns:      max,
		ParallelTools: true,
	}
}

// AgentStreamEvent is a union of text tokens and tool events, sent on a
// single channel during the agentic loop.
type AgentStreamEvent struct {
	// TextToken is set when this event carries a streamed text token.
	TextToken string
	// ToolEvent is set when this event carries a tool lifecycle notification.
	ToolEvent *ToolEvent
	// RenderBlock is set when this event carries a structured render
	// payload pushed by the executor wrapper for Deterministic tools.
	RenderBlock *RenderBlockEvent
	// Done signals the end of the agentic loop.
	Done bool
	// Err carries any terminal error from the agentic loop.
	Err error
	// TokenUsage is non-nil only on the terminal Done event and carries
	// the provider's final input/output token counts. Providers that
	// don't surface usage leave this nil.
	TokenUsage *TokenUsage
}
