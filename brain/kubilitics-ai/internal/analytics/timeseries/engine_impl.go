package timeseries

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// dataPoint is an internal storage entry.
type dataPoint struct {
	timestamp time.Time
	value     float64
}

// ringBuffer is a fixed-capacity circular buffer of dataPoints.
type ringBuffer struct {
	data     []dataPoint
	head     int
	size     int
	capacity int
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{
		data:     make([]dataPoint, capacity),
		capacity: capacity,
	}
}

func (rb *ringBuffer) push(dp dataPoint) {
	idx := (rb.head + rb.size) % rb.capacity
	rb.data[idx] = dp
	if rb.size < rb.capacity {
		rb.size++
	} else {
		rb.head = (rb.head + 1) % rb.capacity
	}
}

// slice returns all points in chronological order.
func (rb *ringBuffer) slice() []dataPoint {
	out := make([]dataPoint, rb.size)
	for i := 0; i < rb.size; i++ {
		out[i] = rb.data[(rb.head+i)%rb.capacity]
	}
	return out
}

// timeSeriesEngineImpl is the in-memory TimeSeriesEngine implementation.
type timeSeriesEngineImpl struct {
	mu sync.RWMutex
	// key = resourceID + ":" + metricName
	series map[string]*ringBuffer
	// retention for hot buffer: 24 hours of 15-second samples = 5760 points
	hotCapacity int
}

// NewTimeSeriesEngine creates a new in-memory time-series engine.
func NewTimeSeriesEngine() TimeSeriesEngine {
	return &timeSeriesEngineImpl{
		series:      make(map[string]*ringBuffer),
		hotCapacity: 5760, // 24h × 240 points/h (15s intervals)
	}
}

func (e *timeSeriesEngineImpl) key(resourceID, metricName string) string {
	return resourceID + ":" + metricName
}

func (e *timeSeriesEngineImpl) getOrCreate(resourceID, metricName string) *ringBuffer {
	k := e.key(resourceID, metricName)
	if rb, ok := e.series[k]; ok {
		return rb
	}
	rb := newRingBuffer(e.hotCapacity)
	e.series[k] = rb
	return rb
}

// StoreMetric stores a single metric data point.
func (e *timeSeriesEngineImpl) StoreMetric(ctx context.Context, resourceID, metricName string, timestamp interface{}, value float64) error {
	t, err := toTime(timestamp)
	if err != nil {
		return err
	}
	e.mu.Lock()
	rb := e.getOrCreate(resourceID, metricName)
	rb.push(dataPoint{timestamp: t, value: value})
	e.mu.Unlock()
	return nil
}

// QueryRange returns metric data for a time range.
func (e *timeSeriesEngineImpl) QueryRange(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}, resolution string) (interface{}, error) {
	start, err := toTime(startTime)
	if err != nil {
		return nil, err
	}
	end, err := toTime(endTime)
	if err != nil {
		return nil, err
	}

	e.mu.RLock()
	rb, ok := e.series[e.key(resourceID, metricName)]
	e.mu.RUnlock()
	if !ok {
		return []map[string]interface{}{}, nil
	}

	points := rb.slice()
	var result []map[string]interface{}
	for _, p := range points {
		if p.timestamp.Before(start) || p.timestamp.After(end) {
			continue
		}
		result = append(result, map[string]interface{}{
			"timestamp": p.timestamp,
			"value":     p.value,
		})
	}
	return result, nil
}

// QueryPoint returns the metric value closest to the given timestamp.
func (e *timeSeriesEngineImpl) QueryPoint(ctx context.Context, resourceID, metricName string, timestamp interface{}) (float64, error) {
	t, err := toTime(timestamp)
	if err != nil {
		return 0, err
	}

	e.mu.RLock()
	rb, ok := e.series[e.key(resourceID, metricName)]
	e.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("no data for %s/%s", resourceID, metricName)
	}

	points := rb.slice()
	if len(points) == 0 {
		return 0, fmt.Errorf("no data for %s/%s", resourceID, metricName)
	}

	// Find closest point
	bestDiff := math.MaxFloat64
	best := points[0]
	for _, p := range points {
		diff := math.Abs(float64(p.timestamp.Sub(t)))
		if diff < bestDiff {
			bestDiff = diff
			best = p
		}
	}
	return best.value, nil
}

// Aggregate computes aggregation over a time range.
func (e *timeSeriesEngineImpl) Aggregate(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}, aggregationType string) (float64, error) {
	start, err := toTime(startTime)
	if err != nil {
		return 0, err
	}
	end, err := toTime(endTime)
	if err != nil {
		return 0, err
	}

	e.mu.RLock()
	rb, ok := e.series[e.key(resourceID, metricName)]
	e.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("no data for %s/%s", resourceID, metricName)
	}

	var values []float64
	for _, p := range rb.slice() {
		if p.timestamp.Before(start) || p.timestamp.After(end) {
			continue
		}
		values = append(values, p.value)
	}

	if len(values) == 0 {
		return 0, fmt.Errorf("no data in range")
	}

	return aggregate(values, aggregationType)
}

// WindowedAggregate computes metric over sliding windows.
func (e *timeSeriesEngineImpl) WindowedAggregate(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}, windowSize, aggregationType string) (interface{}, error) {
	start, err := toTime(startTime)
	if err != nil {
		return nil, err
	}
	end, err := toTime(endTime)
	if err != nil {
		return nil, err
	}
	window, err := parseDuration(windowSize)
	if err != nil {
		return nil, err
	}

	e.mu.RLock()
	rb, ok := e.series[e.key(resourceID, metricName)]
	e.mu.RUnlock()
	if !ok {
		return []interface{}{}, nil
	}

	points := rb.slice()
	var results []map[string]interface{}
	for t := start; t.Before(end); t = t.Add(window) {
		windowEnd := t.Add(window)
		var values []float64
		for _, p := range points {
			if !p.timestamp.Before(t) && p.timestamp.Before(windowEnd) {
				values = append(values, p.value)
			}
		}
		if len(values) == 0 {
			continue
		}
		val, _ := aggregate(values, aggregationType)
		results = append(results, map[string]interface{}{
			"window_start": t,
			"window_end":   windowEnd,
			"value":        val,
			"count":        len(values),
		})
	}
	return results, nil
}

