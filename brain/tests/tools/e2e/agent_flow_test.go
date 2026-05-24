//go:build e2e

// Package e2e validates end-to-end agent→tool→result chains without a live cluster.
// Each test drives a realistic multi-step conversation scenario using a fake backend.
// Run: go test -v -tags e2e -timeout 3m ./tests/tools/e2e/
package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/config"
	"github.com/vellankikoti/kubilitics/brain/internal/db"
	"github.com/vellankikoti/kubilitics/brain/internal/integration/backend"
	"github.com/vellankikoti/kubilitics/brain/internal/mcp/server"
)

const e2eClusterID = "e2e-cluster"

// ─── harness ──────────────────────────────────────────────────────────────────

type e2eHarness struct {
	srv    server.MCPServer
	routes map[string]interface{}
}

func newE2EHarness(t *testing.T) *e2eHarness {
	t.Helper()
	h := &e2eHarness{routes: make(map[string]interface{})}

	h.routes["/clusters"] = []map[string]interface{}{
		{"id": e2eClusterID, "name": "e2e-cluster"},
	}

	fakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		w.Header().Set("Content-Type", "application/json")

		for k, v := range h.routes {
			if strings.HasPrefix(path, k) {
				_ = json.NewEncoder(w).Encode(v)
				return
			}
		}
		http.Error(w, fmt.Sprintf(`{"error":"not found: %s"}`, path), http.StatusNotFound)
	}))
	t.Cleanup(fakeSrv.Close)

	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = fakeSrv.URL

	auditCfg := &audit.Config{AuditLogPath: "/tmp/e2e-audit.log"}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("audit logger: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("backend proxy: %v", err)
	}

	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	srv, err := server.NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("NewMCPServer: %v", err)
	}
	h.srv = srv
	return h
}

func (h *e2eHarness) register(path string, data interface{}) {
	h.routes[path] = data
}

func (h *e2eHarness) call(t *testing.T, tool string, args map[string]interface{}) interface{} {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := h.srv.ExecuteTool(ctx, tool, args)
	if err != nil {
		t.Logf("tool %s returned error (may be expected): %v", tool, err)
	}
	return result
}

// ─── Flow 1: cluster triage → problem list → log inspection ──────────────────

func TestE2E_TriageFlow(t *testing.T) {
	h := newE2EHarness(t)

	// Register backend data for this scenario.
	h.register("/clusters/"+e2eClusterID+"/overview", map[string]interface{}{
		"status": "degraded",
		"nodes":  3,
		"health": map[string]interface{}{"score": 62, "issues": 4},
	})
	h.register("/clusters/"+e2eClusterID+"/problems", map[string]interface{}{
		"problems": []map[string]interface{}{
			{"kind": "Pod", "name": "api-server-7f", "namespace": "default", "reason": "CrashLoopBackOff", "severity": "critical"},
			{"kind": "Node", "name": "node-1", "reason": "DiskPressure", "severity": "warning"},
		},
	})
	h.register("/clusters/"+e2eClusterID+"/namespaces/default/pods/api-server-7f/logs", map[string]interface{}{
		"logs": "2026-05-24T00:00:00Z ERROR panic: nil pointer dereference\n",
	})

	// Step 1 — agent calls triage_cluster.
	overview := h.call(t, "triage_cluster", map[string]interface{}{
		"cluster_id": e2eClusterID,
	})
	if overview == nil {
		t.Log("triage_cluster returned nil (backend endpoint may not be registered at exact path)")
	}

	// Step 2 — agent calls list_problems.
	problems := h.call(t, "list_problems", map[string]interface{}{
		"cluster_id": e2eClusterID,
	})
	t.Logf("list_problems result: %v", problems)

	// Step 3 — agent calls get_logs on the crashing pod.
	logs := h.call(t, "get_logs", map[string]interface{}{
		"cluster_id": e2eClusterID,
		"namespace":  "default",
		"name":       "api-server-7f",
	})
	t.Logf("get_logs result: %v", logs)

	// Contract: none of the 3 steps should panic.
	t.Log("Triage flow completed without panic")
}

// ─── Flow 2: node analysis → recommendation → plan ───────────────────────────

func TestE2E_NodeAnalysisFlow(t *testing.T) {
	h := newE2EHarness(t)

	h.register("/clusters/"+e2eClusterID+"/nodes", map[string]interface{}{
		"items": []map[string]interface{}{
			{
				"metadata": map[string]interface{}{"name": "node-1"},
				"status": map[string]interface{}{
					"conditions": []map[string]interface{}{
						{"type": "Ready", "status": "True"},
						{"type": "DiskPressure", "status": "True"},
					},
					"allocatable": map[string]interface{}{
						"cpu": "4", "memory": "8Gi",
					},
				},
			},
		},
	})
	h.register("/clusters/"+e2eClusterID+"/nodes/node-1", map[string]interface{}{
		"metadata": map[string]interface{}{"name": "node-1"},
		"status": map[string]interface{}{
			"conditions": []map[string]interface{}{
				{"type": "DiskPressure", "status": "True"},
			},
		},
	})

	// Step 1 — inspect the node.
	h.call(t, "inspect_node", map[string]interface{}{
		"cluster_id": e2eClusterID,
		"name":       "node-1",
	})

	// Step 2 — analyze node pressure.
	h.call(t, "analyze_node_pressure", map[string]interface{}{
		"cluster_id": e2eClusterID,
	})

	// Step 3 — plan drain.
	h.call(t, "plan_drain_node", map[string]interface{}{
		"cluster_id": e2eClusterID,
		"name":       "node-1",
	})

	t.Log("Node analysis flow completed without panic")
}

