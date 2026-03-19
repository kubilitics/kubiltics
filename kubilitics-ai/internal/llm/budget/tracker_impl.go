package budget

// Package budget — concrete BudgetTracker implementation.
//
// Design:
//   - In-memory per-user counters (persisted to DB via optional Store hook)
//   - Provider pricing table (cents per 1K tokens)
//   - Soft limit: warn, continue. Hard limit: return ErrBudgetExceeded.
//   - Global daily/monthly limits configurable via BudgetConfig.

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/metrics"
)

// ─── Pricing ─────────────────────────────────────────────────────────────────

// providerPricing maps provider names to (input, output) cost per 1K tokens in USD.
// Override any entry via environment variables:
//
//	KUBILITICS_PRICE_ANTHROPIC_IN=0.003  KUBILITICS_PRICE_ANTHROPIC_OUT=0.015
//	KUBILITICS_PRICE_OPENAI_IN=0.0025    KUBILITICS_PRICE_OPENAI_OUT=0.010
//	KUBILITICS_PRICE_CUSTOM_IN=0.001     KUBILITICS_PRICE_CUSTOM_OUT=0.002
var providerPricing = func() map[string][2]float64 {
	table := map[string][2]float64{
		"anthropic": {0.003, 0.015},  // claude-3.5-sonnet (AI-013: configurable via env)
		"openai":    {0.0025, 0.010}, // gpt-4o
		"ollama":    {0.0, 0.0},      // local, always free
		"custom":    {0.001, 0.002},  // configurable default
	}
	for _, provider := range []string{"anthropic", "openai", "custom"} {
		p := strings.ToUpper(provider)
		if in, err := strconv.ParseFloat(os.Getenv("KUBILITICS_PRICE_"+p+"_IN"), 64); err == nil {
			entry := table[provider]
			entry[0] = in
			table[provider] = entry
		}
		if out, err := strconv.ParseFloat(os.Getenv("KUBILITICS_PRICE_"+p+"_OUT"), 64); err == nil {
			entry := table[provider]
			entry[1] = out
			table[provider] = entry
		}
	}
	return table
}()

// ─── Types ────────────────────────────────────────────────────────────────────

// UsageEntry tracks token consumption for a single LLM call.
type UsageEntry struct {
	Provider        string
	InvestigationID string
	InputTokens     int
	OutputTokens    int
	CostUSD         float64
	Timestamp       time.Time
}

// UsageSummary aggregates usage for a user.
type UsageSummary struct {
	UserID            string         `json:"user_id"`
	TotalInputTokens  int            `json:"total_input_tokens"`
	TotalOutputTokens int            `json:"total_output_tokens"`
	TotalTokens       int            `json:"total_tokens"`
	TotalCostUSD      float64        `json:"total_cost_usd"`
	ByProvider        map[string]int `json:"by_provider"`      // provider → total tokens
	ByInvestigation   map[string]int `json:"by_investigation"` // investigation_id → total tokens
	BudgetLimitUSD    float64        `json:"budget_limit_usd"`
	RemainingUSD      float64        `json:"remaining_usd"`
	PeriodStart       time.Time      `json:"period_start"`
}

// BudgetConfig sets global and per-user budget limits.
type BudgetConfig struct {
	// GlobalDailyLimitUSD caps total spending per day. 0 = unlimited.
	GlobalDailyLimitUSD float64
	// DefaultPerUserLimitUSD is the default per-user budget. 0 = unlimited.
	DefaultPerUserLimitUSD float64
	// PerInvestigationLimitTokens caps tokens for a single investigation. 0 = unlimited.
	PerInvestigationLimitTokens int
	// WarnThreshold is the fraction of budget that triggers a warning (e.g. 0.8 = 80%).
	WarnThreshold float64
}

// DefaultBudgetConfig returns defaults with conservative guardrails.
// All limits can be overridden via environment variables or the Settings UI.
// 0 = unlimited (preserved for Ollama users where cost is always $0).
func DefaultBudgetConfig() *BudgetConfig {
	return &BudgetConfig{
		GlobalDailyLimitUSD:         10.0,  // $10/day global cap — prevents runaway spend
		DefaultPerUserLimitUSD:      5.0,   // $5/day per user
		PerInvestigationLimitTokens: 50000, // ~50K tokens per investigation (~$0.75 at claude-3.5-sonnet rates)
		WarnThreshold:               0.80,  // warn at 80%
	}
}

// ─── Implementation ───────────────────────────────────────────────────────────

