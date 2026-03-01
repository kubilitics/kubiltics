package models

import "time"

// Event represents a Kubernetes event
type Event struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`               // metadata.name (for detail link)
	EventNamespace   string    `json:"event_namespace"`    // metadata.namespace (where event lives)
	Type             string    `json:"type"`               // Normal, Warning, Error
	Reason           string    `json:"reason"`
	Message          string    `json:"message"`
	ResourceKind     string    `json:"resource_kind"`
	ResourceName     string    `json:"resource_name"`
	Namespace        string    `json:"namespace"`          // involvedObject.namespace
	FirstTimestamp   time.Time `json:"first_timestamp"`
	LastTimestamp    time.Time `json:"last_timestamp"`
	Count            int32     `json:"count"`
	SourceComponent  string   `json:"source_component,omitempty"`
}

// WebSocketMessage represents a message sent via WebSocket
type WebSocketMessage struct {
	Type      string                 `json:"type"`      // resource_update, event, error
	Event     string                 `json:"event"`     // added, updated, deleted
	ClusterID string                 `json:"cluster_id,omitempty"` // Cluster scope for filtering
	Resource  map[string]interface{} `json:"resource"`
	Timestamp time.Time              `json:"timestamp"`
}