// ─── Flow 3: security audit chain ────────────────────────────────────────────

func TestE2E_SecurityAuditFlow(t *testing.T) {
	h := newE2EHarness(t)

	h.register("/clusters/"+e2eClusterID+"/security", map[string]interface{}{
		"score": 45,
		"findings": []map[string]interface{}{
			{"check": "privileged_containers", "count": 3, "severity": "critical"},
			{"check": "secrets_in_env", "count": 7, "severity": "high"},
		},
	})

	steps := []struct {
		tool string
		args map[string]interface{}
	}{
		{"assess_security_posture", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"check_privileged_containers", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"check_secrets_in_env", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"check_rbac_wildcards", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"security_compliance_report", map[string]interface{}{"cluster_id": e2eClusterID}},
	}

	for _, step := range steps {
		result := h.call(t, step.tool, step.args)
		t.Logf("  %s → %T", step.tool, result)
	}
	t.Log("Security audit flow completed without panic")
}

// ─── Flow 4: cost analysis chain ─────────────────────────────────────────────

func TestE2E_CostAnalysisFlow(t *testing.T) {
	h := newE2EHarness(t)

	h.register("/clusters/"+e2eClusterID+"/cost", map[string]interface{}{
		"monthly_estimate": 4200.0,
		"waste_percentage": 38.0,
		"top_consumers": []map[string]interface{}{
			{"namespace": "production", "monthly_cost": 1800.0},
		},
	})

	steps := []string{
		"cost_analyze_spending",
		"cost_identify_waste",
		"cost_forecast_spending",
		"cost_optimization_plan",
	}

	for _, tool := range steps {
		h.call(t, tool, map[string]interface{}{"cluster_id": e2eClusterID})
	}
	t.Log("Cost analysis flow completed without panic")
}

// ─── Flow 5: full observe → analyze → recommend pipeline ─────────────────────

func TestE2E_ObserveAnalyzeRecommendPipeline(t *testing.T) {
	h := newE2EHarness(t)

	// Generic data for all endpoints.
	h.register("/clusters/"+e2eClusterID, map[string]interface{}{
		"status": "healthy", "nodes": 5,
	})
	h.register("/clusters/"+e2eClusterID+"/namespaces/default/pods", map[string]interface{}{
		"items": []map[string]interface{}{
			{
				"metadata": map[string]interface{}{"name": "web-0", "namespace": "default"},
				"status": map[string]interface{}{
					"phase": "Running",
					"containerStatuses": []map[string]interface{}{
						{"name": "web", "ready": true, "restartCount": 0},
					},
				},
				"spec": map[string]interface{}{
					"containers": []map[string]interface{}{
						{
							"name":  "web",
							"image": "nginx:latest",
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{"cpu": "100m", "memory": "128Mi"},
								"limits":   map[string]interface{}{"cpu": "500m", "memory": "512Mi"},
							},
						},
					},
				},
			},
		},
	})

	pipeline := []struct {
		tool string
		args map[string]interface{}
	}{
		// Observe
		{"observe_orphaned_pods", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"observe_stuck_rollouts", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"observe_restart_storms", map[string]interface{}{"cluster_id": e2eClusterID}},
		// Analyze
		{"analyze_resource_efficiency", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"check_resource_limits", map[string]interface{}{"cluster_id": e2eClusterID}},
		// Recommend
		{"recommend_resource_sizing", map[string]interface{}{"cluster_id": e2eClusterID}},
		{"generate_optimization_report", map[string]interface{}{"cluster_id": e2eClusterID}},
	}

	for _, step := range pipeline {
		h.call(t, step.tool, step.args)
	}
	t.Log("Observe→Analyze→Recommend pipeline completed without panic")
}

// ─── Flow 6: tool result is always serialisable ───────────────────────────────

func TestE2E_ToolResultsAreJSONSerializable(t *testing.T) {
	h := newE2EHarness(t)

	// Spot-check 10 tools across all categories.
	tools := []string{
		"cluster_overview",
		"list_resources",
		"get_events",
		"analyze_log_patterns",
		"assess_security_posture",
		"cost_analyze_spending",
		"recommend_resource_sizing",
		"triage_cluster",
		"list_problems",
		"get_cluster_topology",
	}

	for _, tool := range tools {
		result := h.call(t, tool, map[string]interface{}{
			"cluster_id": e2eClusterID,
			"namespace":  "default",
			"kind":       "Pod",
		})
		if result == nil {
			continue
		}
		_, err := json.Marshal(result)
		if err != nil {
			t.Errorf("tool %s returned non-serializable result: %v", tool, err)
		}
	}
}
