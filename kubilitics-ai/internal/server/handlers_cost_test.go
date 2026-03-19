package server

// A-CORE-011: Cost Intelligence — Handler Tests
//
// Tests for all 10 cost endpoints wired through handleCostDispatch.
// Uses real CostPipeline with a nil fetcher (returns empty resource lists)
// so arithmetic is exercised without needing a live backend.

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/cost"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

// stubFetcher is a ResourceFetcher that returns pre-configured resources.
type stubFetcher struct {
	pods  []*pb.Resource
	nodes []*pb.Resource
	pvcs  []*pb.Resource
	svcs  []*pb.Resource
}

func (s *stubFetcher) ListResources(_ context.Context, kind, _ string) ([]*pb.Resource, error) {
	switch kind {
	case "Pod":
		return s.pods, nil
	case "Node":
		return s.nodes, nil
	case "PersistentVolumeClaim":
		return s.pvcs, nil
	case "Service":
		return s.svcs, nil
	}
	return nil, nil
}

// buildCostServer creates a Server with a real CostPipeline backed by the given fetcher.
func buildCostServer(t *testing.T, fetcher cost.ResourceFetcher) *Server {
	t.Helper()
	return &Server{
		costPipeline: cost.NewCostPipeline(fetcher, cost.ProviderGeneric),
	}
}

// buildCostServerNoPipeline creates a Server without a cost pipeline (degraded mode).
func buildCostServerNoPipeline(t *testing.T) *Server {
	t.Helper()
	return &Server{}
}

// decodeBody parses JSON response body into a map.
func decodeBody(t *testing.T, rr interface{ Body() string }) map[string]interface{} {
	t.Helper()
	return nil // unused — use json.Unmarshal directly in tests
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

func TestHandleCostDispatch_NotFound(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostDispatch, http.MethodGet, "/api/v1/cost/nonexistent", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestHandleCostDispatch_RoutesOverview(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostDispatch, http.MethodGet, "/api/v1/cost/overview", "")
	// No pipeline → degraded 200 with note
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if _, ok := resp["note"]; !ok {
		t.Error("expected 'note' field in degraded response")
	}
}

// ─── Overview ─────────────────────────────────────────────────────────────────

func TestHandleCostOverview_NoPipeline(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostOverview, http.MethodGet, "/api/v1/cost/overview", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["note"] == nil {
		t.Error("expected note in no-pipeline response")
	}
}

func TestHandleCostOverview_MethodNotAllowed(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	rr := doRequest(t, srv.handleCostOverview, http.MethodPost, "/api/v1/cost/overview", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

func TestHandleCostOverview_WithData(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "api", Namespace: "prod", Kind: "Pod"},
			{Name: "worker", Namespace: "prod", Kind: "Pod"},
		},
		nodes: []*pb.Resource{
			{Name: "node-1", Kind: "Node"},
		},
	}
	srv := buildCostServer(t, fetcher)
	rr := doRequest(t, srv.handleCostOverview, http.MethodGet, "/api/v1/cost/overview", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	for _, field := range []string{"total_cost_hour", "total_cost_day", "total_cost_month", "provider", "timestamp"} {
		if resp[field] == nil {
			t.Errorf("missing field: %s", field)
		}
	}
	// Cost must be > 0 with real resources
	if hourCost, ok := resp["total_cost_hour"].(float64); !ok || hourCost <= 0 {
		t.Errorf("expected total_cost_hour > 0, got %v", resp["total_cost_hour"])
	}
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

func TestHandleCostNamespaces_NoPipeline(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostNamespaces, http.MethodGet, "/api/v1/cost/namespaces", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleCostNamespaces_WithData(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "p1", Namespace: "default", Kind: "Pod"},
			{Name: "p2", Namespace: "kube-system", Kind: "Pod"},
		},
	}
	srv := buildCostServer(t, fetcher)
	rr := doRequest(t, srv.handleCostNamespaces, http.MethodGet, "/api/v1/cost/namespaces", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	nsCosts, ok := resp["namespaces"].([]interface{})
	if !ok {
		t.Fatal("expected namespaces array")
	}
	if len(nsCosts) == 0 {
		t.Error("expected at least one namespace")
	}
}

// ─── Efficiency ───────────────────────────────────────────────────────────────

func TestHandleCostEfficiency_NoPipeline(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostEfficiency, http.MethodGet, "/api/v1/cost/efficiency", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["note"] == nil {
		t.Error("expected note field in degraded response")
	}
}

func TestHandleCostEfficiency_WithData(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "over-provisioned", Namespace: "prod", Kind: "Pod"},
		},
	}
	srv := buildCostServer(t, fetcher)
	rr := doRequest(t, srv.handleCostEfficiency, http.MethodGet, "/api/v1/cost/efficiency", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	for _, field := range []string{"efficiencies", "grade_distribution", "total_monthly_waste"} {
		if resp[field] == nil {
			t.Errorf("missing field: %s", field)
		}
	}
}

