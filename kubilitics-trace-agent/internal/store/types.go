// Package store provides SQLite-backed persistence for OpenTelemetry spans and
// trace summaries collected by the kubilitics-trace-agent.
package store

// Span represents a single span stored in the spans table.
// Field tags use both `db` (sqlx) and `json` so the same struct is used for
// storage and REST serialisation.
type Span struct {
	SpanID         string `json:"span_id" db:"span_id"`
	TraceID        string `json:"trace_id" db:"trace_id"`
	ParentSpanID   string `json:"parent_span_id" db:"parent_span_id"`
	ServiceName    string `json:"service_name" db:"service_name"`
	OperationName  string `json:"operation_name" db:"operation_name"`
	SpanKind       string `json:"span_kind" db:"span_kind"`
	StartTime      int64  `json:"start_time" db:"start_time"`
	EndTime        int64  `json:"end_time" db:"end_time"`
	DurationNs     int64  `json:"duration_ns" db:"duration_ns"`
	StatusCode     string `json:"status_code" db:"status_code"`
	StatusMessage  string `json:"status_message" db:"status_message"`
	HTTPMethod     string `json:"http_method" db:"http_method"`
	HTTPURL        string `json:"http_url" db:"http_url"`
	HTTPStatusCode *int   `json:"http_status_code" db:"http_status_code"`
	HTTPRoute      string `json:"http_route" db:"http_route"`
	DBSystem       string `json:"db_system" db:"db_system"`
	DBStatement    string `json:"db_statement" db:"db_statement"`
	K8sPodName     string `json:"k8s_pod_name" db:"k8s_pod_name"`
	K8sNamespace   string `json:"k8s_namespace" db:"k8s_namespace"`
	K8sNodeName    string `json:"k8s_node_name" db:"k8s_node_name"`
	K8sContainer   string `json:"k8s_container" db:"k8s_container"`
	K8sDeployment  string `json:"k8s_deployment" db:"k8s_deployment"`
	// Attributes and Events are stored as JSON text (e.g. '{"key":"val"}' / '[...]').
	Attributes string `json:"attributes" db:"attributes"`
	Events     string `json:"events" db:"events"`
}

// TraceSummary is a denormalised trace record used for fast trace listing.
// It is kept in sync with the backend's otel.TraceSummary minus cluster-scoped
// fields that are irrelevant inside the in-cluster agent.
type TraceSummary struct {
	TraceID       string `json:"trace_id" db:"trace_id"`
	RootService   string `json:"root_service" db:"root_service"`
	RootOperation string `json:"root_operation" db:"root_operation"`
	StartTime     int64  `json:"start_time" db:"start_time"`
	DurationNs    int64  `json:"duration_ns" db:"duration_ns"`
	SpanCount     int    `json:"span_count" db:"span_count"`
	ErrorCount    int    `json:"error_count" db:"error_count"`
	ServiceCount  int    `json:"service_count" db:"service_count"`
	Status        string `json:"status" db:"status"`
	// Services is a JSON array of service name strings, e.g. '["svc-a","svc-b"]'.
	Services  string `json:"services" db:"services"`
	UpdatedAt int64  `json:"updated_at" db:"updated_at"`
}

// TraceDetail bundles a trace's spans for the waterfall/detail view.
type TraceDetail struct {
	TraceID string `json:"trace_id"`
	Spans   []Span `json:"spans"`
}

// ServiceMapNode holds aggregated metrics for a single service.
type ServiceMapNode struct {
	Name          string `json:"name"`
	SpanCount     int    `json:"span_count"`
	ErrorCount    int    `json:"error_count"`
	AvgDurationNs int64  `json:"avg_duration_ns"`
}

// ServiceMapEdge represents a call edge between two services.
type ServiceMapEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Count  int    `json:"count"`
}

// ServiceMap holds the service dependency graph derived from span parent/child
// relationships.
type ServiceMap struct {
	Nodes []ServiceMapNode `json:"nodes"`
	Edges []ServiceMapEdge `json:"edges"`
}

// TraceQuery defines optional filters for the QueryTraces method.
type TraceQuery struct {
	Service string
	Status  string
	From    int64
	To      int64
	Limit   int
}

// HealthInfo is returned by the /health endpoint.
type HealthInfo struct {
	Status     string `json:"status"`
	SpanCount  int64  `json:"span_count"`
	OldestSpan int64  `json:"oldest_span"`
}
