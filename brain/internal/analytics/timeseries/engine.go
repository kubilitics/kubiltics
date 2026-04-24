package timeseries

import "context"

// Package timeseries provides time-series storage and querying for metrics.
//
// Responsibilities:
//   - Store time-series metric data with automatic management
//   - Provide efficient range queries and aggregations
//   - Implement automatic downsampling for old data (hot/cold storage)
//   - Support windowed computations and time-window aggregations
//   - Query metrics for trend analysis and forecasting
//   - Manage storage lifecycle (hot data in-memory, cold data in database)
//
// Storage Architecture:
//   1. Hot Data (Last 24 hours): In-memory ring buffer
//      - Fast queries for recent metrics
//      - Used for real-time dashboards, anomaly detection
//      - Ring buffer (FIFO when full)
//   2. Cold Data (Historical): SQLite or PostgreSQL
//      - Downsampled to lower resolution (1min → 5min → 1hour)
//      - Used for trend analysis, long-term forecasting
//      - Compressed or archived after retention period
//
// Metric Types Stored:
//   - Pod metrics: CPU, memory, network I/O, disk I/O
//   - Node metrics: CPU, memory, disk, network
//   - Cluster metrics: Total CPU, memory, storage
//   - Custom application metrics (if exposed)
//
// Downsampling Strategy:
//   - Raw data: 15-second intervals (hot buffer, 24 hours)
//   - 1-minute resolution: 30 days
//   - 5-minute resolution: 90 days
//   - 1-hour resolution: 1 year
//   - Automatic aggregation: min, max, avg, p50, p95, p99
//
// Query Types:
//   - Range query: Get all data in time range
//   - Point query: Get data at specific timestamp
//   - Aggregation: min, max, avg, sum over range
//   - Windowed: Compute metric over sliding window (e.g., 5min rolling avg)
//   - Comparison: Compare metric between time periods
//
// Integration Points:
//   - Backend gRPC stream: Receives metric updates
//   - Analytics Engine: Queries metrics for analysis
//   - Anomaly Detector: Accesses time-series for pattern detection
//   - Forecasting Engine: Uses historical trends
//   - Observation Tools: Provides metric data to LLM
//   - REST API: Metrics endpoint

// TimeSeriesEngine defines the interface for time-series operations.
type TimeSeriesEngine interface {
	// StoreMetric stores a single metric data point.
	StoreMetric(ctx context.Context, resourceID string, metricName string, timestamp interface{}, value float64) error

	// QueryRange returns metric data for a time range.
	// resolution: "15s", "1m", "5m", "1h" - automatically selects based on query range
	QueryRange(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}, resolution string) (interface{}, error)

	// QueryPoint returns metric data at specific timestamp.
	QueryPoint(ctx context.Context, resourceID string, metricName string, timestamp interface{}) (float64, error)

	// Aggregate computes aggregation over time range.
	// aggregationType: "min", "max", "avg", "sum", "p50", "p95", "p99"
	Aggregate(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}, aggregationType string) (float64, error)

	// WindowedAggregate computes metric over sliding windows.
	// windowSize: duration like "5m", "1h"
	WindowedAggregate(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}, windowSize string, aggregationType string) (interface{}, error)

	// GetTrend analyzes trend in metric over time range.
	// Returns: direction (up/down/flat), slope, recent_value, forecast
	GetTrend(ctx context.Context, resourceID string, metricName string, startTime interface{}, endTime interface{}) (interface{}, error)

	// CompareMetrics compares metric between two time periods.
	CompareMetrics(ctx context.Context, resourceID string, metricName string, period1Start interface{}, period1End interface{}, period2Start interface{}, period2End interface{}) (interface{}, error)

	// DeleteOldData removes data older than retention period (background task).
	DeleteOldData(ctx context.Context, retentionDays int) error
}

// NewTimeSeriesEngine creates a new time-series engine with storage backends.
// The concrete implementation is in engine_impl.go.
