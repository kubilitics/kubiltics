package budget

import (
	"context"
	"errors"
	"sync"
)

// ErrBudgetExceeded is returned by Gate.AllowDebit when the requested
// spend would exceed the configured cap. The chat stream handler maps
// this to a `budget_exceeded` WebSocket event so the frontend banner
// can surface a "reset cap in Settings" call-to-action.
var ErrBudgetExceeded = errors.New("budget exceeded")

// Gate is the pre-spend authorization primitive for the chat stream.
//
// Phase 2 / Package B — the wider BudgetTracker records usage after the
// fact (post-completion token counts). Gate closes the other half of the
// loop: before the LLM even dispatches a tool, the caller asks
// AllowDebit(estimatedUSD) and receives a fast pass/fail. This lets
// the chat stream emit `budget_exceeded` before incurring spend rather
// than surfacing the error after a paid response.
//
// A cap of 0 means "unlimited" — matching the convention used by the
// existing SetBudgetLimit handler.
type Gate interface {
	AllowDebit(ctx context.Context, estimatedUSD float64) error
	SpentUSD() float64
	SetCap(usd float64)
	ResetSpend()
}

// MemoryGate is the in-process Gate implementation. Goroutine-safe.
type MemoryGate struct {
	mu    sync.Mutex
	cap   float64
	spent float64
}

// NewMemoryGate builds an in-memory gate with the given USD cap. cap=0
// disables enforcement (unlimited).
func NewMemoryGate(capUSD float64) *MemoryGate {
	return &MemoryGate{cap: capUSD}
}

// AllowDebit atomically checks remaining budget and, on success, commits
// the debit. On failure ErrBudgetExceeded is returned and no spend is
// recorded — callers must not partial-commit.
func (g *MemoryGate) AllowDebit(_ context.Context, estimatedUSD float64) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.cap <= 0 {
		g.spent += estimatedUSD
		return nil
	}
	if g.spent+estimatedUSD > g.cap {
		return ErrBudgetExceeded
	}
	g.spent += estimatedUSD
	return nil
}

// SpentUSD returns the running cumulative spend in dollars.
func (g *MemoryGate) SpentUSD() float64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.spent
}

// Cap returns the active cap in dollars. 0 = unlimited. Exposed for the
// admin HTTP surface (Phase 2 / Gap 3) so the frontend Settings page
// can render "Spent $x of $y".
func (g *MemoryGate) Cap() float64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.cap
}

// SetCap replaces the active cap. Existing spend is retained; the next
// AllowDebit call is evaluated against the new cap.
func (g *MemoryGate) SetCap(usd float64) {
	g.mu.Lock()
	g.cap = usd
	g.mu.Unlock()
}

// ResetSpend zeroes the accumulator. Wired to the Settings "reset cap"
// button + monthly rollover.
func (g *MemoryGate) ResetSpend() {
	g.mu.Lock()
	g.spent = 0
	g.mu.Unlock()
}
