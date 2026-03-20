// Package topologycache provides a TTL cache for topology graphs per (clusterID, namespace).
// Invalidated on WebSocket resource update for that scope (C1.3).
package topologycache

import (
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

type entry struct {
	graph *models.TopologyGraph
	expAt time.Time
}

// Cache holds topology graphs by (clusterID, namespace) with TTL. Thread-safe.
type Cache struct {
	ttl   time.Duration
	mu    sync.RWMutex
	store map[string]*entry
}

// New returns a cache with the given TTL. If ttl <= 0, Get will always miss (cache disabled).
func New(ttl time.Duration) *Cache {
	return &Cache{
		ttl:   ttl,
		store: make(map[string]*entry),
	}
}

func key(clusterID, namespace string) string {
	if namespace == "" {
		return clusterID + "|"
	}
	return clusterID + "|" + namespace
}

// Get returns a cached graph if the key exists and is not expired. Records hit/miss.
func (c *Cache) Get(clusterID, namespace string) (*models.TopologyGraph, bool) {
	if c.ttl <= 0 {
		metrics.TopologyCacheMissesTotal.Inc()
		return nil, false
	}
	k := key(clusterID, namespace)
	c.mu.RLock()
	e, ok := c.store[k]
	c.mu.RUnlock()
	if !ok || e == nil || time.Now().After(e.expAt) {
		metrics.TopologyCacheMissesTotal.Inc()
		return nil, false
	}
	metrics.TopologyCacheHitsTotal.Inc()
	return e.graph, true
}

// Set stores the graph for the given scope with TTL from cache config.
func (c *Cache) Set(clusterID, namespace string, graph *models.TopologyGraph) {
	if c.ttl <= 0 || graph == nil {
		return
	}
	k := key(clusterID, namespace)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[k] = &entry{graph: graph, expAt: time.Now().Add(c.ttl)}
}

// InvalidateForCluster removes all cached entries for the cluster (any namespace).
func (c *Cache) InvalidateForCluster(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := clusterID + "|"
	for k := range c.store {
		if strings.HasPrefix(k, prefix) {
			delete(c.store, k)
		}
	}
}

// InvalidateForClusterNamespace removes the entry for (clusterID, namespace).
// Use namespace == "" to invalidate cluster-scoped topology only (key clusterID|).
func (c *Cache) InvalidateForClusterNamespace(clusterID, namespace string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.store, key(clusterID, namespace))
}
