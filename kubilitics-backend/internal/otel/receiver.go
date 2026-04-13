package otel

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/events"
)

// ---------------------------------------------------------------------------
// OTLP JSON structs (lightweight — no proto dependency)
// ---------------------------------------------------------------------------

// OTLPTraceRequest is the top-level OTLP/HTTP JSON trace export request.
type OTLPTraceRequest struct {
	ResourceSpans []ResourceSpans `json:"resourceSpans"`
}

// ResourceSpans groups spans by resource (service).
type ResourceSpans struct {
	Resource   Resource     `json:"resource"`
	ScopeSpans []ScopeSpans `json:"scopeSpans"`
}

// Resource holds resource-level attributes (service.name, k8s.* etc.).
type Resource struct {
	Attributes []Attribute `json:"attributes"`
}

// ScopeSpans groups spans by instrumentation scope.
type ScopeSpans struct {
	Spans []OTLPSpan `json:"spans"`
}

// OTLPSpan is a single span in the OTLP JSON format.
//
// Per the OTLP/HTTP JSON spec int64 fields like startTimeUnixNano should be
// serialized as strings to avoid JS number precision loss above 2^53. In
// practice many SDKs and the otel-collector contrib still emit them as JSON
// numbers. Use json.Number so the decoder accepts both.
type OTLPSpan struct {
	TraceID           string      `json:"traceId"`
	SpanID            string      `json:"spanId"`
	ParentSpanID      string      `json:"parentSpanId"`
	Name              string      `json:"name"`
	Kind              int         `json:"kind"`
	StartTimeUnixNano json.Number `json:"startTimeUnixNano"`
	EndTimeUnixNano   json.Number `json:"endTimeUnixNano"`
	Attributes        []Attribute `json:"attributes"`
	Status            SpanStatus  `json:"status"`
	Events            []SpanEvent `json:"events"`
}

// Attribute is an OTLP key-value attribute.
type Attribute struct {
	Key   string         `json:"key"`
	Value AttributeValue `json:"value"`
}

// AttributeValue holds one of the OTLP value types.
//
// Per the OTLP/HTTP JSON spec, int64 values should be encoded as strings to
// avoid JS number precision loss. However, in practice many OpenTelemetry
// SDKs and the otel-collector emit small int values as JSON numbers.
// Use json.Number so the decoder accepts both "200" and 200.
type AttributeValue struct {
	StringValue string      `json:"stringValue,omitempty"`
	IntValue    json.Number `json:"intValue,omitempty"`
	BoolValue   bool        `json:"boolValue,omitempty"`
	DoubleValue json.Number `json:"doubleValue,omitempty"`
	// ArrayValue and KvlistValue are accepted but ignored (we only persist scalars).
	ArrayValue  json.RawMessage `json:"arrayValue,omitempty"`
	KvlistValue json.RawMessage `json:"kvlistValue,omitempty"`
}

