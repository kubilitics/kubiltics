package server

import (
	"context"
	"testing"
)

func TestAnalyzeStatefulSetHealth_DegradedReplicas(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/statefulsets", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "mysql", "namespace": "data"},
				"spec":     map[string]interface{}{"replicas": float64(3)},
				"status":   map[string]interface{}{"replicas": float64(3), "readyReplicas": float64(1)},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_statefulset_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := out.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeJobHealth_FailedJob(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/jobs", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "backup-job", "namespace": "ops"},
				"spec":     map[string]interface{}{"backoffLimit": float64(3)},
				"status":   map[string]interface{}{"failed": float64(3), "active": float64(0)},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_job_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeServiceHealth_NoEndpoints(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/services", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "api-svc", "namespace": "default"},
				"spec":     map[string]interface{}{"selector": map[string]interface{}{"app": "api"}},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/services/default/api-svc/endpoints", map[string]interface{}{
		"subsets": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_service_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeDaemonSetHealth_DegradedCount(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/daemonsets", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "fluentd", "namespace": "kube-system"},
				"status":   map[string]interface{}{"desiredNumberScheduled": float64(3), "numberReady": float64(1)},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_daemonset_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeCronJobHealth_Suspended(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/cronjobs", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "nightly-backup", "namespace": "ops"},
				"spec":     map[string]interface{}{"suspend": true, "schedule": "0 2 * * *"},
				"status":   map[string]interface{}{},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_cronjob_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeIngressHealth_NoBackend(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/ingresses", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "app-ingress", "namespace": "default"},
				"spec": map[string]interface{}{
					"rules": []interface{}{
						map[string]interface{}{
							"host": "app.example.com",
							"http": map[string]interface{}{
								"paths": []interface{}{
									map[string]interface{}{
										"path": "/",
										"backend": map[string]interface{}{
											"service": map[string]interface{}{
												"name": "missing-svc",
												"port": map[string]interface{}{"number": float64(80)},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_ingress_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}

func TestAnalyzeReplicaSetHealth_OrphanedRS(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/replicasets", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      "api-old-rs",
					"namespace": "default",
				},
				"spec":   map[string]interface{}{"replicas": float64(3)},
				"status": map[string]interface{}{"replicas": float64(3), "readyReplicas": float64(3)},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeAnalysisTool(context.Background(), "analyze_replicaset_health", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if clusterID, _ := m["cluster_id"].(string); clusterID == "" {
		t.Errorf("cluster_id must be set")
	}
}
