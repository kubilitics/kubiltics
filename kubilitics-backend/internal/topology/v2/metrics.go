package v2

import (
	"sync"
	"sync/atomic"
	"time"
)

// TopologyMetrics tracks operational metrics for the topology engine.
// Exposed via /metrics endpoint in Prometheus format.
type TopologyMetrics struct {
	mu sync.RWMutex

	// Build metrics
	buildCount    int64
	buildErrors   int64
	buildDuration map[string]*durationHistogram // keyed by view mode

	// Cache metrics
	cacheHits   int64
	cacheMisses int64

	// WebSocket metrics
	wsConnections int64

	// API metrics
	apiCalls   map[string]int64 // keyed by resource type
	apiErrors  map[string]int64
	apiLatency map[string]*durationHistogram
}

type durationHistogram struct {
	count int64
	sum   float64
	max   float64
	min   float64
}

// NewTopologyMetrics creates a new metrics collector.
func NewTopologyMetrics() *TopologyMetrics {
	return &TopologyMetrics{
		buildDuration: make(map[string]*durationHistogram),
		apiCalls:      make(map[string]int64),
		apiErrors:     make(map[string]int64),
		apiLatency:    make(map[string]*durationHistogram),
	}
}

// RecordBuild records a topology build completion.
func (m *TopologyMetrics) RecordBuild(mode string, duration time.Duration, err error) {
	atomic.AddInt64(&m.buildCount, 1)
	if err != nil {
		atomic.AddInt64(&m.buildErrors, 1)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	h, ok := m.buildDuration[mode]
	if !ok {
		h = &durationHistogram{min: float64(duration.Milliseconds())}
		m.buildDuration[mode] = h
	}

	ms := float64(duration.Milliseconds())
	h.count++
	h.sum += ms
	if ms > h.max {
		h.max = ms
	}
	if ms < h.min {
		h.min = ms
	}
}

// RecordCacheHit increments cache hit counter.
func (m *TopologyMetrics) RecordCacheHit() {
	atomic.AddInt64(&m.cacheHits, 1)
}

// RecordCacheMiss increments cache miss counter.
func (m *TopologyMetrics) RecordCacheMiss() {
	atomic.AddInt64(&m.cacheMisses, 1)
}

// RecordWSConnect increments WebSocket connection counter.
func (m *TopologyMetrics) RecordWSConnect() {
	atomic.AddInt64(&m.wsConnections, 1)
}

// RecordWSDisconnect decrements WebSocket connection counter.
func (m *TopologyMetrics) RecordWSDisconnect() {
	atomic.AddInt64(&m.wsConnections, -1)
}

// RecordAPICall records a Kubernetes API call.
func (m *TopologyMetrics) RecordAPICall(resourceType string, duration time.Duration, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.apiCalls[resourceType]++
	if err != nil {
		m.apiErrors[resourceType]++
	}

	h, ok := m.apiLatency[resourceType]
	if !ok {
		h = &durationHistogram{min: float64(duration.Milliseconds())}
		m.apiLatency[resourceType] = h
	}

	ms := float64(duration.Milliseconds())
	h.count++
	h.sum += ms
	if ms > h.max {
		h.max = ms
	}
	if ms < h.min {
		h.min = ms
	}
}

// CacheHitRatio returns the cache hit ratio (0.0 to 1.0).
func (m *TopologyMetrics) CacheHitRatio() float64 {
	hits := atomic.LoadInt64(&m.cacheHits)
	misses := atomic.LoadInt64(&m.cacheMisses)
	total := hits + misses
	if total == 0 {
		return 0
	}
	return float64(hits) / float64(total)
}

// Snapshot returns a copy of all metrics for reporting.
type MetricsSnapshot struct {
	BuildCount       int64              `json:"build_count"`
	BuildErrors      int64              `json:"build_errors"`
	BuildDurationMs  map[string]float64 `json:"build_duration_avg_ms"`
	CacheHits        int64              `json:"cache_hits"`
	CacheMisses      int64              `json:"cache_misses"`
	CacheHitRatio    float64            `json:"cache_hit_ratio"`
	WSConnections    int64              `json:"ws_connections"`
	APICalls         map[string]int64   `json:"api_calls"`
	APIErrors        map[string]int64   `json:"api_errors"`
	APILatencyAvgMs  map[string]float64 `json:"api_latency_avg_ms"`
}

func (m *TopologyMetrics) Snapshot() MetricsSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	buildAvg := make(map[string]float64)
	for mode, h := range m.buildDuration {
		if h.count > 0 {
			buildAvg[mode] = h.sum / float64(h.count)
		}
	}

	apiLatencyAvg := make(map[string]float64)
	for rt, h := range m.apiLatency {
		if h.count > 0 {
			apiLatencyAvg[rt] = h.sum / float64(h.count)
		}
	}

	apiCallsCopy := make(map[string]int64)
	for k, v := range m.apiCalls {
		apiCallsCopy[k] = v
	}

	apiErrorsCopy := make(map[string]int64)
	for k, v := range m.apiErrors {
		apiErrorsCopy[k] = v
	}

	return MetricsSnapshot{
		BuildCount:      atomic.LoadInt64(&m.buildCount),
		BuildErrors:     atomic.LoadInt64(&m.buildErrors),
		BuildDurationMs: buildAvg,
		CacheHits:       atomic.LoadInt64(&m.cacheHits),
		CacheMisses:     atomic.LoadInt64(&m.cacheMisses),
		CacheHitRatio:   m.CacheHitRatio(),
		WSConnections:   atomic.LoadInt64(&m.wsConnections),
		APICalls:        apiCallsCopy,
		APIErrors:       apiErrorsCopy,
		APILatencyAvgMs: apiLatencyAvg,
	}
}

