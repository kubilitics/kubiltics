package events

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// Package events provides event handling from kubilitics-backend stream.
//
// Responsibilities:
//   - Process incoming events from kubilitics-backend
//   - Detect anomalous events
//   - Trigger proactive investigations when needed
//   - Feed events into World Model
//   - Correlate events with metrics
//   - Build event-based alerts

// ─── Public types ─────────────────────────────────────────────────────────────

// EventSeverity classifies event urgency.
type EventSeverity string

const (
	SeverityNormal   EventSeverity = "normal"
	SeverityWarning  EventSeverity = "warning"
	SeverityCritical EventSeverity = "critical"
)

// AnomalyType classifies the detected anomaly pattern.
type AnomalyType string

const (
	AnomalyCrashLoop      AnomalyType = "crash_loop"
	AnomalyOOMKilled      AnomalyType = "oom_killed"
	AnomalyNodeNotReady   AnomalyType = "node_not_ready"
	AnomalyMemoryPressure AnomalyType = "memory_pressure"
	AnomalyRestartSurge   AnomalyType = "restart_surge"
	AnomalyDeployFail     AnomalyType = "deployment_failure"
)

// ProcessedEvent is the normalised internal representation of a K8s event.
type ProcessedEvent struct {
	ID              string
	Type            EventSeverity
	Reason          string
	Message         string
	Namespace       string
	InvolvedKind    string
	InvolvedName    string
	Count           int32
	FirstSeen       time.Time
	LastSeen        time.Time
	Source          string
	IsAnomaly       bool
	AnomalyType     AnomalyType
	InvestigationID string // non-empty when a proactive investigation was triggered
}

// AnomalyPattern represents a detected anomaly pattern.
type AnomalyPattern struct {
	Type        AnomalyType
	Description string
	Namespace   string
	Resource    string
	EventCount  int
	FirstSeen   time.Time
	LastSeen    time.Time
	Severity    EventSeverity
}

// EventStats holds aggregate event statistics.
type EventStats struct {
	TotalEvents     int
	WarningEvents   int
	AnomalyCount    int
	AnomalyPatterns []AnomalyPattern
	TopReasons      map[string]int
	LastProcessedAt time.Time
	EventsByKind    map[string]int
}

// InvestigationTrigger is a callback invoked when an anomaly demands investigation.
// Returns the investigation ID or an error.
type InvestigationTrigger func(ctx context.Context, description string, resourceKind, namespace, name string) (string, error)

// EventHandler defines the interface for event processing.
type EventHandler interface {
	// HandleEvent processes a single event from backend stream.
	// Detects anomalies, triggers investigations if needed.
	HandleEvent(ctx context.Context, event interface{}) error

	// GetRecentEvents returns recent events (cached in memory).
	GetRecentEvents(ctx context.Context, namespace string, kind string, limit int) ([]interface{}, error)

	// GetEventStats returns statistics about events.
	GetEventStats(ctx context.Context) (interface{}, error)

	// GetEventTimeline returns events related to incident in time order.
	GetEventTimeline(ctx context.Context, namespace string, startTime interface{}, endTime interface{}) ([]interface{}, error)

	// FindCorrelatedEvents finds events that are correlated.
	FindCorrelatedEvents(ctx context.Context, event interface{}) ([]interface{}, error)

	// SetAnomalyThreshold sets threshold for anomaly detection.
	SetAnomalyThreshold(ctx context.Context, eventType string, threshold int) error

	// TriggerManualInvestigation manually triggers investigation for event.
	TriggerManualInvestigation(ctx context.Context, event interface{}) (string, error)
}

// ─── Ring buffer ───────────────────────────────────────────────────────────────

const defaultRingSize = 1000

type ringBuffer struct {
	mu    sync.RWMutex
	items []*ProcessedEvent
	head  int // index of next write position
	size  int // current fill level
	cap   int // total capacity
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{
		items: make([]*ProcessedEvent, capacity),
		cap:   capacity,
	}
}

func (rb *ringBuffer) Push(ev *ProcessedEvent) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.items[rb.head] = ev
	rb.head = (rb.head + 1) % rb.cap
	if rb.size < rb.cap {
		rb.size++
	}
}

// Snapshot returns all events in chronological order (oldest first).
func (rb *ringBuffer) Snapshot() []*ProcessedEvent {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	result := make([]*ProcessedEvent, 0, rb.size)
	if rb.size < rb.cap {
		// Buffer not yet wrapped: [0..size)
		for i := 0; i < rb.size; i++ {
			if rb.items[i] != nil {
				result = append(result, rb.items[i])
			}
		}
	} else {
		// Buffer has wrapped: oldest element is at rb.head
		for i := 0; i < rb.cap; i++ {
			idx := (rb.head + i) % rb.cap
			if rb.items[idx] != nil {
				result = append(result, rb.items[idx])
			}
		}
	}
	return result
}

