package resilient

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestEnvelope_HealthyRoundTrip(t *testing.T) {
	now := time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC)
	env := ResilientResponse[map[string]int]{
		Data:         map[string]int{"pods": 42},
		Reachable:    true,
		HealthStatus: "healthy",
		StaleAsOf:    &now,
	}
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ResilientResponse[map[string]int]
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !decoded.Reachable || decoded.Data["pods"] != 42 {
		t.Fatalf("round-trip lost data: %+v", decoded)
	}
}

func TestEnvelope_UnreachableOmitsData(t *testing.T) {
	env := ResilientResponse[map[string]int]{
		Reachable:    false,
		ErrorMessage: "connection refused",
		HealthStatus: "unreachable",
	}
	b, _ := json.Marshal(env)
	if bytes.Contains(b, []byte(`"data":`)) {
		t.Fatalf("expected omitempty on Data when zero; got: %s", b)
	}
}
