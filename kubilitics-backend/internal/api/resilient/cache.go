package resilient

import (
	"container/list"
	"sync"
	"time"
)

// Entry is the public shape returned by Get.
type Entry[V any] struct {
	Value V
	At    time.Time // when Put stored this value
}

type lruItem[K comparable, V any] struct {
	key   K
	entry Entry[V]
}

// LRUCache is a thread-safe least-recently-used cache. Get promotes
// recency; Put evicts the oldest when capacity is exceeded.
type LRUCache[K comparable, V any] struct {
	mu       sync.Mutex
	capacity int
	order    *list.List
	items    map[K]*list.Element
}

func NewLRUCache[K comparable, V any](capacity int) *LRUCache[K, V] {
	if capacity <= 0 {
		capacity = 1
	}
	return &LRUCache[K, V]{
		capacity: capacity,
		order:    list.New(),
		items:    make(map[K]*list.Element, capacity),
	}
}

func (c *LRUCache[K, V]) Get(key K) (Entry[V], bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		return Entry[V]{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*lruItem[K, V]).entry, true
}

func (c *LRUCache[K, V]) Put(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := Entry[V]{Value: value, At: time.Now()}
	if el, ok := c.items[key]; ok {
		el.Value.(*lruItem[K, V]).entry = entry
		c.order.MoveToFront(el)
		return
	}
	el := c.order.PushFront(&lruItem[K, V]{key: key, entry: entry})
	c.items[key] = el
	if c.order.Len() > c.capacity {
		oldest := c.order.Back()
		if oldest != nil {
			c.order.Remove(oldest)
			delete(c.items, oldest.Value.(*lruItem[K, V]).key)
		}
	}
}
