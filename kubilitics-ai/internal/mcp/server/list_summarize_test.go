package server

import (
	"encoding/json"
	"strings"
	"testing"
)

// The regression: "list all the pods" on a cluster with 49+ real pods
// returned the raw K8s list from the backend — full managedFields,
// annotations, spec, status.conditions per item. That blew past
// gpt-4o-mini's output-token budget; the model called the tool and
// emitted zero text, leaving users with a bare tool block and no
// summary. summarizeListForLLM reduces the payload to the fields an
// LLM reasoner actually uses (kind, name, namespace, labels, creation
// time, compact status). These tests lock the contract so nobody
// accidentally pipes the raw backend payload straight to the LLM again.

func TestSummarizeListForLLM_StripsManagedFieldsAndAnnotations(t *testing.T) {
	raw := map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "PodList",
		"items": []interface{}{
			map[string]interface{}{
				"kind": "Pod",
				"metadata": map[string]interface{}{
					"name":              "app-1",
					"namespace":         "default",
					"creationTimestamp": "2026-04-12T17:41:40Z",
					"labels":            map[string]interface{}{"app": "frontend"},
					// These two fields are the bulk of a real pod list payload.
					// They must not leak into the LLM context.
					"annotations": map[string]interface{}{
						"kubectl.kubernetes.io/last-applied-configuration": strings.Repeat("x", 10000),
					},
					"managedFields": []interface{}{
						map[string]interface{}{"manager": "kubectl", "fieldsV1": strings.Repeat("y", 8000)},
					},
				},
				"status": map[string]interface{}{
					"phase": "Running",
					"conditions": []interface{}{
						map[string]interface{}{"type": "Ready", "status": "True"},
					},
					"containerStatuses": []interface{}{
						map[string]interface{}{"name": "main", "ready": true, "restartCount": 3.0},
						map[string]interface{}{"name": "sidecar", "ready": false, "restartCount": 1.0},
					},
				},
				"spec": map[string]interface{}{
					"nodeName": "worker-1",
					"containers": []interface{}{
						map[string]interface{}{"name": "main", "image": "nginx:1.27"},
						map[string]interface{}{"name": "sidecar", "image": "otel/collector"},
					},
				},
			},
		},
	}

	out := summarizeListForLLM(raw)
	b, _ := json.Marshal(out)
	s := string(b)

	if strings.Contains(s, "managedFields") {
		t.Fatalf("summary must not leak managedFields: %s", s)
	}
	if strings.Contains(s, "annotations") {
		t.Fatalf("summary must not leak annotations: %s", s)
	}
	if strings.Contains(s, "conditions") {
		t.Fatalf("summary must drop status.conditions (verbose, noisy): %s", s)
	}
	if strings.Contains(s, "last-applied-configuration") {
		t.Fatalf("annotation payload leaked: %s", s)
	}

	m := out.(map[string]interface{})
	if m["item_count"].(int) != 1 {
		t.Fatalf("item_count should be 1, got %v", m["item_count"])
	}

	item := m["items"].([]interface{})[0].(map[string]interface{})
	meta := item["metadata"].(map[string]interface{})
	if meta["name"] != "app-1" || meta["namespace"] != "default" {
		t.Fatalf("name/namespace lost: %v", meta)
	}
	if meta["labels"] == nil {
		t.Fatalf("labels must be preserved (LLM uses them to group)")
	}

	status := item["status"].(map[string]interface{})
	if status["phase"] != "Running" {
		t.Fatalf("status.phase must be preserved: %v", status)
	}
	if status["total_restarts"] != 4 {
		t.Fatalf("total_restarts should aggregate containerStatuses.restartCount (3+1=4), got %v", status["total_restarts"])
	}
	if status["containers_not_ready"] != 1 {
		t.Fatalf("containers_not_ready should count not-ready containers, got %v", status["containers_not_ready"])
	}

	spec := item["spec"].(map[string]interface{})
	names, ok := spec["container_names"].([]string)
	if !ok || len(names) != 2 || names[0] != "main" {
		t.Fatalf("container_names should preserve the ordered list, got %v", spec["container_names"])
	}
	if _, hasContainers := spec["containers"]; hasContainers {
		t.Fatalf("spec.containers (with images, env, volumeMounts) must be dropped — too verbose for list queries")
	}
}

