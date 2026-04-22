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

func TestResolveResource_RequiresArgs(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.handleResolveResource(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "kind": "Pod",
	})
	if err == nil || !strings.Contains(err.Error(), "name_hint") {
		t.Errorf("expected name_hint error, got %v", err)
	}
}
