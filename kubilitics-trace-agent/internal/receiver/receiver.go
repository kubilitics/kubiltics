// Package receiver accepts OTLP/HTTP JSON trace payloads and persists them via
// the store. It is a simplified port of the kubilitics-backend OTLP receiver:
// no rate limiting (single-cluster agent) and no cluster-ID fallback chain.
package receiver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	"google.golang.org/protobuf/proto"

	"github.com/kubilitics/kubilitics-trace-agent/internal/store"
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
type OTLPSpan struct {
	TraceID           string      `json:"traceId"`
	SpanID            string      `json:"spanId"`
	ParentSpanID      string      `json:"parentSpanId"`
	Name              string      `json:"name"`
	Kind              int         `json:"kind"`
	StartTimeUnixNano string      `json:"startTimeUnixNano"`
	EndTimeUnixNano   string      `json:"endTimeUnixNano"`
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
type AttributeValue struct {
	StringValue string `json:"stringValue,omitempty"`
	IntValue    string `json:"intValue,omitempty"`
	BoolValue   bool   `json:"boolValue,omitempty"`
}

// SpanStatus holds the span status code and optional message.
type SpanStatus struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SpanEvent is a timestamped annotation on a span.
type SpanEvent struct {
	Name         string      `json:"name"`
	TimeUnixNano string      `json:"timeUnixNano"`
	Attributes   []Attribute `json:"attributes"`
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

// Receiver accepts OTLP trace data and persists it via the store.
type Receiver struct {
	store *store.Store
}

// NewReceiver creates a new Receiver backed by the given store.
func NewReceiver(s *store.Store) *Receiver {
	return &Receiver{store: s}
}

// HandleTraces is an http.HandlerFunc that accepts POST /v1/traces.
// It supports both OTLP/HTTP protobuf (application/x-protobuf) and
// OTLP/HTTP JSON (application/json) payloads.
func (r *Receiver) HandleTraces(w http.ResponseWriter, req *http.Request) {
	// Limit request body to 10 MB to prevent OOM from oversized payloads.
	req.Body = http.MaxBytesReader(w, req.Body, 10*1024*1024)

	ct := req.Header.Get("Content-Type")

	if strings.Contains(ct, "application/x-protobuf") || strings.Contains(ct, "application/protobuf") {
		r.handleProtobuf(w, req)
		return
	}

	// Default: try JSON, and if it fails try protobuf as fallback
	// (some SDKs don't set Content-Type correctly).
	body, err := io.ReadAll(req.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"failed to read request body"}`))
		return
	}

	var otlpReq OTLPTraceRequest
	if err := json.Unmarshal(body, &otlpReq); err != nil {
		// JSON parse failed — try protobuf
		if pbErr := r.processProtobufBody(req.Context(), body); pbErr != nil {
			log.Printf("[receiver] both JSON and protobuf decode failed: json=%v proto=%v", err, pbErr)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid payload — expected OTLP JSON or protobuf"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{}"))
		return
	}

	if err := r.ProcessTraces(req.Context(), &otlpReq); err != nil {
		log.Printf("[receiver] ProcessTraces error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"failed to process traces"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("{}"))
}

// handleProtobuf handles explicit protobuf content type.
func (r *Receiver) handleProtobuf(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"failed to read request body"}`))
		return
	}

	if err := r.processProtobufBody(req.Context(), body); err != nil {
		log.Printf("[receiver] protobuf ProcessTraces error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"failed to process traces"}`))
		return
	}

	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte{})
}

// processProtobufBody decodes an OTLP protobuf trace request and processes it.
func (r *Receiver) processProtobufBody(ctx context.Context, body []byte) error {
	var pbReq coltracepb.ExportTraceServiceRequest
	if err := proto.Unmarshal(body, &pbReq); err != nil {
		return fmt.Errorf("unmarshal protobuf: %w", err)
	}

	// Convert protobuf to our internal OTLPTraceRequest struct
	otlpReq := convertProtoToJSON(&pbReq)
	return r.ProcessTraces(ctx, otlpReq)
}

// convertProtoToJSON translates a protobuf ExportTraceServiceRequest to
// the receiver's internal OTLPTraceRequest format for unified processing.
func convertProtoToJSON(pb *coltracepb.ExportTraceServiceRequest) *OTLPTraceRequest {
	req := &OTLPTraceRequest{}
	for _, rs := range pb.ResourceSpans {
		rspans := ResourceSpans{}
		if rs.Resource != nil {
			rspans.Resource.Attributes = convertPBAttributes(rs.Resource.Attributes)
		}
		for _, ss := range rs.ScopeSpans {
			scopeSpans := ScopeSpans{}
			for _, s := range ss.Spans {
				span := OTLPSpan{
					TraceID:           fmt.Sprintf("%x", s.TraceId),
					SpanID:            fmt.Sprintf("%x", s.SpanId),
					ParentSpanID:      fmt.Sprintf("%x", s.ParentSpanId),
					Name:              s.Name,
					Kind:              int(s.Kind),
					StartTimeUnixNano: fmt.Sprintf("%d", s.StartTimeUnixNano),
					EndTimeUnixNano:   fmt.Sprintf("%d", s.EndTimeUnixNano),
					Attributes:        convertPBAttributes(s.Attributes),
					Status: SpanStatus{
						Message: s.Status.GetMessage(),
						Code:    int(s.Status.GetCode()),
					},
				}
				for _, e := range s.Events {
					span.Events = append(span.Events, SpanEvent{
						Name:         e.Name,
						TimeUnixNano: fmt.Sprintf("%d", e.TimeUnixNano),
						Attributes:   convertPBAttributes(e.Attributes),
					})
				}
				scopeSpans.Spans = append(scopeSpans.Spans, span)
			}
			rspans.ScopeSpans = append(rspans.ScopeSpans, scopeSpans)
		}
		req.ResourceSpans = append(req.ResourceSpans, rspans)
	}
	return req
}