// SpanStatus holds the span status code and optional message.
type SpanStatus struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SpanEvent is a timestamped annotation on a span.
type SpanEvent struct {
	Name         string      `json:"name"`
	TimeUnixNano json.Number `json:"timeUnixNano"`
	Attributes   []Attribute `json:"attributes"`
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

// ErrRateLimited is returned when span ingestion massively exceeds the rate limit (10x).
var ErrRateLimited = fmt.Errorf("span rate limit exceeded")

// clusterSpanStats holds per-cluster span counters updated by ProcessTraces.
type clusterSpanStats struct {
	lastSeenAt   atomic.Int64 // unix milliseconds of the most recent span
	countLastMin atomic.Int64 // spans seen in the current 60-second window
	windowStart  atomic.Int64 // unix seconds when the current window started
}

// Receiver accepts OTLP trace data and persists it.
type Receiver struct {
	store            *Store
	defaultClusterID atomic.Value // string, fallback for single-cluster desktop setups
	// Rate limiting (protected by rateMu)
	rateMu         sync.Mutex
	spanCount      int64 // counter for current second
	lastReset      int64 // unix second of last reset
	maxSpansPerSec int64 // default 1000
	// Per-cluster span statistics (protected by spanStatsMu)
	spanStatsMu sync.RWMutex
	spanStats   map[string]*clusterSpanStats // keyed by clusterID
}

// NewReceiver creates a new OTLP trace receiver. The defaultClusterID is used
// as a fallback when spans arrive without a kubilitics.cluster.id attribute
// (common in single-cluster desktop setups).
func NewReceiver(store *Store, defaultClusterID string) *Receiver {
	r := &Receiver{
		store:          store,
		maxSpansPerSec: 1000,
		spanStats:      make(map[string]*clusterSpanStats),
	}
	r.defaultClusterID.Store(defaultClusterID)
	return r
}

// recordSpansForCluster updates the per-cluster span counters. Called from
// ProcessTraces with the total span count attributed to a given cluster ID.
func (r *Receiver) recordSpansForCluster(clusterID string, count int) {
	if clusterID == "" || count == 0 {
		return
	}
	nowSec := time.Now().Unix()
	nowMs := time.Now().UnixMilli()

	r.spanStatsMu.RLock()
	stats, ok := r.spanStats[clusterID]
	r.spanStatsMu.RUnlock()
	if !ok {
		r.spanStatsMu.Lock()
		// Re-check under write lock (double-checked init).
		stats, ok = r.spanStats[clusterID]
		if !ok {
			stats = &clusterSpanStats{}
			r.spanStats[clusterID] = stats
		}
		r.spanStatsMu.Unlock()
	}

	stats.lastSeenAt.Store(nowMs)
	// Reset the rolling 60-second window if we've crossed into a new minute.
	if last := stats.windowStart.Load(); nowSec-last >= 60 {
		stats.windowStart.Store(nowSec)
		stats.countLastMin.Store(int64(count))
	} else {
		stats.countLastMin.Add(int64(count))
	}
}

// LastSpanAt returns the unix-millisecond timestamp of the most recent span
// seen for the given cluster, and a bool indicating whether any span has
// ever been observed for that cluster.
func (r *Receiver) LastSpanAt(clusterID string) (int64, bool) {
	r.spanStatsMu.RLock()
	stats, ok := r.spanStats[clusterID]
	r.spanStatsMu.RUnlock()
	if !ok {
		return 0, false
	}
	last := stats.lastSeenAt.Load()
	return last, last > 0
}

// SpansPerMinute returns the count of spans seen for the cluster in the
// current rolling 60-second window. Returns 0 if no spans have been seen,
// or if the window has rolled over without new spans.
func (r *Receiver) SpansPerMinute(clusterID string) int {
	r.spanStatsMu.RLock()
	stats, ok := r.spanStats[clusterID]
	r.spanStatsMu.RUnlock()
	if !ok {
		return 0
	}
	// If the window is older than 60s, treat the count as stale → 0.
	if time.Now().Unix()-stats.windowStart.Load() >= 60 {
		return 0
	}
	return int(stats.countLastMin.Load())
}

// RecordSpansForClusterTest is a test-only helper that bumps the per-cluster
// span counter directly. NOT for production use — the production path is
// ProcessTraces calling recordSpansForCluster internally.
func (r *Receiver) RecordSpansForClusterTest(clusterID string, count int) {
	r.recordSpansForCluster(clusterID, count)
}

// checkRateLimit increments the span counter under a mutex and returns true if
// the current second's total is within the allowed limit.
func (r *Receiver) checkRateLimit(count int) bool {
	r.rateMu.Lock()
	defer r.rateMu.Unlock()
	now := time.Now().Unix()
	if now != r.lastReset {
		r.spanCount = 0
		r.lastReset = now
	}
	r.spanCount += int64(count)
	return r.spanCount <= r.maxSpansPerSec
}

// SetDefaultClusterID updates the fallback cluster ID. This is called when the
// active cluster changes so that spans without an explicit cluster attribute
// are attributed to the correct cluster.
func (r *Receiver) SetDefaultClusterID(id string) {
	r.defaultClusterID.Store(id)
}

// ProcessTraces parses an OTLP JSON request and stores the spans.
// The clusterIDHint is an optional fallback extracted from the
// X-Kubilitics-Cluster-Id HTTP header; it is used when spans lack a
// kubilitics.cluster.id resource attribute.
func (r *Receiver) ProcessTraces(ctx context.Context, req *OTLPTraceRequest, clusterIDHint string) error {
	var allSpans []Span

	// Track trace-level aggregates for summary upsert.
	type traceAgg struct {
		rootService   string
		rootOperation string
		startTime     int64
		endTime       int64
		spanCount     int
		errorCount    int
		services      map[string]bool
		clusterID     string
		hasRoot       bool
	}
	traceMap := make(map[string]*traceAgg)

	for _, rs := range req.ResourceSpans {
		// Extract resource-level attributes
		resAttrs := attributeMap(rs.Resource.Attributes)

		serviceName := resAttrs["service.name"]
		k8sPod := resAttrs["k8s.pod.name"]
		k8sNamespace := resAttrs["k8s.namespace.name"]
		k8sNode := resAttrs["k8s.node.name"]
		k8sContainer := resAttrs["k8s.container.name"]
		k8sDeployment := resAttrs["k8s.deployment.name"]

		for _, ss := range rs.ScopeSpans {
			for _, os := range ss.Spans {
				startNs := parseNano(os.StartTimeUnixNano)
				endNs := parseNano(os.EndTimeUnixNano)
				durationNs := endNs - startNs
				if durationNs < 0 {
					durationNs = 0
				}

				// Extract span-level attributes
				spanAttrs := attributeMap(os.Attributes)

				// Merge resource + span attributes for full attribute JSON
				allAttrs := make(map[string]string, len(resAttrs)+len(spanAttrs))
				for k, v := range resAttrs {
					allAttrs[k] = v
				}
				for k, v := range spanAttrs {
					allAttrs[k] = v
				}
				attrsJSON, _ := json.Marshal(allAttrs)

				// Serialize span events
				eventsJSON, _ := json.Marshal(os.Events)

				// Extract HTTP fields
				httpMethod := firstNonEmpty(spanAttrs["http.method"], spanAttrs["http.request.method"])
				httpURL := firstNonEmpty(spanAttrs["http.url"], spanAttrs["url.full"])
				httpRoute := spanAttrs["http.route"]
				var httpStatusCode *int
				if sc := firstNonEmpty(spanAttrs["http.status_code"], spanAttrs["http.response.status_code"]); sc != "" {
					if v, err := strconv.Atoi(sc); err == nil {
						httpStatusCode = &v
					}
				}

				// Extract DB fields
				dbSystem := spanAttrs["db.system"]
				dbStatement := spanAttrs["db.statement"]

				// Extract user
				userID := firstNonEmpty(spanAttrs["enduser.id"], spanAttrs["user.id"])

				// Determine cluster ID from resource attributes (convention: kubilitics.cluster.id)
				clusterID := firstNonEmpty(resAttrs["kubilitics.cluster.id"], resAttrs["k8s.cluster.uid"])

				// Fallback chain: header hint → default cluster → "unknown"
				if clusterID == "" && clusterIDHint != "" {
					clusterID = clusterIDHint
				}
				if clusterID == "" {
					if defID, ok := r.defaultClusterID.Load().(string); ok && defID != "" {
						clusterID = defID
					}
				}
				if clusterID == "" {
					log.Printf("[otel/receiver] span %s has no cluster ID, using 'unknown'", os.SpanID)
					clusterID = "unknown"
				}

				span := Span{
					SpanID:         os.SpanID,
					TraceID:        os.TraceID,
					ParentSpanID:   os.ParentSpanID,
					ServiceName:    serviceName,
					OperationName:  os.Name,
					SpanKind:       spanKindString(os.Kind),
					StartTime:      startNs,
					EndTime:        endNs,
					DurationNs:     durationNs,
					StatusCode:     statusCodeString(os.Status.Code),
					StatusMessage:  os.Status.Message,
					HTTPMethod:     httpMethod,
					HTTPURL:        httpURL,
					HTTPStatusCode: httpStatusCode,
					HTTPRoute:      httpRoute,
					DBSystem:       dbSystem,
					DBStatement:    dbStatement,
					K8sPodName:     k8sPod,
					K8sNamespace:   k8sNamespace,
					K8sNodeName:    k8sNode,
					K8sContainer:   k8sContainer,
					K8sDeployment:  k8sDeployment,
					UserID:         userID,
					ClusterID:      clusterID,
					Attributes:     events.JSONText(attrsJSON),
					Events:         events.JSONText(eventsJSON),
					LinkedEventIDs: events.JSONText("[]"),
				}
				allSpans = append(allSpans, span)

				// Aggregate trace summary
				agg, ok := traceMap[os.TraceID]
				if !ok {
					agg = &traceAgg{
						startTime: startNs,
						endTime:   endNs,
						services:  make(map[string]bool),
						clusterID: clusterID,
					}
					traceMap[os.TraceID] = agg
				}
				agg.spanCount++
				if span.StatusCode == "ERROR" {
					agg.errorCount++
				}
				if serviceName != "" {
					agg.services[serviceName] = true
				}
				if startNs < agg.startTime {
					agg.startTime = startNs
				}
				if endNs > agg.endTime {
					agg.endTime = endNs
				}
				// Root span: no parent
				if os.ParentSpanID == "" {
					agg.rootService = serviceName
					agg.rootOperation = os.Name
					agg.hasRoot = true
				}
				if clusterID != "" {
					agg.clusterID = clusterID
				}
			}
		}
	}

	// Update per-cluster span statistics (batched by cluster — not per span).
	clusterCounts := make(map[string]int)
	for _, s := range allSpans {
		clusterCounts[s.ClusterID]++
	}
	for cid, n := range clusterCounts {
		r.recordSpansForCluster(cid, n)
	}

	// Rate limiting: check if we're over the per-second span budget.
	if !r.checkRateLimit(len(allSpans)) {
		r.rateMu.Lock()
		currentCount := r.spanCount
		r.rateMu.Unlock()
		limit := r.maxSpansPerSec

		// Massively over limit (10x) — reject entirely with HTTP 429.
		if currentCount > limit*10 {
			log.Printf("[otel/receiver] RATE LIMIT: %d spans/sec exceeds 10x limit (%d) — rejecting batch", currentCount, limit)
			return ErrRateLimited
		}

		// Over limit but not catastrophic — keep ERROR spans, drop OK/UNSET.
		log.Printf("[otel/receiver] RATE LIMIT: %d spans/sec exceeds limit (%d) — sampling non-error spans", currentCount, limit)
		filtered := make([]Span, 0, len(allSpans))
		for i := range allSpans {
			if allSpans[i].StatusCode == "ERROR" {
				filtered = append(filtered, allSpans[i])
			}
		}
		allSpans = filtered

		// Also filter trace aggregates: only keep traces that still have spans.
		keptTraces := make(map[string]bool, len(filtered))
		for i := range filtered {
			keptTraces[filtered[i].TraceID] = true
		}
		for traceID := range traceMap {
			if !keptTraces[traceID] {
				delete(traceMap, traceID)
			}
		}
	}

	// Persist spans
	if err := r.store.InsertSpans(ctx, allSpans); err != nil {
		return fmt.Errorf("insert spans: %w", err)
	}

	// Upsert trace summaries
	now := time.Now().UnixNano()
	for traceID, agg := range traceMap {
		serviceList := make([]string, 0, len(agg.services))
		for svc := range agg.services {
			serviceList = append(serviceList, svc)
		}
		servicesJSON, _ := json.Marshal(serviceList)

		status := "OK"
		if agg.errorCount > 0 {
			status = "ERROR"
		}

		summary := &TraceSummary{
			TraceID:       traceID,
			RootService:   agg.rootService,
			RootOperation: agg.rootOperation,
			StartTime:     agg.startTime,
			DurationNs:    agg.endTime - agg.startTime,
			SpanCount:     agg.spanCount,
			ErrorCount:    agg.errorCount,
			ServiceCount:  len(agg.services),
			Status:        status,
			ClusterID:     agg.clusterID,
			Services:      events.JSONText(servicesJSON),
			UpdatedAt:     now,
		}
		if err := r.store.InsertTraceSummary(ctx, summary); err != nil {
			return fmt.Errorf("upsert trace summary %s: %w", traceID, err)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// attributeMap converts a slice of OTLP Attributes to a string map.
func attributeMap(attrs []Attribute) map[string]string {
	m := make(map[string]string, len(attrs))
	for _, a := range attrs {
		if a.Value.StringValue != "" {
			m[a.Key] = a.Value.StringValue
		} else if a.Value.IntValue != "" {
			m[a.Key] = string(a.Value.IntValue)
		} else if a.Value.DoubleValue != "" {
			m[a.Key] = string(a.Value.DoubleValue)
		} else if a.Key != "" {
			// Bool attribute — store as string (handles both true and false)
			m[a.Key] = fmt.Sprintf("%t", a.Value.BoolValue)
		}
	}
	return m
}

// parseNano parses a nanosecond timestamp (json.Number — string or number) to int64.
func parseNano(n json.Number) int64 {
	v, _ := strconv.ParseInt(string(n), 10, 64)
	return v
}

// spanKindString maps OTLP SpanKind int to human string.
func spanKindString(kind int) string {
	switch kind {
	case 1:
		return "internal"
	case 2:
		return "server"
	case 3:
		return "client"
	case 4:
		return "producer"
	case 5:
		return "consumer"
	default:
		return ""
	}
}

// statusCodeString maps OTLP StatusCode int to human string.
func statusCodeString(code int) string {
	switch code {
	case 0:
		return "UNSET"
	case 1:
		return "OK"
	case 2:
		return "ERROR"
	default:
		return "UNSET"
	}
}

// firstNonEmpty returns the first non-empty string from the arguments.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
