package server

// handlers_narrate_test.go — dispatch smoke for Phase 3 Category 5 narrators.

import (
	"context"
	"testing"
)

func TestNarrate_DispatchRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	for _, p := range []string{
		"/events", "/overview", "/metrics/summary",
		"/resources/deployments", "/resources/pvcs", "/resources/configmaps",
		"/resources/secrets", "/resources/pods", "/resources/services",
		"/resources/networkpolicies", "/resources/rolebindings",
		"/resources/clusterrolebindings", "/resources/nodes",
		"/resources/persistentvolumes",
		"/resources/services/demo/web", "/resources/deployments/demo/web/rollout-history",
	} {
		fb.register("/clusters/"+testClusterID+p, map[string]interface{}{"items": []interface{}{}})
	}
	s := newTestServer(t, fb.server.URL)

	cases := []struct {
		name string
		args map[string]interface{}
	}{
		{"narrate_incident_timeline", map[string]interface{}{"window_minutes": 60}},
		{"narrate_deploy_diff", map[string]interface{}{"namespace": "demo", "deployment": "web"}},
		{"narrate_weekly_status", map[string]interface{}{}},
		{"narrate_onboarding_for_user", map[string]interface{}{"service_account": "ci"}},
		{"narrate_service_dependency_graph", map[string]interface{}{"namespace": "demo", "service": "web"}},
		{"narrate_capacity_report", map[string]interface{}{}},
		{"narrate_cost_report", map[string]interface{}{"period": "weekly"}},
		{"narrate_security_posture", map[string]interface{}{}},
		{"narrate_migration_readiness", map[string]interface{}{"source_namespace": "demo", "destination_cluster": "prod"}},
		{"narrate_change_impact", map[string]interface{}{"what_if": "scale web to 10"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, err := s.routeAnalysisTool(context.Background(), c.name, c.args)
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			m, ok := out.(map[string]interface{})
			if !ok {
				t.Fatalf("%s: non-map result: %T", c.name, out)
			}
			if m["narrative_prompt"] == nil {
				t.Errorf("%s: missing narrative_prompt", c.name)
			}
		})
	}
}
