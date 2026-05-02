package server

// handlers_plan_test.go — dispatch smoke for Phase 3 Category 3 planners.

import (
	"context"
	"testing"
)

func TestPlan_DispatchRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// Every plan_* fetches between 2 and 4 endpoints from the same small set.
	for _, p := range []string{
		"/resources/deployments", "/resources/statefulsets", "/resources/daemonsets",
		"/resources/pods", "/resources/services", "/resources/secrets",
		"/resources/nodes", "/resources/namespaces", "/resources/persistentvolumes",
		"/resources/pvcs", "/resources/horizontalpodautoscalers",
		"/resources/poddisruptionbudgets", "/resources/resourcequotas",
		"/resources/networkpolicies", "/metrics/summary", "/metrics", "/overview",
	} {
		fb.register("/clusters/"+testClusterID+p, map[string]interface{}{"items": []interface{}{}})
	}
	s := newTestServer(t, fb.server.URL)

	plans := []string{
		"plan_scale_deployment",
		"plan_drain_node",
		"plan_rollout_safety",
		"plan_cost_reduction",
		"plan_ha_upgrade",
		"plan_resource_quota",
		"plan_psa_enforcement",
		"plan_image_pull_secrets",
		"plan_backup_coverage",
		"plan_pdb_coverage",
	}
	for _, name := range plans {
		t.Run(name, func(t *testing.T) {
			out, err := s.routeRecommendationTool(context.Background(), name, map[string]interface{}{})
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			m, ok := out.(map[string]interface{})
			if !ok {
				t.Fatalf("%s returned non-map result: %T", name, out)
			}
			if m["tool"] != name {
				t.Errorf("%s: tool field mismatch: %v", name, m["tool"])
			}
			if _, ok := m["planning_hint"]; !ok {
				t.Errorf("%s: missing planning_hint", name)
			}
		})
	}
}

func TestPlanDrainNode_IncludesPodList(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "api-xyz", "namespace": "default"},
				"spec":     map[string]interface{}{"nodeName": "node-1"},
				"status":   map[string]interface{}{"phase": "Running"},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/poddisruptionbudgets", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	result, matched, err := s.handlePlanRoute(context.Background(), "plan_drain_node", map[string]interface{}{"name": "node-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("plan_drain_node must be matched by handlePlanRoute")
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	if _, ok := m["planning_hint"]; !ok {
		t.Errorf("plan tool must return planning_hint, got: %v", mapKeysPlan(m))
	}
}

func TestPlanScaleDeployment_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "api", "namespace": "default"},
				"spec":     map[string]interface{}{"replicas": float64(2)},
				"status":   map[string]interface{}{"replicas": float64(2), "readyReplicas": float64(2)},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/horizontalpodautoscalers", map[string]interface{}{})
	s := newTestServer(t, fb.server.URL)
	result, matched, err := s.handlePlanRoute(context.Background(), "plan_scale_deployment", map[string]interface{}{
		"namespace": "default",
		"name":      "api",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("plan_scale_deployment must be matched by handlePlanRoute")
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	if _, ok := m["planning_hint"]; !ok {
		t.Errorf("plan tool must return planning_hint, got: %v", mapKeysPlan(m))
	}
}

func mapKeysPlan(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