type userBudget struct {
	limitUSD    float64
	periodStart time.Time
	entries     []*UsageEntry
}

type budgetTrackerImpl struct {
	mu    sync.RWMutex
	cfg   *BudgetConfig
	store db.Store
}

// NewBudgetTracker creates a budget tracker with default config.
// Note: This constructor is legacy; use NewBudgetTrackerWithStore instead.
func NewBudgetTracker(store db.Store) BudgetTracker {
	return NewBudgetTrackerWithConfig(DefaultBudgetConfig(), store)
}

// NewBudgetTrackerWithConfig creates a budget tracker with explicit config and store.
func NewBudgetTrackerWithConfig(cfg *BudgetConfig, store db.Store) BudgetTracker {
	if cfg == nil {
		cfg = DefaultBudgetConfig()
	}
	return &budgetTrackerImpl{
		cfg:   cfg,
		store: store,
	}
}

func (t *budgetTrackerImpl) getOrCreateUser(ctx context.Context, userID string) (*userBudget, error) {
	// With DB, we fetch limit/start from DB.
	// If not found, we use defaults.
	limit, periodStart, err := t.store.GetUserBudget(ctx, userID)
	if err != nil {
		return nil, err
	}

	if periodStart.IsZero() {
		periodStart = startOfMonth()
	}
	if limit == 0 && t.cfg.DefaultPerUserLimitUSD > 0 {
		limit = t.cfg.DefaultPerUserLimitUSD
	}

	return &userBudget{
		limitUSD:    limit,
		periodStart: periodStart,
	}, nil
}

// RecordTokenUsage records actual token usage from an LLM call.
func (t *budgetTrackerImpl) RecordTokenUsage(ctx context.Context, userID, investigationID string, inputTokens, outputTokens int, provider string) error {
	cost := calculateCost(provider, inputTokens, outputTokens)
	entry := &db.BudgetRecord{
		UserID:          userID,
		InvestigationID: investigationID,
		Provider:        provider,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		CostUSD:         cost,
		RecordedAt:      time.Now().UTC(),
	}

	metrics.LLMTokensUsed.WithLabelValues(provider, "unknown", "input").Add(float64(inputTokens))
	metrics.LLMTokensUsed.WithLabelValues(provider, "unknown", "output").Add(float64(outputTokens))
	metrics.LLMCostUSD.WithLabelValues(provider, "unknown").Add(cost)

	return t.store.AppendBudgetRecord(ctx, entry)
}

// GetUsageSummary returns usage summary for a user.
func (t *budgetTrackerImpl) GetUsageSummary(ctx context.Context, userID string) (interface{}, error) {
	// No mutex needed for DB reads usually, but we keep mutex for config access if needed?
	// tracker implementation usually stateless with DB.

	ub, err := t.getOrCreateUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	records, err := t.store.QueryBudgetRecords(ctx, userID, ub.periodStart, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("query records: %w", err)
	}

	summary := &UsageSummary{
		UserID:          userID,
		ByProvider:      map[string]int{},
		ByInvestigation: map[string]int{},
		BudgetLimitUSD:  ub.limitUSD,
		PeriodStart:     ub.periodStart,
	}

	for _, r := range records {
		summary.TotalInputTokens += r.InputTokens
		summary.TotalOutputTokens += r.OutputTokens
		summary.TotalCostUSD += r.CostUSD
		summary.ByProvider[r.Provider] += r.InputTokens + r.OutputTokens
		if r.InvestigationID != "" {
			summary.ByInvestigation[r.InvestigationID] += r.InputTokens + r.OutputTokens
		}
	}
	summary.TotalTokens = summary.TotalInputTokens + summary.TotalOutputTokens
	if ub.limitUSD > 0 {
		summary.RemainingUSD = ub.limitUSD - summary.TotalCostUSD
	}

	return summary, nil
}

// GetUsageDetails returns per-investigation usage breakdown.
func (t *budgetTrackerImpl) GetUsageDetails(ctx context.Context, userID, investigationID string) (interface{}, error) {
	ub, err := t.getOrCreateUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Fetch all records for the current period
	records, err := t.store.QueryBudgetRecords(ctx, userID, ub.periodStart, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("get usage details: %w", err)
	}

	var entries []*UsageEntry
	for _, r := range records {
		if investigationID == "" || r.InvestigationID == investigationID {
			entries = append(entries, &UsageEntry{
				Provider:        r.Provider,
				InvestigationID: r.InvestigationID,
				InputTokens:     r.InputTokens,
				OutputTokens:    r.OutputTokens,
				CostUSD:         r.CostUSD,
				Timestamp:       r.RecordedAt,
			})
		}
	}
	return entries, nil
}