// GetTrend analyzes trend in metric over a time range.
func (e *timeSeriesEngineImpl) GetTrend(ctx context.Context, resourceID, metricName string, startTime, endTime interface{}) (interface{}, error) {
	start, err := toTime(startTime)
	if err != nil {
		return nil, err
	}
	end, err := toTime(endTime)
	if err != nil {
		return nil, err
	}

	e.mu.RLock()
	rb, ok := e.series[e.key(resourceID, metricName)]
	e.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("no data for %s/%s", resourceID, metricName)
	}

	var filtered []dataPoint
	for _, p := range rb.slice() {
		if !p.timestamp.Before(start) && !p.timestamp.After(end) {
			filtered = append(filtered, p)
		}
	}
	if len(filtered) < 2 {
		return map[string]interface{}{
			"direction": "unknown",
			"slope":     0,
		}, nil
	}

	slope := linearRegressionSlope(filtered)
	direction := "stable"
	if slope > 0.01 {
		direction = "increasing"
	} else if slope < -0.01 {
		direction = "decreasing"
	}

	recent := filtered[len(filtered)-1].value
	return map[string]interface{}{
		"direction":    direction,
		"slope":        slope,
		"recent_value": recent,
		"data_points":  len(filtered),
	}, nil
}

// CompareMetrics compares metric between two time periods.
func (e *timeSeriesEngineImpl) CompareMetrics(ctx context.Context, resourceID, metricName string, p1Start, p1End, p2Start, p2End interface{}) (interface{}, error) {
	avg1, err := e.Aggregate(ctx, resourceID, metricName, p1Start, p1End, "avg")
	if err != nil {
		return nil, fmt.Errorf("period1: %w", err)
	}
	avg2, err := e.Aggregate(ctx, resourceID, metricName, p2Start, p2End, "avg")
	if err != nil {
		return nil, fmt.Errorf("period2: %w", err)
	}

	changePct := 0.0
	if avg1 != 0 {
		changePct = (avg2 - avg1) / avg1 * 100
	}
	return map[string]interface{}{
		"period1_avg": avg1,
		"period2_avg": avg2,
		"change_pct":  changePct,
		"increased":   avg2 > avg1,
	}, nil
}

// DeleteOldData removes data older than retentionDays (no-op for ring buffer — handled by capacity).
func (e *timeSeriesEngineImpl) DeleteOldData(ctx context.Context, retentionDays int) error {
	// Ring buffer automatically evicts oldest data; no explicit deletion needed.
	return nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func aggregate(values []float64, aggregationType string) (float64, error) {
	if len(values) == 0 {
		return 0, fmt.Errorf("no values")
	}
	switch aggregationType {
	case "min":
		min := values[0]
		for _, v := range values[1:] {
			if v < min {
				min = v
			}
		}
		return min, nil
	case "max":
		max := values[0]
		for _, v := range values[1:] {
			if v > max {
				max = v
			}
		}
		return max, nil
	case "sum":
		sum := 0.0
		for _, v := range values {
			sum += v
		}
		return sum, nil
	case "avg", "mean":
		sum := 0.0
		for _, v := range values {
			sum += v
		}
		return sum / float64(len(values)), nil
	case "p50":
		return percentile(values, 50), nil
	case "p95":
		return percentile(values, 95), nil
	case "p99":
		return percentile(values, 99), nil
	default:
		return 0, fmt.Errorf("unknown aggregation type: %s", aggregationType)
	}
}

func percentile(values []float64, p int) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	// Simple insertion sort
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	rank := float64(p) / 100.0 * float64(len(sorted)-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	if lo == hi {
		return sorted[lo]
	}
	w := rank - float64(lo)
	return sorted[lo]*(1-w) + sorted[hi]*w
}

func linearRegressionSlope(points []dataPoint) float64 {
	n := float64(len(points))
	if n < 2 {
		return 0
	}
	var sumX, sumY, sumXY, sumX2 float64
	for i, p := range points {
		x := float64(i)
		y := p.value
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}
	denom := n*sumX2 - sumX*sumX
	if denom == 0 {
		return 0
	}
	return (n*sumXY - sumX*sumY) / denom
}

func parseDuration(s string) (time.Duration, error) {
	switch s {
	case "15s":
		return 15 * time.Second, nil
	case "1m":
		return time.Minute, nil
	case "5m":
		return 5 * time.Minute, nil
	case "15m":
		return 15 * time.Minute, nil
	case "1h":
		return time.Hour, nil
	case "6h":
		return 6 * time.Hour, nil
	case "1d", "24h":
		return 24 * time.Hour, nil
	}
	return time.ParseDuration(s)
}

func toTime(v interface{}) (time.Time, error) {
	switch t := v.(type) {
	case time.Time:
		return t, nil
	case string:
		parsed, err := time.Parse(time.RFC3339, t)
		if err != nil {
			return time.Time{}, fmt.Errorf("invalid time %q: %w", t, err)
		}
		return parsed, nil
	case int64:
		return time.Unix(t, 0), nil
	case float64:
		return time.Unix(int64(t), 0), nil
	default:
		return time.Time{}, fmt.Errorf("unsupported time type %T", v)
	}
}
