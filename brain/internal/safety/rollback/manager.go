package rollback

import "context"

// Package rollback provides automatic rollback management for executed actions.
//
// Responsibilities:
//   - Monitor metrics after action execution
//   - Detect if action caused performance degradation
//   - Automatically revert action if degradation detected
//   - Implement dead man's switch (periodic health check)
//   - Record rollback events for investigation
//   - Learn from rollback patterns
//
// Rollback Trigger Conditions:
//   - Error rate increases > 50% from baseline
//   - Latency p99 increases > 200% from baseline
//   - Resource availability drops below threshold
//   - Pod restart rate increases significantly
//   - Custom metrics exceed thresholds (if defined)
//
// Rollback Timeline:
//   1. Action executed at T=0
//   2. Monitor for period 1: T=1min (quick detection window)
//   3. If degradation detected: Initiate rollback
//   4. Rollback executed at T+1min
//   5. Verify recovery (compare post-rollback metrics to baseline)
//   6. Log complete rollback event
//
// Implementation:
//   - For Deployment: Rolling restart → Previous version
//   - For Pod: Delete pod (let ReplicaSet recreate)
//   - For Resource patch: Revert to previous config
//   - For Resource scale: Revert to previous replica count
//
// Dead Man's Switch:
//   - Continuous health monitoring even after no explicit action
//   - If previous action's effects still degrading: Extended rollback window
//   - Prevents cascading issues
//
// Baseline Metrics (collected before action):
//   - Average error rate
//   - Average latency (p50, p95, p99)
//   - Pod restart count
//   - Available replicas
//   - Resource utilization
//   - Custom metrics
//
// Integration Points:
//   - Time-Series Engine: Query current vs. baseline metrics
//   - Execution Tools: Track what was executed for rollback
//   - Analytics Engine: Compute metrics for degradation detection
//   - Audit Logger: Record rollback events
//   - World Model: Get deployment info for rollback
//   - Backend Proxy: Execute rollback operations

// RollbackManager defines the interface for automatic rollback.
type RollbackManager interface {
	// MonitorAction starts monitoring an executed action for degradation.
	// action: the action that was executed
	// baseline: metrics snapshot before action
	// Returns: monitoring_session_id
	MonitorAction(ctx context.Context, actionID string, action interface{}, baseline interface{}) (string, error)

	// StopMonitoring stops monitoring an action (action succeeded, no rollback needed).
	StopMonitoring(ctx context.Context, sessionID string) error

	// GetMonitoringStatus returns current status of monitoring session.
	// Returns: status (monitoring/degraded/rolling_back/rolled_back/complete), current_metrics
	GetMonitoringStatus(ctx context.Context, sessionID string) (interface{}, error)

	// TriggerRollback manually triggers rollback of an action.
	TriggerRollback(ctx context.Context, actionID string, reason string) error

	// RollbackAction reverts an action to previous state.
	RollbackAction(ctx context.Context, actionID string) (bool, string, error)

	// GetRollbackHistory returns history of rollbacks.
	GetRollbackHistory(ctx context.Context, limit int) ([]interface{}, error)

	// AnalyzeRollbackPatterns identifies patterns in rollbacks.
	// Returns: common_causes, frequently_rolled_back_actions
	AnalyzeRollbackPatterns(ctx context.Context) (interface{}, error)

	// SetDegradationThreshold sets threshold for degradation detection.
	// metric: "error_rate", "latency_p99", "availability", etc.
	// threshold: percentage change (0.0-1.0)
	SetDegradationThreshold(ctx context.Context, metric string, threshold float64) error
}

// NewRollbackManager creates a new rollback manager.
// The concrete implementation is in manager_impl.go.
