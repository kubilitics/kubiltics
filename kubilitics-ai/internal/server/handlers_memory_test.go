package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/memory/temporal"
	"github.com/kubilitics/kubilitics-ai/internal/memory/vector"
	"github.com/kubilitics/kubilitics-ai/internal/memory/worldmodel"
)

// buildTestServerWithMemory returns a minimal Server with memory layer wired.
func buildTestServerWithMemory(t *testing.T) *Server {
	t.Helper()
	wm := worldmodel.NewWorldModel()
	qa := worldmodel.NewQueryAPI(wm)
	ts := temporal.NewTemporalStore()
	vs := vector.NewVectorStore()
	return &Server{
		worldModel:    wm,
		queryAPI:      qa,
		temporalStore: ts,
		vectorStore:   vs,
	}
}

// seedWorldModel bootstraps the world model with test resources.
func seedWorldModel(t *testing.T, s *Server) {
	t.Helper()
	resources := []*pb.Resource{
		{Kind: "Pod", Namespace: "default", Name: "pod-alpha", Labels: map[string]string{"app": "api"}},
		{Kind: "Pod", Namespace: "default", Name: "pod-beta", Labels: map[string]string{"app": "api"}},
		{Kind: "Service", Namespace: "default", Name: "svc-api"},
		{Kind: "Deployment", Namespace: "production", Name: "api-server"},
		{Kind: "Node", Namespace: "", Name: "node-1"},
	}
	if err := s.worldModel.Bootstrap(context.Background(), resources); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
}

// ─── Overview ─────────────────────────────────────────────────────────────────

func TestHandleMemoryOverview_NoWorldModel(t *testing.T) {
	s := &Server{} // no worldModel
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/overview", nil)
	w := httptest.NewRecorder()
	s.handleMemoryOverview(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if body["error"] == nil {
		t.Error("Expected error field when world model not initialised")
	}
}

func TestHandleMemoryOverview_WithWorldModel(t *testing.T) {
	s := buildTestServerWithMemory(t)
	seedWorldModel(t, s)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/overview", nil)
	w := httptest.NewRecorder()
	s.handleMemoryOverview(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if body["cluster_stats"] == nil {
		t.Error("Expected cluster_stats in overview")
	}
}

// ─── Resources ────────────────────────────────────────────────────────────────

func TestHandleMemoryResources_ListByKind(t *testing.T) {
	s := buildTestServerWithMemory(t)
	seedWorldModel(t, s)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/resources?kind=Pod&namespace=default", nil)
	w := httptest.NewRecorder()
	s.handleMemoryResources(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["count"].(float64) < 1 {
		t.Errorf("Expected >= 1 pod, got %v", body["count"])
	}
}

func TestHandleMemoryResources_TextSearch(t *testing.T) {
	s := buildTestServerWithMemory(t)
	seedWorldModel(t, s)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/resources?search=api", nil)
	w := httptest.NewRecorder()
	s.handleMemoryResources(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestHandleMemoryResources_MethodNotAllowed(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/memory/resources", nil)
	w := httptest.NewRecorder()
	s.handleMemoryResources(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("Expected 405, got %d", w.Code)
	}
}

// ─── Changes ──────────────────────────────────────────────────────────────────

func TestHandleMemoryChanges_Empty(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/changes?since=5m", nil)
	w := httptest.NewRecorder()
	s.handleMemoryChanges(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["changes"] == nil {
		t.Error("Expected changes field")
	}
}

// ─── Temporal ─────────────────────────────────────────────────────────────────

func TestHandleTemporalWindow_NoSnapshots(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/temporal/window", nil)
	w := httptest.NewRecorder()
	s.handleTemporalWindow(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	// available=false because no snapshots yet
	if body["available"] == nil {
		t.Error("Expected available field")
	}
}

func TestHandleTemporalChanges_EmptyRange(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/temporal/changes?kind=Pod&namespace=default&name=pod-alpha", nil)
	w := httptest.NewRecorder()
	s.handleTemporalChanges(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

// ─── Vector ───────────────────────────────────────────────────────────────────

func TestHandleVectorStats(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/vector/stats", nil)
	w := httptest.NewRecorder()
	s.handleVectorStats(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["available"] == nil {
		t.Error("Expected available field")
	}
}

func TestHandleVectorSearch_Investigations(t *testing.T) {
	s := buildTestServerWithMemory(t)
	// Pre-index an investigation
	_ = s.vectorStore.IndexInvestigation(context.Background(), map[string]interface{}{
		"description": "OOMKilled pod in production namespace",
		"conclusion":  "Memory limit too low",
	})

	payload := `{"query":"OOMKilled pod","type":"investigations","limit":5}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/memory/vector/search", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleVectorSearch(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["results"] == nil {
		t.Error("Expected results field")
	}
	// Should find the indexed investigation
	results := body["results"].([]interface{})
	if len(results) == 0 {
		t.Error("Expected at least 1 search result for OOMKilled investigation")
	}
}

func TestHandleVectorIndex_Investigation(t *testing.T) {
	s := buildTestServerWithMemory(t)
	payload := `{"type":"investigation","content":{"description":"Pod crash loop in staging","conclusion":"Image pull error"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/memory/vector/index", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleVectorIndex(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["status"] != "indexed" {
		t.Errorf("Expected status=indexed, got %v", body["status"])
	}
}

func TestHandleVectorSearch_BadJSON(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/memory/vector/search", bytes.NewBufferString("not json"))
	w := httptest.NewRecorder()
	s.handleVectorSearch(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
}

// ─── Router dispatch ──────────────────────────────────────────────────────────

func TestHandleMemory_DispatchOverview(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/overview", nil)
	w := httptest.NewRecorder()
	s.handleMemory(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestHandleMemory_UnknownPath(t *testing.T) {
	s := buildTestServerWithMemory(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory/unknown-path", nil)
	w := httptest.NewRecorder()
	s.handleMemory(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404, got %d", w.Code)
	}
}
