// Package cache provides an in-memory TTL cache for metrics responses.
// Interface is Redis-ready: Get/Set with key string; swap implementation later without changing callers.
package metrics

import (
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const defaultMetricsCacheTTL = 30 * time.Second

// MetricsCache caches MetricsSummary by a string key (e.g. clusterID:namespace:resourceType:name).
type MetricsCache interface {
	Get(key string) (*models.MetricsSummary, bool)
	Set(key string, summary *models.MetricsSummary, ttl time.Duration)
}

type entry struct {
	summary *models.MetricsSummary
	expiry time.Time
}

// InMemoryMetricsCache is a TTL cache. Not distributed; use a Redis implementation for multi-instance.
type InMemoryMetricsCache struct {
	mu    sync.RWMutex
	items map[string]entry
	ttl   time.Duration
}

// NewInMemoryMetricsCache returns a cache with the given default TTL.
func NewInMemoryMetricsCache(defaultTTL time.Duration) *InMemoryMetricsCache {
	if defaultTTL <= 0 {
		defaultTTL = defaultMetricsCacheTTL
	}
	return &InMemoryMetricsCache{
		items: make(map[string]entry),
		ttl:   defaultTTL,
	}
}

func (c *InMemoryMetricsCache) Get(key string) (*models.MetricsSummary, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.items[key]
	if !ok || time.Now().After(e.expiry) {
		return nil, false
	}
	return e.summary, true
}

func (c *InMemoryMetricsCache) Set(key string, summary *models.MetricsSummary, ttl time.Duration) {
	if ttl <= 0 {
		ttl = c.ttl
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = entry{summary: summary, expiry: time.Now().Add(ttl)}
}

// CacheKey builds a stable key for the identity (for deduplication).
func CacheKey(clusterID, namespace string, resourceType models.ResourceType, resourceName string) string {
	return clusterID + ":" + namespace + ":" + string(resourceType) + ":" + resourceName
}
