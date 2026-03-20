package context

import "context"

// Package context provides context building for investigations.
//
// Responsibilities:
//   - Gather relevant cluster state from World Model and Backend
//   - Collect historical data (metrics, events, logs, previous investigations)
//   - Select most relevant resources based on the investigation topic
//   - Manage context window budget (token limit for LLM)
//   - Prune low-relevance information when approaching token limit
//   - Format context for LLM consumption (markdown, structured JSON)
//   - Track context composition for auditability
//
// Context Window Management:
//   - Maximum context size configurable per LLM provider
//   - OpenAI GPT-4: ~8k context available for investigation
//   - Anthropic Claude: ~50k context available for investigation
//   - Ollama: ~4k-8k depending on model
//   - Token counting per component:
//       * Resource specs: estimated via simple char/token ratio
//       * Events: recent only, old events pruned
//       * Metrics: latest values + trends, full history not needed
//       * Logs: tail only (last N lines)
//       * Investigation history: summaries, not full transcripts
//
// Context Components:
//   1. Target Resources
//      - The resources being investigated (pods, deployments, nodes, etc.)
//      - Full spec and current status
//
//   2. Related Resources
//      - Parent resources (Deployment for Pod, DaemonSet, etc.)
//      - Dependent resources (Services, Ingresses, etc.)
//      - Sibling resources (other pods in same deployment)
//
//   3. Events
//      - Last 50-100 events related to target resources
//      - Recent errors, warnings, normal activity
//      - Timestamps for timeline reconstruction
//
//   4. Metrics
//      - Current resource usage (CPU, memory)
//      - Trend over last hour (spike detection)
//      - Comparison to limits and requests
//
//   5. Logs
//      - Last 100-500 lines from relevant containers
//      - Error patterns and stack traces
//
//   6. History
//      - Recent investigations on same resources
//      - Previous findings and resolutions
//      - Configuration change history
//
//   7. Cluster Context
//      - Cluster size, node count
//      - Resource availability
//      - Recent system events (scaling, updates, failures)
//
// Integration Points:
//   - World Model: Fetch cluster state and resource graph
//   - Backend Proxy: Historical queries
//   - Analytics Engine: Recent metrics and trends
//   - Audit Logger: Previous investigations
//   - Prompt Manager: Format context as markdown

// ContextBuilder defines the interface for context building.
type ContextBuilder interface {
	// BuildContext gathers all relevant information for an investigation.
	// Returns formatted context string suitable for LLM prompt.
	BuildContext(ctx context.Context, investigationType string, description string, resources []string) (string, error)

	// GetTokenCount estimates token usage for built context.
	GetTokenCount(ctx context.Context, contextStr string) (int, error)

	// PruneContext removes low-relevance information when context exceeds token budget.
	// Returns pruned context and list of removed sections.
	PruneContext(ctx context.Context, contextStr string, maxTokens int) (string, []string, error)

	// GetContextMetadata returns information about context composition.
	GetContextMetadata(ctx context.Context) (interface{}, error)
}

// NewContextBuilder creates a stub context builder.
// Use NewContextBuilderWithProxy (builder_impl.go) for a fully wired implementation.
