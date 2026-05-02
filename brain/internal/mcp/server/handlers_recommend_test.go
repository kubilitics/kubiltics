package server

// handlers_recommend_test.go — behavior tests for Phase 3 Category 1 recommendation tools.

import (
	"context"
	"testing"
)

func TestRecommendResourceOptimization_ReturnsFindingsAndHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeRecommendationTool(context.Background(), "recommend_resource_optimization", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	if _, ok := m["recommendation_hint"]; !ok {
		t.Errorf("recommend_resource_optimization must return recommendation_hint key, got: %v", mapKeysRecommend(m))
	}
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestRecommendCostReduction_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{
		map[string]interface{}{"metadata": map[string]interface{}{"name": "node-1"}},
	}})
	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics", map[string]interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeRecommendationTool(context.Background(), "recommend_cost_reduction", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["recommendation_hint"]; !ok {
		t.Errorf("recommend_cost_reduction must return recommendation_hint, got: %v", mapKeysRecommend(m))
	}
}

func TestRecommendSecurityHardening_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/networkpolicies", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/rolebindings", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeRecommendationTool(context.Background(), "recommend_security_hardening", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["recommendation_hint"]; !ok {
		t.Errorf("recommend_security_hardening must return recommendation_hint, got: %v", mapKeysRecommend(m))
	}
}

func TestRecommendGenericFallback_ReturnsOverviewAndHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/overview", map[string]interface{}{"cluster": "docker-desktop"})
	s := newTestServer(t, fb.server.URL)
	// recommend_disaster_recovery falls to the generic default branch
	out, err := s.routeRecommendationTool(context.Background(), "recommend_disaster_recovery", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["recommendation_hint"]; !ok {
		t.Errorf("generic recommend fallback must return recommendation_hint, got: %v", mapKeysRecommend(m))
	}
	if _, ok := m["overview"]; !ok {
		t.Errorf("generic recommend fallback must return overview data, got: %v", mapKeysRecommend(m))
	}
}

func mapKeysRecommend(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
