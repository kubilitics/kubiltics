package v2

import (
	"sync"
	"time"
)

// CacheKey is the composite key for cache entries.
type CacheKey struct {
	ClusterID string
	Mode      ViewMode
	Namespace string
	Resource  string
}

// cacheEntry holds a cached topology and its metadata.
type cacheEntry struct {
	response *TopologyResponse
	created  time.Time
	ttl      time.Duration
}

// DefaultCacheTTL is the default time-to-live for cache entries.
const DefaultCacheTTL = 30 * time.Second

// Cache is a per-cluster, per-view cache for topology responses.
type Cache struct {
	mu    sync.RWMutex
	store map[CacheKey]*cacheEntry
}

// NewCache creates an empty cache.
func NewCache() *Cache {
	return &Cache{
		store: make(map[CacheKey]*cacheEntry),
	}
}

// Get retrieves a cached response if it exists and hasn't expired.
func (c *Cache) Get(key CacheKey) (*TopologyResponse, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.store[key]
	if !ok {
		return nil, false
	}
	if time.Since(entry.created) > entry.ttl {
		return nil, false
	}
	resp := *entry.response
	resp.Metadata.CachedAt = entry.created.Format(time.RFC3339)
	return &resp, true
}

// Set stores a topology response with the given TTL.
func (c *Cache) Set(key CacheKey, resp *TopologyResponse, ttl time.Duration) {
	if resp == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[key] = &cacheEntry{
		response: resp,
		created:  time.Now(),
		ttl:      ttl,
	}
}

// Invalidate removes a specific cache entry.
func (c *Cache) Invalidate(key CacheKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.store, key)
}

// InvalidateCluster removes all cache entries for a given cluster.
func (c *Cache) InvalidateCluster(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k := range c.store {
		if k.ClusterID == clusterID {
			delete(c.store, k)
		}
	}
}

// InvalidateAll clears the entire cache.
func (c *Cache) InvalidateAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store = make(map[CacheKey]*cacheEntry)
}

// Size returns the number of entries in the cache.
func (c *Cache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.store)
}

// Cleanup removes expired entries. Call periodically from a background goroutine.
func (c *Cache) Cleanup() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	removed := 0
	for k, entry := range c.store {
		if time.Since(entry.created) > entry.ttl {
			delete(c.store, k)
			removed++
		}
	}
	return removed
}

