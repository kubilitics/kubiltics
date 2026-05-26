package guardrails

import (
	"fmt"
	"sync"
)

// ToolCallBudget enforces a per-session cap on tool calls to prevent
// runaway agentic loops.  Once the budget is exhausted every subsequent
// call returns an error that the LLM should treat as a termination signal.
//
// The budget is intentionally simple (a counter + ceiling) rather than
// token-weighted, because the goal is to stop infinite loops, not to
// optimise LLM cost (that is handled by the budget tracker in internal/llm/budget).
type ToolCallBudget struct {
	mu      sync.Mutex
	count   int
	limit   int
	// perToolCount tracks calls per tool name for diagnostics.
	perTool map[string]int
}

// NewToolCallBudget creates a budget with the given call limit.
// A limit of 0 disables enforcement (all calls allowed).
func NewToolCallBudget(limit int) *ToolCallBudget {
	return &ToolCallBudget{
		limit:   limit,
		perTool: make(map[string]int),
	}
}

// Check returns an error if the budget is already exhausted.
// The check does NOT consume budget — call Consume after a successful check.
func (b *ToolCallBudget) Check(toolName string) error {
	if b.limit == 0 {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.count >= b.limit {
		return fmt.Errorf(
			"tool call budget exhausted: %d/%d calls used this session "+
				"(this tool: %q, session total: %d). "+
				"The session has reached its maximum tool call limit to prevent runaway loops. "+
				"Please summarise findings and stop calling tools.",
			b.count, b.limit, toolName, b.count,
		)
	}
	return nil
}

// Consume increments the counter.  Must be called after a successful execution.
func (b *ToolCallBudget) Consume(toolName string) {
	if b.limit == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.count++
	b.perTool[toolName]++
}

// Remaining returns how many calls remain in the budget.
// Returns -1 if the budget is disabled (limit=0).
func (b *ToolCallBudget) Remaining() int {
	if b.limit == 0 {
		return -1
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	r := b.limit - b.count
	if r < 0 {
		return 0
	}
	return r
}

// Stats returns a snapshot of budget usage for monitoring.
func (b *ToolCallBudget) Stats() map[string]interface{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	perTool := make(map[string]int, len(b.perTool))
	for k, v := range b.perTool {
		perTool[k] = v
	}
	remaining := max(0, b.limit-b.count)
	if b.limit == 0 {
		remaining = -1 // consistent with Remaining() when budget is disabled
	}
	return map[string]interface{}{
		"total_calls": b.count,
		"limit":       b.limit,
		"remaining":   remaining,
		"disabled":    b.limit == 0,
		"per_tool":    perTool,
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
