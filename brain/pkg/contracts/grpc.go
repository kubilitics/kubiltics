package contracts

// Package contracts defines gRPC contract types shared between kubilitics-ai and kubilitics-backend.
//
// These types define the inter-service communication interface.
// In reality, these would be in .proto files and generated, but this file documents the contract.

// ResourceUpdateEvent represents a cluster resource change from backend.
type ResourceUpdateEvent struct {
	EventType string      `json:"event_type"` // "CREATE", "UPDATE", "DELETE", "FULL_SYNC"
	Resource  interface{} `json:"resource"`   // Kubernetes resource
	Timestamp int64       `json:"timestamp"`
}

// ResourceQueryRequest queries resources from backend.
type ResourceQueryRequest struct {
	Namespace     string `json:"namespace"`
	Kind          string `json:"kind"`
	Name          string `json:"name"`
	LabelSelector string `json:"label_selector"`
	Limit         int    `json:"limit"`
}

// ResourceQueryResponse returns query results from backend.
type ResourceQueryResponse struct {
	Resources []interface{} `json:"resources"`
	Total     int           `json:"total"`
	Error     string        `json:"error"`
}

// MetricQueryRequest queries metrics from backend.
type MetricQueryRequest struct {
	ResourceID string `json:"resource_id"`
	MetricName string `json:"metric_name"`
	StartTime  int64  `json:"start_time"`
	EndTime    int64  `json:"end_time"`
	Step       string `json:"step"`
}

// MetricQueryResponse returns metric results from backend.
type MetricQueryResponse struct {
	DataPoints []interface{} `json:"data_points"`
	Error      string        `json:"error"`
}

// LogQueryRequest queries container logs from backend.
type LogQueryRequest struct {
	Namespace     string `json:"namespace"`
	PodName       string `json:"pod_name"`
	ContainerName string `json:"container_name"`
	TailLines     int    `json:"tail_lines"`
	SinceSeconds  int    `json:"since_seconds"`
}

// LogQueryResponse returns logs from backend.
type LogQueryResponse struct {
	Logs  string `json:"logs"`
	Error string `json:"error"`
}

// EventQueryRequest queries events from backend.
type EventQueryRequest struct {
	Namespace      string `json:"namespace"`
	InvolvedObject string `json:"involved_object"`
	Reason         string `json:"reason"`
	SinceSeconds   int    `json:"since_seconds"`
}

// EventQueryResponse returns events from backend.
type EventQueryResponse struct {
	Events []interface{} `json:"events"`
	Error  string        `json:"error"`
}

// MutationRequest represents a mutation operation from AI to backend.
type MutationRequest struct {
	Operation string      `json:"operation"` // "patch", "scale", "delete", "apply", etc.
	Resource  interface{} `json:"resource"`
	Changes   interface{} `json:"changes"`
}

// MutationResponse returns mutation result from backend.
type MutationResponse struct {
	Success bool        `json:"success"`
	Result  interface{} `json:"result"`
	Error   string      `json:"error"`
}

// FullSyncRequest initiates full cluster sync from AI.
type FullSyncRequest struct {
	Timestamp int64 `json:"timestamp"`
}

// FullSyncResponse returns full cluster state to AI.
type FullSyncResponse struct {
	Resources []interface{} `json:"resources"`
	Events    []interface{} `json:"events"`
	Metrics   interface{}   `json:"metrics"`
	Timestamp int64         `json:"timestamp"`
	Complete  bool          `json:"complete"`
}

// HealthCheckRequest checks backend health.
type HealthCheckRequest struct {
	Service string `json:"service"` // Optional specific service to check
}

// HealthCheckResponse returns health status.
type HealthCheckResponse struct {
	Status    string                 `json:"status"` // "healthy", "degraded", "unhealthy"
	Timestamp int64                  `json:"timestamp"`
	Details   map[string]interface{} `json:"details"`
}

// StreamRequest initiates streaming from backend.
type StreamRequest struct {
	RequestID  string `json:"request_id"`
	StreamType string `json:"stream_type"` // "resources", "events", "metrics"
	Namespace  string `json:"namespace"`
}

// StreamMessage represents a message in the streaming response.
type StreamMessage struct {
	MessageType string      `json:"message_type"`
	Data        interface{} `json:"data"`
	Timestamp   int64       `json:"timestamp"`
	Error       string      `json:"error"`
}