// convertPBAttributes converts protobuf KeyValue attributes to the receiver's Attribute slice.
func convertPBAttributes(attrs []*commonpb.KeyValue) []Attribute {
	result := make([]Attribute, 0, len(attrs))
	for _, kv := range attrs {
		a := Attribute{Key: kv.Key}
		if kv.Value != nil {
			switch v := kv.Value.Value.(type) {
			case *commonpb.AnyValue_StringValue:
				a.Value.StringValue = v.StringValue
			case *commonpb.AnyValue_IntValue:
				a.Value.IntValue = fmt.Sprintf("%d", v.IntValue)
			case *commonpb.AnyValue_BoolValue:
				a.Value.BoolValue = v.BoolValue
			case *commonpb.AnyValue_DoubleValue:
				a.Value.StringValue = fmt.Sprintf("%g", v.DoubleValue)
			}
		}
		result = append(result, a)
	}
	return result
}

// ProcessTraces parses an OTLP JSON request and stores the spans.
func (r *Receiver) ProcessTraces(ctx context.Context, req *OTLPTraceRequest) error {
	var allSpans []store.Span

	// Track trace-level aggregates for summary upsert.
	type traceAgg struct {
		rootService   string
		rootOperation string
		startTime     int64
		endTime       int64
		spanCount     int
		errorCount    int
		services      map[string]bool
		hasRoot       bool
	}
	traceMap := make(map[string]*traceAgg)

	for _, rs := range req.ResourceSpans {
		// Extract resource-level attributes.
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

				// Extract span-level attributes.
				spanAttrs := attributeMap(os.Attributes)

				// Merge resource + span attributes for full attribute JSON.
				allAttrs := make(map[string]string, len(resAttrs)+len(spanAttrs))
				for k, v := range resAttrs {
					allAttrs[k] = v
				}
				for k, v := range spanAttrs {
					allAttrs[k] = v
				}
				attrsJSON, _ := json.Marshal(allAttrs)

				// Serialize span events.
				eventsJSON, _ := json.Marshal(os.Events)

				// Extract HTTP fields.
				httpMethod := firstNonEmpty(spanAttrs["http.method"], spanAttrs["http.request.method"])
				httpURL := firstNonEmpty(spanAttrs["http.url"], spanAttrs["url.full"])
				httpRoute := spanAttrs["http.route"]
				var httpStatusCode *int
				if sc := firstNonEmpty(spanAttrs["http.status_code"], spanAttrs["http.response.status_code"]); sc != "" {
					if v, err := strconv.Atoi(sc); err == nil {
						httpStatusCode = &v
					}
				}

				// Extract DB fields.
				dbSystem := spanAttrs["db.system"]
				dbStatement := spanAttrs["db.statement"]

				span := store.Span{
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
					Attributes:     string(attrsJSON),
					Events:         string(eventsJSON),
				}
				allSpans = append(allSpans, span)

				// Aggregate trace summary.
				agg, ok := traceMap[os.TraceID]
				if !ok {
					agg = &traceAgg{
						startTime: startNs,
						endTime:   endNs,
						services:  make(map[string]bool),
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
				// Root span: no parent.
				if os.ParentSpanID == "" {
					agg.rootService = serviceName
					agg.rootOperation = os.Name
					agg.hasRoot = true
				}
			}
		}
	}

	// Persist spans.
	if err := r.store.InsertSpans(ctx, allSpans); err != nil {
		return fmt.Errorf("insert spans: %w", err)
	}

	// Upsert trace summaries.
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

		summary := &store.TraceSummary{
			TraceID:       traceID,
			RootService:   agg.rootService,
			RootOperation: agg.rootOperation,
			StartTime:     agg.startTime,
			DurationNs:    agg.endTime - agg.startTime,
			SpanCount:     agg.spanCount,
			ErrorCount:    agg.errorCount,
			ServiceCount:  len(agg.services),
			Status:        status,
			Services:      string(servicesJSON),
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
			m[a.Key] = a.Value.IntValue
		} else if a.Key != "" {
			// Bool attribute — store as string (handles both true and false).
			m[a.Key] = fmt.Sprintf("%t", a.Value.BoolValue)
		}
	}
	return m
}

// parseNano parses a nanosecond timestamp string to int64.
func parseNano(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
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