// ─── Recommendations ─────────────────────────────────────────────────────────

func TestHandleCostRecommendations_NoPipeline(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostRecommendations, http.MethodGet, "/api/v1/cost/recommendations", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
}

func TestHandleCostRecommendations_WithData(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "idle-pod", Namespace: "staging", Kind: "Pod"},
		},
	}
	srv := buildCostServer(t, fetcher)
	rr := doRequest(t, srv.handleCostRecommendations, http.MethodGet, "/api/v1/cost/recommendations", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	// "total_savings" and "by_type" must always be present; "recommendations" may be null
	// when the optimizer finds no over-provisioned resources for a single zero-spec pod.
	for _, f := range []string{"total_savings", "by_type", "total", "timestamp"} {
		if _, ok := resp[f]; !ok {
			t.Errorf("missing field: %s", f)
		}
	}
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

func TestHandleCostForecast_NoPipeline(t *testing.T) {
	srv := buildCostServerNoPipeline(t)
	rr := doRequest(t, srv.handleCostForecast, http.MethodGet, "/api/v1/cost/forecast", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	f6m, ok := resp["forecast_6m"].([]interface{})
	if !ok {
		t.Fatal("expected forecast_6m array")
	}
	if len(f6m) != 6 {
		t.Errorf("expected 6 forecast months, got %d", len(f6m))
	}
}

func TestHandleCostForecast_WithSnapshot(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "p1", Namespace: "default", Kind: "Pod"},
		},
	}
	srv := buildCostServer(t, fetcher)
	// Trigger scrape to populate last snapshot.
	_, _ = srv.costPipeline.Scrape(context.Background())

	rr := doRequest(t, srv.handleCostForecast, http.MethodGet, "/api/v1/cost/forecast", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	f6m, ok := resp["forecast_6m"].([]interface{})
	if !ok || len(f6m) != 6 {
		t.Errorf("expected 6-month forecast, got %v", resp["forecast_6m"])
	}
	// Each month should have cost, lower_95, upper_95, trend.
	first, _ := f6m[0].(map[string]interface{})
	for _, k := range []string{"month", "cost", "lower_95", "upper_95", "trend"} {
		if first[k] == nil {
			t.Errorf("month[0] missing field: %s", k)
		}
	}
}

// ─── History ─────────────────────────────────────────────────────────────────

