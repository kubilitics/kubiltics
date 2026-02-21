package server

// handlers_test.go — integration tests for all MCP tool handlers.
//
// Each test spins up a fake httptest.Server that mimics the kubilitics-backend
// REST API. We then construct an mcpServerImpl pointing at that fake server,
// call the relevant handler, and assert on the returned map structure.
//
// This validates that:
//   1. Args are correctly extracted and forwarded as query/path params.
//   2. The handler correctly parses the JSON response.
//   3. Error paths (backend down, bad status) are propagated.
//   4. Multiple endpoints are aggregated for composite handlers.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
)

// noopLogger satisfies audit.Logger for tests.
type noopLogger struct{}

func (noopLogger) Log(_ context.Context, _ *audit.Event) error               { return nil }
func (noopLogger) LogInvestigationStarted(_ context.Context, _ string) error { return nil }
func (noopLogger) LogInvestigationCompleted(_ context.Context, _ string, _ time.Duration) error {
	return nil
}
func (noopLogger) LogInvestigationFailed(_ context.Context, _ string, _ error) error { return nil }
func (noopLogger) LogActionProposed(_ context.Context, _, _ string) error            { return nil }
func (noopLogger) LogActionApproved(_ context.Context, _, _, _ string) error         { return nil }
func (noopLogger) LogActionExecuted(_ context.Context, _, _ string, _ time.Duration) error {
	return nil
}
func (noopLogger) LogSafetyViolation(_ context.Context, _, _ string) error { return nil }
func (noopLogger) Sync() error                                             { return nil }
func (noopLogger) Close() error                                            { return nil }

var _ audit.Logger = noopLogger{}

// ─── Test helpers ─────────────────────────────────────────────────────────────

// fakeBackend is a minimal fake kubilitics-backend REST server.
// Register routes by adding entries to routes map before starting.
type fakeBackend struct {
	routes map[string]interface{}
	server *httptest.Server
}

func newFakeBackend(t *testing.T) *fakeBackend {
	t.Helper()
	fb := &fakeBackend{routes: make(map[string]interface{})}
	fb.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// Prefix-match: strip /api/v1 if present
		path = strings.TrimPrefix(path, "/api/v1")

		data, ok := fb.routes[path]
		if !ok {
			// Partial prefix match
			for k, v := range fb.routes {
				if strings.HasPrefix(path, k) {
					data = v
					ok = true
					break
				}
			}
		}
		if !ok {
			http.Error(w, fmt.Sprintf("route not found: %s", path), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(data)
	}))
	t.Cleanup(fb.server.Close)
	return fb
}

func (fb *fakeBackend) register(path string, data interface{}) {
	fb.routes[path] = data
}

// newTestServer creates a mcpServerImpl pointing at the given fake backend URL.
func newTestServer(t *testing.T, backendURL string) *mcpServerImpl {
	t.Helper()
	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = backendURL

	s := &mcpServerImpl{
		config:      cfg,
		tools:       make(map[string]*toolRegistration),
		handlers:    make(map[string]ToolHandler),
		stopChan:    make(chan struct{}),
		auditLog:    noopLogger{},
		rateLimiter: newRateLimiter(1000, 0),
	}
	s.stats.CallsByTool = make(map[string]int64)
	return s
}

// clusterID used throughout tests
const testClusterID = "cluster-123"

// registerClusterList registers the /clusters endpoint with a single cluster.
func (fb *fakeBackend) registerCluster() {
	fb.register("/clusters", []map[string]interface{}{
		{"id": testClusterID, "name": "test-cluster"},
	})
}

// ─── backendHTTP helper tests ─────────────────────────────────────────────────

func TestBackendHTTP_Get_Success(t *testing.T) {
	fb := newFakeBackend(t)
	fb.register("/clusters", []map[string]string{{"id": "c1"}})

	c := newBackendHTTP(fb.server.URL)
	var out []map[string]string
	if err := c.get(context.Background(), "/clusters", &out); err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if len(out) != 1 || out[0]["id"] != "c1" {
		t.Errorf("unexpected result: %v", out)
	}
}

