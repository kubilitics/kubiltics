package events

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// cacheEntry wraps a CausalChain with its insertion timestamp for staleness
// checking.
type cacheEntry struct {
	chain    *CausalChain
	storedAt time.Time
}

// ChainCache is a thread-safe in-memory cache for CausalChains keyed by
// insightID. Entries older than maxAge are treated as misses. The cache is
// backed by a Store so it can be persisted to SQLite and restored across
// process restarts.
type ChainCache struct {
	mu     sync.RWMutex
	chains map[string]cacheEntry // keyed by insightID
	maxAge time.Duration
	store  *Store
}

// NewChainCache constructs a ChainCache with the given Store and maximum entry
// age. A zero or negative maxAge disables staleness checking (entries live
// forever).
func NewChainCache(store *Store, maxAge time.Duration) *ChainCache {
	return &ChainCache{
		chains: make(map[string]cacheEntry),
		maxAge: maxAge,
		store:  store,
	}
}

// Get returns the cached CausalChain for the given insightID. The second
// return value is false when the key is absent or the entry has exceeded
// maxAge.
func (cc *ChainCache) Get(insightID string) (*CausalChain, bool) {
	cc.mu.RLock()
	entry, ok := cc.chains[insightID]
	cc.mu.RUnlock()

	if !ok {
		return nil, false
	}
	if cc.maxAge > 0 && time.Since(entry.storedAt) > cc.maxAge {
		return nil, false
	}
	return entry.chain, true
}

// Set stores the chain in the cache under its InsightID, stamped with the
// current time.
func (cc *ChainCache) Set(chain *CausalChain) {
	cc.mu.Lock()
	cc.chains[chain.InsightID] = cacheEntry{
		chain:    chain,
		storedAt: time.Now(),
	}
	cc.mu.Unlock()
}

// Invalidate removes the entry for insightID from the cache. It is a no-op
// if the key is not present.
func (cc *ChainCache) Invalidate(insightID string) {
	cc.mu.Lock()
	delete(cc.chains, insightID)
	cc.mu.Unlock()
}

// Persist writes every entry currently held in the cache to the backing Store
// via UpsertCausalChain. Stale entries are persisted as well — the Store is
// the source of truth for what is "active".
func (cc *ChainCache) Persist(ctx context.Context) error {
	cc.mu.RLock()
	snapshot := make([]cacheEntry, 0, len(cc.chains))
	for _, e := range cc.chains {
		snapshot = append(snapshot, e)
	}
	cc.mu.RUnlock()

	for _, e := range snapshot {
		if err := cc.store.UpsertCausalChain(ctx, e.chain); err != nil {
			return fmt.Errorf("chain_cache persist %s: %w", e.chain.ID, err)
		}
	}
	return nil
}

// Restore loads all active causal chains for the given clusterID from the
// backing Store and populates the in-memory cache. Existing cache entries are
// not removed; restored entries overwrite any conflicting in-memory entries.
// The storedAt timestamp is set to now so that freshly restored entries are
// not immediately considered stale.
func (cc *ChainCache) Restore(ctx context.Context, clusterID string) error {
	chains, err := cc.store.GetActiveCausalChains(ctx, clusterID)
	if err != nil {
		return fmt.Errorf("chain_cache restore cluster=%s: %w", clusterID, err)
	}

	now := time.Now()
	cc.mu.Lock()
	for i := range chains {
		c := &chains[i]
		cc.chains[c.InsightID] = cacheEntry{
			chain:    c,
			storedAt: now,
		}
	}
	cc.mu.Unlock()
	return nil
}