func TestSummarizeListForLLM_HandlesNonListInputs(t *testing.T) {
	// A bare string / nil / non-list map should pass through unchanged so
	// callers can wrap the summarizer without worrying about shape.
	if summarizeListForLLM(nil) != nil {
		t.Fatalf("nil input must pass through")
	}
	if summarizeListForLLM("hello") != "hello" {
		t.Fatalf("scalar input must pass through")
	}
	m := map[string]interface{}{"status": "ok"}
	out := summarizeListForLLM(m)
	if out.(map[string]interface{})["status"] != "ok" {
		t.Fatalf("non-list map must pass through: %v", out)
	}
}

func TestSummarizeListForLLM_PayloadSizeDropsDramatically(t *testing.T) {
	// Sanity: the whole point is to shrink payload size. Compose a
	// realistic-ish 49-pod list (each with 5KB of managedFields noise)
	// and assert the summarized output is at least 10x smaller.
	items := make([]interface{}, 0, 49)
	for i := 0; i < 49; i++ {
		items = append(items, map[string]interface{}{
			"kind": "Pod",
			"metadata": map[string]interface{}{
				"name":          "pod-" + strings.Repeat("a", 4),
				"namespace":     "otel-demo",
				"annotations":   map[string]interface{}{"noise": strings.Repeat("X", 3000)},
				"managedFields": []interface{}{map[string]interface{}{"blob": strings.Repeat("Y", 2000)}},
			},
			"status": map[string]interface{}{"phase": "Running"},
		})
	}
	raw := map[string]interface{}{"kind": "PodList", "items": items}
	rawBytes, _ := json.Marshal(raw)
	outBytes, _ := json.Marshal(summarizeListForLLM(raw))
	if len(outBytes)*10 > len(rawBytes) {
		t.Fatalf("summary should be ≥10x smaller than raw; raw=%d summary=%d", len(rawBytes), len(outBytes))
	}
}

// ─── capToolOutput tests ──────────────────────────────────────────────────
//
// The regression this prevents: any future tool handler forgetting to
// pre-summarize its backend response dumps raw JSON to the LLM, gpt-4o-mini
// runs out of output budget, and the turn ends with a bare tool block and no
// text answer. capToolOutput enforces MaxToolOutputBytes globally at the
// dispatch layer so that class of bug can't ship again.

func TestCapToolOutput_UnderBudget_PassesThrough(t *testing.T) {
	in := map[string]interface{}{"status": "ok", "items": []interface{}{"a", "b"}}
	out := capToolOutput(in)
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("under budget: output must preserve type, got %T", out)
	}
	if m["status"] != "ok" {
		t.Fatalf("under budget: content changed: %v", m)
	}
	if _, truncated := m["_truncated"]; truncated {
		t.Fatalf("under budget payload must not be marked truncated")
	}
}

func TestCapToolOutput_OverBudget_TruncatesAndFlags(t *testing.T) {
	big := make([]interface{}, 500)
	for i := range big {
		big[i] = map[string]interface{}{"name": "pod-name", "blob": strings.Repeat("X", 60)}
	}
	raw := map[string]interface{}{"items": big, "item_count": 500}

	out := capToolOutput(raw).(map[string]interface{})
	if out["_truncated"] != true {
		t.Fatalf("over-budget payload must set _truncated=true, got %v", out)
	}
	if _, ok := out["_truncated_reason"]; !ok {
		t.Fatalf("over-budget payload must include _truncated_reason explaining what was cut")
	}
	blob, _ := json.Marshal(out)
	max := int(MaxToolOutputBytes)
	budget := max + max/10 // 10% slack for _truncated metadata keys
	if len(blob) > budget {
		t.Fatalf("capped output still exceeds budget: %d bytes (limit %d)", len(blob), budget)
	}
	if out["item_count"] != 500 {
		t.Fatalf("item_count must survive truncation, got %v", out["item_count"])
	}
}

func TestCapToolOutput_Nil(t *testing.T) {
	if capToolOutput(nil) != nil {
		t.Fatalf("nil must pass through")
	}
}

func TestCapToolOutput_NonMapScalar(t *testing.T) {
	if capToolOutput("hello") != "hello" {
		t.Fatalf("small scalar must pass through")
	}
}
