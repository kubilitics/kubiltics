package analytics

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"
)

// Package analytics provides statistical analysis for Kubernetes metrics.
//
// IMPORTANT: This package uses ONLY pure statistical methods. NO machine learning.
//
// Core Capabilities:
//   - Statistical anomaly detection (z-score, moving averages, percentiles)
//   - Trend analysis (linear regression, rate of change)
//   - Resource optimization recommendations (statistical thresholds)
//   - Time-series analysis (seasonality detection, pattern recognition)
//
// Statistical Methods Used:
//   1. Z-Score Analysis: Detect outliers using standard deviation
//   2. Moving Averages: Smooth time-series data to identify trends
//   3. Percentiles: Identify threshold violations (p50, p95, p99)
//   4. Linear Regression: Calculate trend slopes
//   5. Coefficient of Variation: Measure relative variability
//   6. Interquartile Range (IQR): Robust outlier detection
//
// Integration Points:
//   - Time-Series Engine: Query historical metrics
//   - World Model: Current cluster state
//   - Safety Engine: Inform risk assessment
//   - Reasoning Engine: Data-driven recommendations

// MetricType represents the type of metric being analyzed
type MetricType string

const (
	MetricTypeCPU            MetricType = "cpu"
	MetricTypeMemory         MetricType = "memory"
	MetricTypeLatency        MetricType = "latency"
	MetricTypeErrorRate      MetricType = "error_rate"
	MetricTypeThroughput     MetricType = "throughput"
	MetricTypeRestartCount   MetricType = "restart_count"
	MetricTypePodCount       MetricType = "pod_count"
	MetricTypeRequestRate    MetricType = "request_rate"
	MetricTypeNetworkTraffic MetricType = "network_traffic"
)

// DataPoint represents a single metric observation
type DataPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
	Metadata  map[string]interface{}
}

// TimeSeries represents a collection of data points
type TimeSeries struct {
	MetricName string      `json:"metric_name"`
	MetricType MetricType  `json:"metric_type"`
	Data       []DataPoint `json:"data"`
}

// AnomalyType represents the type of anomaly detected
type AnomalyType string

const (
	AnomalyTypeSpike    AnomalyType = "spike"    // Sudden increase
	AnomalyTypeDrop     AnomalyType = "drop"     // Sudden decrease
	AnomalyTypeOutlier  AnomalyType = "outlier"  // Statistical outlier
	AnomalyTypeTrend    AnomalyType = "trend"    // Concerning trend
	AnomalyTypeFlapping AnomalyType = "flapping" // Rapid oscillation
	AnomalyTypePlateau  AnomalyType = "plateau"  // Unusual stability
)

