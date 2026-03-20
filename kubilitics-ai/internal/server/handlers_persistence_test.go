package server

// A-CORE-013: Persistence layer handler tests.
// 28 tests covering all persistence endpoints.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

// buildPersistenceServer creates a server with a live in-memory SQLite store.
func buildPersistenceServer(t *testing.T) *Server {
	t.Helper()
	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return &Server{store: store}
}

// buildPersistenceServerNoStore creates a server without a store.
func buildPersistenceServerNoStore() *Server {
	return &Server{store: nil}
}

func persistenceGET(t *testing.T, srv *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	srv.handlePersistenceDispatch(w, req)
	return w
}

func persistencePOST(t *testing.T, srv *Server, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.handlePersistenceDispatch(w, req)
	return w
}

// ─── Health ───────────────────────────────────────────────────────────────────

func TestHandlePersistenceHealth_OK(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/health")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %v", resp["status"])
	}
}

func TestHandlePersistenceHealth_NoStore(t *testing.T) {
	srv := buildPersistenceServerNoStore()
	w := persistenceGET(t, srv, "/api/v1/persistence/health")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestHandlePersistenceHealth_MethodNotAllowed(t *testing.T) {
	srv := buildPersistenceServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/persistence/health", nil)
	w := httptest.NewRecorder()
	srv.handlePersistenceDispatch(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

// ─── Audit ────────────────────────────────────────────────────────────────────

func TestHandlePersistenceAuditAppend_OK(t *testing.T) {
	srv := buildPersistenceServer(t)
	body := map[string]any{
		"event_type":  "investigation_started",
		"description": "User triggered investigation for pod/nginx",
		"resource":    "pod/nginx",
		"action":      "investigate",
		"result":      "pending",
		"user_id":     "user-1",
		"metadata":    `{"cluster":"prod"}`,
		"timestamp":   time.Now().Format(time.RFC3339),
	}
	w := persistencePOST(t, srv, "/api/v1/persistence/audit", body)
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandlePersistenceAuditAppend_MissingEventType(t *testing.T) {
	srv := buildPersistenceServer(t)
	body := map[string]any{"resource": "pod/nginx"}
	w := persistencePOST(t, srv, "/api/v1/persistence/audit", body)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandlePersistenceAuditQuery_Empty(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/audit")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	events, ok := resp["events"].([]any)
	if !ok || len(events) != 0 {
		t.Errorf("expected empty events array, got %v", resp["events"])
	}
}

func TestHandlePersistenceAuditQuery_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)

	// Append three events
	for i := 0; i < 3; i++ {
		body := map[string]any{
			"event_type": fmt.Sprintf("action_%d", i),
			"resource":   "deployment/api",
			"action":     "scale",
			"result":     "approved",
			"timestamp":  time.Now().Add(time.Duration(i) * time.Second).Format(time.RFC3339),
		}
		persistencePOST(t, srv, "/api/v1/persistence/audit", body)
	}

	w := persistenceGET(t, srv, "/api/v1/persistence/audit?resource=deployment%2Fapi&limit=10")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 3 {
		t.Errorf("expected total 3, got %v", resp["total"])
	}
}

func TestHandlePersistenceAuditQuery_NoStore(t *testing.T) {
	srv := buildPersistenceServerNoStore()
	w := persistenceGET(t, srv, "/api/v1/persistence/audit")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// ─── Conversations ────────────────────────────────────────────────────────────

func TestHandlePersistenceConversations_Empty(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/conversations")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	convs, _ := resp["conversations"].([]any)
	if len(convs) != 0 {
		t.Errorf("expected empty, got %d", len(convs))
	}
}

func TestHandlePersistenceConversations_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	// Insert a conversation directly via store
	_ = srv.store.SaveConversation(ctx, &db.ConversationRecord{
		ID:        "conv-test-001",
		ClusterID: "cluster-prod",
		Title:     "Debug session",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})
	_ = srv.store.AppendMessage(ctx, &db.MessageRecord{
		ConversationID: "conv-test-001",
		Role:           "user",
		Content:        "Why is my pod failing?",
		TokenCount:     7,
		Metadata:       "{}",
		Timestamp:      time.Now(),
	})

	// List conversations
	w := persistenceGET(t, srv, "/api/v1/persistence/conversations?cluster_id=cluster-prod")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var listResp map[string]any
	json.NewDecoder(w.Body).Decode(&listResp)
	if total, _ := listResp["total"].(float64); int(total) != 1 {
		t.Errorf("expected 1 conversation, got %v", listResp["total"])
	}

	// Get specific conversation with messages
	w2 := persistenceGET(t, srv, "/api/v1/persistence/conversations/conv-test-001")
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var getResp map[string]any
	json.NewDecoder(w2.Body).Decode(&getResp)
	if getResp["conversation"] == nil {
		t.Error("expected conversation in response")
	}
	msgs, _ := getResp["messages"].([]any)
	if len(msgs) != 1 {
		t.Errorf("expected 1 message, got %d", len(msgs))
	}
}

func TestHandlePersistenceConversationGet_NotFound(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/conversations/nonexistent")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandlePersistenceConversations_NoStore(t *testing.T) {
	srv := buildPersistenceServerNoStore()
	w := persistenceGET(t, srv, "/api/v1/persistence/conversations")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// ─── Anomalies ────────────────────────────────────────────────────────────────

func TestHandlePersistenceAnomalyQuery_Empty(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/anomalies")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	anomalies, _ := resp["anomalies"].([]any)
	if len(anomalies) != 0 {
		t.Errorf("expected empty, got %d", len(anomalies))
	}
}

func TestHandlePersistenceAnomalyQuery_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	// Insert anomalies
	for i := 0; i < 4; i++ {
		sev := "HIGH"
		if i%2 == 0 {
			sev = "CRITICAL"
		}
		_ = srv.store.AppendAnomaly(ctx, &db.AnomalyRecord{
			ResourceID:  "pod/nginx-" + fmt.Sprint(i),
			Namespace:   "production",
			Kind:        "Pod",
			AnomalyType: "cpu_spike",
			Severity:    sev,
			Score:       0.9 - float64(i)*0.1,
			Description: "CPU usage exceeded threshold",
			Metadata:    "{}",
			DetectedAt:  time.Now().Add(time.Duration(i) * time.Minute),
		})
	}

	// Query all
	w := persistenceGET(t, srv, "/api/v1/persistence/anomalies?namespace=production&limit=10")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 4 {
		t.Errorf("expected 4 anomalies, got %v", resp["total"])
	}

	// Query by severity
	w2 := persistenceGET(t, srv, "/api/v1/persistence/anomalies?severity=CRITICAL&limit=10")
	json.NewDecoder(w2.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 2 {
		t.Errorf("expected 2 CRITICAL anomalies, got %v", resp["total"])
	}
}

func TestHandlePersistenceAnomalySummary_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	now := time.Now()
	severities := []string{"CRITICAL", "HIGH", "HIGH", "LOW"}
	for i, sev := range severities {
		_ = srv.store.AppendAnomaly(ctx, &db.AnomalyRecord{
			ResourceID:  fmt.Sprintf("pod/test-%d", i),
			Namespace:   "default",
			Kind:        "Pod",
			AnomalyType: "anomaly",
			Severity:    sev,
			Score:       0.8,
			Description: "test",
			Metadata:    "{}",
			DetectedAt:  now.Add(time.Duration(i) * time.Second),
		})
	}

	// Pass explicit time window that covers all inserted anomalies.
	// Use URL-encoded RFC3339 to avoid '+' being decoded as space.
	from := now.Add(-time.Minute).UTC().Format("2006-01-02T15:04:05Z")
	to := now.Add(time.Minute).UTC().Format("2006-01-02T15:04:05Z")
	w := persistenceGET(t, srv, fmt.Sprintf("/api/v1/persistence/anomalies/summary?from=%s&to=%s", from, to))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 4 {
		t.Errorf("expected total 4, got %v", resp["total"])
	}
	summary, _ := resp["summary"].(map[string]any)
	if high, _ := summary["HIGH"].(float64); int(high) != 2 {
		t.Errorf("expected 2 HIGH, got %v", summary["HIGH"])
	}
}

func TestHandlePersistenceAnomalySummary_NoStore(t *testing.T) {
	srv := buildPersistenceServerNoStore()
	w := persistenceGET(t, srv, "/api/v1/persistence/anomalies/summary")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// ─── Cost snapshots ───────────────────────────────────────────────────────────

func TestHandlePersistenceCostSnapshots_Empty(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/cost/snapshots")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	snaps, _ := resp["snapshots"].([]any)
	if len(snaps) != 0 {
		t.Errorf("expected empty, got %d", len(snaps))
	}
}

func TestHandlePersistenceCostSnapshots_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	// Insert 3 snapshots
	for i := 0; i < 3; i++ {
		_ = srv.store.AppendCostSnapshot(ctx, &db.CostSnapshotRecord{
			ClusterID:  "cluster-prod",
			TotalCost:  1000.0 + float64(i)*100,
			WasteCost:  200.0 + float64(i)*20,
			Efficiency: 80.0 - float64(i)*5,
			Grade:      "B",
			Breakdown:  `{"Pod":500,"Service":200}`,
			Namespaces: `[]`,
			RecordedAt: time.Now().Add(-time.Duration(3-i) * 24 * time.Hour),
		})
	}

	w := persistenceGET(t, srv, "/api/v1/persistence/cost/snapshots?cluster_id=cluster-prod&limit=10")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 3 {
		t.Errorf("expected 3 snapshots, got %v", resp["total"])
	}
}

func TestHandlePersistenceCostTrend_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	now := time.Now()
	for i := 0; i < 5; i++ {
		_ = srv.store.AppendCostSnapshot(ctx, &db.CostSnapshotRecord{
			ClusterID:  "cluster-prod",
			TotalCost:  1000.0 + float64(i)*50,
			WasteCost:  150.0,
			Efficiency: 85.0,
			Grade:      "A",
			Breakdown:  "{}",
			Namespaces: "[]",
			RecordedAt: now.Add(-time.Duration(5-i) * 24 * time.Hour),
		})
	}

	from := now.Add(-10 * 24 * time.Hour).Format(time.RFC3339)
	to := now.Add(time.Hour).Format(time.RFC3339)
	w := persistenceGET(t, srv, fmt.Sprintf("/api/v1/persistence/cost/trend?cluster_id=cluster-prod&from=%s&to=%s", from, to))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if total, _ := resp["total"].(float64); int(total) != 5 {
		t.Errorf("expected 5 trend points, got %v", resp["total"])
	}
}

func TestHandlePersistenceCostLatest_NoData(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/cost/latest")
	// 204 No Content when no snapshots
	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}

func TestHandlePersistenceCostLatest_WithData(t *testing.T) {
	srv := buildPersistenceServer(t)
	ctx := httptest.NewRequest(http.MethodGet, "/", nil).Context()

	_ = srv.store.AppendCostSnapshot(ctx, &db.CostSnapshotRecord{
		ClusterID:  "cluster-prod",
		TotalCost:  2500.0,
		WasteCost:  300.0,
		Efficiency: 88.0,
		Grade:      "A",
		Breakdown:  `{"Pod":1500,"PVC":500}`,
		Namespaces: `[]`,
		RecordedAt: time.Now(),
	})

	w := persistenceGET(t, srv, "/api/v1/persistence/cost/latest?cluster_id=cluster-prod")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var snap db.CostSnapshotRecord
	json.NewDecoder(w.Body).Decode(&snap)
	if snap.TotalCost != 2500.0 {
		t.Errorf("expected TotalCost 2500, got %v", snap.TotalCost)
	}
	if snap.Grade != "A" {
		t.Errorf("expected grade A, got %s", snap.Grade)
	}
}

func TestHandlePersistenceCostSnapshots_NoStore(t *testing.T) {
	srv := buildPersistenceServerNoStore()
	w := persistenceGET(t, srv, "/api/v1/persistence/cost/snapshots")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// ─── Dispatch routing ─────────────────────────────────────────────────────────

func TestHandlePersistenceDispatch_NotFound(t *testing.T) {
	srv := buildPersistenceServer(t)
	w := persistenceGET(t, srv, "/api/v1/persistence/unknown-route")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandlePersistenceDispatch_AllRoutes(t *testing.T) {
	srv := buildPersistenceServer(t)
	routes := []string{
		"/api/v1/persistence/health",
		"/api/v1/persistence/audit",
		"/api/v1/persistence/conversations",
		"/api/v1/persistence/anomalies",
		"/api/v1/persistence/anomalies/summary",
		"/api/v1/persistence/cost/snapshots",
		"/api/v1/persistence/cost/trend",
		"/api/v1/persistence/cost/latest",
	}
	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			w := persistenceGET(t, srv, route)
			if w.Code == http.StatusNotFound {
				t.Errorf("route %s returned 404", route)
			}
		})
	}
}
