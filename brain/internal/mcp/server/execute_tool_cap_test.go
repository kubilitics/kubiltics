package server

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// ExecuteTool must never return a JSON blob larger than MaxToolOutputBytes
// to the LLM. This is the single guardrail against every future tool that
// forgets to pre-summarize. Smoke-tests the wrap via capToolOutput directly
// (full dispatcher mocking is covered by the larger server_test.go suite).
func TestExecuteTool_CapsOversizedHandlerOutput(t *testing.T) {
	big := make([]interface{}, 300)
	for i := range big {
		big[i] = map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":        "pod-xyz",
				"annotations": map[string]interface{}{"junk": strings.Repeat("Z", 500)},
			},
		}
	}
	raw := map[string]interface{}{"items": big, "item_count": 300}

	capped := capToolOutput(raw)
	b, _ := json.Marshal(capped)
	max := int(MaxToolOutputBytes)
	budget := max + max/10
	if len(b) > budget {
		t.Fatalf("capToolOutput did not cap payload: %d bytes (limit %d)", len(b), budget)
	}
	m := capped.(map[string]interface{})
	if m["item_count"] != 300 {
		t.Fatalf("item_count must survive truncation so the LLM can still say 'N of M': %v", m["item_count"])
	}
	if m["_truncated"] != true {
		t.Fatalf("caller must know the payload was truncated so it can warn the user")
	}
}

func TestInjectToolMetadata_AddsDataSourceAndLatency(t *testing.T) {
	cases := []struct {
		tool   string
		source string
	}{
		{"list_resources", "k8s-live"},
		{"inspect_pod", "k8s-live"},
		{"get_logs", "logs-live"},
		{"get_events", "events-live"},
		{"observe_top_pods_by_metric", "metrics-live"},
		{"analyze_pod_health", "derived"},
		{"diagnose_pod_not_ready", "derived"},
		{"narrate_cluster_incident", "derived"},
		{"plan_scale_deployment", "derived"},
		{"observe_problem_pods", "derived"},
	}
	for _, tc := range cases {
		t.Run(tc.tool, func(t *testing.T) {
			raw := map[string]interface{}{"some_field": "value"}
			result := injectToolMetadata(raw, tc.tool, 42*time.Millisecond)
			m := result.(map[string]interface{})
			if m["data_source"] != tc.source {
				t.Fatalf("tool %s: want data_source=%q, got %q", tc.tool, tc.source, m["data_source"])
			}
			if m["latency_ms"] != int64(42) {
				t.Fatalf("tool %s: want latency_ms=42, got %v", tc.tool, m["latency_ms"])
			}
		})
	}
}

func TestInjectToolMetadata_DoesNotOverwriteExistingDataSource(t *testing.T) {
	raw := map[string]interface{}{"data_source": "custom-override"}
	result := injectToolMetadata(raw, "list_resources", time.Millisecond)
	m := result.(map[string]interface{})
	if m["data_source"] != "custom-override" {
		t.Fatalf("existing data_source must not be overwritten, got %v", m["data_source"])
	}
}

func TestInjectToolMetadata_WrapsNonMapResult(t *testing.T) {
	result := injectToolMetadata("raw string result", "get_logs", 5*time.Millisecond)
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatal("non-map result must be wrapped in a map")
	}
	if m["data_source"] != "logs-live" {
		t.Fatalf("wrapped result must have data_source, got %v", m["data_source"])
	}
	if m["result"] != "raw string result" {
		t.Fatalf("original result must be preserved under 'result' key, got %v", m["result"])
	}
}