func TestBackendHTTP_Get_NotFound(t *testing.T) {
	fb := newFakeBackend(t)
	_ = fb // no routes registered → 404

	c := newBackendHTTP(fb.server.URL)
	var out interface{}
	err := c.get(context.Background(), "/nonexistent", &out)
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestBackendHTTP_ResolveCluster_FromArgs(t *testing.T) {
	c := newBackendHTTP("http://unused")
	clusterID, err := c.resolveCluster(context.Background(), map[string]interface{}{
		"cluster_id": "my-cluster",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if clusterID != "my-cluster" {
		t.Errorf("got %s, want my-cluster", clusterID)
	}
}

func TestBackendHTTP_ResolveCluster_Fallback(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()

	c := newBackendHTTP(fb.server.URL)
	clusterID, err := c.resolveCluster(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if clusterID != testClusterID {
		t.Errorf("got %s, want %s", clusterID, testClusterID)
	}
}

func TestBackendHTTP_ResolveCluster_NoClusters(t *testing.T) {
	fb := newFakeBackend(t)
	fb.register("/clusters", []interface{}{}) // empty list

	c := newBackendHTTP(fb.server.URL)
	_, err := c.resolveCluster(context.Background(), map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error when no clusters registered")
	}
}

// ─── Observation handler tests ────────────────────────────────────────────────

func TestHandleClusterOverview_Success(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/overview", map[string]interface{}{
		"status": "healthy", "nodes": 3,
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleClusterOverview(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["cluster_id"] != testClusterID {
		t.Errorf("cluster_id mismatch: %v", m["cluster_id"])
	}
	ov := m["overview"].(map[string]interface{})
	if ov["status"] != "healthy" {
		t.Errorf("unexpected overview: %v", ov)
	}
}

func TestHandleClusterOverview_FallsBackToSummary(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// No /overview route; only /summary
	fb.register("/clusters/"+testClusterID+"/summary", map[string]interface{}{
		"total_pods": 42,
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleClusterOverview(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["summary"] == nil {
		t.Errorf("expected fallback summary, got: %v", m)
	}
}

func TestHandleObserveResource_MissingKind(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	_, err := s.handleObserveResource(context.Background(), map[string]interface{}{
		"name": "my-pod",
	})
	if err == nil || !strings.Contains(err.Error(), "kind") {
		t.Errorf("expected kind error, got: %v", err)
	}
}

func TestHandleObserveResource_MissingName(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	_, err := s.handleObserveResource(context.Background(), map[string]interface{}{
		"kind": "Pod",
	})
	if err == nil || !strings.Contains(err.Error(), "name") {
		t.Errorf("expected name error, got: %v", err)
	}
}

func TestHandleObserveResource_Success(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods/default/my-pod", map[string]interface{}{
		"metadata": map[string]interface{}{"name": "my-pod"},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleObserveResource(context.Background(), map[string]interface{}{
		"kind":      "Pod",
		"name":      "my-pod",
		"namespace": "default",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	meta := m["metadata"].(map[string]interface{})
	if meta["name"] != "my-pod" {
		t.Errorf("unexpected result: %v", result)
	}
}

func TestHandleEvents_Success(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{"reason": "Pulled"},
		},
	})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleEvents(context.Background(), map[string]interface{}{
		"limit": 10,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["items"] == nil {
		t.Errorf("expected items in result: %v", m)
	}
}

func TestHandleWorkloadHealth_AggregatesMultiple(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	base := "/clusters/" + testClusterID + "/resources/"
	fb.register(base+"deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"statefulsets", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"daemonsets", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"replicasets", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{"cpu_used": "50%"})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleWorkloadHealth(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	// Should have aggregated all four workload types
	for _, key := range []string{"deployments", "statefulsets", "daemonsets", "replicasets"} {
		if m[key] == nil {
			t.Errorf("missing %s in result", key)
		}
	}
	if m["metrics_summary"] == nil {
		t.Error("missing metrics_summary")
	}
}

func TestHandleNodeStatus_ListAll(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes", map[string]interface{}{
		"items": []interface{}{map[string]interface{}{"name": "node-1"}},
	})
	fb.register("/clusters/"+testClusterID+"/metrics", map[string]interface{}{"node_count": 1})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleNodeStatus(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["nodes"] == nil {
		t.Error("expected nodes in result")
	}
}

func TestHandleStorageStatus_AggregatesResources(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	base := "/clusters/" + testClusterID + "/resources/"
	fb.register(base+"persistentvolumeclaims", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"persistentvolumes", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"storageclasses", map[string]interface{}{"items": []interface{}{}})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleStorageStatus(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	for _, key := range []string{"pvcs", "pvs", "storage_classes"} {
		if m[key] == nil {
			t.Errorf("missing %s", key)
		}
	}
}

// ─── Analysis handler tests ───────────────────────────────────────────────────

func TestHandleAnalyzeResourceEfficiency_ReturnsBothWorkloadsAndMetrics(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	base := "/clusters/" + testClusterID + "/resources/"
	fb.register(base+"deployments", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"statefulsets", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"daemonsets", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{"cpu": "70%"})
	fb.register("/clusters/"+testClusterID+"/metrics", map[string]interface{}{"nodes": 3})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleAnalyzeResourceEfficiency(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["deployments"] == nil || m["metrics_summary"] == nil {
		t.Errorf("missing expected keys: %v", m)
	}
	// Should always include analysis hint
	if m["analysis_hint"] == nil {
		t.Error("missing analysis_hint")
	}
}

func TestHandleAnalyzeBlastRadius_RequiresKindAndName(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.handleAnalyzeBlastRadius(context.Background(), map[string]interface{}{
		"namespace": "default",
	})
	if err == nil {
		t.Error("expected error for missing kind/name")
	}
}

func TestHandleAnalyzeRolloutRisk_SingleDeployment(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments/production/web", map[string]interface{}{
		"metadata": map[string]interface{}{"name": "web"},
		"spec":     map[string]interface{}{"replicas": 3},
	})
	fb.register("/clusters/"+testClusterID+"/metrics/summary", map[string]interface{}{"headroom": "30%"})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleAnalyzeRolloutRisk(context.Background(), map[string]interface{}{
		"namespace": "production",
		"name":      "web",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["deployment"] == nil {
		t.Errorf("expected deployment in result: %v", m)
	}
}

// ─── Troubleshooting handler tests ───────────────────────────────────────────

func TestHandleTroubleshootPodFailures_IncludesHint(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleTroubleshootPodFailures(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	if m["analysis_hint"] == nil {
		t.Error("missing analysis_hint in troubleshoot result")
	}
}

func TestHandleTroubleshootNetworkIssues_AggregatesServices(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	base := "/clusters/" + testClusterID + "/resources/"
	fb.register(base+"services", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"networkpolicies", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"ingresses", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/events", map[string]interface{}{"items": []interface{}{}})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleTroubleshootNetworkIssues(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	for _, key := range []string{"services", "network_policies", "ingresses"} {
		if m[key] == nil {
			t.Errorf("missing %s", key)
		}
	}
}

func TestHandleTroubleshootRBACIssues_FetchesAllRBACResources(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	base := "/clusters/" + testClusterID + "/resources/"
	fb.register(base+"roles", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"rolebindings", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"clusterroles", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"clusterrolebindings", map[string]interface{}{"items": []interface{}{}})
	fb.register(base+"serviceaccounts", map[string]interface{}{"items": []interface{}{}})

	s := newTestServer(t, fb.server.URL)
	result, err := s.handleTroubleshootRBACIssues(context.Background(), map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := result.(map[string]interface{})
	for _, key := range []string{"roles", "role_bindings", "cluster_roles", "cluster_role_bindings", "service_accounts"} {
		if m[key] == nil {
			t.Errorf("missing %s in RBAC result", key)
		}
	}
}

// ─── routeObservationTool dispatch tests ─────────────────────────────────────

func TestRouteObservationTool_UnknownToolReturnsError(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.routeObservationTool(context.Background(), "observe_nonexistent_tool", nil)
	if err == nil {
		t.Error("expected error for unknown tool")
	}
}

func TestRouteAnalysisTool_UnknownToolReturnsError(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.routeAnalysisTool(context.Background(), "analyze_nonexistent_tool", nil)
	if err == nil {
		t.Error("expected error for unknown tool")
	}
}

func TestRouteTroubleshootingTool_UnknownToolReturnsError(t *testing.T) {
	s := newTestServer(t, "http://unused")
	_, err := s.routeTroubleshootingTool(context.Background(), "troubleshoot_nonexistent_tool", nil)
	if err == nil {
		t.Error("expected error for unknown tool")
	}
}

// ─── registerAllTools integration test ───────────────────────────────────────

func TestRegisterAllTools_AllToolsRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	_ = fb // no routes needed for registration

	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = fb.server.URL

	s := newTestServer(t, fb.server.URL)
	if err := s.registerAllTools(); err != nil {
		t.Fatalf("registerAllTools failed: %v", err)
	}

	tools, err := s.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools failed: %v", err)
	}
	if len(tools) < 50 {
		t.Errorf("expected at least 50 tools, got %d", len(tools))
	}

	// Spot-check a few tools are present
	names := make(map[string]bool)
	for _, tool := range tools {
		names[tool.Name] = true
	}
	for _, expected := range []string{
		"observe_cluster_overview",
		"observe_pod_logs",
		"analyze_resource_efficiency",
		"troubleshoot_pod_failures",
		"security_scan_cluster",
		"cost_analyze_spending",
		"action_scale_workload",
		"automation_generate_runbook",
	} {
		if !names[expected] {
			t.Errorf("tool %s not registered", expected)
		}
	}
}

// ─── nsQuery helper test ──────────────────────────────────────────────────────

func TestNsQuery(t *testing.T) {
	if nsQuery("") != "" {
		t.Error("empty namespace should return empty string")
	}
	q := nsQuery("kube-system")
	if q != "?namespace=kube-system" {
		t.Errorf("unexpected query: %s", q)
	}
	// Special chars should be escaped
	q2 := nsQuery("ns with space")
	if !strings.Contains(q2, "ns+with+space") && !strings.Contains(q2, "ns%20with%20space") {
		t.Errorf("expected URL-encoded namespace, got: %s", q2)
	}
}

// ─── strArg / intArg helper tests ────────────────────────────────────────────

func TestStrArg(t *testing.T) {
	args := map[string]interface{}{"key": "value", "num": 42}
	if strArg(args, "key") != "value" {
		t.Error("strArg string failed")
	}
	if strArg(args, "missing") != "" {
		t.Error("strArg missing should return empty")
	}
	if strArg(args, "num") != "" {
		t.Error("strArg on non-string should return empty")
	}
}

func TestIntArg(t *testing.T) {
	args := map[string]interface{}{
		"int":   10,
		"float": float64(20),
		"int64": int64(30),
	}
	if intArg(args, "int", 0) != 10 {
		t.Error("int arg failed")
	}
	if intArg(args, "float", 0) != 20 {
		t.Error("float64 arg failed")
	}
	if intArg(args, "int64", 0) != 30 {
		t.Error("int64 arg failed")
	}
	if intArg(args, "missing", 99) != 99 {
		t.Error("default value failed")
	}
}
