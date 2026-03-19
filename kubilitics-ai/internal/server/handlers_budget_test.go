package server

// A-CORE-014: Token budget enforcement handler tests.
// 22 tests covering all budget endpoints.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"os"

	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/llm/budget"
)

func newTestStore(t *testing.T) db.Store {
	f, err := os.CreateTemp("", "kubilitics-ai-budget-handler-test-*.db")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	name := f.Name()
	f.Close()
	t.Cleanup(func() { os.Remove(name) })

	s, err := db.NewSQLiteStore(name)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	return s
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func buildBudgetServer(t *testing.T) *Server {
	return &Server{budgetTracker: budget.NewBudgetTracker(newTestStore(t))}
}

func buildBudgetServerNoTracker() *Server {
	return &Server{budgetTracker: nil}
}

func budgetGET(t *testing.T, srv *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	srv.handleBudgetDispatch(w, req)
	return w
}

func budgetPOST(t *testing.T, srv *Server, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.handleBudgetDispatch(w, req)
	return w
}

func decodeJSON(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(w.Body).Decode(&m); err != nil {
		t.Fatalf("JSON decode: %v (body: %s)", err, w.Body.String())
	}
	return m
}

// ─── Summary ─────────────────────────────────────────────────────────────────

func TestHandleBudgetSummary_Empty(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/summary?user_id=user-1")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if resp["user_id"] != "user-1" {
		t.Errorf("expected user_id user-1, got %v", resp["user_id"])
	}
	if resp["total_tokens"] != float64(0) {
		t.Errorf("expected 0 tokens, got %v", resp["total_tokens"])
	}
}

func TestHandleBudgetSummary_AfterRecord(t *testing.T) {
	srv := buildBudgetServer(t)

	// Record some usage
	budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"user_id":       "user-2",
		"input_tokens":  1000,
		"output_tokens": 500,
		"provider":      "openai",
	})

	w := budgetGET(t, srv, "/api/v1/budget/summary?user_id=user-2")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if tokens, _ := resp["total_tokens"].(float64); int(tokens) != 1500 {
		t.Errorf("expected 1500 total tokens, got %v", resp["total_tokens"])
	}
	if cost, _ := resp["total_cost_usd"].(float64); cost <= 0 {
		t.Errorf("expected positive cost, got %v", cost)
	}
}

func TestHandleBudgetSummary_NoTracker(t *testing.T) {
	srv := buildBudgetServerNoTracker()
	w := budgetGET(t, srv, "/api/v1/budget/summary")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestHandleBudgetSummary_DefaultUserGlobal(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/summary") // no user_id param
	resp := decodeJSON(t, w)
	if resp["user_id"] != "global" {
		t.Errorf("expected user_id global, got %v", resp["user_id"])
	}
}

// ─── Details ─────────────────────────────────────────────────────────────────

func TestHandleBudgetDetails_Empty(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/details?user_id=user-3")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandleBudgetDetails_WithInvestigation(t *testing.T) {
	srv := buildBudgetServer(t)
	budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"user_id":          "user-4",
		"investigation_id": "inv-abc",
		"input_tokens":     200,
		"output_tokens":    100,
		"provider":         "anthropic",
	})

	w := budgetGET(t, srv, "/api/v1/budget/details?user_id=user-4&investigation_id=inv-abc")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeJSON(t, w)
	entries, _ := resp["entries"].([]any)
	if len(entries) != 1 {
		t.Errorf("expected 1 entry, got %d", len(entries))
	}
}

// ─── Limits ───────────────────────────────────────────────────────────────────

func TestHandleBudgetGetLimits_Default(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/limits?user_id=user-5")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if resp["user_id"] != "user-5" {
		t.Errorf("expected user_id user-5, got %v", resp["user_id"])
	}
}

func TestHandleBudgetSetLimit_OK(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetPOST(t, srv, "/api/v1/budget/limits", map[string]any{
		"user_id":   "user-6",
		"limit_usd": 25.0,
	})
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeJSON(t, w)
	if resp["status"] != "updated" {
		t.Errorf("expected status updated, got %v", resp["status"])
	}
	if limitUSD, _ := resp["limit_usd"].(float64); limitUSD != 25.0 {
		t.Errorf("expected limit_usd 25.0, got %v", resp["limit_usd"])
	}
}

