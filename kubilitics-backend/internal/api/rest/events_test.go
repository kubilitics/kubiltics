package rest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// TestHandler_GetEvents_AllNamespaces_Envelope locks the Phase 4 wire shape:
//
//	GET /clusters/{id}/events returns the resilient envelope with the historical
//	all-namespaces response ([]*models.Event) nested under .data.
func TestHandler_GetEvents_AllNamespaces_Envelope(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster}
	mockSvc.clientMap[clusterID] = makeMockClientWithCounts(1, 1)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/events", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	// Envelope shape post-Phase-4. mockEventsService.ListEventsAllNamespaces
	// returns an empty slice; the bare-array branch serializes it as [].
	var envelope struct {
		Data         []*models.Event `json:"data"`
		Reachable    bool            `json:"reachable"`
		HealthStatus string          `json:"health_status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if !envelope.Reachable {
		t.Fatalf("expected reachable=true, got %+v", envelope)
	}
	if envelope.HealthStatus != "healthy" {
		t.Fatalf("expected health_status=healthy, got %q", envelope.HealthStatus)
	}
	// Data is the bare events slice (not an object with items).
	if envelope.Data == nil {
		// nil is acceptable for empty slice — JSON might emit [] or omit.
		envelope.Data = []*models.Event{}
	}
	if len(envelope.Data) != 0 {
		t.Fatalf("expected 0 events, got %d", len(envelope.Data))
	}
}

// TestHandler_GetEvents_SingleNamespace_EnvelopeShape verifies the nested
// {items, metadata} branch is preserved under .data for single-namespace
// requests (the paginated path).
func TestHandler_GetEvents_SingleNamespace_EnvelopeShape(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster}
	mockSvc.clientMap[clusterID] = makeMockClientWithCounts(1, 1)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/events?namespace=kube-system&limit=50", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Data struct {
			Items    []*models.Event `json:"items"`
			Metadata map[string]any  `json:"metadata"`
		} `json:"data"`
		Reachable bool `json:"reachable"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if !envelope.Reachable {
		t.Fatalf("expected reachable=true, got %+v", envelope)
	}
	// metadata should contain continue + total keys even when empty.
	if _, ok := envelope.Data.Metadata["total"]; !ok {
		t.Fatalf("expected metadata.total, got %+v", envelope.Data.Metadata)
	}
}

// Ensure the helper doesn't race with itself when invoked concurrently.
// This is a smoke test for the LRU path — full race coverage lives in
// internal/api/resilient.
func TestHandler_GetEvents_ConcurrentCalls(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	mockSvc.clusterMap[clusterID] = &models.Cluster{ID: clusterID, Name: "c", Context: "c", Status: "connected"}
	mockSvc.clusters = []*models.Cluster{mockSvc.clusterMap[clusterID]}
	mockSvc.clientMap[clusterID] = makeMockClientWithCounts(0, 0)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	done := make(chan struct{}, 8)
	for i := 0; i < 8; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/events", nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			done <- struct{}{}
		}()
	}
	deadline := time.After(5 * time.Second)
	for i := 0; i < 8; i++ {
		select {
		case <-done:
		case <-deadline:
			t.Fatal("concurrent events requests deadlocked")
		}
	}
}
