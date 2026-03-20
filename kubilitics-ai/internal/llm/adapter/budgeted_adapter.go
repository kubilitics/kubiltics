package adapter

// budgetedAdapter wraps LLMAdapter with pre-flight budget checks and
// post-call token recording. This is the recommended production wrapper:
//
//	adapter, _ := NewLLMAdapter(cfg)
//	safe := NewBudgetedAdapter(adapter, tracker, "user-123", "inv-456")
//
// The budgeted adapter satisfies the same LLMAdapter interface so callers
// do not need to change.

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-ai/internal/llm/budget"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// budgetedAdapterImpl wraps an LLMAdapter with budget enforcement.
type budgetedAdapterImpl struct {
	inner           LLMAdapter
	tracker         budget.BudgetTracker
	userID          string
	investigationID string
	provider        string
}

// NewBudgetedAdapter creates an LLMAdapter with pre-flight budget checks.
// userID is the calling user; investigationID is optional (pass "" if none).
// provider is used for cost calculation (e.g. "anthropic", "openai", "ollama").
func NewBudgetedAdapter(inner LLMAdapter, tracker budget.BudgetTracker, userID, investigationID, provider string) LLMAdapter {
	return &budgetedAdapterImpl{
		inner:           inner,
		tracker:         tracker,
		userID:          userID,
		investigationID: investigationID,
		provider:        provider,
	}
}

// Complete performs a budget check, executes the LLM call, then records usage.
func (a *budgetedAdapterImpl) Complete(ctx context.Context, messages []types.Message, tools []types.Tool) (string, []interface{}, error) {
	// Pre-flight: enforce hard limit
	if err := a.tracker.EnforceBudgetLimit(ctx, a.userID); err != nil {
		return "", nil, fmt.Errorf("budget limit: %w", err)
	}

	// Estimate token count for a soft-limit check (best-effort)
	if estimated, err := a.inner.CountTokens(ctx, messages, tools); err == nil {
		ok, warn := a.tracker.CheckBudgetAvailable(ctx, a.userID, estimated)
		if !ok {
			return "", nil, fmt.Errorf("budget insufficient for estimated %d tokens", estimated)
		}
		if warn != nil {
			// Log warning but continue
			_ = warn // caller can check budget metrics via REST API
		}
	}

	// Execute
	resp, toolCalls, err := a.inner.Complete(ctx, messages, tools)
	if err != nil {
		return resp, toolCalls, err
	}

	// Post-call: record usage (estimate from response length if no usage header)
	inputTokens, outputTokens := estimateTokens(messages, resp)
	_ = a.tracker.RecordTokenUsage(ctx, a.userID, a.investigationID, inputTokens, outputTokens, a.provider)

	return resp, toolCalls, nil
}

// CompleteStream wraps streaming — records estimated usage on first message.
func (a *budgetedAdapterImpl) CompleteStream(ctx context.Context, messages []types.Message, tools []types.Tool) (chan string, chan interface{}, error) {
	if err := a.tracker.EnforceBudgetLimit(ctx, a.userID); err != nil {
		return nil, nil, fmt.Errorf("budget limit: %w", err)
	}

	textCh, toolCh, err := a.inner.CompleteStream(ctx, messages, tools)
	if err != nil {
		return nil, nil, err
	}

	// Wrap text channel to record usage after streaming completes
	wrappedCh := make(chan string, cap(textCh))
	go func() {
		var total int
		for token := range textCh {
			wrappedCh <- token
			total += len(token) / 4 // rough token estimate
		}
		close(wrappedCh)
		inputTokens, _ := estimateTokens(messages, "")
		_ = a.tracker.RecordTokenUsage(ctx, a.userID, a.investigationID, inputTokens, total, a.provider)
	}()

	return wrappedCh, toolCh, nil
}

// CompleteWithTools wraps the agentic loop with a pre-flight budget check.
// Token usage is recorded after the loop completes.
func (a *budgetedAdapterImpl) CompleteWithTools(
	ctx context.Context,
	messages []types.Message,
	tools []types.Tool,
	executor types.ToolExecutor,
	cfg types.AgentConfig,
) (<-chan types.AgentStreamEvent, error) {
	if err := a.tracker.EnforceBudgetLimit(ctx, a.userID); err != nil {
		return nil, fmt.Errorf("budget limit: %w", err)
	}

	evtCh, err := a.inner.CompleteWithTools(ctx, messages, tools, executor, cfg)
	if err != nil {
		return nil, err
	}

	// Wrap the channel to record usage after the loop finishes.
	wrapped := make(chan types.AgentStreamEvent, 64)
	go func() {
		var outputTokens int
		for evt := range evtCh {
			if evt.TextToken != "" {
				outputTokens += len(evt.TextToken) / 4
			}
			wrapped <- evt
			if evt.Done || evt.Err != nil {
				break
			}
		}
		close(wrapped)
		inputTokens, _ := estimateTokens(messages, "")
		_ = a.tracker.RecordTokenUsage(ctx, a.userID, a.investigationID, inputTokens, outputTokens, a.provider)
	}()

	return wrapped, nil
}

// CountTokens delegates to the inner adapter.
func (a *budgetedAdapterImpl) CountTokens(ctx context.Context, messages []types.Message, tools []types.Tool) (int, error) {
	return a.inner.CountTokens(ctx, messages, tools)
}

// GetCapabilities delegates to the inner adapter.
func (a *budgetedAdapterImpl) GetCapabilities(ctx context.Context) (interface{}, error) {
	return a.inner.GetCapabilities(ctx)
}

// NormalizeToolCall delegates to the inner adapter.
func (a *budgetedAdapterImpl) NormalizeToolCall(ctx context.Context, toolCall interface{}) (map[string]interface{}, error) {
	return a.inner.NormalizeToolCall(ctx, toolCall)
}

// estimateTokens provides a rough token count estimate (4 chars per token).
func estimateTokens(messages []types.Message, response string) (int, int) {
	inputChars := 0
	for _, m := range messages {
		inputChars += len(m.Content)
	}
	return inputChars / 4, len(response) / 4
}
