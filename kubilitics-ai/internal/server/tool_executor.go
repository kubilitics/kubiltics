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

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	mcpserver "github.com/kubilitics/kubilitics-ai/internal/mcp/server"
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
	switch v := result.(type) {
	case string:
		return v, nil
	case []byte:
		return string(v), nil
	default:
		b, jsonErr := json.Marshal(result)
		if jsonErr != nil {
			return fmt.Sprintf("%v", result), nil
		}
		return string(b), nil
	}
}
