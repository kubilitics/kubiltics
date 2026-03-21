// Package metrics – history.go provides an in-memory ring-buffer store
// for per-resource metrics history (last 1 hour at 30-second intervals).
// No external database needed; suitable for a desktop/single-instance app.
package metrics

import (
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	defaultHistoryMaxPoints = 120               // 1h at 30s intervals
	defaultHistoryMaxAge    = 60 * time.Minute
	pruneStaleAfter         = 10 * time.Minute  // remove buffers with no writes for 10 min
)

// ringBuffer is a fixed-size circular buffer of history points.
type ringBuffer struct {
	points   []models.MetricsHistoryPoint
	head     int   // next write position
	count    int
	cap      int
	lastWrite time.Time
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{
		points: make([]models.MetricsHistoryPoint, capacity),
		cap:    capacity,
	}
}

func (rb *ringBuffer) append(p models.MetricsHistoryPoint) {
	rb.points[rb.head] = p
	rb.head = (rb.head + 1) % rb.cap
	if rb.count < rb.cap {
		rb.count++
	}
	rb.lastWrite = time.Now()
}

// query returns points within the given duration window, oldest first.
func (rb *ringBuffer) query(duration time.Duration) []models.MetricsHistoryPoint {
	if rb.count == 0 {
		return nil
	}
	cutoff := time.Now().Add(-duration).Unix()
	// Start from oldest point
	start := 0
	if rb.count == rb.cap {
		start = rb.head // oldest is at head when buffer is full
	}
	result := make([]models.MetricsHistoryPoint, 0, rb.count)
	for i := 0; i < rb.count; i++ {
		idx := (start + i) % rb.cap
		if rb.points[idx].Timestamp >= cutoff {
			result = append(result, rb.points[idx])
		}
	}
	return result
}

// MetricsHistoryStore manages per-resource ring buffers.
type MetricsHistoryStore struct {
	mu      sync.RWMutex
	buffers map[string]*ringBuffer
	maxPts  int
	maxAge  time.Duration
}

// NewMetricsHistoryStore creates a new history store.
func NewMetricsHistoryStore() *MetricsHistoryStore {
	return &MetricsHistoryStore{
		buffers: make(map[string]*ringBuffer),
		maxPts:  defaultHistoryMaxPoints,
		maxAge:  defaultHistoryMaxAge,
	}
}

// Record appends a data point for the given resource key.
func (s *MetricsHistoryStore) Record(key string, point models.MetricsHistoryPoint) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rb, ok := s.buffers[key]
	if !ok {
		rb = newRingBuffer(s.maxPts)
		s.buffers[key] = rb
	}
	rb.append(point)
}

// Query returns history points for the given key within the duration window.
func (s *MetricsHistoryStore) Query(key string, duration time.Duration) []models.MetricsHistoryPoint {
	if duration <= 0 || duration > s.maxAge {
		duration = s.maxAge
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	rb, ok := s.buffers[key]
	if !ok {
		return nil
	}
	return rb.query(duration)
}

// MarkWatched records that a resource is actively being viewed.
// Returns the key for the resource.
func (s *MetricsHistoryStore) MarkWatched(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rb, ok := s.buffers[key]; ok {
		rb.lastWrite = time.Now() // keep alive even if no new data
	}
}

// WatchedKeys returns all keys that have been written to within the staleness window.
func (s *MetricsHistoryStore) WatchedKeys() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cutoff := time.Now().Add(-pruneStaleAfter)
	keys := make([]string, 0, len(s.buffers))
	for k, rb := range s.buffers {
		if rb.lastWrite.After(cutoff) {
			keys = append(keys, k)
		}
	}
	return keys
}

// Prune removes buffers that haven't been written to for > pruneStaleAfter.
func (s *MetricsHistoryStore) Prune() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-pruneStaleAfter)
	pruned := 0
	for k, rb := range s.buffers {
		if rb.lastWrite.Before(cutoff) {
			delete(s.buffers, k)
			pruned++
		}
	}
	return pruned
}

// SummaryToHistoryPoint converts a MetricsSummary into a MetricsHistoryPoint.
func SummaryToHistoryPoint(s *models.MetricsSummary) models.MetricsHistoryPoint {
	cpuMilli, _ := ParseCPUToMilli(s.TotalCPU)
	memMiB, _ := ParseMemoryToMi(s.TotalMemory)

	point := models.MetricsHistoryPoint{
		Timestamp: time.Now().Unix(),
		CPUMilli:  cpuMilli,
		MemoryMiB: memMiB,
		NetworkRx: s.TotalNetworkRx,
		NetworkTx: s.TotalNetworkTx,
	}

	if len(s.Pods) > 0 {
		point.PodPoints = make([]models.PodHistoryPoint, 0, len(s.Pods))
		for _, pod := range s.Pods {
			pc, _ := ParseCPUToMilli(pod.CPU)
			pm, _ := ParseMemoryToMi(pod.Memory)
			pp := models.PodHistoryPoint{
				Name:      pod.Name,
				CPUMilli:  pc,
				MemoryMiB: pm,
				NetworkRx: pod.NetworkRxBytes,
				NetworkTx: pod.NetworkTxBytes,
			}
			if len(pod.Containers) > 0 {
				pp.Containers = make([]models.ContainerHistoryPoint, 0, len(pod.Containers))
				for _, c := range pod.Containers {
					cc, _ := ParseCPUToMilli(c.CPU)
					cm, _ := ParseMemoryToMi(c.Memory)
					pp.Containers = append(pp.Containers, models.ContainerHistoryPoint{
						Name:      c.Name,
						CPUMilli:  cc,
						MemoryMiB: cm,
					})
				}
			}
			point.PodPoints = append(point.PodPoints, pp)
		}
	}
	return point
}
