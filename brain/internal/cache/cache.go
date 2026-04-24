package cache

import "context"

// Package cache provides multi-tier caching to reduce redundant operations.
//
// Responsibilities:
//   - Cache tool call results (avoid redundant cluster queries)
//   - Cache LLM responses (exact match, avoid redundant API calls)
//   - Cache analytics computations (invalidated on data change)
//   - Manage cache lifetime and invalidation
//   - Monitor cache hit/miss rates
//
// Cache Tiers:
//
//   1. Tool Result Cache
//      - TTL: 30 seconds for resource queries, 5 minutes for metrics
//      - Key: tool_name + args hash
//      - Value: tool result
//      - Use case: Same resource queried multiple times
//      - Example: get_resource called twice → second call hits cache
//
//   2. LLM Response Cache
//      - TTL: 1 day
//      - Key: message_hash (exact match on messages)
//      - Value: LLM response
//      - Use case: Identical investigation context
//      - Example: Same pod crash investigated twice → use cached reasoning
//
//   3. Analytics Cache
//      - TTL: 5 minutes or until data changes
//      - Key: computation + parameters
//      - Value: computed result (trends, forecasts, scores)
//      - Invalidation: On new metrics received
//      - Use case: Expensive computations called multiple times
//
// Cache Key Strategy:
//   - Function name + serialized parameters → hash
//   - Example: get_resource(ns: "default", kind: "Pod", name: "app") → unique key
//   - Hash ensures cache keys are fixed-size
//
// TTL Strategy (configurable):
//   - Hot data (last 1 minute): 30 second TTL (catch duplicates)
//   - Recent data (last hour): 5 minute TTL (safe for trend analysis)
//   - Historical data: 1 hour TTL (change unlikely)
//   - LLM responses: 1 day (don't change during same day)
//   - Computations: 5 minutes or invalidated on change
//
// Invalidation Triggers:
//   - TTL expiration (automatic)
//   - Resource change detected (World Model push update)
//   - Metric data change (time-series update)
//   - Manual invalidation (force refresh)
//   - User-initiated clear cache
//
// Memory Management:
//   - LRU eviction when cache exceeds max size
//   - Configurable max size (default 100MB)
//   - Monitor memory usage
//   - Warn if cache evictions frequent
//
// Integration Points:
//   - MCP Server: Cache tool call results
//   - LLM Adapter: Cache completions
//   - Analytics Engine: Cache computations
//   - World Model: Trigger invalidation on updates
//   - REST API: Cache control headers

// Cache defines the interface for caching operations.
type Cache interface {
	// Get retrieves a cached value by key.
	// Returns: value, found (bool), error
	Get(ctx context.Context, key string) (interface{}, bool, error)

	// Set stores a value with given key and TTL.
	// ttlSeconds: time to live in seconds (0 = never expire)
	Set(ctx context.Context, key string, value interface{}, ttlSeconds int) error

	// Delete removes a key from cache.
	Delete(ctx context.Context, key string) error

	// Clear removes all entries from cache.
	Clear(ctx context.Context) error

	// Invalidate marks certain keys for refresh.
	// pattern: glob pattern to match keys (e.g., "get_resource:*")
	Invalidate(ctx context.Context, pattern string) error

	// GetStats returns cache statistics.
	// Returns: hits, misses, size_bytes, entry_count
	GetStats(ctx context.Context) (interface{}, error)

	// SetTTL changes TTL for a specific key.
	SetTTL(ctx context.Context, key string, ttlSeconds int) error

	// Has checks if key exists and is not expired.
	Has(ctx context.Context, key string) (bool, error)

	// WatchKey watches for changes to a key.
	// Returns channel that emits when key value changes.
	WatchKey(ctx context.Context, key string) <-chan interface{}
}

// NewCache creates a new cache with configurable backends.
func NewCache() Cache {
	// Initialize in-memory cache with LRU eviction
	// Load configuration (max size, TTLs)
	// Set up background cleanup for expired entries
	return nil
}
