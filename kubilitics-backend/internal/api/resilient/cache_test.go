package resilient

import (
	"sync"
	"testing"
	"time"
)

func TestLRUCache_PutAndGet(t *testing.T) {
	c := NewLRUCache[string, int](3)
	c.Put("a", 1)
	c.Put("b", 2)
	if e, ok := c.Get("a"); !ok || e.Value != 1 {
		t.Fatalf("get a: %+v ok=%v", e, ok)
	}
}

func TestLRUCache_EvictsOldest(t *testing.T) {
	c := NewLRUCache[string, int](2)
	c.Put("a", 1)
	c.Put("b", 2)
	c.Put("c", 3) // evicts a
	if _, ok := c.Get("a"); ok {
		t.Fatal("expected a to be evicted")
	}
	if e, _ := c.Get("b"); e.Value != 2 {
		t.Fatalf("b lost: %+v", e)
	}
}

func TestLRUCache_GetPromotesRecency(t *testing.T) {
	c := NewLRUCache[string, int](2)
	c.Put("a", 1)
	c.Put("b", 2)
	_, _ = c.Get("a") // promote a
	c.Put("c", 3)     // evicts b, not a
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should survive")
	}
	if _, ok := c.Get("b"); ok {
		t.Fatal("b should be evicted")
	}
}

func TestLRUCache_ThreadSafe(t *testing.T) {
	c := NewLRUCache[string, int](100)
	var wg sync.WaitGroup
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := "k" + string(rune('a'+i%26))
			c.Put(k, i)
			_, _ = c.Get(k)
		}(i)
	}
	wg.Wait() // if this hits a race, -race catches it
}

func TestLRUCache_EntryTimestamp(t *testing.T) {
	c := NewLRUCache[string, int](2)
	before := time.Now()
	c.Put("a", 1)
	e, _ := c.Get("a")
	if e.At.Before(before) {
		t.Fatalf("entry timestamp before Put: %v < %v", e.At, before)
	}
}
