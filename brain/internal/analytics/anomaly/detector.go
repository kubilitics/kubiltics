package anomaly

import "context"

// Package anomaly provides anomaly detection using classical statistics.
//
// Responsibilities:
//   - Detect anomalies in time-series metrics using pure mathematical approaches
//   - Support multiple detection algorithms (Z-score, IQR, rolling window)
//   - Trigger proactive investigations when anomalies detected
//   - Maintain interpretability (why was this flagged as anomaly?)
//   - Configure sensitivity per metric type
//   - Avoid false positives in intentional scaling events
//
// Philosophy: Classical Statistics, NOT Machine Learning
//   - No neural networks, no training data required
//   - Fully interpretable and explainable results
//   - Deterministic and reproducible
//   - Fast computation (suitable for streaming)
//   - Requires no historical learning period
//
// Detection Algorithms:
//
//   1. Z-Score Method
//      - Detect values deviating > N sigma from mean
//      - Formula: z = (value - mean) / stddev
//      - Threshold: z > 2 (95% confidence) or z > 3 (99.7% confidence)
//      - Use case: Detect sudden spikes or drops
//
//   2. Interquartile Range (IQR) Method
//      - Detect values outside 1.5 × IQR from quartiles
//      - Formula: outlier if value < Q1 - 1.5*IQR or value > Q3 + 1.5*IQR
//      - Use case: Robust to outliers, handles non-normal distributions
//      - More sensitive than Z-score for heavy-tailed distributions
//
//   3. Rolling Window Comparison
//      - Compare current window to baseline window
//      - Flag if change > threshold % from baseline
//      - Useful for detecting gradual degradation
//      - Example: CPU 20% higher than same time yesterday
//
// Metric-Specific Configuration:
//   - CPU: Z-score > 2.5, detect sudden spikes
//   - Memory: IQR method, slower gradual increase
//   - Network: Z-score > 2, volatile metric
//   - Error rate: Z-score > 1.5, even small changes important
//   - Request latency: Rolling window comparison
//
// Anomaly Context:
//   - Report confidence score (0-100%)
//   - Report detection method used
//   - Report baseline/expected range
//   - Trigger investigation if high confidence
//
// Integration Points:
//   - Time-Series Engine: Query metric data
//   - Reasoning Engine: Trigger proactive investigations
//   - REST API: Anomaly endpoint
//   - Analytics Engine: Feed into scoring
//   - World Model: Correlate with events

// AnomalyDetector defines the interface for anomaly detection.
type AnomalyDetector interface {
	// DetectAnomalies analyzes metric and returns detected anomalies.
	// Returns: list of anomalies with confidence, baseline, and detection method
	DetectAnomalies(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}) ([]interface{}, error)

	// CheckMetricAnomaly checks if single metric value is anomalous.
	// Returns: is_anomaly (bool), confidence (0-100), reason
	CheckMetricAnomaly(ctx context.Context, resourceID string, metricName string, value float64) (bool, int, string, error)

	// GetBaseline computes baseline (mean, stddev) for metric in time range.
	GetBaseline(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}) (interface{}, error)

	// SetAnomalySensitivity sets sensitivity for metric (0.0-1.0, where 1.0 is most sensitive).
	SetAnomalySensitivity(ctx context.Context, metricName string, sensitivity float64) error

	// GetAnomalySensitivity gets current sensitivity for metric.
	GetAnomalySensitivity(ctx context.Context, metricName string) (float64, error)

	// CompareToBaseline compares current metric to historical baseline.
	// Returns: deviation_percent, is_anomalous
	CompareToBaseline(ctx context.Context, resourceID string, metricName string, currentValue float64) (float64, bool, error)
}

// NewAnomalyDetector creates a new anomaly detector with dependencies.
// The concrete implementation is in detector_impl.go.
