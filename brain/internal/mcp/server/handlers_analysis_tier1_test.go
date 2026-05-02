package server

import (
	"context"
	"testing"
)

func TestAnalyzeResourceEfficiency_ReturnsFindingsNotRawData(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "api", "namespace": "default"},
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{
							"name": "api",
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{"cpu": "1000m", "memory": "2Gi"},
								"limits":   map[string]interface{}{"cpu": "2000m", "memory": "4Gi"},
							},
						},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_resource_efficiency", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	if _, hasRaw := m["deployments"]; hasRaw {
		t.Errorf("analyze_resource_efficiency must NOT return raw 'deployments' key — too large for LLM context")
	}
	if _, hasFindings := m["findings"]; !hasFindings {
		t.Errorf("analyze_resource_efficiency must return 'findings' key, got keys: %v", mapKeysTier1(m))
	}
}

func TestAnalyzeCapacityTrends_ReturnsFindingsNotRawData(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "node-1"},
				"status": map[string]interface{}{
					"capacity":    map[string]interface{}{"cpu": "4", "memory": "8Gi"},
					"allocatable": map[string]interface{}{"cpu": "3800m", "memory": "7Gi"},
					"conditions": []interface{}{
						map[string]interface{}{"type": "Ready", "status": "True"},
					},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_capacity_trends", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, hasRaw := m["nodes"]; hasRaw {
		t.Errorf("analyze_capacity_trends must NOT return raw 'nodes' key — pre-compute node summaries instead")
	}
	if _, hasFinding := m["findings"]; !hasFinding {
		t.Errorf("analyze_capacity_trends must return 'findings' key, got: %v", mapKeysTier1(m))
	}
}

func TestAnalyzePerformanceBottlenecks_ReturnsFindingsNotRawData(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/events?since=30m", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_performance_bottlenecks", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, hasRaw := m["pods"]; hasRaw {
		t.Errorf("analyze_performance_bottlenecks must not return raw pods list")
	}
	if _, hasFinding := m["findings"]; !hasFinding {
		t.Errorf("analyze_performance_bottlenecks must return findings, got: %v", mapKeysTier1(m))
	}
}

func mapKeysTier1(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
