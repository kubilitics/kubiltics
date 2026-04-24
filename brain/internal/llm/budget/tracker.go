package budget

import "context"

// Package budget provides token budget tracking across investigations and sessions.
//
// Responsibilities:
//   - Track token usage per session, per user, and per investigation
//   - Enforce configurable token/cost spending limits
//   - Monitor cumulative costs across providers
//   - Provide usage analytics (breakdown by investigation, model, etc.)
//   - Alert when approaching budget limits
//   - Block investigations if budget exceeded
//   - Per-user budget allocation (if multi-user setup)
//
// Budget Types:
//   1. Global Budget: Total spend across all users/investigations
//   2. Per-User Budget: Spending limit per user account
//   3. Per-Investigation Budget: Max tokens/cost per single investigation
//   4. Per-LLM-Provider Budget: Separate limits for OpenAI, Anthropic, Ollama, etc.
//
// Budget Enforcement:
//   - Soft limit: Warn when approaching limit, continue
//   - Hard limit: Block new operations when limit reached
//   - Configurable per budget type
//
// Token Tracking:
//   - Input tokens (from user messages, context, tools)
//   - Output tokens (LLM response, tool calls)
//   - Total tokens (sum of input + output)
//   - Tokens per tool call
//
// Cost Calculation:
//   - Cost = (input_tokens * input_cost) + (output_tokens * output_cost)
//   - Provider-specific pricing (OpenAI, Anthropic, etc.)
//   - Ollama: zero cost
//   - Custom: configurable cost
//
// Integration Points:
//   - LLM Adapter: Reports token usage per completion
//   - Reasoning Engine: Checks budget before starting investigation
//   - REST API: Exposes usage endpoints
//   - Audit Logger: Records budget-related decisions

// BudgetTracker defines the interface for budget tracking.
type BudgetTracker interface {
	// RecordTokenUsage records token usage from an LLM call.
	RecordTokenUsage(ctx context.Context, userID string, investigationID string, inputTokens int, outputTokens int, provider string) error

	// GetUsageSummary returns total usage summary for a user or global.
	GetUsageSummary(ctx context.Context, userID string) (interface{}, error)

	// GetUsageDetails returns detailed usage breakdown.
	GetUsageDetails(ctx context.Context, userID string, investigationID string) (interface{}, error)

	// CheckBudgetAvailable checks if budget is available for operation.
	// Returns true if budget available, false if limit reached or exceeded.
	CheckBudgetAvailable(ctx context.Context, userID string, estimatedTokens int) (bool, error)

	// EnforceBudgetLimit blocks operations if budget exceeded.
	// Returns error if limit violated.
	EnforceBudgetLimit(ctx context.Context, userID string) error

	// GetEstimatedCost estimates cost of an operation.
	GetEstimatedCost(ctx context.Context, inputTokens int, outputTokens int, provider string) (float64, error)

	// ResetBudget resets usage counters (typically on monthly cycle).
	ResetBudget(ctx context.Context, userID string) error

	// SetBudgetLimit sets new budget limit for user.
	SetBudgetLimit(ctx context.Context, userID string, limitDollars float64) error

	// GetBudgetLimits returns current budget limits.
	GetBudgetLimits(ctx context.Context, userID string) (interface{}, error)
}

// NewBudgetTracker creates a new budget tracker.
// The concrete implementation is in tracker_impl.go.
