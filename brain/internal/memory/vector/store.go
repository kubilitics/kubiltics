package vector

import "context"

// Package vector provides semantic search capabilities via vector embeddings.
//
// Responsibilities:
//   - Store and search past investigations using semantic similarity
//   - Index error patterns and common solutions
//   - Enable searching over K8s documentation
//   - Provide graceful degradation if vector store unavailable
//   - Support similarity-based recommendation discovery
//
// Optional Integration:
//   This package is OPTIONAL. If vector store is unavailable:
//   - Investigations still work (degrade to keyword search)
//   - Recommendations still work (degrade to rule-based)
//   - No hard dependency on external service
//
// Supported Backends:
//   - ChromaDB: Open-source, embedded option available
//   - Qdrant: Vector database, self-hosted or cloud
//   - Disabled: If neither configured, graceful degradation
//
// Use Cases:
//
//   1. Investigation History Search
//      Query: "pod crashes due to OOMKilled"
//      Returns: Similar past investigations with solutions
//      Embedding: Investigation summary text
//
//   2. Error Pattern Matching
//      Query: "CrashLoopBackOff with timeout errors"
//      Returns: Similar error patterns from history
//      Embedding: Error log text
//
//   3. Documentation Search
//      Query: "How to troubleshoot high CPU usage?"
//      Returns: Relevant K8s docs and best practices
//      Embedding: Documentation text
//
//   4. Recommendation Discovery
//      Query: Similar resource configurations
//      Returns: How similar resources were optimized
//      Embedding: Resource configuration
//
// Embedding Strategy:
//   - Use OpenAI embeddings API or local embedding model
//   - Generate embeddings for: investigation summaries, error logs, docs
//   - Update embeddings as investigations complete
//   - Background indexing (don't block on embedding generation)
//
// Graceful Degradation:
//   - If vector store unavailable: Continue operation without semantic search
//   - If embedding fails: Log warning, continue with keyword search
//   - Check vector store health on startup, warn if unavailable
//   - Periodically retry connection to vector store
//
// Integration Points:
//   - Reasoning Engine: Retrieve similar past investigations
//   - Recommendation Tools: Find relevant past recommendations
//   - Context Builder: Enrich context with relevant docs/investigations
//   - REST API: Search endpoints
//   - Audit Logger: Index completed investigations

// VectorStore defines the interface for semantic search.
type VectorStore interface {
	// SearchInvestigations finds similar past investigations.
	// query: investigation description or summary
	// limit: max results to return
	// Returns: similar investigations with similarity scores
	SearchInvestigations(ctx context.Context, query string, limit int) ([]interface{}, error)

	// SearchErrorPatterns finds similar error patterns.
	// query: error log or description
	// limit: max results
	// Returns: similar error patterns with solutions
	SearchErrorPatterns(ctx context.Context, query string, limit int) ([]interface{}, error)

	// SearchDocumentation searches K8s docs and best practices.
	// query: search query
	// Returns: relevant documentation sections
	SearchDocumentation(ctx context.Context, query string, limit int) ([]interface{}, error)

	// IndexInvestigation indexes a completed investigation.
	// investigation: investigation object to index
	IndexInvestigation(ctx context.Context, investigation interface{}) error

	// IndexErrorPattern indexes an error pattern.
	IndexErrorPattern(ctx context.Context, pattern interface{}) error

	// IndexDocument indexes a documentation section.
	IndexDocument(ctx context.Context, docType string, docContent string) error

	// IsAvailable checks if vector store is healthy and available.
	IsAvailable(ctx context.Context) (bool, error)

	// DeleteIndex deletes an indexed item.
	DeleteIndex(ctx context.Context, itemID string) error

	// GetStats returns vector store statistics.
	// Returns: total_items, storage_size, last_update
	GetStats(ctx context.Context) (interface{}, error)

	// Rebuild rebuilds indices from scratch.
	Rebuild(ctx context.Context) error
}

// NewVectorStore creates a new vector store with optional backend.
// If configured backend is unavailable, gracefully degrades to keyword search.
// The concrete implementation is in store_impl.go.
