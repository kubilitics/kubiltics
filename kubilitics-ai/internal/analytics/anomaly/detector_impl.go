package anomaly

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics/timeseries"
)

// baselineEntry stores computed baseline for a resource metric.
type baselineEntry struct {
	mean      float64
	stdDev    float64
	q1        float64
	q3        float64
	iqr       float64
	count     int
	updatedAt time.Time
}

// anomalyDetectorImpl is the concrete AnomalyDetector.
type anomalyDetectorImpl struct {
	mu            sync.RWMutex
	ts            timeseries.TimeSeriesEngine
	sensitivities map[string]float64        // metricName → 0.0-1.0
	baselines     map[string]*baselineEntry // "resourceID:metricName" → baseline
}

// NewAnomalyDetector creates a new anomaly detector backed by a time-series engine.
func NewAnomalyDetector(ts timeseries.TimeSeriesEngine) AnomalyDetector {
	return &anomalyDetectorImpl{
		ts:            ts,
		sensitivities: defaultSensitivities(),
		baselines:     make(map[string]*baselineEntry),
	}
}

func defaultSensitivities() map[string]float64 {
	return map[string]float64{
		"cpu":           0.5, // medium — volatile
		"memory":        0.6, // slightly higher — gradual changes matter
		"error_rate":    0.8, // high — even small changes important
		"latency":       0.7,
		"restart_count": 0.9, // very high — any restart is notable
		"network":       0.4,
	}
}

// DetectAnomalies analyzes metric history and returns detected anomalies.
func (d *anomalyDetectorImpl) DetectAnomalies(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}) ([]interface{}, error) {
	// Query time-series data
	raw, err := d.ts.QueryRange(ctx, resourceID, metricName, startTime, endTime, "")
	if err != nil {
		return nil, fmt.Errorf("query range: %w", err)
	}

	points, ok := raw.([]map[string]interface{})
	if !ok {
		return []interface{}{}, nil
	}
	if len(points) < 3 {
		return []interface{}{}, nil
	}

	// Extract values
	values := make([]float64, 0, len(points))
	for _, p := range points {
		if v, ok := p["value"].(float64); ok {
			values = append(values, v)
		}
	}

	if len(values) < 3 {
		return []interface{}{}, nil
	}

	baseline := computeBaseline(values)
	sensitivity := d.getSensitivity(metricName)
	zThreshold := sensitivityToZThreshold(sensitivity)

	var anomalies []interface{}

	// Z-score detection
	for i, p := range points {
		v, ok := p["value"].(float64)
		if !ok {
			continue
		}
		if baseline.stdDev == 0 {
			continue
		}
		z := (v - baseline.mean) / baseline.stdDev
		if math.Abs(z) > zThreshold {
			aType := "spike"
			if z < 0 {
				aType = "drop"
			}
			anomalies = append(anomalies, map[string]interface{}{
				"type":             aType,
				"severity":         zToSeverity(math.Abs(z), zThreshold),
				"timestamp":        p["timestamp"],
				"value":            v,
				"expected":         baseline.mean,
				"z_score":          z,
				"confidence":       zToConfidence(math.Abs(z), zThreshold),
				"detection_method": "z_score",
				"resource_id":      resourceID,
				"metric_name":      metricName,
				"point_index":      i,
			})
		}
	}

	// IQR detection (complementary — catches outliers missed by z-score)
	lowerFence := baseline.q1 - 1.5*baseline.iqr
	upperFence := baseline.q3 + 1.5*baseline.iqr
	for _, p := range points {
		v, ok := p["value"].(float64)
		if !ok {
			continue
		}
		if v < lowerFence || v > upperFence {
			// De-dup: skip if already flagged by z-score
			alreadyFlagged := false
			for _, a := range anomalies {
				if am, ok := a.(map[string]interface{}); ok {
					if am["value"] == v {
						alreadyFlagged = true
						break
					}
				}
			}
			if !alreadyFlagged {
				anomalies = append(anomalies, map[string]interface{}{
					"type":             "outlier",
					"severity":         "medium",
					"timestamp":        p["timestamp"],
					"value":            v,
					"expected_range":   fmt.Sprintf("[%.2f, %.2f]", lowerFence, upperFence),
					"confidence":       60,
					"detection_method": "iqr",
					"resource_id":      resourceID,
					"metric_name":      metricName,
				})
			}
		}
	}

	return anomalies, nil
}

// CheckMetricAnomaly checks if a single metric value is anomalous.
func (d *anomalyDetectorImpl) CheckMetricAnomaly(ctx context.Context, resourceID, metricName string, value float64) (bool, int, string, error) {
	d.mu.RLock()
	bl, ok := d.baselines[resourceID+":"+metricName]
	d.mu.RUnlock()

	if !ok || bl.count < 5 {
		return false, 0, "insufficient baseline data", nil
	}

	sensitivity := d.getSensitivity(metricName)
	zThreshold := sensitivityToZThreshold(sensitivity)

	if bl.stdDev == 0 {
		return false, 0, "zero variance in baseline", nil
	}

	z := math.Abs((value - bl.mean) / bl.stdDev)
	if z > zThreshold {
		confidence := zToConfidence(z, zThreshold)
		reason := fmt.Sprintf("value %.2f is %.2f std deviations from baseline mean %.2f",
			value, z, bl.mean)
		return true, confidence, reason, nil
	}
	return false, 0, "value within normal range", nil
}

