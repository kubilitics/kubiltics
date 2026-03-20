package budget

import (
	"context"
	"os"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/db"
)

func newTestStore(t *testing.T) db.Store {
	f, err := os.CreateTemp("", "kubilitics-ai-budget-test-*.db")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	name := f.Name()
	f.Close()
	t.Cleanup(func() { os.Remove(name) })

	s, err := db.NewSQLiteStore(name)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	return s
}

func newTracker(t *testing.T, limitUSD float64) BudgetTracker {
	cfg := DefaultBudgetConfig()
	cfg.DefaultPerUserLimitUSD = limitUSD
	return NewBudgetTrackerWithConfig(cfg, newTestStore(t))
}

func TestRecordAndSummary(t *testing.T) {
	tr := newTracker(t, 0) // unlimited
	ctx := context.Background()

	if err := tr.RecordTokenUsage(ctx, "user-1", "inv-1", 1000, 500, "anthropic"); err != nil {
		t.Fatalf("RecordTokenUsage: %v", err)
	}
	if err := tr.RecordTokenUsage(ctx, "user-1", "inv-2", 2000, 800, "openai"); err != nil {
		t.Fatalf("RecordTokenUsage: %v", err)
	}

	raw, err := tr.GetUsageSummary(ctx, "user-1")
	if err != nil {
		t.Fatalf("GetUsageSummary: %v", err)
	}
	summary, ok := raw.(*UsageSummary)
	if !ok {
		t.Fatalf("expected *UsageSummary, got %T", raw)
	}
	if summary.TotalInputTokens != 3000 {
		t.Errorf("expected 3000 input tokens, got %d", summary.TotalInputTokens)
	}
	if summary.TotalOutputTokens != 1300 {
		t.Errorf("expected 1300 output tokens, got %d", summary.TotalOutputTokens)
	}
	if summary.TotalCostUSD <= 0 {
		t.Error("expected positive cost")
	}
	if summary.ByProvider["anthropic"] == 0 {
		t.Error("expected usage for anthropic provider")
	}
	t.Logf("Total cost: $%.6f, tokens: %d", summary.TotalCostUSD, summary.TotalTokens)
}

func TestBudgetEnforcement(t *testing.T) {

	tr := newTracker(t, 0.01) // $0.01 limit
	ctx := context.Background()

	// Record enough to exceed limit
	for i := 0; i < 5; i++ {
		_ = tr.RecordTokenUsage(ctx, "user-budget", "inv-1", 1000, 500, "openai")
	}

	err := tr.EnforceBudgetLimit(ctx, "user-budget")
	if err == nil {
		t.Error("expected budget exceeded error, got nil")
	}
	t.Logf("Budget enforcement: %v", err)
}

func TestBudgetAvailableUnlimited(t *testing.T) {
	tr := newTracker(t, 0) // unlimited
	ctx := context.Background()

	ok, _ := tr.CheckBudgetAvailable(ctx, "user-unlimited", 100000)
	if !ok {
		t.Error("expected budget available for unlimited user")
	}
}

func TestBudgetAvailableInsufficient(t *testing.T) {
	tr := newTracker(t, 0.001) // tiny limit
	ctx := context.Background()

	// Spend most of the budget
	_ = tr.RecordTokenUsage(ctx, "user-low", "inv-1", 5000, 2000, "openai")

	ok, _ := tr.CheckBudgetAvailable(ctx, "user-low", 100000)
	if ok {
		t.Error("expected budget unavailable after heavy usage")
	}
}

func TestEstimatedCost(t *testing.T) {
	tr := newTracker(t, 0)
	ctx := context.Background()

	cost, err := tr.GetEstimatedCost(ctx, 1000, 500, "anthropic")
	if err != nil {
		t.Fatalf("GetEstimatedCost: %v", err)
	}
	if cost <= 0 {
		t.Error("expected positive cost estimate")
	}
	t.Logf("Estimated cost (1000 in, 500 out, anthropic): $%.6f", cost)

	// Ollama should be free
	ollamaCost, _ := tr.GetEstimatedCost(ctx, 1000, 500, "ollama")
	if ollamaCost != 0 {
		t.Errorf("expected zero cost for ollama, got %f", ollamaCost)
	}
}

func TestResetBudget(t *testing.T) {
	tr := newTracker(t, 0.05)
	ctx := context.Background()

	_ = tr.RecordTokenUsage(ctx, "user-reset", "inv-1", 10000, 5000, "openai")

	raw, _ := tr.GetUsageSummary(ctx, "user-reset")
	before := raw.(*UsageSummary).TotalCostUSD

	if err := tr.ResetBudget(ctx, "user-reset"); err != nil {
		t.Fatalf("ResetBudget: %v", err)
	}

	raw, _ = tr.GetUsageSummary(ctx, "user-reset")
	after := raw.(*UsageSummary).TotalCostUSD

	if before == 0 {
		t.Fatal("expected non-zero cost before reset")
	}
	if after != 0 {
		t.Errorf("expected zero cost after reset, got %f", after)
	}
}

func TestSetBudgetLimit(t *testing.T) {
	tr := newTracker(t, 0)
	ctx := context.Background()

	if err := tr.SetBudgetLimit(ctx, "user-limited", 5.00); err != nil {
		t.Fatalf("SetBudgetLimit: %v", err)
	}

	raw, err := tr.GetBudgetLimits(ctx, "user-limited")
	if err != nil {
		t.Fatalf("GetBudgetLimits: %v", err)
	}
	limits, ok := raw.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", raw)
	}
	if limits["limit_usd"] != 5.00 {
		t.Errorf("expected $5 limit, got %v", limits["limit_usd"])
	}
}

func TestGetUsageDetails(t *testing.T) {
	tr := newTracker(t, 0)
	ctx := context.Background()

	_ = tr.RecordTokenUsage(ctx, "user-detail", "inv-A", 500, 200, "anthropic")
	_ = tr.RecordTokenUsage(ctx, "user-detail", "inv-B", 300, 100, "openai")

	raw, err := tr.GetUsageDetails(ctx, "user-detail", "inv-A")
	if err != nil {
		t.Fatalf("GetUsageDetails: %v", err)
	}
	entries, ok := raw.([]*UsageEntry)
	if !ok {
		t.Fatalf("expected []*UsageEntry, got %T", raw)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 entry for inv-A, got %d", len(entries))
	}
	if entries[0].InvestigationID != "inv-A" {
		t.Errorf("expected inv-A, got %s", entries[0].InvestigationID)
	}
}
