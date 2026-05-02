package server

// handlers_cost_test.go — behavior tests for Phase 3 Category 2 cost analysis tools.

import (
	"context"
	"testing"
)

func TestCostIdentifyWaste_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumes", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeCostTool(context.Background(), "cost_identify_waste", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	if _, ok := m["cost_hint"]; !ok {
		t.Errorf("cost_identify_waste must return cost_hint, got: %v", mapKeysCost(m))
	}
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestCostForecastSpending_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumes", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeCostTool(context.Background(), "cost_forecast_spending", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["cost_hint"]; !ok {
		t.Errorf("cost_forecast_spending must return cost_hint, got: %v", mapKeysCost(m))
	}
}

func TestCostAnalyzeSpending_FallsToDefaultHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumes", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeCostTool(context.Background(), "cost_analyze_spending", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["cost_hint"]; !ok {
		t.Errorf("cost_analyze_spending must return cost_hint (default branch), got: %v", mapKeysCost(m))
	}
}

func mapKeysCost(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
