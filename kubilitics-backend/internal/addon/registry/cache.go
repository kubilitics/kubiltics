package registry

import (
	"sync"
	"time"
)

const (
	coreCacheTTL      = 5 * time.Minute
	communityCacheTTL = 2 * time.Minute
)

type RegistryCache struct {
	entries    sync.Map
	defaultTTL time.Duration
}

type cacheEntry struct {
	value     interface{}
	expiresAt time.Time
}

func NewRegistryCache(defaultTTL time.Duration) *RegistryCache {
	if defaultTTL <= 0 {
		defaultTTL = coreCacheTTL
	}
	return &RegistryCache{defaultTTL: defaultTTL}
}

func (c *RegistryCache) Set(key string, value interface{}, ttl time.Duration) {
	if ttl <= 0 {
		ttl = c.defaultTTL
	}
	c.entries.Store(key, cacheEntry{
		value:     value,
		expiresAt: time.Now().UTC().Add(ttl),
	})
}

func (c *RegistryCache) Get(key string) (interface{}, bool) {
	v, ok := c.entries.Load(key)
	if !ok {
		return nil, false
	}
	entry, ok := v.(cacheEntry)
	if !ok {
		c.entries.Delete(key)
		return nil, false
	}
	if time.Now().UTC().After(entry.expiresAt) {
		c.entries.Delete(key)
		return nil, false
	}
	return entry.value, true
}

func (c *RegistryCache) Delete(key string) {
	c.entries.Delete(key)
}
