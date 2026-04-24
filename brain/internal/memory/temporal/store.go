package temporal

import "context"

// Package temporal provides temporal storage for cluster state changes.
//
// Responsibilities:
//   - Maintain sliding window of cluster state snapshots
//   - Enable time-travel queries ("what changed before the crash?")
//   - Support "what-if" analysis on past states
//   - Provide efficient storage using ring buffer
//   - Answer questions like "was this pod running an hour ago?"
//
// Architecture:
//   - Ring Buffer: Fixed-size circular buffer in memory
//   - Snapshots: Periodic snapshots of full cluster state (configurable interval)
//   - Changes: Incremental change events stored between snapshots
//   - Compression: Optional compression for older snapshots
//
// Retention Policy:
//   - Keep last N snapshots in memory (e.g., 24 snapshots for 24-hour retention)
//   - Each snapshot interval: 1 hour (configurable)
//   - Total retention: ~24 hours with default config
//   - Ring buffer discards oldest snapshot when full
//
// Query Types:
//   - Point-in-time: Get state of resource at specific time
//   - Range: Get all changes to resource in time range
//   - Diff: Compare resource state between two times
//   - Event history: Get all events affecting resource
//
// Storage Efficiency:
//   - Full snapshots every N minutes (e.g., 1 hour)
//   - Incremental changes between snapshots (small storage footprint)
//   - Only store changed resources, not entire cluster
//   - Compress snapshots older than configurable age
//
// Use Cases:
//   1. "What was the pod running before the crash?"
//      Query pod state 5 minutes before crash time
//
//   2. "When did this deployment get updated?"
//      Query change history for deployment
//
//   3. "Was DNS working 10 minutes ago?"
//      Query CoreDNS pod status at past time
//
//   4. "What changed in the cluster during the incident?"
//      Query all changes in time range around incident
//
// Integration Points:
//   - World Model: Receives state updates to snapshot
//   - Observation tools: Answer temporal queries
//   - Investigation tools: Understand state at incident time
//   - Analysis tools: Compare past and current states
//   - Context builder: Include relevant past states

// TemporalStore defines the interface for temporal queries.
type TemporalStore interface {
	// SnapshotNow creates a snapshot of current cluster state.
	// Called periodically to record state at point in time.
	SnapshotNow(ctx context.Context) error

	// GetResourceAt returns resource state at specific point in time.
	// Returns: resource spec and status, or error if outside retention window
	GetResourceAt(ctx context.Context, namespace string, kind string, name string, timestamp interface{}) (interface{}, error)

	// GetChangesInRange returns all changes to a resource in time range.
	// Returns: list of change events with before/after states
	GetChangesInRange(ctx context.Context, namespace string, kind string, name string, startTime interface{}, endTime interface{}) ([]interface{}, error)

	// CompareResourceStates compares resource state at two points in time.
	// Returns: differences between before and after state
	CompareResourceStates(ctx context.Context, namespace string, kind string, name string, beforeTime interface{}, afterTime interface{}) (interface{}, error)

	// GetClusterSnapshotAt returns full cluster state snapshot at time.
	// Returns: cluster state similar to World Model snapshot
	GetClusterSnapshotAt(ctx context.Context, timestamp interface{}) (interface{}, error)

	// GetEventHistory returns all events affecting resource in range.
	// Returns: list of creation, update, delete, restart events
	GetEventHistory(ctx context.Context, namespace string, kind string, name string, startTime interface{}, endTime interface{}) ([]interface{}, error)

	// FindStateChange finds when a specific state change occurred.
	// field: the field that changed (e.g., "status.phase")
	// oldValue: value before change
	// newValue: value after change
	FindStateChange(ctx context.Context, namespace string, kind string, name string, field string, oldValue interface{}, newValue interface{}) (interface{}, error)

	// GetRetentionWindow returns current retention time window.
	// Returns: oldest_snapshot_time, newest_snapshot_time
	GetRetentionWindow(ctx context.Context) (interface{}, interface{}, error)

	// Prune removes old snapshots outside retention window.
	// Called automatically, can be called manually to free space.
	Prune(ctx context.Context) error
}

// NewTemporalStore creates a new temporal store with ring buffer.
// The concrete implementation is in store_impl.go.
