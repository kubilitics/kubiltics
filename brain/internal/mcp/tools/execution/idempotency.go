package execution

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

// IdempotencyGuard prevents the LLM from executing the same destructive
// operation twice within a short window.  It uses a SHA-256 hash of
// (toolName, sorted-args-JSON) as the deduplication key.
//
// The guard does NOT prevent a second attempt if the caller explicitly sets
// idempotency_override=true in args, which lets operators retry after a
// transient failure.
type IdempotencyGuard struct {
	mu      sync.Mutex
	entries map[string]idempotencyEntry
	window  time.Duration
}

type idempotencyEntry struct {
	recordedAt time.Time
	toolName   string
}

// NewIdempotencyGuard creates a guard with the given dedup window.
// A zero window disables the guard (all calls pass through).
func NewIdempotencyGuard(window time.Duration) *IdempotencyGuard {
	return &IdempotencyGuard{
		entries: make(map[string]idempotencyEntry),
		window:  window,
	}
}

// Check returns an error if the same (toolName, args) was recorded within
// the deduplication window and idempotency_override is not set.
// It is safe for concurrent use.
func (g *IdempotencyGuard) Check(toolName string, args map[string]interface{}) error {
	if g.window == 0 {
		return nil
	}
	// Caller may override the guard for intentional retries.
	if override, _ := args["idempotency_override"].(bool); override {
		return nil
	}

	key := idempotencyKey(toolName, args)
	g.mu.Lock()
	defer g.mu.Unlock()

	g.evict()
	if entry, ok := g.entries[key]; ok {
		age := time.Since(entry.recordedAt).Round(time.Second)
		return fmt.Errorf(
			"duplicate operation: %s with the same arguments was executed %s ago "+
				"(within the %s deduplication window). "+
				"Set idempotency_override=true to force re-execution",
			toolName, age, g.window,
		)
	}
	return nil
}

// Record marks (toolName, args) as executed.  Call this only after a
// successful execution (not on dry-run or safety-denied outcomes).
func (g *IdempotencyGuard) Record(toolName string, args map[string]interface{}) {
	if g.window == 0 {
		return
	}
	key := idempotencyKey(toolName, args)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.entries[key] = idempotencyEntry{recordedAt: time.Now(), toolName: toolName}
}

// evict removes entries older than the deduplication window.
// Must be called with g.mu held.
func (g *IdempotencyGuard) evict() {
	cutoff := time.Now().Add(-g.window)
	for k, e := range g.entries {
		if e.recordedAt.Before(cutoff) {
			delete(g.entries, k)
		}
	}
}

// idempotencyKey produces a stable hash key for (toolName, args).
// Args are serialised with sorted keys so that map iteration order
// does not affect the key.
func idempotencyKey(toolName string, args map[string]interface{}) string {
	// Filter out idempotency_override so it doesn't affect the key.
	filtered := make(map[string]interface{}, len(args))
	for k, v := range args {
		if k == "idempotency_override" {
			continue
		}
		filtered[k] = v
	}

	// Marshal with sorted keys using a sorted slice.
	keys := make([]string, 0, len(filtered))
	for k := range filtered {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	ordered := make([]interface{}, 0, len(keys)*2)
	for _, k := range keys {
		ordered = append(ordered, k, filtered[k])
	}

	b, _ := json.Marshal(ordered)
	h := sha256.Sum256(append([]byte(toolName+":"), b...))
	return fmt.Sprintf("%x", h)
}