// ─── Anomaly detector ─────────────────────────────────────────────────────────

// anomalyWindow is the sliding window for restart/crash counting.
const anomalyWindow = 5 * time.Minute

// crashReasonKeywords maps Kubernetes event reasons to anomaly types.
var crashReasonKeywords = map[string]AnomalyType{
	"crashloopbackoff": AnomalyCrashLoop,
	"oomkilled":        AnomalyOOMKilled,
	"backoff":          AnomalyCrashLoop,
	"failed":           AnomalyDeployFail,
	"notready":         AnomalyNodeNotReady,
	"memorypressure":   AnomalyMemoryPressure,
	"diskpressure":     AnomalyMemoryPressure,
	"evicted":          AnomalyOOMKilled,
}

// recentCounts tracks recent event counts per resource for surge detection.
type recentCounts struct {
	mu     sync.Mutex
	counts map[string][]time.Time // key = "kind/namespace/name/reason"
}

func newRecentCounts() *recentCounts {
	return &recentCounts{counts: make(map[string][]time.Time)}
}

// Record adds a timestamp entry for the given key and returns the count
// within the anomalyWindow.
func (rc *recentCounts) Record(key string) int {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-anomalyWindow)
	ts := rc.counts[key]
	// Trim old entries
	valid := ts[:0]
	for _, t := range ts {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	valid = append(valid, now)
	rc.counts[key] = valid
	return len(valid)
}

// ─── eventHandlerImpl ─────────────────────────────────────────────────────────

type eventHandlerImpl struct {
	mu sync.RWMutex

	// Ring buffer of processed events.
	ring *ringBuffer

	// Per-resource recent counts for surge detection.
	rc *recentCounts

	// Anomaly thresholds.
	thresholds map[string]int // eventType → threshold count

	// Detected anomaly patterns (cleared on ForceReset).
	anomalies []AnomalyPattern

	// Aggregate stats.
	totalEvents   int
	warningEvents int

	// Optional investigation trigger callback.
	triggerFn InvestigationTrigger
}

// NewEventHandler creates a new event handler with defaults.
func NewEventHandler() EventHandler {
	return &eventHandlerImpl{
		ring: newRingBuffer(defaultRingSize),
		rc:   newRecentCounts(),
		thresholds: map[string]int{
			"Pod":        3, // ≥3 crash/restart events in 5m → anomaly
			"Node":       1, // Any NotReady → anomaly
			"Deployment": 2,
		},
		anomalies: make([]AnomalyPattern, 0),
	}
}

// NewEventHandlerWithTrigger creates an event handler that calls triggerFn on anomalies.
func NewEventHandlerWithTrigger(trigger InvestigationTrigger) EventHandler {
	h := NewEventHandler().(*eventHandlerImpl)
	h.triggerFn = trigger
	return h
}

// HandleEvent processes a single event from the backend stream.
func (h *eventHandlerImpl) HandleEvent(ctx context.Context, event interface{}) error {
	ev, err := h.normalize(event)
	if err != nil {
		return fmt.Errorf("event normalization failed: %w", err)
	}

	// Run anomaly detection.
	anomaly, detected := h.detectAnomaly(ev)
	if detected {
		ev.IsAnomaly = true
		ev.AnomalyType = anomaly.Type
		h.mu.Lock()
		h.anomalies = append(h.anomalies, anomaly)
		h.mu.Unlock()

		// Trigger investigation if a callback is registered.
		if h.triggerFn != nil {
			desc := fmt.Sprintf("Anomaly detected: %s on %s/%s — %s",
				anomaly.Type, ev.InvolvedKind, ev.InvolvedName, ev.Message)
			invID, trigErr := h.triggerFn(ctx, desc, ev.InvolvedKind, ev.Namespace, ev.InvolvedName)
			if trigErr == nil {
				ev.InvestigationID = invID
			}
		}
	}

	// Update aggregates.
	h.mu.Lock()
	h.totalEvents++
	if ev.Type == SeverityWarning || ev.Type == SeverityCritical {
		h.warningEvents++
	}
	h.mu.Unlock()

	// Push into ring buffer.
	h.ring.Push(ev)
	return nil
}

