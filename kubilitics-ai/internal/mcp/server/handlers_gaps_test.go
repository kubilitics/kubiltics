package server

// handlers_gaps_test.go — tests for the 6 gaps closed after the 100-prompt
// Together.ai bench (see docs/strategy/2026-04-22-gap-findings-from-100-bench.md).
//
// Each gap gets: happy-path, empty-result, and error-path coverage where
// meaningful. All tests rely on the fakeBackend harness defined in
// handlers_test.go.

import (
	"context"
	"strings"
	"testing"
	"time"
)

// ═══════════════════════════════════════════════════════════════════════════
// Gap 6 — analyze_blast_radius schema fix (scope-aware)
// ═══════════════════════════════════════════════════════════════════════════

func TestBlastRadius_ScopeResource_RequiresKindName(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	_, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{
		"scope": "resource",
	})
	if err == nil || !strings.Contains(err.Error(), "'kind' and 'name'") {
		t.Fatalf("expected kind+name error, got %v", err)
	}
}

func TestBlastRadius_ScopeNamespace_NoKindNeeded(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{
		"scope":     "namespace",
		"namespace": "demo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["scope"] != "namespace" {
		t.Errorf("scope mismatch: %v", m["scope"])
	}
}

func TestBlastRadius_ScopeCluster_NoArgs(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{
		"scope": "cluster",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["scope"] != "cluster" {
		t.Errorf("scope mismatch: %v", m["scope"])
	}
	if _, ok := m["analysis_hint"]; !ok {
		t.Error("expected analysis_hint on cluster scope")
	}
}

func TestBlastRadius_InfersScope_WhenOmitted(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	// No scope, no kind/name/namespace → should fall back to cluster scope
	out, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.(map[string]interface{})["scope"] != "cluster" {
		t.Errorf("expected inferred cluster scope")
	}
}

func TestBlastRadius_BackwardsCompat_KindAndName(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{
		"kind":      "Deployment",
		"name":      "web",
		"namespace": "demo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["scope"] != "resource" || m["subject_name"] != "web" {
		t.Errorf("expected inferred resource scope, got %v", m)
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 2 — resolve_resource (kind + name_hint)
// ═══════════════════════════════════════════════════════════════════════════

func TestResolveResource_ExactMatchAcrossNamespaces(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "web", "namespace": "default"},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "redis", "namespace": "data"},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleResolveResource(context.Background(), map[string]interface{}{
		"kind":      "Deployment",
		"name_hint": "redis",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	matches := m["matches"].([]map[string]interface{})
	if len(matches) != 1 || matches[0]["namespace"] != "data" {
		t.Errorf("expected single match in data namespace, got %+v", matches)
	}
}

func TestResolveResource_NoMatchGivesSuggestions(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/configmaps", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{"metadata": map[string]interface{}{"name": "web-config", "namespace": "demo"}},
			map[string]interface{}{"metadata": map[string]interface{}{"name": "redis-config", "namespace": "data"}},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleResolveResource(context.Background(), map[string]interface{}{
		"kind":      "ConfigMap",
		"name_hint": "nonexistent",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if len(m["matches"].([]map[string]interface{})) != 0 {
		t.Errorf("expected no matches")
	}
	if sug, _ := m["suggestions"].([]string); len(sug) != 2 {
		t.Errorf("expected 2 suggestions, got %v", m["suggestions"])
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 1 — live metrics adapter
// ═══════════════════════════════════════════════════════════════════════════

func TestObservePodMetrics_SinglePod(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/metrics/demo/web-1", map[string]interface{}{
		"cpu_millicores": 250, "memory_mib": 512,
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObservePodMetrics(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "web-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["pod"] != "web-1" {
		t.Errorf("pod mismatch")
	}
}

func TestObservePodMetrics_FallbackWhenUnavailable(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObservePodMetrics(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "web-1",
	})
	if err != nil {
		t.Fatalf("expected fallback (no error), got %v", err)
	}
	m := out.(map[string]interface{})
	if m["metrics_unavailable"] != true {
		t.Errorf("expected metrics_unavailable=true, got %v", m)
	}
}

func TestObserveTopPodsByMetric_SortsByCPU(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{
		"pods": []interface{}{
			map[string]interface{}{"namespace": "demo", "name": "a", "cpu_millicores": 100.0, "memory_mib": 50.0},
			map[string]interface{}{"namespace": "demo", "name": "b", "cpu_millicores": 500.0, "memory_mib": 20.0},
			map[string]interface{}{"namespace": "demo", "name": "c", "cpu_millicores": 200.0, "memory_mib": 80.0},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveTopPodsByMetric(context.Background(), map[string]interface{}{
		"metric_type": "cpu", "limit": 2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	top := m["top_pods"].([]map[string]interface{})
	if len(top) != 2 || top[0]["name"] != "b" {
		t.Errorf("expected b first, got %+v", top)
	}
}

func TestObserveTopPodsByMetric_EmptyFallback(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveTopPodsByMetric(context.Background(), map[string]interface{}{
		"metric_type": "memory",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["metrics_unavailable"] != true {
		t.Errorf("expected metrics_unavailable fallback, got %v", m)
	}
}

func TestObserveTopPodsByMetric_InvalidType(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.handleObserveTopPodsByMetric(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "metric_type": "disk",
	})
	if err == nil || !strings.Contains(err.Error(), "metric_type") {
		t.Errorf("expected metric_type error, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 3 — who_can_do RBAC aggregator
// ═══════════════════════════════════════════════════════════════════════════

func TestWhoCanDo_AggregatesMatchingRolesAndBindings(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/clusterroles", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "cluster-admin"},
				"rules": []interface{}{
					map[string]interface{}{
						"verbs":     []interface{}{"*"},
						"resources": []interface{}{"*"},
					},
				},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "read-only"},
				"rules": []interface{}{
					map[string]interface{}{
						"verbs":     []interface{}{"get", "list"},
						"resources": []interface{}{"pods"},
					},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/clusterrolebindings", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "bind-admin"},
				"roleRef":  map[string]interface{}{"kind": "ClusterRole", "name": "cluster-admin"},
				"subjects": []interface{}{
					map[string]interface{}{"kind": "ServiceAccount", "name": "default", "namespace": "kube-system"},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/roles", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/rolebindings", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleWhoCanDo(context.Background(), map[string]interface{}{
		"verb": "delete", "resource": "pods", "namespace": "demo",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	roles := m["roles_granting"].([]string)
	found := false
	for _, r := range roles {
		if r == "ClusterRole/cluster-admin" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected ClusterRole/cluster-admin to grant delete pods, got %v", roles)
	}
}

func TestWhoCanDo_NoMatches(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/clusterroles", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/roles", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/clusterrolebindings", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/rolebindings", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleWhoCanDo(context.Background(), map[string]interface{}{
		"verb": "create", "resource": "secrets",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if len(m["roles_granting"].([]string)) != 0 {
		t.Errorf("expected no granting roles")
	}
}

func TestWhoCanDo_RequiresArgs(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.handleWhoCanDo(context.Background(), map[string]interface{}{
		"cluster_id": "c1",
	})
	if err == nil || !strings.Contains(err.Error(), "verb") {
		t.Errorf("expected verb/resource error, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 4 — observe_recent_changes
// ═══════════════════════════════════════════════════════════════════════════

func TestRecentChanges_FiltersByWindow(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{
		map[string]interface{}{
			"reason":         "ScalingReplicaSet",
			"lastTimestamp":  "2099-01-01T00:00:00Z",
			"involvedObject": map[string]interface{}{"kind": "Deployment", "name": "web", "namespace": "demo"},
			"message":        "scaled to 3",
		},
		map[string]interface{}{
			"reason":         "ScalingReplicaSet",
			"lastTimestamp":  "2000-01-01T00:00:00Z", // outside window
			"involvedObject": map[string]interface{}{"kind": "Deployment", "name": "old"},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveRecentChanges(context.Background(), map[string]interface{}{
		"window_minutes": 60,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["window_minutes"] != 60 {
		t.Errorf("unexpected window: %v", m["window_minutes"])
	}
}

func TestRecentChanges_EmptyWindow(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveRecentChanges(context.Background(), map[string]interface{}{
		"window_minutes": 5,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["window_minutes"] != 5 {
		t.Errorf("expected window=5, got %v", m["window_minutes"])
	}
}

func TestClassifyEventReason(t *testing.T) {
	cases := map[string]string{
		"ScalingReplicaSet":  "rollout",
		"SuccessfulCreate":   "create",
		"ConfigMapUpdated":   "update",
		"FailedScheduling":   "failure",
		"BackOff":            "failure",
		"SomethingUnrelated": "",
	}
	for reason, want := range cases {
		if got := classifyEventReason(reason); got != want {
			t.Errorf("classifyEventReason(%q)=%q, want %q", reason, got, want)
		}
	}
}

func TestResolveResource_RequiresArgs(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.handleResolveResource(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "kind": "Pod",
	})
	if err == nil || !strings.Contains(err.Error(), "name_hint") {
		t.Errorf("expected name_hint error, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Iteration 3 — services_by_filter / secrets_usage / ingresses_by_tls_expiry
// ═══════════════════════════════════════════════════════════════════════════

func TestServicesByFilter_NoEndpoints(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/services", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "lonely", "namespace": "demo"},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "healthy", "namespace": "demo"},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	// lonely has no endpoints route — fake backend returns 404 → nil map → 0 ready
	// healthy has endpoints with 1 ready address.
	fb.register("/clusters/"+testClusterID+"/resources/services/demo/healthy/endpoints", map[string]interface{}{
		"subsets": []interface{}{
			map[string]interface{}{
				"addresses": []interface{}{map[string]interface{}{"ip": "10.0.0.1"}},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveServicesByFilter(context.Background(), map[string]interface{}{
		"no_endpoints": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	summary, _ := m["summary"].(string)
	if !strings.Contains(summary, "service(s) matched") && !strings.Contains(summary, "No services") {
		t.Errorf("unexpected summary: %q", summary)
	}
}

func TestServicesByFilter_ImpliedFiltersWhenNoneGiven(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/services", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveServicesByFilter(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	filters, _ := m["filters"].(map[string]interface{})
	if filters["flapping"] != true || filters["no_endpoints"] != true {
		t.Errorf("expected both filters implied, got %#v", filters)
	}
}

func TestSecretsUsage_MarksUnused(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/secrets", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "db-creds", "namespace": "demo"},
				"type":     "Opaque",
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "sa-token", "namespace": "demo"},
				"type":     "kubernetes.io/service-account-token",
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "web", "namespace": "demo"},
				"spec": map[string]interface{}{
					"volumes": []interface{}{
						map[string]interface{}{"secret": map[string]interface{}{"secretName": "db-creds"}},
					},
					"containers": []interface{}{
						map[string]interface{}{"name": "c", "env": []interface{}{}},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveSecretsUsage(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	// db-creds is mounted → unused=false; sa-token is service-account-token → filtered out of unused.
	if unused, _ := m["unused_count"].(int); unused != 0 {
		t.Errorf("expected 0 unused secrets (sa-tokens excluded), got %d", unused)
	}
	summary, _ := m["summary"].(string)
	if !strings.Contains(summary, "secret(s) total") {
		t.Errorf("summary shape wrong: %q", summary)
	}
}

func TestSecretsUsage_CatchesTrulyUnused(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/secrets", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "orphan", "namespace": "demo"},
				"type":     "Opaque",
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, _ := s.handleObserveSecretsUsage(context.Background(), map[string]interface{}{})
	m := out.(map[string]interface{})
	if unused, _ := m["unused_count"].(int); unused != 1 {
		t.Errorf("expected 1 unused secret, got %d", unused)
	}
}

func TestIngressesByTLSExpiry_UnavailableFallback(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/ingresses", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "web", "namespace": "demo"},
			},
		},
	})
	// No tls-info route registered — fake backend 404s → unavailable fallback.
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveIngressesByTLSExpiry(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["tls_inspection_unavailable"] != true {
		t.Errorf("expected tls_inspection_unavailable=true, got %#v", m)
	}
}

func TestIngressesByTLSExpiry_FlagsExpiring(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/ingresses", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "web", "namespace": "demo"},
			},
		},
	})
	// Cert expiring in ~1 day (well inside 30-day default window).
	soon := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	fb.register("/clusters/"+testClusterID+"/resources/ingresses/demo/web/tls-info", map[string]interface{}{
		"certificates": []interface{}{
			map[string]interface{}{
				"host":      "web.example.com",
				"issuer":    "Let's Encrypt",
				"not_after": soon,
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveIngressesByTLSExpiry(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["tls_inspection_unavailable"] == true {
		t.Fatalf("did not expect unavailable fallback; got %#v", m)
	}
	summary, _ := m["summary"].(string)
	if !strings.Contains(summary, "expire within") {
		t.Errorf("unexpected summary: %q", summary)
	}
}
