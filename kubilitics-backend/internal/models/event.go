package models

import (
	"encoding/json"
	"time"
)

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
	Historical       bool     `json:"historical,omitempty"` // true when loaded from Kubilitics DB (K8s events expired)
}

// MarshalJSON emits each Event with BOTH snake_case (legacy clients, DB tooling)
// AND the Kubernetes-native shape (camelCase timestamps + involvedObject{kind,name,namespace}).
// Added 2026-04-22 to close an integration gap: the kubilitics-ai brain (and anything
// expecting kubectl-style shapes) reads lastTimestamp + involvedObject; the old serializer
// only emitted last_timestamp + flat resource_* fields, so brain tools like
// observe_recent_changes and observe_services_by_filter saw zero rows.
func (e Event) MarshalJSON() ([]byte, error) {
	type alias Event // avoid infinite recursion
	return json.Marshal(struct {
		alias
		FirstTimestampCamel time.Time               `json:"firstTimestamp"`
		LastTimestampCamel  time.Time               `json:"lastTimestamp"`
		InvolvedObject      map[string]string       `json:"involvedObject"`
	}{
		alias:               alias(e),
		FirstTimestampCamel: e.FirstTimestamp,
		LastTimestampCamel:  e.LastTimestamp,
		InvolvedObject: map[string]string{
			"kind":      e.ResourceKind,
			"name":      e.ResourceName,
			"namespace": e.Namespace,
		},
	})
}

// WebSocketMessage represents a message sent via WebSocket
type WebSocketMessage struct {
	Type      string                 `json:"type"`      // resource_update, event, error
	Event     string                 `json:"event"`     // added, updated, deleted
	ClusterID string                 `json:"cluster_id,omitempty"` // Cluster scope for filtering
	Resource  map[string]interface{} `json:"resource"`
	Timestamp time.Time              `json:"timestamp"`
}