// CheckBudgetAvailable checks if the user has budget for an estimated call.
func (t *budgetTrackerImpl) CheckBudgetAvailable(ctx context.Context, userID string, estimatedTokens int) (bool, error) {
	ub, err := t.getOrCreateUser(ctx, userID)
	if err != nil {
		return false, err // fail safe or fail closed? fail closed for budget.
	}
	if ub.limitUSD <= 0 {
		return true, nil // unlimited
	}

	// Get current spend
	records, err := t.store.QueryBudgetRecords(ctx, userID, ub.periodStart, time.Now().UTC())
	if err != nil {
		return false, fmt.Errorf("check budget: %w", err)
	}
	spent := 0.0
	for _, r := range records {
		spent += r.CostUSD
	}

	remaining := ub.limitUSD - spent
	// Rough estimate: 1K tokens ~ average cost across providers, using custom/openai mix
	// Safe default cost $0.01 per 1K for estimation? Or usage provider context?
	// The interface doesn't give provider. Let's use 0.01 as safe upper bound or 0.005.
	estimatedCost := float64(estimatedTokens) / 1000.0 * 0.01

	if remaining < estimatedCost {
		return false, nil
	}
	// Warn threshold
	if remaining < ub.limitUSD*(1-t.cfg.WarnThreshold) {
		return true, fmt.Errorf("budget warning: %.1f%% used (remaining: $%.4f)", (spent/ub.limitUSD)*100, remaining)
	}
	return true, nil
}

// EnforceBudgetLimit returns an error if the user's budget is exhausted.
func (t *budgetTrackerImpl) EnforceBudgetLimit(ctx context.Context, userID string) error {
	ub, err := t.getOrCreateUser(ctx, userID)
	if err != nil {
		return err
	}
	if ub.limitUSD <= 0 {
		return nil // unlimited
	}

	records, err := t.store.QueryBudgetRecords(ctx, userID, ub.periodStart, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("enforce budget query: %w", err)
	}
	spent := 0.0
	for _, r := range records {
		spent += r.CostUSD
	}

	if spent >= ub.limitUSD {
		metrics.BudgetExceeded.WithLabelValues(userID).Inc()
		return fmt.Errorf("budget exceeded: spent $%.4f of $%.4f limit", spent, ub.limitUSD)
	}
	return nil
}

// GetEstimatedCost estimates the cost for an LLM call.
func (t *budgetTrackerImpl) GetEstimatedCost(_ context.Context, inputTokens, outputTokens int, provider string) (float64, error) {
	return calculateCost(provider, inputTokens, outputTokens), nil
}

// ResetBudget clears usage counters for a user (e.g. on monthly cycle).
func (t *budgetTrackerImpl) ResetBudget(ctx context.Context, userID string) error {
	return t.store.ResetUserBudget(ctx, userID)
}

// SetBudgetLimit sets a spending limit for a user.
func (t *budgetTrackerImpl) SetBudgetLimit(ctx context.Context, userID string, limitDollars float64) error {
	return t.store.SetUserBudget(ctx, userID, limitDollars)
}

// GetBudgetLimits returns limit info for a user.
func (t *budgetTrackerImpl) GetBudgetLimits(ctx context.Context, userID string) (interface{}, error) {
	ub, err := t.getOrCreateUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	records, err := t.store.QueryBudgetRecords(ctx, userID, ub.periodStart, time.Now().UTC())
	spent := 0.0
	if err == nil {
		for _, r := range records {
			spent += r.CostUSD
		}
	}

	return map[string]interface{}{
		"user_id":        userID,
		"limit_usd":      ub.limitUSD,
		"spent_usd":      spent,
		"remaining_usd":  ub.limitUSD - spent,
		"period_start":   ub.periodStart,
		"warn_threshold": t.cfg.WarnThreshold,
	}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func calculateCost(provider string, inputTokens, outputTokens int) float64 {
	p := provider
	pricing, ok := providerPricing[p]
	if !ok {
		pricing = providerPricing["custom"]
	}
	inputCostPer1K := pricing[0]
	outputCostPer1K := pricing[1]
	return (float64(inputTokens)/1000.0)*inputCostPer1K + (float64(outputTokens)/1000.0)*outputCostPer1K
}

func startOfMonth() time.Time {
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}