// GetRecentEvents returns recent events filtered by namespace and kind.
func (h *eventHandlerImpl) GetRecentEvents(ctx context.Context, namespace, kind string, limit int) ([]interface{}, error) {
	all := h.ring.Snapshot()
	result := make([]interface{}, 0, limit)
	// Iterate newest-first.
	for i := len(all) - 1; i >= 0 && len(result) < limit; i-- {
		ev := all[i]
		if namespace != "" && ev.Namespace != namespace {
			continue
		}
		if kind != "" && !strings.EqualFold(ev.InvolvedKind, kind) {
			continue
		}
		result = append(result, ev)
	}
	return result, nil
}

// GetEventStats returns aggregate event statistics.
func (h *eventHandlerImpl) GetEventStats(ctx context.Context) (interface{}, error) {
	all := h.ring.Snapshot()
	h.mu.RLock()
	total := h.totalEvents
	warnings := h.warningEvents
	anomalies := make([]AnomalyPattern, len(h.anomalies))
	copy(anomalies, h.anomalies)
	h.mu.RUnlock()

	topReasons := make(map[string]int)
	byKind := make(map[string]int)
	for _, ev := range all {
		topReasons[ev.Reason]++
		byKind[ev.InvolvedKind]++
	}

	return &EventStats{
		TotalEvents:     total,
		WarningEvents:   warnings,
		AnomalyCount:    len(anomalies),
		AnomalyPatterns: anomalies,
		TopReasons:      topReasons,
		EventsByKind:    byKind,
		LastProcessedAt: time.Now(),
	}, nil
}

// GetEventTimeline returns events in a time range for a namespace.
func (h *eventHandlerImpl) GetEventTimeline(ctx context.Context, namespace string, startTime, endTime interface{}) ([]interface{}, error) {
	var start, end time.Time
	if t, ok := startTime.(time.Time); ok {
		start = t
	}
	if t, ok := endTime.(time.Time); ok {
		end = t
	}

	all := h.ring.Snapshot()
	result := make([]interface{}, 0)
	for _, ev := range all {
		if namespace != "" && ev.Namespace != namespace {
			continue
		}
		if !start.IsZero() && ev.LastSeen.Before(start) {
			continue
		}
		if !end.IsZero() && ev.LastSeen.After(end) {
			continue
		}
		result = append(result, ev)
	}
	return result, nil
}

// FindCorrelatedEvents finds events correlated with the given event.
// Correlation is based on: same namespace within anomalyWindow, same or related reason.
func (h *eventHandlerImpl) FindCorrelatedEvents(ctx context.Context, event interface{}) ([]interface{}, error) {
	target, err := h.normalize(event)
	if err != nil {
		return nil, err
	}

	all := h.ring.Snapshot()
	result := make([]interface{}, 0)
	cutoff := target.LastSeen.Add(-anomalyWindow)

	for _, ev := range all {
		if ev.ID == target.ID {
			continue
		}
		if ev.Namespace != target.Namespace {
			continue
		}
		if ev.LastSeen.Before(cutoff) {
			continue
		}
		// Same reason or both are warning/critical.
		if ev.Reason == target.Reason || (ev.Type != SeverityNormal && target.Type != SeverityNormal) {
			result = append(result, ev)
		}
	}
	return result, nil
}

