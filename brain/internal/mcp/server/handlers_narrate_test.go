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

func TestNarrateWeeklyStatus_IncludesClusterData(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/overview", map[string]interface{}{"summary": "ok"})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	result, matched, err := s.routeNarrateTool(context.Background(), "narrate_weekly_status", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("narrate_weekly_status must be matched by routeNarrateTool")
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	if _, ok := m["narrative_prompt"]; !ok {
		t.Errorf("narrate tool must return narrative_prompt key, got: %v", mapKeysNarrate(m))
	}
}

func TestNarrateIncidentTimeline_ReturnsHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	result, matched, err := s.routeNarrateTool(context.Background(), "narrate_incident_timeline", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("narrate_incident_timeline must be matched")
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	if _, ok := m["narrative_prompt"]; !ok {
		t.Errorf("narrate_incident_timeline must return narrative_prompt, got: %v", mapKeysNarrate(m))
	}
}

func mapKeysNarrate(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
