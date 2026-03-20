package v2

import (
	"testing"
	"time"
)

func TestCache_SetAndGet(t *testing.T) {
	c := NewCache()
	key := CacheKey{ClusterID: "test", Mode: ViewModeNamespace}
	resp := &TopologyResponse{Metadata: TopologyMetadata{ClusterID: "test"}}
	c.Set(key, resp, 10*time.Second)
	got, ok := c.Get(key)
	if !ok {
		t.Fatal("expected cache hit")
	}
	if got.Metadata.ClusterID != "test" {
		t.Errorf("expected clusterID test, got %s", got.Metadata.ClusterID)
	}
	if got.Metadata.CachedAt == "" {
		t.Error("expected CachedAt to be set")
	}
}

func TestCache_Expired(t *testing.T) {
	c := NewCache()
	key := CacheKey{ClusterID: "test", Mode: ViewModeNamespace}
	resp := &TopologyResponse{Metadata: TopologyMetadata{ClusterID: "test"}}
	c.Set(key, resp, 1*time.Millisecond)
	time.Sleep(5 * time.Millisecond)
	_, ok := c.Get(key)
	if ok {
		t.Error("expected cache miss for expired entry")
	}
}

func TestCache_Invalidate(t *testing.T) {
	c := NewCache()
	key := CacheKey{ClusterID: "test", Mode: ViewModeNamespace}
	resp := &TopologyResponse{Metadata: TopologyMetadata{ClusterID: "test"}}
	c.Set(key, resp, 10*time.Second)
	c.Invalidate(key)
	_, ok := c.Get(key)
	if ok {
		t.Error("expected cache miss after invalidation")
	}
}

func TestCache_InvalidateCluster(t *testing.T) {
	c := NewCache()
	resp := &TopologyResponse{Metadata: TopologyMetadata{ClusterID: "test"}}
	c.Set(CacheKey{ClusterID: "c1", Mode: ViewModeNamespace}, resp, 10*time.Second)
	c.Set(CacheKey{ClusterID: "c1", Mode: ViewModeCluster}, resp, 10*time.Second)
	c.Set(CacheKey{ClusterID: "c2", Mode: ViewModeNamespace}, resp, 10*time.Second)
	c.InvalidateCluster("c1")
	if c.Size() != 1 {
		t.Errorf("expected 1 entry after cluster invalidation, got %d", c.Size())
	}
}

func TestCache_Cleanup(t *testing.T) {
	c := NewCache()
	resp := &TopologyResponse{Metadata: TopologyMetadata{ClusterID: "test"}}
	c.Set(CacheKey{ClusterID: "expired", Mode: ViewModeNamespace}, resp, 1*time.Millisecond)
	c.Set(CacheKey{ClusterID: "valid", Mode: ViewModeNamespace}, resp, 10*time.Second)
	time.Sleep(5 * time.Millisecond)
	removed := c.Cleanup()
	if removed != 1 {
		t.Errorf("expected 1 removed, got %d", removed)
	}
	if c.Size() != 1 {
		t.Errorf("expected 1 entry remaining, got %d", c.Size())
	}
}

func TestCache_SetNil(t *testing.T) {
	c := NewCache()
	key := CacheKey{ClusterID: "test", Mode: ViewModeNamespace}
	c.Set(key, nil, 10*time.Second)
	if c.Size() != 0 {
		t.Error("expected 0 entries after setting nil")
	}
}
