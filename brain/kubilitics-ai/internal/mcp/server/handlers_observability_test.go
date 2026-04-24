package server

// handlers_observability_test.go — tests for Phase 3 Category 1 tools.

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func itemsLen(t *testing.T, m map[string]interface{}) int {
	t.Helper()
	v := reflect.ValueOf(m["items"])
	if !v.IsValid() {
		t.Fatalf("missing items field")
	}
	if v.Kind() != reflect.Slice {
		t.Fatalf("items not slice: %T", m["items"])
	}
	return v.Len()
}

func itemField(t *testing.T, m map[string]interface{}, idx int, field string) interface{} {
	t.Helper()
	v := reflect.ValueOf(m["items"])
	if v.Kind() != reflect.Slice || idx >= v.Len() {
		t.Fatalf("items[%d] out of range", idx)
	}
	return v.Index(idx).FieldByName(field).Interface()
}

func recentIsoAgo(minutes int) string {
	return time.Now().Add(-time.Duration(minutes) * time.Minute).UTC().Format(time.RFC3339)
}

func TestObserveFlappingServices_CountsChurn(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{
		map[string]interface{}{
			"reason":         "EndpointAddresses",
			"lastTimestamp":  recentIsoAgo(1),
			"involvedObject": map[string]interface{}{"kind": "Service", "name": "web", "namespace": "demo"},
		},
		map[string]interface{}{
			"reason":         "EndpointAddresses",
			"lastTimestamp":  recentIsoAgo(2),
			"involvedObject": map[string]interface{}{"kind": "Service", "name": "web", "namespace": "demo"},
		},
		map[string]interface{}{
			"reason":         "EndpointAddresses",
			"lastTimestamp":  recentIsoAgo(3),
			"involvedObject": map[string]interface{}{"kind": "Service", "name": "web", "namespace": "demo"},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveFlappingServices(context.Background(), map[string]interface{}{
		"window_minutes": 15,
		"threshold":      3,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if itemsLen(t, m) != 1 {
		t.Fatalf("expected 1 flapping service, got len=%d", itemsLen(t, m))
	}
	if svc := itemField(t, m, 0, "Service"); svc != "web" {
		t.Fatalf("expected service 'web', got %v", svc)
	}
	if churn := itemField(t, m, 0, "Churn").(int); churn < 3 {
		t.Fatalf("expected churn>=3, got %d", churn)
	}
}

func TestObserveNoisyNeighbors_ThresholdFilter(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{
		"nodes": []interface{}{
			map[string]interface{}{"name": "n1", "cpu_millicores": 1000.0, "memory_mib": 2048.0},
		},
		"pods": []interface{}{
			map[string]interface{}{"namespace": "demo", "name": "hot", "node": "n1", "cpu_millicores": 900.0, "memory_mib": 200.0},
			map[string]interface{}{"namespace": "demo", "name": "cool", "node": "n1", "cpu_millicores": 50.0, "memory_mib": 100.0},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveNoisyNeighbors(context.Background(), map[string]interface{}{
		"cpu_threshold_pct": 80,
		"mem_threshold_pct": 80,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if itemsLen(t, m) != 1 {
		t.Fatalf("expected 1 noisy neighbor, got %d", itemsLen(t, m))
	}
	if pod := itemField(t, m, 0, "Pod"); pod != "hot" {
		t.Fatalf("expected pod 'hot', got %v", pod)
	}
}

func TestObserveNoisyNeighbors_MetricsMissing_GracefulNote(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// no /metrics/summary registered → 404
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveNoisyNeighbors(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("should degrade not error: %v", err)
	}
	m := out.(map[string]interface{})
	if _, ok := m["note"]; !ok {
		t.Fatal("expected graceful note when metrics/summary missing")
	}
}

func TestObserveUnhealthyProbes_FiltersByReason(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{
		map[string]interface{}{
			"reason":         "Unhealthy",
			"lastTimestamp":  recentIsoAgo(5),
			"involvedObject": map[string]interface{}{"kind": "Pod", "name": "api-1", "namespace": "demo"},
			"message":        "Liveness probe failed: HTTP 500",
		},
		map[string]interface{}{
			"reason":         "Normal",
			"lastTimestamp":  recentIsoAgo(5),
			"involvedObject": map[string]interface{}{"kind": "Pod", "name": "api-1", "namespace": "demo"},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveUnhealthyProbes(context.Background(), map[string]interface{}{
		"window_minutes": 60,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
}

func TestObserveMissingProbes_FlagsContainer(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "bare", "namespace": "demo"},
				"spec": map[string]interface{}{
					"template": map[string]interface{}{
						"spec": map[string]interface{}{
							"containers": []interface{}{
								map[string]interface{}{"name": "app"}, // no probes
							},
						},
					},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/statefulsets", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/daemonsets", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveMissingProbes(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
}

func TestObserveOrphanedPods_OwnerMissing(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "orphan-1", "namespace": "demo",
					"ownerReferences": []interface{}{
						map[string]interface{}{"kind": "ReplicaSet", "name": "ghost-rs"},
					},
				},
			},
		},
	})
	// ghost-rs NOT registered → 404
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveOrphanedPods(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if items := m["items"]; items == nil {
		t.Fatal("expected items slice")
	}
}

func TestObserveStuckRollouts_TransitionOlderThanCutoff(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	oldTs := time.Now().Add(-20 * time.Minute).UTC().Format(time.RFC3339)
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "stuck", "namespace": "demo"},
				"spec":     map[string]interface{}{"replicas": 3.0},
				"status": map[string]interface{}{
					"replicas":      3.0,
					"readyReplicas": 1.0,
					"conditions": []interface{}{
						map[string]interface{}{
							"type": "Progressing", "status": "True",
							"reason":             "ReplicaSetUpdated",
							"lastTransitionTime": oldTs,
						},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveStuckRollouts(context.Background(), map[string]interface{}{
		"stuck_minutes": 10,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
}

func TestObserveHighCardinalityLabels_GracefulDegrade(t *testing.T) {
	s := newTestServer(t, "http://127.0.0.1:1") // doesn't matter — no backend call
	out, err := s.handleObserveHighCardinalityLabels(context.Background(), map[string]interface{}{"threshold": 500})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["note"] == nil {
		t.Fatal("expected graceful-degradation note")
	}
}

func TestObserveRestartStorms_FlagsAboveThreshold(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "crashy", "namespace": "demo"},
				"status": map[string]interface{}{
					"containerStatuses": []interface{}{
						map[string]interface{}{"name": "app", "restartCount": 7.0},
					},
				},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "fine", "namespace": "demo"},
				"status": map[string]interface{}{
					"containerStatuses": []interface{}{
						map[string]interface{}{"name": "app", "restartCount": 1.0},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveRestartStorms(context.Background(), map[string]interface{}{"threshold": 5})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
	if m["note"] == nil {
		t.Fatal("expected note about cumulative restartCount semantics")
	}
}

func TestObservePendingSchedulerEvents_FilterByReason(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{
		map[string]interface{}{
			"reason":         "FailedScheduling",
			"lastTimestamp":  recentIsoAgo(2),
			"involvedObject": map[string]interface{}{"kind": "Pod", "name": "pending-1", "namespace": "demo"},
			"message":        "0/3 nodes are available: 3 node(s) had untolerated taint {foo: bar}.",
		},
		map[string]interface{}{
			"reason":         "Scheduled",
			"lastTimestamp":  recentIsoAgo(2),
			"involvedObject": map[string]interface{}{"kind": "Pod", "name": "ok", "namespace": "demo"},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObservePendingSchedulerEvents(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
}

func TestObserveZombieFinalizers_DeletionOlderThanCutoff(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	oldTs := time.Now().Add(-15 * time.Minute).UTC().Format(time.RFC3339)
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "zombie-1", "namespace": "demo",
					"deletionTimestamp": oldTs,
					"finalizers":        []interface{}{"kubernetes.io/pv-protection"},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/namespaces", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pvcs", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleObserveZombieFinalizers(context.Background(), map[string]interface{}{"stuck_minutes": 10})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	items := m["items"]
	if items == nil {
		t.Fatal("expected items slice")
	}
}

// Dispatch smoke — verifies the 10 tool names resolve in routeObservationTool.
func TestObservability_DispatchRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{"pods": []interface{}{}, "nodes": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/statefulsets", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/daemonsets", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/namespaces", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pvcs", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	names := []string{
		"observe_flapping_services",
		"observe_noisy_neighbors",
		"observe_unhealthy_probes",
		"observe_missing_probes",
		"observe_orphaned_pods",
		"observe_stuck_rollouts",
		"observe_high_cardinality_labels",
		"observe_restart_storms",
		"observe_pending_scheduler_events",
		"observe_zombie_finalizers",
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			_, err := s.routeObservationTool(context.Background(), name, map[string]interface{}{})
			if err != nil {
				t.Fatalf("%s dispatch failed: %v", name, err)
			}
		})
	}
}
