package render

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildDeterministicResponse_HappyPath_ListPods(t *testing.T) {
	raw := []byte(`[{"metadata":{"name":"p1","namespace":"x"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}]`)
	ev, err := BuildDeterministicResponse(context.Background(), "list_pods", "x", raw)
	if err != nil { t.Fatalf("err: %v", err) }
	if ev.Kind != "render_block" {
		t.Fatalf("kind: %q", ev.Kind)
	}
	if ev.RenderType != "kubectl_table" {
		t.Fatalf("type: %q", ev.RenderType)
	}
	if len(ev.RenderData) == 0 {
		t.Fatal("data empty")
	}
	if ev.Summary == "" {
		t.Fatal("summary empty (expected default formatter output)")
	}
}

func TestBuildDeterministicResponse_RefusesAnalyticalTool(t *testing.T) {
	_, err := BuildDeterministicResponse(context.Background(), "explain_anything", "", []byte(`{}`))
	if err == nil {
		t.Fatal("expected error for non-deterministic tool")
	}
}

func TestBuildDeterministicResponse_ShaperFailureProducesRenderError(t *testing.T) {
	ev, err := BuildDeterministicResponse(context.Background(), "list_pods", "x", []byte(`{not json`))
	if err != nil {
		t.Fatalf("must not return error; must produce render_error event: %v", err)
	}
	if ev.RenderType != "render_error" {
		t.Fatalf("expected render_error, got %q", ev.RenderType)
	}
	var payload map[string]interface{}
	_ = json.Unmarshal(ev.RenderData, &payload)
	if payload["tool"] != "list_pods" {
		t.Errorf("error payload missing tool field")
	}
	errStr, _ := payload["error"].(string)
	if !strings.Contains(errStr, "shaper") && !strings.Contains(errStr, "json") {
		t.Errorf("error message should mention shaper/json, got %q", errStr)
	}
}

func TestBuildDeterministicResponse_OversizePayloadTruncated(t *testing.T) {
	big := make([]byte, 250_000)
	for i := range big { big[i] = 'A' }
	out := maybeTruncate(big, 200_000)
	if len(out) > 200_000 {
		t.Fatalf("not truncated: %d", len(out))
	}
}