func TestHandleCostHistory_EmptyNoSnapshots(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	rr := doRequest(t, srv.handleCostHistory, http.MethodGet, "/api/v1/cost/history", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	snaps, ok := resp["snapshots"].([]interface{})
	if !ok {
		t.Fatal("expected snapshots array")
	}
	if len(snaps) != 0 {
		t.Errorf("expected empty history, got %d", len(snaps))
	}
}

func TestHandleCostHistory_AfterScrape(t *testing.T) {
	fetcher := &stubFetcher{
		pods: []*pb.Resource{
			{Name: "p1", Namespace: "default", Kind: "Pod"},
		},
	}
	srv := buildCostServer(t, fetcher)
	_, _ = srv.costPipeline.Scrape(context.Background())

	rr := doRequest(t, srv.handleCostHistory, http.MethodGet, "/api/v1/cost/history", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	snaps, _ := resp["snapshots"].([]interface{})
	if len(snaps) == 0 {
		t.Error("expected at least one snapshot after scrape")
	}
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

func TestHandleCostPricing_GetDefault(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	rr := doRequest(t, srv.handleCostPricing, http.MethodGet, "/api/v1/cost/pricing", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["cpu_price_per_hour"] == nil {
		t.Error("expected cpu_price_per_hour in pricing response")
	}
}

func TestHandleCostPricing_SetCustom(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"provider":"on-prem","cpu_price_per_hour":0.02,"mem_price_per_gb_hour":0.005,"storage_price_per_gb_month":0.05,"network_price_per_gb":0.01,"lb_price_per_hour":0.008}`
	rr := doRequest(t, srv.handleCostPricing, http.MethodPost, "/api/v1/cost/pricing", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["status"] != "updated" {
		t.Errorf("expected status=updated, got %v", resp["status"])
	}
	pricing, ok := resp["pricing"].(map[string]interface{})
	if !ok {
		t.Fatal("expected pricing object")
	}
	if pricing["cpu_price_per_hour"].(float64) != 0.02 {
		t.Errorf("expected cpu=0.02, got %v", pricing["cpu_price_per_hour"])
	}
}

func TestHandleCostPricing_SetInvalid(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	// cpu_price_per_hour = 0 → should fail
	body := `{"cpu_price_per_hour":0}`
	rr := doRequest(t, srv.handleCostPricing, http.MethodPost, "/api/v1/cost/pricing", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestHandleCostPricing_MethodNotAllowed(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	rr := doRequest(t, srv.handleCostPricing, http.MethodDelete, "/api/v1/cost/pricing", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

// ─── Resource Cost ────────────────────────────────────────────────────────────

func TestHandleResourceCost_Pod(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"pod","resource_name":"api","namespace":"prod","cpu_cores":2.0,"memory_gb":4.0}`
	rr := doRequest(t, srv.handleResourceCost, http.MethodPost, "/api/v1/cost/resource", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	// ResourceCost struct has no json tags — Go uses CamelCase keys.
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["TotalCostMonth"] == nil {
		t.Errorf("expected TotalCostMonth in response, got keys: %v", resp)
	}
	if v, ok := resp["TotalCostMonth"].(float64); !ok || v <= 0 {
		t.Errorf("expected positive TotalCostMonth, got %v", resp["TotalCostMonth"])
	}
}

func TestHandleResourceCost_Node(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"node","resource_name":"node-1","cpu_cores":8.0,"memory_gb":32.0}`
	rr := doRequest(t, srv.handleResourceCost, http.MethodPost, "/api/v1/cost/resource", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	// ResourceCost uses CamelCase keys (no json struct tags).
	if resp["TotalCostMonth"] == nil {
		t.Errorf("expected TotalCostMonth in response, got: %v", resp)
	}
}

func TestHandleResourceCost_PVC(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"pvc","resource_name":"data-vol","namespace":"prod","storage_gb":100.0}`
	rr := doRequest(t, srv.handleResourceCost, http.MethodPost, "/api/v1/cost/resource", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleResourceCost_UnknownType(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"unknown","resource_name":"x"}`
	rr := doRequest(t, srv.handleResourceCost, http.MethodPost, "/api/v1/cost/resource", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestHandleResourceCost_MissingFields(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"pod"}`
	rr := doRequest(t, srv.handleResourceCost, http.MethodPost, "/api/v1/cost/resource", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ─── Optimize ─────────────────────────────────────────────────────────────────

func TestHandleOptimize_Pod(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	// Pod requesting 4 CPU but only using 0.5 — optimizer should flag this
	body := `{"resource_type":"pod","resource_name":"fat-pod","namespace":"prod","requested_cpu":4.0,"actual_cpu":0.5,"requested_memory":8.0,"actual_memory":1.0}`
	rr := doRequest(t, srv.handleOptimize, http.MethodPost, "/api/v1/cost/optimize", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	opts, ok := resp["optimizations"].([]interface{})
	if !ok {
		t.Fatal("expected optimizations array")
	}
	if len(opts) == 0 {
		t.Error("expected at least one optimization for an over-provisioned pod")
	}
	if resp["total_savings"] == nil {
		t.Error("expected total_savings field")
	}
}

func TestHandleOptimize_Node(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"node","resource_name":"spare-node","total_cpu":16.0,"used_cpu":1.0,"total_memory":64.0,"used_memory":4.0}`
	rr := doRequest(t, srv.handleOptimize, http.MethodPost, "/api/v1/cost/optimize", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["optimizations"] == nil {
		t.Error("expected optimizations field")
	}
}

func TestHandleOptimize_MissingFields(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	body := `{"resource_type":"pod"}`
	rr := doRequest(t, srv.handleOptimize, http.MethodPost, "/api/v1/cost/optimize", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestHandleOptimize_MethodNotAllowed(t *testing.T) {
	srv := buildCostServer(t, &stubFetcher{})
	rr := doRequest(t, srv.handleOptimize, http.MethodGet, "/api/v1/cost/optimize", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}