// PrometheusFormat returns metrics in Prometheus exposition format.
func (m *TopologyMetrics) PrometheusFormat() string {
	snap := m.Snapshot()
	var buf []byte

	appendMetric := func(name, help, mtype string, value interface{}) {
		buf = append(buf, []byte("# HELP "+name+" "+help+"\n")...)
		buf = append(buf, []byte("# TYPE "+name+" "+mtype+"\n")...)
		switch v := value.(type) {
		case int64:
			buf = append(buf, []byte(name+" "+itoa(v)+"\n")...)
		case float64:
			buf = append(buf, []byte(name+" "+ftoa(v)+"\n")...)
		}
	}

	appendMetric("topology_build_total", "Total topology builds", "counter", snap.BuildCount)
	appendMetric("topology_build_errors_total", "Total topology build errors", "counter", snap.BuildErrors)
	appendMetric("topology_cache_hits_total", "Total cache hits", "counter", snap.CacheHits)
	appendMetric("topology_cache_misses_total", "Total cache misses", "counter", snap.CacheMisses)
	appendMetric("topology_cache_hit_ratio", "Cache hit ratio", "gauge", snap.CacheHitRatio)
	appendMetric("topology_ws_connections", "Active WebSocket connections", "gauge", snap.WSConnections)

	return string(buf)
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf) - 1
	neg := v < 0
	if neg {
		v = -v
	}
	for v > 0 {
		buf[pos] = byte('0' + v%10)
		v /= 10
		pos--
	}
	if neg {
		buf[pos] = '-'
		pos--
	}
	return string(buf[pos+1:])
}

func ftoa(v float64) string {
	if v == 0 {
		return "0"
	}
	// Simple conversion — in production use strconv.FormatFloat
	intPart := int64(v)
	fracPart := int64((v - float64(intPart)) * 1000)
	if fracPart < 0 {
		fracPart = -fracPart
	}
	if fracPart == 0 {
		return itoa(intPart)
	}
	return itoa(intPart) + "." + itoa(fracPart)
}
