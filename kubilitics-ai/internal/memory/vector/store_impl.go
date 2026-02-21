package vector

import (
	"context"
	"strings"
	"sync"
	"time"
)

// indexedItem is a stored item in the in-memory vector store.
type indexedItem struct {
	id        string
	itemType  string // "investigation", "error_pattern", "document"
	text      string // searchable text
	payload   interface{}
	createdAt time.Time
}

// inMemoryVectorStore is a graceful-degradation implementation.
// It uses keyword search when no embedding backend is available.
type inMemoryVectorStore struct {
	mu    sync.RWMutex
	items []*indexedItem
	seq   int
}

// NewVectorStore creates a new in-memory vector store (graceful degradation).
func NewVectorStore() VectorStore {
	return &inMemoryVectorStore{
		items: make([]*indexedItem, 0, 256),
	}
}

func (s *inMemoryVectorStore) nextID() string {
	s.seq++
	return strings.Join([]string{"item", string(rune('0' + s.seq/100%10)), string(rune('0' + s.seq/10%10)), string(rune('0' + s.seq%10))}, "")
}

// SearchInvestigations finds similar past investigations via keyword search.
func (s *inMemoryVectorStore) SearchInvestigations(ctx context.Context, query string, limit int) ([]interface{}, error) {
	return s.search(ctx, "investigation", query, limit)
}

// SearchErrorPatterns finds similar error patterns via keyword search.
func (s *inMemoryVectorStore) SearchErrorPatterns(ctx context.Context, query string, limit int) ([]interface{}, error) {
	return s.search(ctx, "error_pattern", query, limit)
}

// SearchDocumentation searches K8s docs via keyword search.
func (s *inMemoryVectorStore) SearchDocumentation(ctx context.Context, query string, limit int) ([]interface{}, error) {
	return s.search(ctx, "document", query, limit)
}

func (s *inMemoryVectorStore) search(ctx context.Context, itemType, query string, limit int) ([]interface{}, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 10
	}

	queryLower := strings.ToLower(query)
	queryTerms := strings.Fields(queryLower)

	type scored struct {
		item  *indexedItem
		score float64
	}

	var matches []scored
	for _, item := range s.items {
		if item.itemType != itemType {
			continue
		}
		textLower := strings.ToLower(item.text)
		score := 0.0
		for _, term := range queryTerms {
			if strings.Contains(textLower, term) {
				score += 1.0
			}
		}
		if score > 0 {
			matches = append(matches, scored{item: item, score: score})
		}
	}

	// Sort by score descending (simple insertion sort for small lists)
	for i := 1; i < len(matches); i++ {
		for j := i; j > 0 && matches[j].score > matches[j-1].score; j-- {
			matches[j], matches[j-1] = matches[j-1], matches[j]
		}
	}

	if len(matches) > limit {
		matches = matches[:limit]
	}

	results := make([]interface{}, 0, len(matches))
	for _, m := range matches {
		results = append(results, map[string]interface{}{
			"id":         m.item.id,
			"text":       m.item.text,
			"payload":    m.item.payload,
			"score":      m.score,
			"created_at": m.item.createdAt,
		})
	}
	return results, nil
}

// IndexInvestigation indexes a completed investigation.
func (s *inMemoryVectorStore) IndexInvestigation(ctx context.Context, investigation interface{}) error {
	text := extractText(investigation)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, &indexedItem{
		id:        s.nextID(),
		itemType:  "investigation",
		text:      text,
		payload:   investigation,
		createdAt: time.Now(),
	})
	return nil
}

// IndexErrorPattern indexes an error pattern.
func (s *inMemoryVectorStore) IndexErrorPattern(ctx context.Context, pattern interface{}) error {
	text := extractText(pattern)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, &indexedItem{
		id:        s.nextID(),
		itemType:  "error_pattern",
		text:      text,
		payload:   pattern,
		createdAt: time.Now(),
	})
	return nil
}

// IndexDocument indexes a documentation section.
func (s *inMemoryVectorStore) IndexDocument(ctx context.Context, docType, docContent string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, &indexedItem{
		id:       s.nextID(),
		itemType: "document",
		text:     docType + " " + docContent,
		payload: map[string]string{
			"doc_type": docType,
			"content":  docContent,
		},
		createdAt: time.Now(),
	})
	return nil
}

// IsAvailable always returns true for in-memory implementation.
func (s *inMemoryVectorStore) IsAvailable(ctx context.Context) (bool, error) {
	return true, nil
}

// DeleteIndex removes an indexed item by ID.
func (s *inMemoryVectorStore) DeleteIndex(ctx context.Context, itemID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, item := range s.items {
		if item.id == itemID {
			s.items = append(s.items[:i], s.items[i+1:]...)
			return nil
		}
	}
	return nil // not found is not an error
}

// GetStats returns vector store statistics.
func (s *inMemoryVectorStore) GetStats(ctx context.Context) (interface{}, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	typeCounts := map[string]int{}
	for _, item := range s.items {
		typeCounts[item.itemType]++
	}

	return map[string]interface{}{
		"backend":         "in_memory_keyword",
		"total_items":     len(s.items),
		"type_counts":     typeCounts,
		"semantic_search": false,
	}, nil
}

// Rebuild is a no-op for the in-memory implementation.
func (s *inMemoryVectorStore) Rebuild(ctx context.Context) error {
	return nil // nothing to rebuild for keyword search
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// extractText extracts a searchable text string from arbitrary data.
func extractText(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case map[string]interface{}:
		var parts []string
		for _, key := range []string{"description", "summary", "conclusion", "type", "pattern", "message", "title"} {
			if val, ok := t[key].(string); ok && val != "" {
				parts = append(parts, val)
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}