// SetAnomalyThreshold updates the anomaly detection threshold for an event type.
func (h *eventHandlerImpl) SetAnomalyThreshold(ctx context.Context, eventType string, threshold int) error {
	if threshold < 1 {
		return fmt.Errorf("threshold must be >= 1, got %d", threshold)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.thresholds[eventType] = threshold
	return nil
}

// TriggerManualInvestigation manually triggers an investigation for the given event.
func (h *eventHandlerImpl) TriggerManualInvestigation(ctx context.Context, event interface{}) (string, error) {
	ev, err := h.normalize(event)
	if err != nil {
		return "", err
	}
	if h.triggerFn == nil {
		return "", fmt.Errorf("no investigation trigger registered")
	}
	desc := fmt.Sprintf("Manual investigation: %s on %s/%s — %s",
		ev.Reason, ev.InvolvedKind, ev.InvolvedName, ev.Message)
	return h.triggerFn(ctx, desc, ev.InvolvedKind, ev.Namespace, ev.InvolvedName)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// normalize converts a raw event (from gRPC proto or map) to ProcessedEvent.
func (h *eventHandlerImpl) normalize(event interface{}) (*ProcessedEvent, error) {
	// Already normalized.
	if ev, ok := event.(*ProcessedEvent); ok {
		return ev, nil
	}

	// Proto-generated KubernetesEvent from stream.
	if kev, ok := event.(*pb.KubernetesEvent); ok {
		return h.fromProto(kev), nil
	}

	// Map-based event (from REST or tests).
	if m, ok := event.(map[string]interface{}); ok {
		return h.fromMap(m), nil
	}

	return nil, fmt.Errorf("unsupported event type: %T", event)
}

func (h *eventHandlerImpl) fromProto(kev *pb.KubernetesEvent) *ProcessedEvent {
	ev := &ProcessedEvent{
		ID:      fmt.Sprintf("%s-%s-%d", kev.Reason, kev.Source, kev.Count),
		Reason:  kev.Reason,
		Message: kev.Message,
		Count:   kev.Count,
		Source:  kev.Source,
	}

	switch strings.ToLower(kev.Type) {
	case "warning":
		ev.Type = SeverityWarning
	default:
		ev.Type = SeverityNormal
	}

	if obj := kev.InvolvedObject; obj != nil {
		ev.Namespace = obj.Namespace
		ev.InvolvedKind = obj.Kind
		ev.InvolvedName = obj.Name
	}

	if kev.FirstTimestamp != nil {
		ev.FirstSeen = kev.FirstTimestamp.AsTime()
	}
	if kev.LastTimestamp != nil {
		ev.LastSeen = kev.LastTimestamp.AsTime()
	} else {
		ev.LastSeen = time.Now()
	}

	return ev
}

func (h *eventHandlerImpl) fromMap(m map[string]interface{}) *ProcessedEvent {
	ev := &ProcessedEvent{
		LastSeen: time.Now(),
	}
	if v, ok := m["type"].(string); ok {
		if strings.ToLower(v) == "warning" {
			ev.Type = SeverityWarning
		} else {
			ev.Type = SeverityNormal
		}
	}
	if v, ok := m["reason"].(string); ok {
		ev.Reason = v
	}
	if v, ok := m["message"].(string); ok {
		ev.Message = v
	}
	if v, ok := m["namespace"].(string); ok {
		ev.Namespace = v
	}
	if v, ok := m["kind"].(string); ok {
		ev.InvolvedKind = v
	}
	if v, ok := m["name"].(string); ok {
		ev.InvolvedName = v
	}
	if v, ok := m["count"].(int32); ok {
		ev.Count = v
	}
	if v, ok := m["count"].(int); ok {
		ev.Count = int32(v)
	}
	ev.ID = fmt.Sprintf("%s-%s-%s-%d", ev.InvolvedKind, ev.InvolvedName, ev.Reason, time.Now().UnixNano())
	return ev
}

// detectAnomaly checks if an event represents an anomalous pattern.
func (h *eventHandlerImpl) detectAnomaly(ev *ProcessedEvent) (AnomalyPattern, bool) {
	if ev.Type == SeverityNormal {
		return AnomalyPattern{}, false
	}

	reasonLower := strings.ToLower(ev.Reason)

	// Check for known crash patterns.
	for keyword, anomalyType := range crashReasonKeywords {
		if strings.Contains(reasonLower, keyword) || strings.Contains(strings.ToLower(ev.Message), keyword) {
			// Immediate anomaly for critical reasons.
			if anomalyType == AnomalyCrashLoop || anomalyType == AnomalyOOMKilled || anomalyType == AnomalyNodeNotReady {
				return AnomalyPattern{
					Type:        anomalyType,
					Description: fmt.Sprintf("%s: %s", anomalyType, ev.Message),
					Namespace:   ev.Namespace,
					Resource:    fmt.Sprintf("%s/%s", ev.InvolvedKind, ev.InvolvedName),
					EventCount:  int(ev.Count),
					FirstSeen:   ev.FirstSeen,
					LastSeen:    ev.LastSeen,
					Severity:    SeverityCritical,
				}, true
			}

			// Threshold-based: count recent occurrences.
			h.mu.RLock()
			threshold, hasThreshold := h.thresholds[ev.InvolvedKind]
			h.mu.RUnlock()
			if !hasThreshold {
				threshold = 3 // default
			}

			key := fmt.Sprintf("%s/%s/%s/%s", ev.InvolvedKind, ev.Namespace, ev.InvolvedName, ev.Reason)
			count := h.rc.Record(key)
			if count >= threshold {
				return AnomalyPattern{
					Type:        AnomalyRestartSurge,
					Description: fmt.Sprintf("Restart surge: %d occurrences in 5m for %s/%s", count, ev.InvolvedKind, ev.InvolvedName),
					Namespace:   ev.Namespace,
					Resource:    fmt.Sprintf("%s/%s", ev.InvolvedKind, ev.InvolvedName),
					EventCount:  count,
					FirstSeen:   ev.FirstSeen,
					LastSeen:    ev.LastSeen,
					Severity:    SeverityWarning,
				}, true
			}
		}
	}

	return AnomalyPattern{}, false
}
