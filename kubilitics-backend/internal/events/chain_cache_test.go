package events

import (
	"context"
	"testing"
	"time"
)

// buildTestChain builds a minimal CausalChain for testing.
func buildTestChain(id, clusterID, insightID string) *CausalChain {
	now := time.Now().UTC().Truncate(time.Millisecond)
	root := CausalNode{
		ResourceKey:  "default/Pod/test-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "test-pod",
		EventReason:  "BackOff",
		EventMessage: "Back-off restarting failed container",
		Timestamp:    now,
		HealthStatus: "critical",
	}
	return &CausalChain{
		ID:         id,
		ClusterID:  clusterID,
		InsightID:  insightID,
		RootCause:  root,
		Links:      []CausalLinkV2{},
		Confidence: 0.85,
		Status:     "active",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

// TestChainCache_SetAndGet verifies that a chain can be stored and retrieved,
// and that a non-existent key returns a miss.
func TestChainCache_SetAndGet(t *testing.T) {
	s := newTestStore(t)
	cc := NewChainCache(s, 5*time.Minute)

	chain := buildTestChain("chain-001", "cluster-abc", "insight-xyz")
	cc.Set(chain)

	got, ok := cc.Get("insight-xyz")
	if !ok {
		t.Fatal("expected cache hit, got miss")
	}
	if got.ID != "chain-001" {
		t.Errorf("ID: want chain-001, got %s", got.ID)
	}
	if got.ClusterID != "cluster-abc" {
		t.Errorf("ClusterID: want cluster-abc, got %s", got.ClusterID)
	}
	if got.InsightID != "insight-xyz" {
		t.Errorf("InsightID: want insight-xyz, got %s", got.InsightID)
	}

	// Non-existent key returns miss.
	_, ok = cc.Get("no-such-insight")
	if ok {
		t.Error("expected cache miss for non-existent key, got hit")
	}
}

// TestChainCache_Invalidate verifies that an invalidated entry is no longer
// returned from the cache.
func TestChainCache_Invalidate(t *testing.T) {
	s := newTestStore(t)
	cc := NewChainCache(s, 5*time.Minute)

	chain := buildTestChain("chain-002", "cluster-abc", "insight-inv")
	cc.Set(chain)

	// Verify it's there first.
	_, ok := cc.Get("insight-inv")
	if !ok {
		t.Fatal("expected cache hit before invalidation")
	}

	cc.Invalidate("insight-inv")

	_, ok = cc.Get("insight-inv")
	if ok {
		t.Error("expected cache miss after Invalidate, got hit")
	}
}

// TestChainCache_StaleEntry verifies that entries older than maxAge are treated
// as cache misses.
func TestChainCache_StaleEntry(t *testing.T) {
	s := newTestStore(t)
	// Very short maxAge so the entry immediately becomes stale.
	cc := NewChainCache(s, 1*time.Millisecond)

	chain := buildTestChain("chain-003", "cluster-abc", "insight-stale")
	cc.Set(chain)

	// Sleep just long enough for the entry to exceed maxAge.
	time.Sleep(5 * time.Millisecond)

	_, ok := cc.Get("insight-stale")
	if ok {
		t.Error("expected cache miss for stale entry, got hit")
	}
}

// TestChainCache_PersistAndRestore verifies that persisting a cache to SQLite
// and restoring it in a fresh cache instance yields the original chain.
func TestChainCache_PersistAndRestore(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	cache1 := NewChainCache(s, 5*time.Minute)
	chain := buildTestChain("chain-persist-01", "cluster-persist", "insight-persist")
	cache1.Set(chain)

	if err := cache1.Persist(ctx); err != nil {
		t.Fatalf("Persist: %v", err)
	}

	// Fresh cache backed by same store.
	cache2 := NewChainCache(s, 5*time.Minute)

	if err := cache2.Restore(ctx, "cluster-persist"); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	got, ok := cache2.Get("insight-persist")
	if !ok {
		t.Fatal("expected cache hit after Restore, got miss")
	}
	if got.ID != "chain-persist-01" {
		t.Errorf("restored chain ID: want chain-persist-01, got %s", got.ID)
	}
	if got.ClusterID != "cluster-persist" {
		t.Errorf("restored ClusterID: want cluster-persist, got %s", got.ClusterID)
	}
	if got.InsightID != "insight-persist" {
		t.Errorf("restored InsightID: want insight-persist, got %s", got.InsightID)
	}
	if got.Confidence != chain.Confidence {
		t.Errorf("restored Confidence: want %.2f, got %.2f", chain.Confidence, got.Confidence)
	}
}