// GetBaseline computes baseline for a metric in a time range.
func (d *anomalyDetectorImpl) GetBaseline(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}) (interface{}, error) {
	raw, err := d.ts.QueryRange(ctx, resourceID, metricName, startTime, endTime, "")
	if err != nil {
		return nil, err
	}

	points, ok := raw.([]map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected data format")
	}

	values := make([]float64, 0, len(points))
	for _, p := range points {
		if v, ok := p["value"].(float64); ok {
			values = append(values, v)
		}
	}

	if len(values) == 0 {
		return nil, fmt.Errorf("no data in range")
	}

	bl := computeBaseline(values)

	// Cache it
	d.mu.Lock()
	d.baselines[resourceID+":"+metricName] = bl
	d.mu.Unlock()

	return map[string]interface{}{
		"mean":        bl.mean,
		"std_dev":     bl.stdDev,
		"q1":          bl.q1,
		"q3":          bl.q3,
		"iqr":         bl.iqr,
		"data_points": bl.count,
		"updated_at":  bl.updatedAt,
	}, nil
}

// SetAnomalySensitivity sets sensitivity for a metric.
func (d *anomalyDetectorImpl) SetAnomalySensitivity(ctx context.Context, metricName string, sensitivity float64) error {
	if sensitivity < 0 || sensitivity > 1 {
		return fmt.Errorf("sensitivity must be between 0.0 and 1.0")
	}
	d.mu.Lock()
	d.sensitivities[metricName] = sensitivity
	d.mu.Unlock()
	return nil
}

// GetAnomalySensitivity gets current sensitivity for a metric.
func (d *anomalyDetectorImpl) GetAnomalySensitivity(ctx context.Context, metricName string) (float64, error) {
	return d.getSensitivity(metricName), nil
}

// CompareToBaseline compares current metric to historical baseline.
func (d *anomalyDetectorImpl) CompareToBaseline(ctx context.Context, resourceID, metricName string, currentValue float64) (float64, bool, error) {
	d.mu.RLock()
	bl, ok := d.baselines[resourceID+":"+metricName]
	d.mu.RUnlock()

	if !ok || bl.count < 5 {
		return 0, false, nil
	}

	if bl.mean == 0 {
		return 0, false, nil
	}

	deviationPct := (currentValue - bl.mean) / bl.mean * 100
	sensitivity := d.getSensitivity(metricName)
	zThreshold := sensitivityToZThreshold(sensitivity)

	isAnomalous := false
	if bl.stdDev > 0 {
		z := math.Abs((currentValue - bl.mean) / bl.stdDev)
		isAnomalous = z > zThreshold
	}

	return deviationPct, isAnomalous, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (d *anomalyDetectorImpl) getSensitivity(metricName string) float64 {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if s, ok := d.sensitivities[metricName]; ok {
		return s
	}
	return 0.5 // default medium
}

// sensitivityToZThreshold maps 0.0-1.0 sensitivity to z-score threshold.
// sensitivity=1.0 → z=1.5 (most sensitive), sensitivity=0.0 → z=4.0 (least sensitive)
func sensitivityToZThreshold(s float64) float64 {
	return 4.0 - (s * 2.5) // linear mapping: [0,1] → [4.0, 1.5]
}

func zToSeverity(z, threshold float64) string {
	ratio := z / threshold
	if ratio > 2.5 {
		return "critical"
	} else if ratio > 1.75 {
		return "high"
	} else if ratio > 1.25 {
		return "medium"
	}
	return "low"
}

func zToConfidence(z, threshold float64) int {
	confidence := int(math.Min(99, (z/threshold)*70))
	if confidence < 50 {
		confidence = 50
	}
	return confidence
}

func computeBaseline(values []float64) *baselineEntry {
	if len(values) == 0 {
		return &baselineEntry{}
	}

	// Mean
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(len(values))

	// Std dev
	variance := 0.0
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	variance /= float64(len(values))
	stdDev := math.Sqrt(variance)

	// Quartiles
	sorted := make([]float64, len(values))
	copy(sorted, values)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	q1 := quartile(sorted, 25)
	q3 := quartile(sorted, 75)

	return &baselineEntry{
		mean:      mean,
		stdDev:    stdDev,
		q1:        q1,
		q3:        q3,
		iqr:       q3 - q1,
		count:     len(values),
		updatedAt: time.Now(),
	}
}

func quartile(sorted []float64, p int) float64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := float64(p) / 100.0 * float64(len(sorted)-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	if lo == hi || hi >= len(sorted) {
		return sorted[lo]
	}
	w := rank - float64(lo)
	return sorted[lo]*(1-w) + sorted[hi]*w
}
