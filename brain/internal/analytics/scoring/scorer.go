package scoring

import "context"

// Package scoring provides resource health and efficiency scoring.
//
// Responsibilities:
//   - Compute health scores for individual resources
//   - Calculate efficiency ratings (resource utilization vs. requests)
//   - Aggregate scores to namespace and cluster level
//   - Track score trends over time
//   - Identify resources needing attention
//   - Support multi-dimensional scoring (health, efficiency, cost, security)
//
// Score Dimensions:
//
//   1. Health Score (0-100, higher is better)
//      - Based on: availability, restart frequency, error rate, crashes
//      - Formula: 100 - (crashes × 10 + frequent_restarts × 5 + errors × 2)
//      - Green: > 90
//      - Yellow: 70-90
//      - Red: < 70
//
//   2. Efficiency Score (0-100, higher is better)
//      - Based on: CPU utilization / CPU request, Memory utilization / Memory request
//      - Formula: (actual_utilization / requested) × 100
//      - Penalize both over-provisioning and under-utilization
//      - Green: 50-80% utilization
//      - Yellow: 20-50% or 80-95%
//      - Red: < 20% or > 95%
//
//   3. Cost Score (0-100, higher is better, contextual)
//      - Based on: cost per unit of work (requests/transactions)
//      - Compare to other similar resources
//      - Flag outliers
//
//   4. Security Score (0-100, higher is better)
//      - Based on: security posture (if integrated with security tools)
//      - Privileged execution, exposed ports, known CVEs
//
// Aggregation Levels:
//   - Pod level: Individual pod health
//   - Deployment level: Aggregate pod scores
//   - Namespace level: Aggregate deployment scores
//   - Cluster level: Aggregate namespace scores
//
// Score Calculation Frequency:
//   - Real-time updates on metric changes
//   - Periodic batch calculation (every 5 minutes)
//   - Historical tracking for trend analysis
//
// Integration Points:
//   - Time-Series Engine: Query metrics
//   - Anomaly Detector: Use anomalies in scoring
//   - Analytics Engine: Consume scores
//   - REST API: Health endpoint
//   - Frontend: Display scores with color coding
//   - Recommendation Tools: Use scores to prioritize recommendations

// ResourceScorer defines the interface for scoring operations.
type ResourceScorer interface {
	// ComputeHealthScore calculates health score for a resource.
	// Returns: score (0-100), status (green/yellow/red), details
	ComputeHealthScore(ctx context.Context, resourceID string) (int, string, interface{}, error)

	// ComputeEfficiencyScore calculates efficiency score for resource.
	// Returns: score (0-100), utilization_percent, recommendations
	ComputeEfficiencyScore(ctx context.Context, resourceID string) (int, float64, []string, error)

	// ComputeCostScore calculates cost efficiency score.
	// Returns: score (0-100), cost_per_unit, percentile_vs_similar
	ComputeCostScore(ctx context.Context, resourceID string) (int, float64, float64, error)

	// ComputeSecurityScore calculates security posture score.
	// Returns: score (0-100), issues_found, recommendations
	ComputeSecurityScore(ctx context.Context, resourceID string) (int, []string, []string, error)

	// ComputeOverallScore computes weighted combination of all scores.
	// Weights: health=0.4, efficiency=0.3, cost=0.2, security=0.1
	ComputeOverallScore(ctx context.Context, resourceID string) (int, interface{}, error)

	// AggregateScores aggregates scores from child resources to parent.
	// Example: pod scores → deployment score
	AggregateScores(ctx context.Context, parentID string) (int, interface{}, error)

	// GetScoreTrend gets historical score trend for resource.
	// Returns: score_history (time-series), trend_direction, recent_change
	GetScoreTrend(ctx context.Context, resourceID string, timeRange string) (interface{}, error)

	// RankResourcesByScore ranks resources by overall score.
	// direction: "ascending" or "descending"
	// limit: max results to return
	RankResourcesByScore(ctx context.Context, namespace string, kind string, direction string, limit int) ([]interface{}, error)

	// IdentifyAtRiskResources returns resources with low scores requiring attention.
	// threshold: score threshold (default 70)
	IdentifyAtRiskResources(ctx context.Context, threshold int) ([]interface{}, error)
}

// NewResourceScorer creates a new resource scorer with dependencies.
// The concrete implementation is in scorer_impl.go.
