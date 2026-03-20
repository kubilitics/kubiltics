package scoring

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics/timeseries"
)

// scorerImpl is the concrete ResourceScorer.
type scorerImpl struct {
	ts timeseries.TimeSeriesEngine
}

// NewResourceScorer creates a new resource scorer backed by the time-series engine.
func NewResourceScorer(ts timeseries.TimeSeriesEngine) ResourceScorer {
	return &scorerImpl{ts: ts}
}

// ComputeHealthScore calculates health score for a resource.
func (s *scorerImpl) ComputeHealthScore(ctx context.Context, resourceID string) (int, string, interface{}, error) {
	score := 100
	details := map[string]interface{}{}

	// Check restart count over last hour
	now := time.Now()
	hour := now.Add(-time.Hour)
	restarts, _ := s.ts.Aggregate(ctx, resourceID, "restart_count", hour, now, "max")
	if restarts > 5 {
		score -= 30
		details["restart_penalty"] = -30
	} else if restarts > 0 {
		score -= int(restarts) * 5
		details["restart_penalty"] = -int(restarts) * 5
	}
	details["restarts_1h"] = restarts

	// Check error rate over last hour
	errorRate, _ := s.ts.Aggregate(ctx, resourceID, "error_rate", hour, now, "avg")
	if errorRate > 10 {
		score -= 20
		details["error_rate_penalty"] = -20
	} else if errorRate > 1 {
		score -= 10
		details["error_rate_penalty"] = -10
	}
	details["error_rate_1h"] = errorRate

	// Clamp
	if score < 0 {
		score = 0
	}

	status := "green"
	if score < 70 {
		status = "red"
	} else if score < 90 {
		status = "yellow"
	}
	details["final_score"] = score
	details["resource_id"] = resourceID

	return score, status, details, nil
}

// ComputeEfficiencyScore calculates efficiency score for a resource.
func (s *scorerImpl) ComputeEfficiencyScore(ctx context.Context, resourceID string) (int, float64, []string, error) {
	now := time.Now()
	hour := now.Add(-time.Hour)

	cpuUtil, err := s.ts.Aggregate(ctx, resourceID, "cpu", hour, now, "avg")
	if err != nil || math.IsNaN(cpuUtil) {
		cpuUtil = 50 // default
	}

	score := 100
	var recs []string

	if cpuUtil < 20 {
		score -= 20
		recs = append(recs, fmt.Sprintf("CPU utilization is low (%.1f%%) — consider reducing resource requests", cpuUtil))
	} else if cpuUtil > 85 {
		score -= 15
		recs = append(recs, fmt.Sprintf("CPU utilization is high (%.1f%%) — consider scaling up", cpuUtil))
	}

	memUtil, err := s.ts.Aggregate(ctx, resourceID, "memory", hour, now, "avg")
	if err == nil && !math.IsNaN(memUtil) {
		if memUtil < 20 {
			score -= 10
			recs = append(recs, fmt.Sprintf("Memory utilization is low (%.1f%%) — consider reducing memory requests", memUtil))
		} else if memUtil > 85 {
			score -= 15
			recs = append(recs, fmt.Sprintf("Memory utilization is high (%.1f%%) — consider increasing memory limit", memUtil))
		}
	}

	if score < 0 {
		score = 0
	}
	return score, cpuUtil, recs, nil
}

// ComputeCostScore calculates cost efficiency score.
func (s *scorerImpl) ComputeCostScore(ctx context.Context, resourceID string) (int, float64, float64, error) {
	// Without real pricing data, return a neutral score
	// In a full implementation this would integrate with cost/calculator.go
	return 70, 0.0, 50.0, nil
}

// ComputeSecurityScore calculates security posture score.
func (s *scorerImpl) ComputeSecurityScore(ctx context.Context, resourceID string) (int, []string, []string, error) {
	// Default neutral score — security analysis tools in mcp/tools/analysis are more comprehensive
	return 75, []string{}, []string{"Run security posture analysis for detailed findings"}, nil
}

// ComputeOverallScore computes weighted combination of all scores.
// Weights: health=0.4, efficiency=0.3, cost=0.2, security=0.1
func (s *scorerImpl) ComputeOverallScore(ctx context.Context, resourceID string) (int, interface{}, error) {
	healthScore, healthStatus, healthDetails, _ := s.ComputeHealthScore(ctx, resourceID)
	effScore, utilPct, effRecs, _ := s.ComputeEfficiencyScore(ctx, resourceID)
	costScore, costPerUnit, percentile, _ := s.ComputeCostScore(ctx, resourceID)
	secScore, secIssues, secRecs, _ := s.ComputeSecurityScore(ctx, resourceID)

	overall := int(float64(healthScore)*0.4 + float64(effScore)*0.3 + float64(costScore)*0.2 + float64(secScore)*0.1)

	details := map[string]interface{}{
		"overall":     overall,
		"health":      map[string]interface{}{"score": healthScore, "status": healthStatus, "details": healthDetails},
		"efficiency":  map[string]interface{}{"score": effScore, "utilization_pct": utilPct, "recommendations": effRecs},
		"cost":        map[string]interface{}{"score": costScore, "cost_per_unit": costPerUnit, "percentile": percentile},
		"security":    map[string]interface{}{"score": secScore, "issues": secIssues, "recommendations": secRecs},
		"resource_id": resourceID,
		"computed_at": time.Now(),
	}
	return overall, details, nil
}

// AggregateScores aggregates scores from child resources to parent.
func (s *scorerImpl) AggregateScores(ctx context.Context, parentID string) (int, interface{}, error) {
	// Simple implementation: return the parent's own overall score
	// A full implementation would enumerate child pods and average their scores
	return s.ComputeOverallScore(ctx, parentID)
}

// GetScoreTrend gets historical score trend for a resource.
func (s *scorerImpl) GetScoreTrend(ctx context.Context, resourceID, timeRange string) (interface{}, error) {
	raw, err := s.ts.GetTrend(ctx, resourceID, "cpu", time.Now().Add(-24*time.Hour), time.Now())
	if err != nil {
		return map[string]interface{}{
			"resource_id": resourceID,
			"trend":       "unknown",
			"note":        "insufficient data",
		}, nil
	}
	return map[string]interface{}{
		"resource_id":  resourceID,
		"time_range":   timeRange,
		"metric_trend": raw,
	}, nil
}

// RankResourcesByScore ranks resources by overall score.
func (s *scorerImpl) RankResourcesByScore(ctx context.Context, namespace, kind, direction string, limit int) ([]interface{}, error) {
	// Without a world model reference we cannot enumerate resources here.
	// This is wired up at a higher level (pipeline) that has world model access.
	return []interface{}{}, nil
}

// IdentifyAtRiskResources returns resources with low scores requiring attention.
func (s *scorerImpl) IdentifyAtRiskResources(ctx context.Context, threshold int) ([]interface{}, error) {
	// Same as RankResourcesByScore — requires world model enumeration at higher level.
	return []interface{}{}, nil
}
