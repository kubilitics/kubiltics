package models

import (
	"encoding/json"
	"testing"
	"time"
)

// TestEvent_MarshalJSON_BrainContract locks the Event serializer shape that
// kubilitics-ai's observe_recent_changes + observe_services_by_filter consume.
// If any of these fields is renamed/dropped, the brain silently returns 0 rows
// and the 100-prompt bench regresses. See integration-gap audit B2.
func TestEvent_MarshalJSON_BrainContract(t *testing.T) {
	now := time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)
	e := Event{
		Name:           "web-crashloop",
		EventNamespace: "demo",
		Type:           "Warning",
		Reason:         "BackOff",
		Message:        "Back-off restarting failed container",
		ResourceKind:   "Pod",
		ResourceName:   "web-0",
		Namespace:      "demo",
		FirstTimestamp: now.Add(-5 * time.Minute),
		LastTimestamp:  now,
		Count:          3,
	}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Snake_case (legacy) must still be present.
	for _, k := range []string{"last_timestamp", "first_timestamp", "resource_kind", "resource_name", "reason", "message"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing legacy field %q in serialized event: %s", k, string(b))
		}
	}

	// CamelCase + involvedObject (brain) must be present.
	if _, ok := m["lastTimestamp"]; !ok {
		t.Errorf("missing brain field lastTimestamp: %s", string(b))
	}
	if _, ok := m["firstTimestamp"]; !ok {
		t.Errorf("missing brain field firstTimestamp: %s", string(b))
	}
	inv, ok := m["involvedObject"].(map[string]interface{})
	if !ok {
		t.Fatalf("involvedObject must serialize as object, got %T: %s", m["involvedObject"], string(b))
	}
	if inv["kind"] != "Pod" || inv["name"] != "web-0" || inv["namespace"] != "demo" {
		t.Errorf("involvedObject fields drifted: %+v", inv)
	}
}
