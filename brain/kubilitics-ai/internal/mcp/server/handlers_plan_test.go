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
