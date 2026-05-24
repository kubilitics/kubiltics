package server

// handlers_observation_coverage_test.go — systematic coverage tests for the
// observation handler layer.  These tests exercise routeObservationTool (the
// top-level dispatch function) and the key detailed-handler implementations.
// Every test uses fakeBackend / newTestServer so no cluster is needed.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── routeObservationTool — full dispatch coverage ────────────────────────────

// allObserveToolCases is every case in routeObservationTool.
// Calling all of them covers the switch 100%.
var allObserveToolCases = []string{
	// chat aliases
	"list_resources",
	"get_resource",
	"get_logs",
	"get_events",
	"get_cluster_health",
	// observe_* tools
	"observe_cluster_overview",
	"observe_resource",
	"observe_resources_by_query",
	"resolve_resource",
	"observe_recent_changes",
	"observe_pod_metrics",
	"observe_node_metrics",
	"observe_top_pods_by_metric",
	"observe_services_by_filter",
	"observe_secrets_usage",
	"observe_ingresses_by_tls_expiry",
	"observe_pod_logs",
	"observe_pod_detailed",
	"observe_pod_dependencies",
	"observe_resource_links",
	"observe_events",
	"observe_pod_events",
	"observe_pod_logs_filtered",
	"observe_pod_ownership_chain",
	"observe_resource_topology",
	"observe_resource_history",
	"export_topology_to_drawio",
	"observe_metrics",
	"observe_node_detailed",
	"observe_node_events",
	"observe_node_status",
	"observe_namespace_detailed",
	"observe_namespace_events",
	"observe_namespace_overview",
	"observe_workload_health",
	"observe_deployment_rollout_history",
	"observe_deployment_events",
	"observe_deployment_ownership_chain",
	"observe_deployment_detailed",
	"observe_replicaset_detailed",
	"observe_replicaset_events",
	"observe_replicaset_ownership_chain",
	"observe_statefulset_detailed",
	"observe_statefulset_events",
	"observe_statefulset_ownership_chain",
	"observe_daemonset_detailed",
	"observe_daemonset_events",
	"observe_daemonset_ownership_chain",
	"observe_job_detailed",
	"observe_job_events",
	"observe_job_ownership_chain",
	"observe_cronjob_detailed",
	"observe_cronjob_events",
	"observe_cronjob_ownership_chain",
	"observe_service_detailed",
	"observe_service_events",
	"observe_service_endpoints",
	"observe_ingress_detailed",
	"observe_ingress_events",
	"observe_networkpolicy_detailed",
	"observe_networkpolicy_events",
	"observe_network_policies",
	"observe_pvc_detailed",
	"observe_pvc_events",
	"observe_pvc_consumers",
	"observe_pv_detailed",
	"observe_pv_events",
	"observe_storageclass_detailed",
	"observe_storageclass_events",
	"observe_storage_status",
	"observe_serviceaccount_detailed",
	"observe_serviceaccount_permissions",
	"observe_role_detailed",
	"observe_rolebinding_detailed",
	"observe_clusterrole_detailed",
	"observe_clusterrolebinding_detailed",
	"observe_secret_detailed",
	"observe_secret_events",
	"observe_secret_consumers",
	"observe_configmap_detailed",
	"observe_configmap_events",
	"observe_configmap_consumers",
	"observe_limitrange_detailed",
	"observe_limitrange_events",
	"observe_resourcequota_detailed",
	"observe_resourcequota_events",
	"observe_hpa_detailed",
	"observe_hpa_events",
	"observe_pdb_detailed",
	"observe_pdb_events",
	"observe_vpa_detailed",
	"observe_vpa_events",
	"observe_crd_detailed",
	"observe_crd_events",
	// inspect composites
	"inspect_pod",
	"inspect_deployment",
	"inspect_replicaset",
	"inspect_statefulset",
	"inspect_daemonset",
	"inspect_job",
	"inspect_cronjob",
	"inspect_service",
	"inspect_ingress",
	"inspect_configmap",
	"inspect_secret",
	"inspect_networkpolicy",
	"inspect_pvc",
	"inspect_hpa",
	"inspect_vpa",
	"inspect_pdb",
	"inspect_role",
	"inspect_rolebinding",
	"inspect_limitrange",
	"inspect_resourcequota",
	"inspect_node",
	"inspect_namespace",
	"inspect_pv",
	"inspect_storageclass",
	"inspect_clusterrole",
	"inspect_clusterrolebinding",
	"inspect_crd",
	// api / custom resources
	"observe_api_resources",
	"observe_custom_resources",
	// phase-3 observability aggregators
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

// TestRouteObservationTool_AllCases calls every switch case in
// routeObservationTool with a minimal fake backend. The goal is 100% branch
// coverage of the dispatch switch; we don't assert on the returned data
// because the fake backend returns empty JSON for unknown paths.
func TestRouteObservationTool_AllCases(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	// Generic stubs that satisfy the most common fetch patterns.
	fb.register("/clusters/"+testClusterID+"/overview", map[string]interface{}{
		"status": "healthy", "nodes": 3,
	})
	fb.register("/clusters/"+testClusterID+"/pods", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/nodes", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/namespaces", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/deployments", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/services", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/events", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/topology", map[string]interface{}{
		"nodes": []interface{}{}, "edges": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/metrics", map[string]interface{}{})
	fb.register("/clusters/"+testClusterID+"/storage", map[string]interface{}{
		"pvcs": []interface{}{}, "pvs": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/api-resources", map[string]interface{}{
		"resources": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/crds", map[string]interface{}{
		"items": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	ctx := context.Background()

	args := map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
		"kind":       "Pod",
		"name":       "test-pod",
		"name_hint":  "test-pod",
		"regex":      "error",
	}

	for _, toolName := range allObserveToolCases {
		toolName := toolName
		t.Run(toolName, func(t *testing.T) {
			// Must not panic; errors from 404/empty backends are acceptable.
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic in routeObservationTool(%q): %v", toolName, r)
				}
			}()
			_, _ = s.routeObservationTool(ctx, toolName, args)
		})
	}
}

// TestRouteObservationTool_UnknownTool ensures the default branch returns an error.
func TestRouteObservationTool_UnknownTool(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.routeObservationTool(context.Background(), "nonexistent_tool", nil)
	if err == nil {
		t.Fatal("expected error for unknown tool, got nil")
	}
}

// ─── mermaidID ────────────────────────────────────────────────────────────────

func TestMermaidID(t *testing.T) {
	// mermaidID replaces ALL non-alphanumeric chars (including dot, hyphen) with underscore.
	cases := []struct{ in, want string }{
		{"simple", "simple"},
		{"has space", "has_space"},
		{"has-hyphen", "has_hyphen"},
		{"has.dot", "has_dot"},
		{"has/slash", "has_slash"},
		{"UPPER", "UPPER"},
		{"", ""},
		{"a b/c.d", "a_b_c_d"},
	}
	for _, tc := range cases {
		got := mermaidID(tc.in)
		if got != tc.want {
			t.Errorf("mermaidID(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ─── getStr helper ────────────────────────────────────────────────────────────

func TestGetStr(t *testing.T) {
	m := map[string]interface{}{
		"a": "hello",
		"b": 42,
		"c": nil,
	}
	if got := getStr(m, "a"); got != "hello" {
		t.Errorf("getStr(a) = %q, want hello", got)
	}
	if got := getStr(m, "b"); got != "" {
		t.Errorf("getStr(non-string) = %q, want empty", got)
	}
	if got := getStr(m, "c"); got != "" {
		t.Errorf("getStr(nil) = %q, want empty", got)
	}
	if got := getStr(m, "missing"); got != "" {
		t.Errorf("getStr(missing) = %q, want empty", got)
	}
}

// ─── intVal helper ────────────────────────────────────────────────────────────

func TestIntVal(t *testing.T) {
	if got := intVal(float64(5)); got != 5 {
		t.Errorf("intVal(float64 5) = %d, want 5", got)
	}
	if got := intVal(int(3)); got != 3 {
		t.Errorf("intVal(int 3) = %d, want 3", got)
	}
	if got := intVal(nil); got != 0 {
		t.Errorf("intVal(nil) = %d, want 0", got)
	}
	if got := intVal("not a number"); got != 0 {
		t.Errorf("intVal(string) = %d, want 0", got)
	}
}

// ─── kindToRestPlural ─────────────────────────────────────────────────────────

func TestKindToRestPlural(t *testing.T) {
	cases := []struct{ kind, want string }{
		{"Pod", "pods"},
		{"Service", "services"},
		{"Deployment", "deployments"},
		{"StatefulSet", "statefulsets"},
		{"DaemonSet", "daemonsets"},
		{"ReplicaSet", "replicasets"},
		{"Job", "jobs"},
		{"CronJob", "cronjobs"},
		{"Namespace", "namespaces"},
		{"Node", "nodes"},
		{"PersistentVolume", "persistentvolumes"},
		{"PersistentVolumeClaim", "persistentvolumeclaims"},
		{"ConfigMap", "configmaps"},
		{"Secret", "secrets"},
		{"ServiceAccount", "serviceaccounts"},
		{"NetworkPolicy", "networkpolicies"},
		{"Ingress", "ingress"}, // already ends with 's' per default branch logic
		{"HorizontalPodAutoscaler", "horizontalpodautoscalers"},
		{"VerticalPodAutoscaler", "verticalpodautoscalers"},
		{"PodDisruptionBudget", "poddisruptionbudgets"},
		{"ClusterRole", "clusterroles"},
		{"ClusterRoleBinding", "clusterrolebindings"},
		{"Role", "roles"},
		{"RoleBinding", "rolebindings"},
		{"CustomResourceDefinition", "customresourcedefinitions"},
		{"LimitRange", "limitranges"},
		{"ResourceQuota", "resourcequotas"},
		{"StorageClass", "storageclasses"},
		// unknown kind — lower-cased with 's' appended
		{"Widget", "widgets"},
	}
	for _, tc := range cases {
		got := kindToRestPlural(tc.kind)
		if got != tc.want {
			t.Errorf("kindToRestPlural(%q) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}

// ─── handlePodDetailed — rich-response path ───────────────────────────────────

// TestHandlePodDetailed_FullResponse exercises the full pod-detailed handler,
// verifying that the handler returns a structured result without panic and that
// the pod raw object is included in the output.
func TestHandlePodDetailed_FullResponse(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	pod := map[string]interface{}{
		"metadata": map[string]interface{}{
			"name": "web-0", "namespace": "default",
			"labels": map[string]interface{}{"app": "web"},
			"ownerReferences": []interface{}{
				map[string]interface{}{"kind": "ReplicaSet", "name": "web-rs", "apiVersion": "apps/v1"},
			},
		},
		"spec": map[string]interface{}{
			"nodeName":       "node-1",
			"serviceAccount": "default",
			"containers": []interface{}{
				map[string]interface{}{
					"name": "web", "image": "nginx:1.25",
					"resources": map[string]interface{}{
						"requests": map[string]interface{}{"cpu": "100m", "memory": "128Mi"},
						"limits":   map[string]interface{}{"cpu": "500m", "memory": "512Mi"},
					},
					"readinessProbe": map[string]interface{}{"httpGet": map[string]interface{}{"path": "/health"}},
					"livenessProbe":  map[string]interface{}{"httpGet": map[string]interface{}{"path": "/live"}},
				},
			},
			"volumes": []interface{}{
				map[string]interface{}{"name": "data", "persistentVolumeClaim": map[string]interface{}{"claimName": "data-pvc"}},
				map[string]interface{}{"name": "cfg", "configMap": map[string]interface{}{"name": "app-config"}},
				map[string]interface{}{"name": "creds", "secret": map[string]interface{}{"secretName": "app-secret"}},
			},
		},
		"status": map[string]interface{}{
			"phase":  "Running",
			"hostIP": "10.0.0.1",
			"podIP":  "172.16.0.5",
			"conditions": []interface{}{
				map[string]interface{}{"type": "Ready", "status": "True"},
			},
			"containerStatuses": []interface{}{
				map[string]interface{}{
					"name": "web", "ready": true, "restartCount": float64(0),
					"image":   "nginx:1.25",
					"imageID": "sha256:abc",
					"state":   map[string]interface{}{"running": map[string]interface{}{}},
				},
			},
		},
	}

	// handlePodDetailed uses /resources/pods/{ns}/{name}.
	fb.register("/clusters/"+testClusterID+"/resources/pods/default/web-0", pod)
	fb.register("/clusters/"+testClusterID+"/namespaces/default/pods/web-0/logs", map[string]interface{}{
		"logs": "started\n",
	})
	fb.register("/clusters/"+testClusterID+"/metrics/default/web-0", map[string]interface{}{
		"containers": []interface{}{
			map[string]interface{}{"name": "web", "cpuUsage": "50m", "memoryUsage": "64Mi"},
		},
	})
	fb.register("/clusters/"+testClusterID+"/namespaces/default/services", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "web-svc"},
				"spec": map[string]interface{}{
					"selector": map[string]interface{}{"app": "web"},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/namespaces/default/replicasets/web-rs", map[string]interface{}{
		"metadata": map[string]interface{}{
			"name": "web-rs",
			"ownerReferences": []interface{}{
				map[string]interface{}{"kind": "Deployment", "name": "web"},
			},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handlePodDetailed(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
		"name":       "web-0",
	})
	if err != nil {
		t.Fatalf("handlePodDetailed: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map result, got %T", result)
	}
	// handlePodDetailed returns "pod" (raw object), "metadata", "data" — not flat name/phase.
	if m["pod"] == nil {
		t.Error("expected 'pod' key in detailed result")
	}
	if m["data"] == nil {
		t.Error("expected 'data' key in detailed result")
	}
}

// ─── handleNodeDetailed ───────────────────────────────────────────────────────

func TestHandleNodeDetailed_FullResponse(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	node := map[string]interface{}{
		"metadata": map[string]interface{}{
			"name":   "node-1",
			"labels": map[string]interface{}{"kubernetes.io/role": "worker"},
		},
		"spec": map[string]interface{}{
			"unschedulable": false,
			"taints": []interface{}{
				map[string]interface{}{"key": "dedicated", "value": "gpu", "effect": "NoSchedule"},
			},
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{
				map[string]interface{}{"type": "Ready", "status": "True"},
				map[string]interface{}{"type": "MemoryPressure", "status": "False"},
				map[string]interface{}{"type": "DiskPressure", "status": "False"},
			},
			"allocatable": map[string]interface{}{
				"cpu": "4", "memory": "16Gi",
			},
			"capacity": map[string]interface{}{
				"cpu": "4", "memory": "16Gi",
			},
			"addresses": []interface{}{
				map[string]interface{}{"type": "InternalIP", "address": "10.0.0.1"},
			},
			"nodeInfo": map[string]interface{}{
				"kubeletVersion":  "v1.29.0",
				"osImage":         "Ubuntu 22.04",
				"containerRuntimeVersion": "containerd://1.7.0",
			},
		},
	}

	// handleNodeDetailed uses /resources/nodes/-/{name}.
	fb.register("/clusters/"+testClusterID+"/resources/nodes/-/node-1", node)
	fb.register("/clusters/"+testClusterID+"/metrics/nodes/node-1", map[string]interface{}{
		"cpuUsage": "1500m", "memoryUsage": "4Gi",
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleNodeDetailed(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"name":       "node-1",
	})
	if err != nil {
		t.Fatalf("handleNodeDetailed: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleNodeDetailed returns "metadata" key (not flat "name").
	if m["metadata"] == nil {
		t.Error("expected 'metadata' key in node detailed result")
	}
	if m["data"] == nil {
		t.Error("expected 'data' key in node detailed result")
	}
}

// ─── handleDeploymentDetailed ─────────────────────────────────────────────────

func TestHandleDeploymentDetailed_FullResponse(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	deploy := map[string]interface{}{
		"metadata": map[string]interface{}{
			"name": "web", "namespace": "default",
			"annotations": map[string]interface{}{
				"deployment.kubernetes.io/revision": "3",
			},
		},
		"spec": map[string]interface{}{
			"replicas": float64(3),
			"selector": map[string]interface{}{
				"matchLabels": map[string]interface{}{"app": "web"},
			},
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{
							"name":  "web",
							"image": "nginx:1.25",
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{"cpu": "100m"},
								"limits":   map[string]interface{}{"cpu": "500m"},
							},
						},
					},
				},
			},
		},
		"status": map[string]interface{}{
			"replicas":            float64(3),
			"readyReplicas":       float64(3),
			"availableReplicas":   float64(3),
			"updatedReplicas":     float64(3),
			"observedGeneration":  float64(3),
			"conditions": []interface{}{
				map[string]interface{}{"type": "Available", "status": "True"},
				map[string]interface{}{"type": "Progressing", "status": "True"},
			},
		},
	}

	// handleDeploymentDetailed uses /resources/deployments/{ns}/{name}.
	fb.register("/clusters/"+testClusterID+"/resources/deployments/default/web", deploy)
	fb.register("/clusters/"+testClusterID+"/resources/replicasets", map[string]interface{}{
		"items": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleDeploymentDetailed(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
		"name":       "web",
	})
	if err != nil {
		t.Fatalf("handleDeploymentDetailed: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleDeploymentDetailed returns "deployment" (the name) not top-level "name".
	if m["deployment"] != "web" {
		t.Errorf("deployment = %v, want web", m["deployment"])
	}
}

// ─── handleExportTopologyToDrawio — Mermaid fallback path ─────────────────────

func TestHandleExportTopologyToDrawio_MermaidFallback(t *testing.T) {
	// Use an exact-match backend so that the draw.io path ("/topology/export/drawio")
	// returns 404 but the topology path ("/topology") returns data.
	// fakeBackend uses prefix matching, which would cause "/topology" to match the
	// draw.io export URL — so we need a custom httptest.Server here.
	marshalJSON := func(v interface{}) []byte {
		b, _ := json.Marshal(v)
		return b
	}

	customSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		w.Header().Set("Content-Type", "application/json")
		switch path {
		case "/clusters":
			_, _ = w.Write(marshalJSON([]map[string]interface{}{
				{"id": testClusterID, "name": "test-cluster"},
			}))
		case "/clusters/" + testClusterID + "/topology":
			_, _ = w.Write(marshalJSON(map[string]interface{}{
				"nodes": []interface{}{
					map[string]interface{}{"id": "pod/default/web-0", "kind": "Pod", "name": "web-0"},
					map[string]interface{}{"id": "svc/default/web-svc", "kind": "Service", "name": "web-svc"},
				},
				"edges": []interface{}{
					map[string]interface{}{"source": "pod/default/web-0", "target": "svc/default/web-svc"},
				},
			}))
		default:
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		}
	}))
	t.Cleanup(customSrv.Close)

	s := newTestServer(t, customSrv.URL)
	result, err := s.handleExportTopologyToDrawio(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
	})
	if err != nil {
		t.Fatalf("handleExportTopologyToDrawio: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map result, got %T", result)
	}
	// The fallback path returns "mermaid" key (the diagram string) and "data_source".
	mermaid, _ := m["mermaid"].(string)
	if mermaid == "" {
		t.Error("expected non-empty 'mermaid' key in fallback result")
	}
	if m["data_source"] != "topology_api_synthesized" {
		t.Errorf("data_source = %v, want topology_api_synthesized", m["data_source"])
	}
}

// ─── handleNamespaceOverview ──────────────────────────────────────────────────

func TestHandleNamespaceOverview(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	// handleNamespaceOverview hits /resources/namespaces (returns a map).
	fb.register("/clusters/"+testClusterID+"/resources/namespaces", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{"metadata": map[string]interface{}{"name": "default"}},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleNamespaceOverview(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
	})
	if err != nil {
		t.Fatalf("handleNamespaceOverview: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

// ─── handleServiceDetailed ────────────────────────────────────────────────────

func TestHandleServiceDetailed_ClusterIP(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	svc := map[string]interface{}{
		"metadata": map[string]interface{}{"name": "web-svc", "namespace": "default"},
		"spec": map[string]interface{}{
			"type":      "ClusterIP",
			"clusterIP": "10.96.0.10",
			"ports": []interface{}{
				map[string]interface{}{"port": float64(80), "targetPort": "http", "protocol": "TCP"},
			},
			"selector": map[string]interface{}{"app": "web"},
		},
		"status": map[string]interface{}{},
	}

	// handleServiceDetailed uses /resources/services/{ns}/{name}.
	fb.register("/clusters/"+testClusterID+"/resources/services/default/web-svc", svc)
	fb.register("/clusters/"+testClusterID+"/resources/services/default/web-svc/endpoints", map[string]interface{}{
		"subsets": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/resources/services/default/pods", map[string]interface{}{
		"items": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleServiceDetailed(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
		"name":       "web-svc",
	})
	if err != nil {
		t.Fatalf("handleServiceDetailed: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleServiceDetailed returns "service" (the name) not a top-level "name".
	if m["service"] != "web-svc" {
		t.Errorf("service = %v, want web-svc", m["service"])
	}
}

// ─── handleWorkloadHealth ─────────────────────────────────────────────────────

func TestHandleWorkloadHealth_AllWorkloadTypes(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	makeDeploy := func(name string, ready, total float64) interface{} {
		return map[string]interface{}{
			"metadata": map[string]interface{}{"name": name, "namespace": "default"},
			"spec":     map[string]interface{}{"replicas": total},
			"status":   map[string]interface{}{"readyReplicas": ready, "replicas": total},
		}
	}

	// handleWorkloadHealth uses /resources/{kind}?namespace=...
	fb.register("/clusters/"+testClusterID+"/resources/deployments", map[string]interface{}{
		"items": []interface{}{
			makeDeploy("web", 3, 3),
			makeDeploy("api", 1, 3),
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/statefulsets", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/resources/daemonsets", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/resources/replicasets", map[string]interface{}{
		"items": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleWorkloadHealth(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
	})
	if err != nil {
		t.Fatalf("handleWorkloadHealth: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleWorkloadHealth returns a map keyed by workload type; no top-level "namespace".
	if _, hasDeploys := m["deployments"]; !hasDeploys {
		t.Error("expected 'deployments' key in workload health result")
	}
}

// ─── handlePodLogs ────────────────────────────────────────────────────────────

func TestHandlePodLogs_WithContainer(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	fb.register("/clusters/"+testClusterID+"/namespaces/default/pods/web-0/logs", map[string]interface{}{
		"logs": "2026-05-24 INFO server started\n",
	})

	s := newTestServer(t, fb.server.URL)
	// handlePodLogs requires 'pod_name' not 'name'.
	result, err := s.handlePodLogs(context.Background(), map[string]interface{}{
		"cluster_id":     testClusterID,
		"namespace":      "default",
		"pod_name":       "web-0",
		"container_name": "web",
		"tail_lines":     float64(50),
	})
	if err != nil {
		t.Fatalf("handlePodLogs: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

// ─── handleMetrics ────────────────────────────────────────────────────────────

func TestHandleMetrics_NodeScope(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	fb.register("/clusters/"+testClusterID+"/metrics/nodes/node-1", map[string]interface{}{
		"cpuUsage": "500m", "memoryUsage": "2Gi",
	})

	s := newTestServer(t, fb.server.URL)
	// handleMetrics requires kind+name; for node it doesn't need namespace.
	result, err := s.handleMetrics(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"kind":       "node",
		"name":       "node-1",
	})
	if err != nil {
		t.Fatalf("handleMetrics: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

// ─── handleResourceHistory ────────────────────────────────────────────────────

func TestHandleResourceHistory(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	fb.register("/clusters/"+testClusterID+"/namespaces/default/deployments/web/history", map[string]interface{}{
		"events": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	// Errors are acceptable (404 from fake backend); no panic is the contract.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("handleResourceHistory panicked: %v", r)
		}
	}()
	_, _ = s.handleResourceHistory(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"namespace":  "default",
		"kind":       "Deployment",
		"name":       "web",
	})
}

// ─── handleCRDDetailed ────────────────────────────────────────────────────────

func TestHandleCRDDetailed(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	fb.register("/clusters/"+testClusterID+"/resources/customresourcedefinitions/-/widgets.example.com", map[string]interface{}{
		"metadata": map[string]interface{}{"name": "widgets.example.com"},
		"spec": map[string]interface{}{
			"group":   "example.com",
			"names":   map[string]interface{}{"plural": "widgets", "kind": "Widget"},
			"scope":   "Namespaced",
			"versions": []interface{}{map[string]interface{}{"name": "v1", "served": true, "storage": true}},
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{
				map[string]interface{}{"type": "Established", "status": "True"},
			},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleCRDDetailed(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
		"name":       "widgets.example.com",
	})
	if err != nil {
		t.Fatalf("handleCRDDetailed: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleCRDDetailed returns "metadata" key, not a top-level "name".
	if m["metadata"] == nil {
		t.Error("expected non-nil 'metadata' in CRD detailed result")
	}
}

// ─── handleAPIResources and handleCustomResources ─────────────────────────────

func TestHandleAPIResources(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// handleAPIResources hits /capabilities (no cluster ID needed).
	fb.register("/capabilities", map[string]interface{}{
		"resources": []interface{}{
			map[string]interface{}{"name": "pods", "kind": "Pod", "namespaced": true},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleAPIResources(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
	})
	if err != nil {
		t.Fatalf("handleAPIResources: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestHandleCustomResources(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// handleCustomResources hits /clusters/{id}/resources/customresourcedefinitions.
	fb.register("/clusters/"+testClusterID+"/resources/customresourcedefinitions", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "widgets.example.com"},
				"spec":     map[string]interface{}{"group": "example.com"},
			},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleCustomResources(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
	})
	if err != nil {
		t.Fatalf("handleCustomResources: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

// ─── extractContainerStatuses helper ─────────────────────────────────────────

func TestExtractContainerStatuses(t *testing.T) {
	s := newTestServer(t, "http://unused")

	status := map[string]interface{}{
		"containerStatuses": []interface{}{
			map[string]interface{}{
				"name":         "web",
				"ready":        true,
				"restartCount": float64(2),
				"image":        "nginx:1.25",
				"imageID":      "sha256:abc",
				"state":        map[string]interface{}{"running": map[string]interface{}{}},
				"lastState": map[string]interface{}{
					"terminated": map[string]interface{}{"reason": "OOMKilled"},
				},
			},
		},
	}
	spec := map[string]interface{}{
		"containers": []interface{}{
			map[string]interface{}{"name": "web", "image": "nginx:1.25"},
		},
	}

	statuses := s.extractContainerStatuses(status, spec, false)
	if len(statuses) != 1 {
		t.Fatalf("expected 1 container status, got %d", len(statuses))
	}
	cs := statuses[0]
	if cs["name"] != "web" {
		t.Errorf("name = %v, want web", cs["name"])
	}
	if cs["restart_count"] != 2 {
		t.Errorf("restart_count = %v, want 2", cs["restart_count"])
	}
	if cs["last_termination_reason"] != "OOMKilled" {
		t.Errorf("last_termination_reason = %v, want OOMKilled", cs["last_termination_reason"])
	}
}

// ─── extractPodSecurityContext ────────────────────────────────────────────────

func TestExtractPodSecurityContext(t *testing.T) {
	s := newTestServer(t, "http://unused")

	spec := map[string]interface{}{
		"securityContext": map[string]interface{}{
			"runAsNonRoot": true,
			"runAsUser":    float64(1000),
		},
		"containers": []interface{}{
			map[string]interface{}{
				"name": "web",
				"securityContext": map[string]interface{}{
					"privileged":               false,
					"allowPrivilegeEscalation": false,
					"readOnlyRootFilesystem":   true,
					"capabilities": map[string]interface{}{
						"drop": []interface{}{"ALL"},
					},
				},
			},
		},
	}

	ctx := s.extractPodSecurityContext(spec)
	if ctx == nil {
		t.Fatal("expected non-nil security context")
	}
}

// ─── summarizeDependencies ────────────────────────────────────────────────────

func TestSummarizeDependencies(t *testing.T) {
	s := newTestServer(t, "http://unused")

	spec := map[string]interface{}{
		"volumes": []interface{}{
			map[string]interface{}{"name": "data", "persistentVolumeClaim": map[string]interface{}{"claimName": "pvc-1"}},
			map[string]interface{}{"name": "cfg", "configMap": map[string]interface{}{"name": "cfg-1"}},
			map[string]interface{}{"name": "creds", "secret": map[string]interface{}{"secretName": "secret-1"}},
		},
		"containers": []interface{}{
			map[string]interface{}{
				"name": "web",
				"envFrom": []interface{}{
					map[string]interface{}{"configMapRef": map[string]interface{}{"name": "env-cfg"}},
					map[string]interface{}{"secretRef": map[string]interface{}{"name": "env-secret"}},
				},
			},
		},
	}

	deps := s.summarizeDependencies(spec)
	if deps["pvcs"] == 0 {
		t.Error("expected pvcs > 0")
	}
	if deps["config_maps"] == 0 {
		t.Error("expected config_maps > 0")
	}
	if deps["secrets"] == 0 {
		t.Error("expected secrets > 0")
	}
}

// ─── normalizePodMetrics ──────────────────────────────────────────────────────

func TestNormalizePodMetrics(t *testing.T) {
	s := newTestServer(t, "http://unused")

	metrics := map[string]interface{}{
		"containers": []interface{}{
			map[string]interface{}{
				"name":        "web",
				"cpuUsage":    "250m",
				"memoryUsage": "128Mi",
			},
		},
	}

	result := s.normalizePodMetrics(metrics)
	if result == nil {
		t.Fatal("expected non-nil metrics result")
	}
	if result["metrics_available"] != true {
		t.Errorf("metrics_available = %v, want true", result["metrics_available"])
	}
}

func TestNormalizePodMetrics_NoData(t *testing.T) {
	s := newTestServer(t, "http://unused")
	result := s.normalizePodMetrics(nil)
	if result["metrics_available"] != false {
		t.Errorf("metrics_available = %v, want false for nil input", result["metrics_available"])
	}
}

// ─── handleStorageStatus ──────────────────────────────────────────────────────

func TestHandleStorageStatus(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumeclaims", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "data-pvc", "namespace": "default"},
				"spec":     map[string]interface{}{"storageClassName": "fast"},
				"status":   map[string]interface{}{"phase": "Bound"},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/persistentvolumes", map[string]interface{}{
		"items": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/resources/storageclasses", map[string]interface{}{
		"items": []interface{}{},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleStorageStatus(context.Background(), map[string]interface{}{
		"cluster_id": testClusterID,
	})
	if err != nil {
		t.Fatalf("handleStorageStatus: %v", err)
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	// handleStorageStatus stores what it fetched under "pvcs" key.
	if _, hasPVCs := m["pvcs"]; !hasPVCs {
		t.Error("expected 'pvcs' key in storage status result")
	}
}
