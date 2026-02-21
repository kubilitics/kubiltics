package analysis_test

// Comprehensive tests for all 12 deep-analysis tools (A-CORE-003).
//
// Strategy: inject a fakeProxy that satisfies BackendProxy and returns
// deterministic proto resources built from JSON.  Tests exercise:
//   - Happy paths: correct data extraction and result shape
//   - Edge cases: empty results, optional filters (Name, ServiceAccountName)
//   - Error paths: missing required args, proxy errors
//   - HandlerMap: all 12 names present and callable

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/mcp/tools/analysis"
)

// ─────────────────────────────────────────────────────────────
// fakeProxy — deterministic in-memory backend for tests
// ─────────────────────────────────────────────────────────────

type fakeProxy struct {
	resources map[string][]*pb.Resource // keyed "kind/namespace"
	getResult *pb.Resource
	getErr    error
	listErr   error
	cmdResult *pb.CommandResult
	cmdErr    error
}

func (f *fakeProxy) ListResources(_ context.Context, kind, namespace string) ([]*pb.Resource, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	key := kind + "/" + namespace
	if res, ok := f.resources[key]; ok {
		return res, nil
	}
	return []*pb.Resource{}, nil
}

func (f *fakeProxy) GetResource(_ context.Context, kind, namespace, name string) (*pb.Resource, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.getResult != nil {
		return f.getResult, nil
	}
	key := kind + "/" + namespace
	for _, r := range f.resources[key] {
		if r.Name == name {
			return r, nil
		}
	}
	return nil, fmt.Errorf("resource not found: %s/%s/%s", kind, namespace, name)
}

func (f *fakeProxy) ExecuteCommand(_ context.Context, _ string, _ *pb.Resource, _ []byte, _ bool) (*pb.CommandResult, error) {
	if f.cmdErr != nil {
		return nil, f.cmdErr
	}
	if f.cmdResult != nil {
		return f.cmdResult, nil
	}
	return &pb.CommandResult{Message: "line1\nerror: something failed\nwarn: deprecated\n"}, nil
}

// ─────────────────────────────────────────────────────────────
// helpers — build pb.Resource from JSON
// ─────────────────────────────────────────────────────────────

func makeResource(kind, namespace, name string, data map[string]interface{}) *pb.Resource {
	raw, _ := json.Marshal(data)
	return &pb.Resource{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Data:      raw,
	}
}

func newFakeProxy() *fakeProxy {
	return &fakeProxy{resources: make(map[string][]*pb.Resource)}
}

func (f *fakeProxy) add(kind, namespace string, resources ...*pb.Resource) {
	key := kind + "/" + namespace
	f.resources[key] = append(f.resources[key], resources...)
}

// ─────────────────────────────────────────────────────────────
// HandlerMap completeness
// ─────────────────────────────────────────────────────────────