func TestHandleBudgetSetLimit_Negative(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetPOST(t, srv, "/api/v1/budget/limits", map[string]any{
		"user_id":   "user-7",
		"limit_usd": -5.0,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleBudgetGetLimits_NoTracker(t *testing.T) {
	srv := buildBudgetServerNoTracker()
	w := budgetGET(t, srv, "/api/v1/budget/limits")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// ─── Record ───────────────────────────────────────────────────────────────────

func TestHandleBudgetRecord_OK(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"user_id":       "user-8",
		"input_tokens":  500,
		"output_tokens": 200,
		"provider":      "openai",
	})
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeJSON(t, w)
	if resp["status"] != "recorded" {
		t.Errorf("expected status recorded, got %v", resp["status"])
	}
	if tokens, _ := resp["total_tokens"].(float64); int(tokens) != 700 {
		t.Errorf("expected 700 total_tokens, got %v", resp["total_tokens"])
	}
}

func TestHandleBudgetRecord_NegativeTokens(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"input_tokens":  -10,
		"output_tokens": 100,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleBudgetRecord_MethodNotAllowed(t *testing.T) {
	srv := buildBudgetServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget/record", nil)
	w := httptest.NewRecorder()
	srv.handleBudgetDispatch(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

// ─── Check ────────────────────────────────────────────────────────────────────

func TestHandleBudgetCheck_Unlimited(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetPOST(t, srv, "/api/v1/budget/check", map[string]any{
		"user_id":          "user-9",
		"estimated_tokens": 5000,
	})
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if resp["available"] != true {
		t.Errorf("expected available true, got %v", resp["available"])
	}
}

func TestHandleBudgetCheck_ExceededLimit(t *testing.T) {
	srv := buildBudgetServer(t)

	// Set tight limit
	budgetPOST(t, srv, "/api/v1/budget/limits", map[string]any{
		"user_id":   "user-10",
		"limit_usd": 0.001, // very small limit
	})
	// Record lots of usage
	budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"user_id":       "user-10",
		"input_tokens":  100000,
		"output_tokens": 100000,
		"provider":      "openai",
	})

	w := budgetPOST(t, srv, "/api/v1/budget/check", map[string]any{
		"user_id":          "user-10",
		"estimated_tokens": 1000,
	})
	if w.Code != http.StatusPaymentRequired {
		t.Errorf("expected 402 when budget exceeded, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if resp["available"] != false {
		t.Errorf("expected available false, got %v", resp["available"])
	}
}

// ─── Reset ────────────────────────────────────────────────────────────────────

func TestHandleBudgetReset_OK(t *testing.T) {
	srv := buildBudgetServer(t)

	// Set a limit explicitly to ensure the user row exists in DB types.
	budgetPOST(t, srv, "/api/v1/budget/limits", map[string]any{
		"user_id":   "user-11",
		"limit_usd": 10.0,
	})

	// Record usage then reset
	budgetPOST(t, srv, "/api/v1/budget/record", map[string]any{
		"user_id":       "user-11",
		"input_tokens":  1000,
		"output_tokens": 500,
		"provider":      "openai",
	})

	w := budgetPOST(t, srv, "/api/v1/budget/reset", map[string]any{"user_id": "user-11"})
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeJSON(t, w)
	if resp["status"] != "reset" {
		t.Errorf("expected status reset, got %v", resp["status"])
	}

	// Verify usage is cleared
	w2 := budgetGET(t, srv, "/api/v1/budget/summary?user_id=user-11")
	resp2 := decodeJSON(t, w2)
	// total_tokens should be 0 because period_start is now AFTER the record
	if tokens, _ := resp2["total_tokens"].(float64); int(tokens) != 0 {
		t.Errorf("expected 0 tokens after reset, got %v", resp2["total_tokens"])
	}
}

func TestHandleBudgetReset_MethodNotAllowed(t *testing.T) {
	srv := buildBudgetServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget/reset", nil)
	w := httptest.NewRecorder()
	srv.handleBudgetDispatch(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

// ─── Estimate ────────────────────────────────────────────────────────────────

func TestHandleBudgetEstimate_OpenAI(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/estimate?input_tokens=1000&output_tokens=500&provider=openai")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if cost, _ := resp["estimated_usd"].(float64); cost <= 0 {
		t.Errorf("expected positive estimated_usd for openai, got %v", cost)
	}
	if resp["provider"] != "openai" {
		t.Errorf("expected provider openai, got %v", resp["provider"])
	}
}

func TestHandleBudgetEstimate_Ollama(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/estimate?input_tokens=5000&output_tokens=2000&provider=ollama")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp := decodeJSON(t, w)
	if cost, _ := resp["estimated_usd"].(float64); cost != 0 {
		t.Errorf("expected 0 cost for ollama (local), got %v", cost)
	}
}

// ─── Dispatch routing ─────────────────────────────────────────────────────────

func TestHandleBudgetDispatch_NotFound(t *testing.T) {
	srv := buildBudgetServer(t)
	w := budgetGET(t, srv, "/api/v1/budget/unknown-route")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandleBudgetDispatch_AllGetRoutes(t *testing.T) {
	srv := buildBudgetServer(t)
	routes := []string{
		"/api/v1/budget/summary",
		"/api/v1/budget/details",
		"/api/v1/budget/limits",
		"/api/v1/budget/estimate",
	}
	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			w := budgetGET(t, srv, route)
			if w.Code == http.StatusNotFound {
				t.Errorf("route %s returned 404", route)
			}
		})
	}
}