// Anomaly represents a detected statistical anomaly
type Anomaly struct {
	Type        AnomalyType            `json:"type"`
	Severity    string                 `json:"severity"` // critical, high, medium, low
	Timestamp   time.Time              `json:"timestamp"`
	Value       float64                `json:"value"`
	Expected    float64                `json:"expected"`
	Deviation   float64                `json:"deviation"` // How many std deviations
	ZScore      float64                `json:"z_score"`
	Description string                 `json:"description"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// Trend represents a statistical trend in data
type Trend struct {
	Direction   string    `json:"direction"` // increasing, decreasing, stable
	Slope       float64   `json:"slope"`     // Rate of change
	RSquared    float64   `json:"r_squared"` // Goodness of fit
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	Confidence  float64   `json:"confidence"` // 0.0-1.0
	Description string    `json:"description"`
}

// Statistics represents statistical measures of a dataset
type Statistics struct {
	Mean               float64 `json:"mean"`
	Median             float64 `json:"median"`
	StdDev             float64 `json:"std_dev"`
	Min                float64 `json:"min"`
	Max                float64 `json:"max"`
	P50                float64 `json:"p50"`
	P95                float64 `json:"p95"`
	P99                float64 `json:"p99"`
	CoefficientOfVar   float64 `json:"coefficient_of_variation"`
	InterquartileRange float64 `json:"iqr"`
	Count              int     `json:"count"`
}

// Recommendation represents an optimization recommendation
type Recommendation struct {
	Type            string                 `json:"type"` // scale_up, scale_down, optimize_resource, adjust_threshold
	Priority        string                 `json:"priority"`
	Resource        string                 `json:"resource"`
	Current         interface{}            `json:"current"`
	Suggested       interface{}            `json:"suggested"`
	Justification   string                 `json:"justification"`
	EstimatedImpact map[string]interface{} `json:"estimated_impact"`
}

// Engine is the analytics engine
type Engine struct {
	// Configuration
	zScoreThreshold     float64 // Default: 3.0 (99.7% confidence)
	movingAverageWindow int     // Default: 10 data points
	trendAnalysisWindow int     // Default: 50 data points
	seasonalityPeriod   int     // Default: 24 (for hourly data)
}

// NewEngine creates a new analytics engine
func NewEngine() *Engine {
	return &Engine{
		zScoreThreshold:     3.0,
		movingAverageWindow: 10,
		trendAnalysisWindow: 50,
		seasonalityPeriod:   24,
	}
}

// DetectAnomalies performs statistical anomaly detection on time-series data
func (e *Engine) DetectAnomalies(ctx context.Context, ts *TimeSeries, sensitivity string) ([]Anomaly, error) {
	if len(ts.Data) < 3 {
		return nil, fmt.Errorf("insufficient data points (need at least 3, got %d)", len(ts.Data))
	}

	// Adjust z-score threshold based on sensitivity
	threshold := e.zScoreThreshold
	switch sensitivity {
	case "high":
		threshold = 2.0 // 95% confidence
	case "medium":
		threshold = 2.5 // 98.8% confidence
	case "low":
		threshold = 3.5 // 99.95% confidence
	}

	anomalies := make([]Anomaly, 0)

	// Calculate statistics
	stats := e.calculateStatistics(ts.Data)

	// Detect outliers using z-score method
	for _, dp := range ts.Data {
		if stats.StdDev == 0 {
			continue // Cannot detect anomalies with zero variance
		}

		zScore := (dp.Value - stats.Mean) / stats.StdDev

		if math.Abs(zScore) > threshold {
			anomalyType := AnomalyTypeOutlier
			if zScore > 0 {
				anomalyType = AnomalyTypeSpike
			} else {
				anomalyType = AnomalyTypeDrop
			}

			severity := e.determineSeverity(math.Abs(zScore), threshold)

			anomaly := Anomaly{
				Type:      anomalyType,
				Severity:  severity,
				Timestamp: dp.Timestamp,
				Value:     dp.Value,
				Expected:  stats.Mean,
				Deviation: math.Abs(zScore),
				ZScore:    zScore,
				Description: fmt.Sprintf("%s detected: value %.2f is %.2f standard deviations from mean %.2f",
					anomalyType, dp.Value, math.Abs(zScore), stats.Mean),
				Metadata: map[string]interface{}{
					"metric_type": ts.MetricType,
					"metric_name": ts.MetricName,
				},
			}
			anomalies = append(anomalies, anomaly)
		}
	}

	// Detect flapping (rapid oscillation)
	flappingAnomalies := e.detectFlapping(ts, stats)
	anomalies = append(anomalies, flappingAnomalies...)

	return anomalies, nil
}

// AnalyzeTrend performs linear regression to identify trends
func (e *Engine) AnalyzeTrend(ctx context.Context, ts *TimeSeries) (*Trend, error) {
	if len(ts.Data) < 2 {
		return nil, fmt.Errorf("insufficient data for trend analysis (need at least 2 points)")
	}

	// Use only recent data for trend analysis
	dataWindow := ts.Data
	if len(ts.Data) > e.trendAnalysisWindow {
		dataWindow = ts.Data[len(ts.Data)-e.trendAnalysisWindow:]
	}

	// Perform linear regression: y = mx + b
	n := float64(len(dataWindow))
	var sumX, sumY, sumXY, sumX2 float64

	for i, dp := range dataWindow {
		x := float64(i)
		y := dp.Value
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	// Calculate slope (m) and intercept (b)
	slope := (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX)
	intercept := (sumY - slope*sumX) / n

	// Calculate R-squared (goodness of fit)
	meanY := sumY / n
	var ssTot, ssRes float64
	for i, dp := range dataWindow {
		x := float64(i)
		y := dp.Value
		predicted := slope*x + intercept
		ssTot += (y - meanY) * (y - meanY)
		ssRes += (y - predicted) * (y - predicted)
	}
	rSquared := 1.0 - (ssRes / ssTot)

	// Determine direction
	direction := "stable"
	if math.Abs(slope) > 0.01 { // Threshold for considering trend significant
		if slope > 0 {
			direction = "increasing"
		} else {
			direction = "decreasing"
		}
	}

	trend := &Trend{
		Direction:  direction,
		Slope:      slope,
		RSquared:   rSquared,
		StartTime:  dataWindow[0].Timestamp,
		EndTime:    dataWindow[len(dataWindow)-1].Timestamp,
		Confidence: rSquared,
		Description: fmt.Sprintf("Trend is %s with slope %.4f (R²=%.3f)",
			direction, slope, rSquared),
	}

	return trend, nil
}

// GenerateRecommendations generates optimization recommendations based on statistical analysis
func (e *Engine) GenerateRecommendations(ctx context.Context, resourceType string, ts *TimeSeries) ([]Recommendation, error) {
	recommendations := make([]Recommendation, 0)

	stats := e.calculateStatistics(ts.Data)
	trend, _ := e.AnalyzeTrend(ctx, ts)

	// CPU/Memory recommendations
	if ts.MetricType == MetricTypeCPU || ts.MetricType == MetricTypeMemory {
		// Check for underutilization
		if stats.P95 < 30.0 { // Less than 30% utilization at p95
			recommendations = append(recommendations, Recommendation{
				Type:      "scale_down",
				Priority:  "medium",
				Resource:  resourceType,
				Current:   map[string]interface{}{"utilization_p95": stats.P95},
				Suggested: map[string]interface{}{"action": "reduce replicas or resource limits"},
				Justification: fmt.Sprintf("95th percentile %s utilization is %.1f%%, indicating overprovisioning",
					ts.MetricType, stats.P95),
				EstimatedImpact: map[string]interface{}{
					"cost_savings": "medium",
					"risk":         "low",
				},
			})
		}

		// Check for overutilization
		if stats.P95 > 80.0 { // Greater than 80% utilization at p95
			recommendations = append(recommendations, Recommendation{
				Type:      "scale_up",
				Priority:  "high",
				Resource:  resourceType,
				Current:   map[string]interface{}{"utilization_p95": stats.P95},
				Suggested: map[string]interface{}{"action": "increase replicas or resource limits"},
				Justification: fmt.Sprintf("95th percentile %s utilization is %.1f%%, approaching saturation",
					ts.MetricType, stats.P95),
				EstimatedImpact: map[string]interface{}{
					"performance_improvement": "high",
					"stability_improvement":   "high",
				},
			})
		}

		// Check for concerning upward trend
		if trend != nil && trend.Direction == "increasing" && trend.Confidence > 0.7 {
			recommendations = append(recommendations, Recommendation{
				Type:      "scale_up",
				Priority:  "medium",
				Resource:  resourceType,
				Current:   map[string]interface{}{"trend_slope": trend.Slope},
				Suggested: map[string]interface{}{"action": "proactively increase capacity"},
				Justification: fmt.Sprintf("%s utilization shows increasing trend (slope=%.4f, R²=%.3f)",
					ts.MetricType, trend.Slope, trend.RSquared),
				EstimatedImpact: map[string]interface{}{
					"prevents_future_issues": true,
				},
			})
		}
	}

	// Restart count recommendations
	if ts.MetricType == MetricTypeRestartCount {
		if stats.Mean > 0.1 { // Average > 0.1 restarts per time period
			recommendations = append(recommendations, Recommendation{
				Type:          "investigate",
				Priority:      "high",
				Resource:      resourceType,
				Current:       map[string]interface{}{"avg_restarts": stats.Mean},
				Suggested:     map[string]interface{}{"action": "investigate pod crashes"},
				Justification: fmt.Sprintf("Average restart count is %.2f, indicating instability", stats.Mean),
				EstimatedImpact: map[string]interface{}{
					"stability_improvement": "critical",
				},
			})
		}
	}

	// Error rate recommendations
	if ts.MetricType == MetricTypeErrorRate {
		if stats.Mean > 1.0 { // Error rate > 1%
			recommendations = append(recommendations, Recommendation{
				Type:          "investigate",
				Priority:      "high",
				Resource:      resourceType,
				Current:       map[string]interface{}{"error_rate_pct": stats.Mean},
				Suggested:     map[string]interface{}{"action": "investigate error causes"},
				Justification: fmt.Sprintf("Error rate is %.2f%%, above acceptable threshold", stats.Mean),
				EstimatedImpact: map[string]interface{}{
					"reliability_improvement": "high",
				},
			})
		}
	}

	return recommendations, nil
}

// CalculateStatistics returns comprehensive statistics for a time-series
func (e *Engine) CalculateStatistics(ctx context.Context, ts *TimeSeries) (*Statistics, error) {
	if len(ts.Data) == 0 {
		return nil, fmt.Errorf("no data points provided")
	}

	return e.calculateStatistics(ts.Data), nil
}

// calculateStatistics is the internal implementation
func (e *Engine) calculateStatistics(data []DataPoint) *Statistics {
	if len(data) == 0 {
		return &Statistics{}
	}

	// Extract values
	values := make([]float64, len(data))
	for i, dp := range data {
		values[i] = dp.Value
	}

	// Sort for percentile calculations
	sortedValues := make([]float64, len(values))
	copy(sortedValues, values)
	sort.Float64s(sortedValues)

	// Calculate mean
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(len(values))

	// Calculate standard deviation
	var variance float64
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	variance /= float64(len(values))
	stdDev := math.Sqrt(variance)

	// Percentiles
	p50 := e.percentile(sortedValues, 50)
	p95 := e.percentile(sortedValues, 95)
	p99 := e.percentile(sortedValues, 99)

	// Interquartile range
	q1 := e.percentile(sortedValues, 25)
	q3 := e.percentile(sortedValues, 75)
	iqr := q3 - q1

	// Coefficient of variation
	cv := 0.0
	if mean != 0 {
		cv = stdDev / math.Abs(mean)
	}

	return &Statistics{
		Mean:               mean,
		Median:             p50,
		StdDev:             stdDev,
		Min:                sortedValues[0],
		Max:                sortedValues[len(sortedValues)-1],
		P50:                p50,
		P95:                p95,
		P99:                p99,
		CoefficientOfVar:   cv,
		InterquartileRange: iqr,
		Count:              len(values),
	}
}

// percentile calculates the nth percentile of sorted data
func (e *Engine) percentile(sortedData []float64, p int) float64 {
	if len(sortedData) == 0 {
		return 0
	}
	if len(sortedData) == 1 {
		return sortedData[0]
	}

	rank := float64(p) / 100.0 * float64(len(sortedData)-1)
	lowerIndex := int(math.Floor(rank))
	upperIndex := int(math.Ceil(rank))

	if lowerIndex == upperIndex {
		return sortedData[lowerIndex]
	}

	// Linear interpolation
	weight := rank - float64(lowerIndex)
	return sortedData[lowerIndex]*(1-weight) + sortedData[upperIndex]*weight
}

// determineSeverity maps z-score to severity level
func (e *Engine) determineSeverity(zScore, threshold float64) string {
	ratio := zScore / threshold

	if ratio > 2.0 {
		return "critical"
	} else if ratio > 1.5 {
		return "high"
	} else if ratio > 1.0 {
		return "medium"
	}
	return "low"
}

// detectFlapping detects rapid oscillation in time-series data
func (e *Engine) detectFlapping(ts *TimeSeries, stats *Statistics) []Anomaly {
	anomalies := make([]Anomaly, 0)

	if len(ts.Data) < 5 {
		return anomalies
	}

	// Count direction changes
	directionChanges := 0
	for i := 1; i < len(ts.Data)-1; i++ {
		prev := ts.Data[i-1].Value
		curr := ts.Data[i].Value
		next := ts.Data[i+1].Value

		// Check if direction changed
		if (curr > prev && curr > next) || (curr < prev && curr < next) {
			directionChanges++
		}
	}

	// If direction changes frequently, it's flapping
	changeRate := float64(directionChanges) / float64(len(ts.Data))
	if changeRate > 0.3 { // More than 30% of points are direction changes
		anomaly := Anomaly{
			Type:      AnomalyTypeFlapping,
			Severity:  "medium",
			Timestamp: ts.Data[len(ts.Data)-1].Timestamp,
			Value:     ts.Data[len(ts.Data)-1].Value,
			Expected:  stats.Mean,
			Deviation: changeRate,
			ZScore:    0,
			Description: fmt.Sprintf("Flapping detected: %.1f%% of data points show direction changes",
				changeRate*100),
			Metadata: map[string]interface{}{
				"direction_changes": directionChanges,
				"change_rate":       changeRate,
			},
		}
		anomalies = append(anomalies, anomaly)
	}

	return anomalies
}

// CompareTimeSeries compares two time-series statistically
func (e *Engine) CompareTimeSeries(ctx context.Context, ts1, ts2 *TimeSeries) (map[string]interface{}, error) {
	stats1 := e.calculateStatistics(ts1.Data)
	stats2 := e.calculateStatistics(ts2.Data)

	// Calculate percent changes
	meanChange := ((stats2.Mean - stats1.Mean) / stats1.Mean) * 100
	p95Change := ((stats2.P95 - stats1.P95) / stats1.P95) * 100

	comparison := map[string]interface{}{
		"ts1_stats":       stats1,
		"ts2_stats":       stats2,
		"mean_change_pct": meanChange,
		"p95_change_pct":  p95Change,
		"interpretation":  e.interpretComparison(meanChange, p95Change),
	}

	return comparison, nil
}

// interpretComparison provides human-readable interpretation
func (e *Engine) interpretComparison(meanChange, p95Change float64) string {
	if math.Abs(meanChange) < 5 && math.Abs(p95Change) < 5 {
		return "No significant change detected"
	}

	if meanChange > 20 || p95Change > 20 {
		return "Significant increase detected - may require attention"
	}

	if meanChange < -20 || p95Change < -20 {
		return "Significant decrease detected - investigate if unexpected"
	}

	return "Moderate change detected - monitor for trends"
}