func TestHandlerMapCompleteness(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	handlers := at.HandlerMap()

	expected := []string{
		"analyze_pod_health",
		"analyze_deployment_health",
		"analyze_node_pressure",
		"detect_resource_contention",
		"analyze_network_connectivity",
		"analyze_rbac_permissions",
		"analyze_storage_health",
		"check_resource_limits",
		"analyze_hpa_behavior",
		"analyze_log_patterns",
		"assess_security_posture",
		"detect_configuration_drift",
	}

	if len(handlers) != len(expected) {
		t.Errorf("expected %d handlers, got %d", len(expected), len(handlers))
	}

	for _, name := range expected {
		if _, ok := handlers[name]; !ok {
			t.Errorf("handler %q missing from HandlerMap", name)
		}
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_pod_health
// ─────────────────────────────────────────────────────────────

func TestAnalyzePodHealth_HealthyPod(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "default",
		makeResource("Pod", "default", "pod-ok", map[string]interface{}{
			"status": map[string]interface{}{
				"phase": "Running",
				"containerStatuses": []interface{}{
					map[string]interface{}{
						"name":         "app",
						"restartCount": 0,
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzePodHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["total_pods"].(int) != 1 {
		t.Errorf("expected 1 pod, got %v", m["total_pods"])
	}
	if m["healthy"].(int) != 1 {
		t.Errorf("expected 1 healthy, got %v", m["healthy"])
	}
	if m["issue_count"].(int) != 0 {
		t.Errorf("expected 0 issues, got %v", m["issue_count"])
	}
}

func TestAnalyzePodHealth_OOMKilledPod(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "default",
		makeResource("Pod", "default", "pod-oom", map[string]interface{}{
			"status": map[string]interface{}{
				"phase": "Running",
				"containerStatuses": []interface{}{
					map[string]interface{}{
						"name":         "app",
						"restartCount": 25,
						"lastState": map[string]interface{}{
							"terminated": map[string]interface{}{
								"reason": "OOMKilled",
							},
						},
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzePodHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	// Should detect both OOMKilled and high restart count
	if m["issue_count"].(int) < 1 {
		t.Errorf("expected issues for OOM/restart loop, got %v", m["issue_count"])
	}
}

func TestAnalyzePodHealth_NameFilter(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "default",
		makeResource("Pod", "default", "pod-a", map[string]interface{}{"status": map[string]interface{}{"phase": "Running"}}),
		makeResource("Pod", "default", "pod-b", map[string]interface{}{"status": map[string]interface{}{"phase": "Pending"}}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzePodHealth(context.Background(), map[string]interface{}{"namespace": "default", "name": "pod-a"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["total_pods"].(int) != 1 {
		t.Errorf("name filter should return 1 pod, got %v", m["total_pods"])
	}
}

func TestAnalyzePodHealth_MissingNamespace(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.AnalyzePodHealth(context.Background(), map[string]interface{}{})
	// Should succeed with empty namespace (returns all-namespace pods)
	if err != nil {
		t.Logf("got error for empty namespace (acceptable): %v", err)
	}
}

func TestAnalyzePodHealth_ProxyError(t *testing.T) {
	fp := newFakeProxy()
	fp.listErr = fmt.Errorf("grpc connection refused")
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.AnalyzePodHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err == nil {
		t.Error("expected error from proxy failure")
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_deployment_health
// ─────────────────────────────────────────────────────────────

func TestAnalyzeDeploymentHealth_DegradedDeployment(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Deployment", "default",
		makeResource("Deployment", "default", "api-server", map[string]interface{}{
			"spec": map[string]interface{}{"replicas": 3},
			"status": map[string]interface{}{
				"readyReplicas":       1,
				"unavailableReplicas": 2,
				"conditions": []interface{}{
					map[string]interface{}{
						"type":    "Available",
						"status":  "False",
						"message": "Deployment does not have minimum availability",
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeDeploymentHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	deployments := m["deployments"].([]map[string]interface{})
	if len(deployments) != 1 {
		t.Fatalf("expected 1 deployment, got %d", len(deployments))
	}
	if deployments[0]["health"] != "Degraded" {
		t.Errorf("expected Degraded health, got %v", deployments[0]["health"])
	}
}

func TestAnalyzeDeploymentHealth_CriticalDeployment(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Deployment", "prod",
		makeResource("Deployment", "prod", "frontend", map[string]interface{}{
			"spec": map[string]interface{}{"replicas": 3},
			"status": map[string]interface{}{
				"readyReplicas":       0,
				"unavailableReplicas": 3,
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeDeploymentHealth(context.Background(), map[string]interface{}{"namespace": "prod"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	deployments := m["deployments"].([]map[string]interface{})
	if deployments[0]["health"] != "Critical" {
		t.Errorf("expected Critical health, got %v", deployments[0]["health"])
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_node_pressure
// ─────────────────────────────────────────────────────────────

func TestAnalyzeNodePressure_PressureDetected(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Node", "",
		makeResource("Node", "", "node-1", map[string]interface{}{
			"status": map[string]interface{}{
				"conditions": []interface{}{
					map[string]interface{}{"type": "MemoryPressure", "status": "True"},
					map[string]interface{}{"type": "DiskPressure", "status": "False"},
					map[string]interface{}{"type": "PIDPressure", "status": "False"},
				},
			},
		}),
		makeResource("Node", "", "node-2", map[string]interface{}{
			"status": map[string]interface{}{
				"conditions": []interface{}{
					map[string]interface{}{"type": "MemoryPressure", "status": "False"},
					map[string]interface{}{"type": "DiskPressure", "status": "False"},
					map[string]interface{}{"type": "PIDPressure", "status": "False"},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeNodePressure(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["total_nodes"].(int) != 2 {
		t.Errorf("expected 2 nodes, got %v", m["total_nodes"])
	}
	if m["nodes_under_pressure"].(int) != 1 {
		t.Errorf("expected 1 node under pressure, got %v", m["nodes_under_pressure"])
	}
}

// ─────────────────────────────────────────────────────────────
// detect_resource_contention
// ─────────────────────────────────────────────────────────────

func TestDetectResourceContention_MissingLimits(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "default",
		makeResource("Pod", "default", "pod-nolimits", map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "app"}, // no resources
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.DetectResourceContention(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["pods_missing_limits"].(int) < 1 {
		t.Errorf("expected containers missing limits, got %v", m["pods_missing_limits"])
	}
}

func TestDetectResourceContention_MissingNamespace(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.DetectResourceContention(context.Background(), map[string]interface{}{})
	// Empty namespace is valid (all namespaces)
	if err != nil {
		t.Logf("detect_resource_contention with empty namespace: %v", err)
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_network_connectivity
// ─────────────────────────────────────────────────────────────

func TestAnalyzeNetworkConnectivity_ServiceNoEndpoints(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Service", "default",
		makeResource("Service", "default", "my-svc", map[string]interface{}{}),
	)
	// Endpoints for my-svc with no ready addresses
	fp.add("Endpoints", "default",
		makeResource("Endpoints", "default", "my-svc", map[string]interface{}{
			"subsets": []interface{}{
				map[string]interface{}{"addresses": []interface{}{}},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeNetworkConnectivity(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	services := m["services"].([]map[string]interface{})
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0]["status"] != "NO_ENDPOINTS" {
		t.Errorf("expected NO_ENDPOINTS, got %v", services[0]["status"])
	}
}

func TestAnalyzeNetworkConnectivity_ServiceWithEndpoints(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Service", "default",
		makeResource("Service", "default", "api", map[string]interface{}{}),
	)
	fp.add("Endpoints", "default",
		makeResource("Endpoints", "default", "api", map[string]interface{}{
			"subsets": []interface{}{
				map[string]interface{}{
					"addresses": []interface{}{
						map[string]interface{}{"ip": "10.0.0.1"},
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeNetworkConnectivity(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	services := m["services"].([]map[string]interface{})
	if services[0]["status"] != "OK" {
		t.Errorf("expected OK, got %v", services[0]["status"])
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_rbac_permissions
// ─────────────────────────────────────────────────────────────

func TestAnalyzeRBACPermissions_OverprivilegedAccount(t *testing.T) {
	fp := newFakeProxy()
	fp.add("RoleBinding", "default",
		makeResource("RoleBinding", "default", "admin-binding", map[string]interface{}{
			"roleRef": map[string]interface{}{
				"kind": "ClusterRole",
				"name": "cluster-admin",
			},
			"subjects": []interface{}{
				map[string]interface{}{
					"kind":      "ServiceAccount",
					"name":      "default",
					"namespace": "default",
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeRBACPermissions(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["overprivileged_accounts"].(int) < 1 {
		t.Errorf("expected overprivileged accounts, got %v", m["overprivileged_accounts"])
	}
	if m["risk_level"] == "LOW" {
		t.Errorf("expected non-LOW risk level, got %v", m["risk_level"])
	}
}

func TestAnalyzeRBACPermissions_SAFilter(t *testing.T) {
	fp := newFakeProxy()
	fp.add("RoleBinding", "default",
		makeResource("RoleBinding", "default", "admin-binding", map[string]interface{}{
			"roleRef": map[string]interface{}{"kind": "ClusterRole", "name": "cluster-admin"},
			"subjects": []interface{}{
				map[string]interface{}{"kind": "ServiceAccount", "name": "danger-sa", "namespace": "default"},
				map[string]interface{}{"kind": "ServiceAccount", "name": "safe-sa", "namespace": "default"},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	// Filter to only safe-sa — still has cluster-admin, should still be flagged
	result, err := at.AnalyzeRBACPermissions(context.Background(), map[string]interface{}{
		"namespace":            "default",
		"service_account_name": "safe-sa",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	findings := m["findings"].([]map[string]interface{})
	for _, f := range findings {
		if f["service_account"] != "safe-sa" {
			t.Errorf("SA filter failed: got binding for %v, want safe-sa", f["service_account"])
		}
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_storage_health
// ─────────────────────────────────────────────────────────────

func TestAnalyzeStorageHealth_UnboundPVC(t *testing.T) {
	fp := newFakeProxy()
	fp.add("PersistentVolumeClaim", "default",
		makeResource("PersistentVolumeClaim", "default", "data-pvc", map[string]interface{}{
			"status": map[string]interface{}{"phase": "Pending"},
		}),
		makeResource("PersistentVolumeClaim", "default", "bound-pvc", map[string]interface{}{
			"status": map[string]interface{}{"phase": "Bound"},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeStorageHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["total_pvcs"].(int) != 2 {
		t.Errorf("expected 2 PVCs, got %v", m["total_pvcs"])
	}
	if m["unbound_pvcs"].(int) != 1 {
		t.Errorf("expected 1 unbound PVC, got %v", m["unbound_pvcs"])
	}
	if m["storage_health"] != "Degraded" {
		t.Errorf("expected Degraded storage health, got %v", m["storage_health"])
	}
}

func TestAnalyzeStorageHealth_AllBound(t *testing.T) {
	fp := newFakeProxy()
	fp.add("PersistentVolumeClaim", "default",
		makeResource("PersistentVolumeClaim", "default", "pvc-1", map[string]interface{}{
			"status": map[string]interface{}{"phase": "Bound"},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeStorageHealth(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["storage_health"] != "Healthy" {
		t.Errorf("expected Healthy storage, got %v", m["storage_health"])
	}
}

// ─────────────────────────────────────────────────────────────
// check_resource_limits
// ─────────────────────────────────────────────────────────────

func TestCheckResourceLimits_Violations(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "prod",
		makeResource("Pod", "prod", "pod-noconf", map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "app"}, // no resources at all
				},
			},
		}),
		makeResource("Pod", "prod", "pod-ok", map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{
						"name": "app",
						"resources": map[string]interface{}{
							"limits":   map[string]interface{}{"cpu": "500m", "memory": "512Mi"},
							"requests": map[string]interface{}{"cpu": "250m", "memory": "256Mi"},
						},
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.CheckResourceLimits(context.Background(), map[string]interface{}{"namespace": "prod"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["violations"].(int) < 1 {
		t.Errorf("expected violations, got %v", m["violations"])
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_hpa_behavior
// ─────────────────────────────────────────────────────────────

func TestAnalyzeHPABehavior_AtMaxReplicas(t *testing.T) {
	fp := newFakeProxy()
	fp.add("HorizontalPodAutoscaler", "default",
		makeResource("HorizontalPodAutoscaler", "default", "web-hpa", map[string]interface{}{
			"spec": map[string]interface{}{
				"minReplicas": 1,
				"maxReplicas": 5,
			},
			"status": map[string]interface{}{
				"currentReplicas": 5,
				"desiredReplicas": 5,
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeHPABehavior(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	hpas := m["hpas"].([]map[string]interface{})
	if len(hpas) != 1 {
		t.Fatalf("expected 1 HPA, got %d", len(hpas))
	}
	if !hpas[0]["at_max_replicas"].(bool) {
		t.Error("expected at_max_replicas=true")
	}
	warnings := hpas[0]["warnings"].([]string)
	if len(warnings) == 0 {
		t.Error("expected at-max-replicas warning")
	}
}

func TestAnalyzeHPABehavior_ScalingInactive(t *testing.T) {
	fp := newFakeProxy()
	fp.add("HorizontalPodAutoscaler", "default",
		makeResource("HorizontalPodAutoscaler", "default", "batch-hpa", map[string]interface{}{
			"spec": map[string]interface{}{"minReplicas": 1, "maxReplicas": 10},
			"status": map[string]interface{}{
				"currentReplicas": 1,
				"desiredReplicas": 1,
				"conditions": []interface{}{
					map[string]interface{}{
						"type":    "ScalingActive",
						"status":  "False",
						"message": "the HPA was unable to compute the replica count",
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeHPABehavior(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	hpas := m["hpas"].([]map[string]interface{})
	warnings := hpas[0]["warnings"].([]string)
	if len(warnings) == 0 {
		t.Error("expected ScalingActive=False warning")
	}
}

// ─────────────────────────────────────────────────────────────
// analyze_log_patterns
// ─────────────────────────────────────────────────────────────

func TestAnalyzeLogPatterns_ErrorsDetected(t *testing.T) {
	fp := newFakeProxy()
	fp.cmdResult = &pb.CommandResult{
		Message: "INFO starting\nERROR database connection failed\nfatal: nil pointer dereference\nWARN deprecated API used\nINFO done\n",
	}

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AnalyzeLogPatterns(context.Background(), map[string]interface{}{
		"namespace": "default",
		"pod_name":  "my-pod",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["lines_analysed"].(int) == 0 {
		t.Error("expected non-zero lines_analysed")
	}
	if m["error_count"].(int) < 1 {
		t.Errorf("expected errors, got %v", m["error_count"])
	}
}

func TestAnalyzeLogPatterns_MissingPodName(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.AnalyzeLogPatterns(context.Background(), map[string]interface{}{"namespace": "default"})
	if err == nil {
		t.Error("expected error for missing pod_name")
	}
}

func TestAnalyzeLogPatterns_CommandError(t *testing.T) {
	fp := newFakeProxy()
	fp.cmdErr = fmt.Errorf("pod not found")
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.AnalyzeLogPatterns(context.Background(), map[string]interface{}{
		"namespace": "default",
		"pod_name":  "ghost-pod",
	})
	if err == nil {
		t.Error("expected error when command fails")
	}
}

// ─────────────────────────────────────────────────────────────
// assess_security_posture
// ─────────────────────────────────────────────────────────────

func TestAssessSecurityPosture_PrivilegedContainer(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "default",
		makeResource("Pod", "default", "priv-pod", map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{
						"name": "app",
						"securityContext": map[string]interface{}{
							"privileged":             true,
							"runAsNonRoot":           false,
							"readOnlyRootFilesystem": false,
						},
					},
				},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AssessSecurityPosture(context.Background(), map[string]interface{}{"namespace": "default"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["security_score"].(int) >= 100 {
		t.Errorf("expected reduced security score for privileged container, got %v", m["security_score"])
	}
	findings := m["findings"].([]map[string]interface{})
	if len(findings) == 0 {
		t.Error("expected security findings for privileged container")
	}

	// Verify CIS IDs are present
	hasCritical := false
	for _, f := range findings {
		if f["check"] == "Privileged" {
			hasCritical = true
			if f["cis_id"] != "5.2.1" {
				t.Errorf("expected CIS ID 5.2.1 for privileged check, got %v", f["cis_id"])
			}
		}
	}
	if !hasCritical {
		t.Error("expected Privileged finding")
	}
}

func TestAssessSecurityPosture_HostNetworkPod(t *testing.T) {
	fp := newFakeProxy()
	fp.add("Pod", "kube-system",
		makeResource("Pod", "kube-system", "network-pod", map[string]interface{}{
			"spec": map[string]interface{}{
				"hostNetwork": true,
				"containers":  []interface{}{map[string]interface{}{"name": "net"}},
			},
		}),
	)

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AssessSecurityPosture(context.Background(), map[string]interface{}{"namespace": "kube-system"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	findings := m["findings"].([]map[string]interface{})
	found := false
	for _, f := range findings {
		if f["check"] == "HostNetworkEnabled" {
			found = true
			if f["cis_id"] != "5.2.4" {
				t.Errorf("expected CIS ID 5.2.4, got %v", f["cis_id"])
			}
		}
	}
	if !found {
		t.Error("expected HostNetworkEnabled finding")
	}
}

func TestAssessSecurityPosture_RiskLevels(t *testing.T) {
	// Zero pods → score 100 → LOW risk
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.AssessSecurityPosture(context.Background(), map[string]interface{}{"namespace": "empty-ns"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["security_score"].(int) != 100 {
		t.Errorf("expected score 100 with no pods, got %v", m["security_score"])
	}
	if m["risk_level"] != "LOW" {
		t.Errorf("expected LOW risk, got %v", m["risk_level"])
	}
}

// ─────────────────────────────────────────────────────────────
// detect_configuration_drift
// ─────────────────────────────────────────────────────────────

func TestDetectConfigurationDrift_NoDrift(t *testing.T) {
	fp := newFakeProxy()
	fp.getResult = makeResource("Deployment", "default", "api", map[string]interface{}{
		"spec": map[string]interface{}{"replicas": 3},
	})

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.DetectConfigurationDrift(context.Background(), map[string]interface{}{
		"namespace": "default",
		"kind":      "Deployment",
		"name":      "api",
		"desired_state": map[string]interface{}{
			"spec": map[string]interface{}{"replicas": 3},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["drift_count"].(int) != 0 {
		t.Errorf("expected no drift, got %v", m["drift_count"])
	}
	if m["has_drift"].(bool) {
		t.Error("expected has_drift=false")
	}
}

func TestDetectConfigurationDrift_DriftDetected(t *testing.T) {
	fp := newFakeProxy()
	fp.getResult = makeResource("Deployment", "default", "api", map[string]interface{}{
		"spec": map[string]interface{}{"replicas": 1}, // live state: 1 replica
	})

	at := analysis.NewAnalysisToolsWithProxy(fp)
	result, err := at.DetectConfigurationDrift(context.Background(), map[string]interface{}{
		"namespace": "default",
		"kind":      "Deployment",
		"name":      "api",
		"desired_state": map[string]interface{}{
			"spec": map[string]interface{}{"replicas": 3}, // desired: 3 replicas
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["drift_count"].(int) == 0 {
		t.Error("expected drift to be detected")
	}
	if !m["has_drift"].(bool) {
		t.Error("expected has_drift=true")
	}
}

func TestDetectConfigurationDrift_MissingKind(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.DetectConfigurationDrift(context.Background(), map[string]interface{}{
		"namespace": "default",
		"name":      "api",
		// missing "kind"
	})
	if err == nil {
		t.Error("expected error for missing kind")
	}
}

func TestDetectConfigurationDrift_MissingName(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.DetectConfigurationDrift(context.Background(), map[string]interface{}{
		"namespace": "default",
		"kind":      "Deployment",
		// missing "name"
	})
	if err == nil {
		t.Error("expected error for missing name")
	}
}

func TestDetectConfigurationDrift_ProxyError(t *testing.T) {
	fp := newFakeProxy()
	fp.getErr = fmt.Errorf("resource not found")
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.DetectConfigurationDrift(context.Background(), map[string]interface{}{
		"namespace": "default",
		"kind":      "Deployment",
		"name":      "ghost",
	})
	if err == nil {
		t.Error("expected error when proxy returns error")
	}
}

// ─────────────────────────────────────────────────────────────
// HandlerMap invocability
// ─────────────────────────────────────────────────────────────

func TestHandlerMapCallable(t *testing.T) {
	fp := newFakeProxy()
	at := analysis.NewAnalysisToolsWithProxy(fp)
	handlers := at.HandlerMap()

	namespaceTools := []string{
		"analyze_pod_health",
		"analyze_deployment_health",
		"detect_resource_contention",
		"analyze_network_connectivity",
		"analyze_rbac_permissions",
		"analyze_storage_health",
		"check_resource_limits",
		"analyze_hpa_behavior",
		"assess_security_posture",
	}

	for _, name := range namespaceTools {
		t.Run(name, func(t *testing.T) {
			fn, ok := handlers[name]
			if !ok {
				t.Fatalf("handler %q not found", name)
			}
			// Should not panic; may return error (proxy returns empty data)
			_, err := fn(context.Background(), map[string]interface{}{"namespace": "default"})
			if err != nil {
				t.Logf("tool %q returned error (acceptable with empty proxy): %v", name, err)
			}
		})
	}

	// node pressure doesn't need namespace
	t.Run("analyze_node_pressure", func(t *testing.T) {
		fn := handlers["analyze_node_pressure"]
		_, err := fn(context.Background(), map[string]interface{}{})
		if err != nil {
			t.Logf("analyze_node_pressure returned error (acceptable): %v", err)
		}
	})

	// log patterns requires pod_name
	t.Run("analyze_log_patterns_missing_pod", func(t *testing.T) {
		fn := handlers["analyze_log_patterns"]
		_, err := fn(context.Background(), map[string]interface{}{"namespace": "default"})
		if err == nil {
			t.Error("expected error for missing pod_name")
		}
	})

	// drift requires kind and name
	t.Run("detect_configuration_drift_missing_required", func(t *testing.T) {
		fn := handlers["detect_configuration_drift"]
		_, err := fn(context.Background(), map[string]interface{}{"namespace": "default"})
		if err == nil {
			t.Error("expected error for missing kind/name")
		}
	})
}
