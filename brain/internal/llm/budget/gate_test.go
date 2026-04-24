package budget

import (
	"context"
	"testing"
)

// TestGate_AllowsDebitBelowCap — debit below the remaining budget is
// authorized and recorded.
func TestGate_AllowsDebitBelowCap(t *testing.T) {
	g := NewMemoryGate(1.00) // $1.00 cap
	ctx := context.Background()
	if err := g.AllowDebit(ctx, 0.10); err != nil {
		t.Fatalf("AllowDebit below cap: %v", err)
	}
	if got := g.SpentUSD(); got < 0.10-1e-9 || got > 0.10+1e-9 {
		t.Fatalf("SpentUSD = %v want 0.10", got)
	}
}

// TestGate_BlocksWhenOver — a debit that would cross the cap returns
// ErrBudgetExceeded and is NOT recorded (transactional: either the spend
// fully commits or not at all).
func TestGate_BlocksWhenOver(t *testing.T) {
	g := NewMemoryGate(1.00)
	ctx := context.Background()
	_ = g.AllowDebit(ctx, 0.95)
	err := g.AllowDebit(ctx, 0.10)
	if err == nil {
		t.Fatal("expected budget-exceeded error")
	}
	if err != ErrBudgetExceeded {
		t.Fatalf("err = %v, want ErrBudgetExceeded", err)
	}
	if got := g.SpentUSD(); got < 0.95-1e-9 || got > 0.95+1e-9 {
		t.Fatalf("rejected debit must not commit: SpentUSD = %v want 0.95", got)
	}
}

// TestGate_ZeroCapIsUnlimited — cap 0 means "no cap", matching the
// existing budget semantics in SetBudgetLimit.
func TestGate_ZeroCapIsUnlimited(t *testing.T) {
	g := NewMemoryGate(0)
	ctx := context.Background()
	for i := 0; i < 100; i++ {
		if err := g.AllowDebit(ctx, 1.00); err != nil {
			t.Fatalf("unlimited gate rejected debit %d: %v", i, err)
		}
	}
}

// TestGate_Reset — ResetSpend zeros the accumulator, matching the
// "reset cap in Settings" user flow.
func TestGate_Reset(t *testing.T) {
	g := NewMemoryGate(1.00)
	ctx := context.Background()
	_ = g.AllowDebit(ctx, 0.50)
	g.ResetSpend()
	if got := g.SpentUSD(); got != 0 {
		t.Fatalf("after reset SpentUSD = %v want 0", got)
	}
	if err := g.AllowDebit(ctx, 0.90); err != nil {
		t.Fatalf("post-reset AllowDebit: %v", err)
	}
}

// TestGate_SetCap — SetCap raises or lowers the cap; a lower cap than
// current spend immediately trips the gate.
func TestGate_SetCap(t *testing.T) {
	g := NewMemoryGate(1.00)
	ctx := context.Background()
	_ = g.AllowDebit(ctx, 0.80)
	g.SetCap(0.50) // lower than current spend
	if err := g.AllowDebit(ctx, 0.01); err != ErrBudgetExceeded {
		t.Fatalf("after lowering cap, AllowDebit should fail: %v", err)
	}
	g.SetCap(2.00) // raise
	if err := g.AllowDebit(ctx, 0.50); err != nil {
		t.Fatalf("after raising cap, AllowDebit should succeed: %v", err)
	}
}
