package server

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestBuildComposableResult_SerializesEnvelope(t *testing.T) {
	raw := buildComposableResult("TriageCluster", "prod-use1", "degraded: 3 on fire",
		map[string]interface{}{"top_problems": []int{1, 2, 3}},
		[]compositeSource{{Tool: "observe_cluster_overview", MS: 42}, {Tool: "observe_events", MS: 73}},
		nil,
	)
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// Round-trip into generic to assert fields.
	var round map[string]interface{}
	if err := json.Unmarshal(b, &round); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if round["kind"] != "TriageCluster" {
		t.Errorf("kind: got %v", round["kind"])
	}
	if round["cluster_id"] != "prod-use1" {
		t.Errorf("cluster_id: got %v", round["cluster_id"])
	}
	if round["summary"] == "" {
		t.Errorf("summary missing")
	}
	if _, ok := round["data"]; !ok {
		t.Errorf("data missing")
	}
	if _, ok := round["sources"]; !ok {
		t.Errorf("sources missing")
	}
	if _, ok := round["partial"]; ok {
		t.Errorf("partial should be absent when no errors supplied")
	}
}

func TestBuildComposableResult_PartialWhenErrsPresent(t *testing.T) {
	raw := buildComposableResult("TriageCluster", "c1", "ok",
		map[string]interface{}{},
		nil,
		map[string]error{"observe_events": errors.New("timeout")},
	)
	b, _ := json.Marshal(raw)
	var round map[string]interface{}
	_ = json.Unmarshal(b, &round)
	p, ok := round["partial"].([]interface{})
	if !ok || len(p) != 1 || p[0] != "observe_events" {
		t.Fatalf("expected partial: [observe_events], got %v", round["partial"])
	}
}
