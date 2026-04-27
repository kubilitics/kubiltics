package server

// tool_executor.go — bridges types.ToolExecutor to the MCP server.
//
// mcpToolExecutor wraps an MCPServer so that the LLM agentic loop can
// execute tool calls without knowing about MCP internals.  Every call is
// marshalled to a JSON string so the LLM can include it in its context.

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
	mcpserver "github.com/vellankikoti/kubilitics/brain/internal/mcp/server"
	"github.com/vellankikoti/kubilitics/brain/internal/render"
	"github.com/vellankikoti/kubilitics/brain/internal/tracing/routing"
)

// Autonomy levels (mirrors config/defaults.go):
//
//	1 = Observe   — read-only, no suggestions
//	2 = Recommend — suggest actions, never execute
//	3 = Propose   — generate a plan, require human approval before execution
//	4 = Act       — execute with safety guardrails
//	5 = Autonomous — execute without confirmation (not currently surfaced in UI)
const (
	AutonomyObserve   = 1
	AutonomyRecommend = 2
	AutonomyPropose   = 3
	AutonomyAct       = 4
	AutonomyFull      = 5
)

// isMutatingTool returns true for tools that modify cluster state.
// All mutating tools use the "action_" prefix by convention (see mcp/tools/taxonomy.go).
func isMutatingTool(toolName string) bool {
	return len(toolName) > 7 && toolName[:7] == "action_"
}

// mcpToolExecutor implements types.ToolExecutor by delegating to an MCPServer.
type mcpToolExecutor struct {
	mcp           mcpserver.MCPServer
	autonomyLevel int // enforced before any mutating tool call
}

// newMCPToolExecutor creates a new executor backed by the given MCP server.
func newMCPToolExecutor(mcp mcpserver.MCPServer) *mcpToolExecutor {
	return &mcpToolExecutor{mcp: mcp, autonomyLevel: AutonomyRecommend}
}

// WithAutonomyLevel returns a copy of the executor with the specified autonomy level.
func (e *mcpToolExecutor) WithAutonomyLevel(level int) types.ToolExecutor {
	if level < AutonomyObserve || level > AutonomyFull {
		level = AutonomyRecommend
	}
	return &mcpToolExecutor{mcp: e.mcp, autonomyLevel: level}
}

// Execute runs the named tool with the provided arguments.
// Mutating tools are blocked when autonomy level < Act (4).
// The result is serialised to JSON so the LLM can read it as plain text.
// Execute runs the named tool with the provided arguments.
// Mutating tools are blocked when autonomy level < RequiredAutonomyLevel.
// The result is serialised to JSON so the LLM can read it as plain text.
func (e *mcpToolExecutor) Execute(ctx context.Context, toolName string, args map[string]interface{}) (string, error) {
	// 1. Get tool definition to check required autonomy level
	toolDef, err := e.mcp.GetTool(toolName)
	if err != nil {
		return "", fmt.Errorf("failed to get tool definition for %s: %w", toolName, err)
	}

	// 2. Check if current autonomy level is sufficient
	if e.autonomyLevel < toolDef.RequiredAutonomyLevel {
		return "", fmt.Errorf("tool %q blocked: requires autonomy level %d, but current level is %d",
			toolName, toolDef.RequiredAutonomyLevel, e.autonomyLevel)
	}

	result, err := e.mcp.ExecuteTool(ctx, toolName, args)
	if err != nil {
		return "", fmt.Errorf("mcp execute %q: %w", toolName, err)
	}

	// Normalise result to a JSON string.
	var s string
	switch v := result.(type) {
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		b, jsonErr := json.Marshal(result)
		if jsonErr != nil {
			s = fmt.Sprintf("%v", result)
		} else {
			s = string(b)
		}
	}

	// Record the summarization delta so the report can quantify how many
	// bytes the summarizer/cap removed from each tool result.
	rec := routing.FromContext(ctx)
	rawBytes := 0
	if rb, err := json.Marshal(result); err == nil {
		rawBytes = len(rb)
	}
	rec.Stage("tool_result_summarized", map[string]any{
		"tool_name": toolName,
		"bytes_in":  rawBytes,
		"bytes_out": len(s),
	})

	// Belt-and-braces string-level cap. capToolOutput already ran inside
	// ExecuteTool at the interface{} level, but a handler that returns a
	// pre-marshalled string can sneak past the map-aware trim. This byte
	// cap ensures whatever reaches the LLM conversation history is under
	// budget — essential for keeping multi-turn agentic loops inside the
	// context window (the "API 400: maximum context length" failure mode
	// the chat-quality bench was hitting on multi-tool turns).
	//
	// Skip the cap for tools classified Deterministic in package render:
	// the render wrapper above us replaces the LLM-bound result with a
	// fixed stub anyway (data goes to the user via render_block, not to
	// the LLM), so capping would only break our shaper's JSON parse.
	if render.Lookup(toolName).Class != render.Deterministic {
		const maxToolBytes = 8 * 1024
		if len(s) > maxToolBytes {
			s = s[:maxToolBytes-256] + `... [truncated: tool output exceeded ` + fmt.Sprintf("%d", maxToolBytes) + ` bytes]`
		}
	}
	return s, nil
}
