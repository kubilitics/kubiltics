//go:build phase2

// Phase 2 live execution validation.
// Requires a running backend at http://localhost:8190 and a real cluster.
//
// Run:
//
//	CLUSTER_ID=<uuid> go test -v -tags phase2 -run TestPhase2 -timeout 20m ./internal/mcp/server/
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/config"
	"github.com/vellankikoti/kubilitics/brain/internal/db"
	"github.com/vellankikoti/kubilitics/brain/internal/integration/backend"
	"github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
)

// ToolResult records the outcome of one tool execution.
type phase2Result struct {
	ID           string   `json:"id"`
	Category     string   `json:"category"`
	Status       string   `json:"status"`
	Verified     bool     `json:"verified"`
	SuccessRate  float64  `json:"success_rate"`
	AvgLatencyMs int64    `json:"avg_latency_ms"`
	AvgLatency   string   `json:"avg_latency"`
	Timeout      bool     `json:"timeout"`
	Confidence   string   `json:"confidence"`
	Destructive  bool     `json:"destructive"`
	RequiresAI   bool     `json:"requires_ai"`
	OutputKeys   []string `json:"output_keys,omitempty"`
	OutputSample string   `json:"output_sample,omitempty"`
	ErrorMessage string   `json:"error_message,omitempty"`
	SkipReason   string   `json:"skip_reason,omitempty"`
}

type phase2Report struct {
	GeneratedAt string                  `json:"generated_at"`
	BackendURL  string                  `json:"backend_url"`
	ClusterID   string                  `json:"cluster_id"`
	TotalTools  int                     `json:"total_tools"`
	Passed      int                     `json:"passed"`
	Failed      int                     `json:"failed"`
	Skipped     int                     `json:"skipped"`
	AvgLatencyMs int64                  `json:"avg_latency_ms"`
	SuccessRate float64                 `json:"success_rate_pct"`
	Tools       []phase2Result          `json:"tools"`
	ByCategory  map[string]categoryStat `json:"by_category"`
	FailedTools []string                `json:"failed_tools"`
}

type categoryStat struct {
	Total   int   `json:"total"`
	Passed  int   `json:"passed"`
	Failed  int   `json:"failed"`
	Skipped int   `json:"skipped"`
	AvgMs   int64 `json:"avg_latency_ms"`
}

// clusterResources holds real resource names discovered via list_* tools.
type clusterResources struct {
	podName            string
	podNamespace       string
	nodeName           string
	serviceName        string
	serviceNamespace   string
	deploymentName     string
	deploymentNS       string
	daemonsetName      string
	daemonsetNS        string
	pvName             string
	storageclassName   string
	clusterroleName    string
	clusterrolebinding string
}

// discover calls list_resources to find real resource names for the cluster.
func discoverResources(t *testing.T, srv MCPServer, clusterID string) *clusterResources {
	t.Helper()
	res := &clusterResources{}
	ctx := context.Background()

	listBy := func(kind, ns string) interface{} {
		a := map[string]interface{}{"cluster_id": clusterID, "kind": kind, "limit": 5}
		if ns != "" {
			a["namespace"] = ns
		}
		out, _ := callTool(srv, ctx, "list_resources", a)
		return out
	}

	if out := listBy("Pod", "kube-system"); out != nil {
		res.podName, res.podNamespace = extractFirstItem(out, "", "")
	}
	if res.podName == "" {
		if out := listBy("Pod", ""); out != nil {
			res.podName, res.podNamespace = extractFirstItem(out, "", "")
		}
	}

	if out := listBy("Node", ""); out != nil {
		res.nodeName, _ = extractFirstItem(out, "", "")
	}

	if out := listBy("Service", "default"); out != nil {
		res.serviceName, res.serviceNamespace = extractFirstItem(out, "", "")
	}
	if res.serviceName == "" {
		if out := listBy("Service", "kube-system"); out != nil {
			res.serviceName, res.serviceNamespace = extractFirstItem(out, "", "")
		}
	}

	if out := listBy("Deployment", "default"); out != nil {
		res.deploymentName, res.deploymentNS = extractFirstItem(out, "", "")
	}
	if res.deploymentName == "" {
		if out := listBy("Deployment", "kube-system"); out != nil {
			res.deploymentName, res.deploymentNS = extractFirstItem(out, "", "")
		}
	}

	if out := listBy("DaemonSet", "kube-system"); out != nil {
		res.daemonsetName, res.daemonsetNS = extractFirstItem(out, "", "")
	}

	if out := listBy("PersistentVolume", ""); out != nil {
		res.pvName, _ = extractFirstItem(out, "", "")
	}

	if out := listBy("StorageClass", ""); out != nil {
		res.storageclassName, _ = extractFirstItem(out, "", "")
	}

	if out := listBy("ClusterRole", ""); out != nil {
		res.clusterroleName, _ = extractFirstItem(out, "", "")
	}

	if out := listBy("ClusterRoleBinding", ""); out != nil {
		res.clusterrolebinding, _ = extractFirstItem(out, "", "")
	}

	t.Logf("Discovery: pod=%s/%s node=%s svc=%s/%s deploy=%s/%s ds=%s/%s pv=%s sc=%s",
		res.podNamespace, res.podName, res.nodeName,
		res.serviceNamespace, res.serviceName,
		res.deploymentNS, res.deploymentName,
		res.daemonsetNS, res.daemonsetName,
		res.pvName, res.storageclassName)

	return res
}

// callTool executes a tool with rate-limit retry.
func callTool(srv MCPServer, ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	for attempt := 0; attempt < 5; attempt++ {
		out, err := srv.ExecuteTool(ctx, name, args)
		if err != nil && strings.Contains(err.Error(), "rate limit exceeded") {
			time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
			continue
		}
		return out, err
	}
	return nil, fmt.Errorf("rate limit exceeded after 5 retries")
}

// extractFirstItem digs a list out of the tool output and returns the first name+namespace.
// Items can have name/namespace at the top level OR nested under "metadata" (K8s object format).
func extractFirstItem(out interface{}, _, _ string) (string, string) {
	m, ok := out.(map[string]interface{})
	if !ok {
		return "", ""
	}
	for _, listKey := range []string{"items", "result", "pods", "nodes", "services", "deployments",
		"daemonsets", "pvs", "storageclasses", "clusterroles", "clusterrolebindings"} {
		raw, ok := m[listKey]
		if !ok {
			continue
		}
		slice, ok := raw.([]interface{})
		if !ok || len(slice) == 0 {
			continue
		}
		first, ok := slice[0].(map[string]interface{})
		if !ok {
			continue
		}
		// K8s object: name+namespace nested under metadata
		if meta, ok := first["metadata"].(map[string]interface{}); ok {
			name, _ := meta["name"].(string)
			ns, _ := meta["namespace"].(string)
			if name != "" {
				return name, ns
			}
		}
		// Flat format
		name, _ := first["name"].(string)
		ns, _ := first["namespace"].(string)
		if name != "" {
			return name, ns
		}
	}
	return "", ""
}

// minimalArgs returns the smallest valid argument set for each tool.
func minimalArgs(name, clusterID string, cr *clusterResources) map[string]interface{} {
	b := map[string]interface{}{"cluster_id": clusterID}

	// defaults for discovered resources (with safe fallbacks)
	pod, podNS := safeStr(cr.podName, "coredns"), safeStr(cr.podNamespace, "kube-system")
	node := safeStr(cr.nodeName, "docker-desktop")
	svc, svcNS := safeStr(cr.serviceName, "kubernetes"), safeStr(cr.serviceNamespace, "default")
	deploy, deployNS := safeStr(cr.deploymentName, "coredns"), safeStr(cr.deploymentNS, "kube-system")
	ds, dsNS := safeStr(cr.daemonsetName, "kube-proxy"), safeStr(cr.daemonsetNS, "kube-system")

	switch name {
	// ── Core list/get ────────────────────────────────────────────────────────
	case "list_resources":
		b["kind"] = "Pod"
	case "get_resource":
		b["kind"] = "Namespace"; b["name"] = "default"
	case "get_events":
		b["namespace"] = "kube-system"; b["limit"] = 10
	case "get_logs":
		b["namespace"] = podNS; b["max_lines"] = 10
	case "get_topology":
		b["namespace"] = "default"
	case "search_resources":
		b["query"] = "kube"

	// ── Resolve ──────────────────────────────────────────────────────────────
	case "resolve_resource":
		b["kind"] = "Pod"; b["name_hint"] = pod

	// ── Topology export ──────────────────────────────────────────────────────
	case "export_topology_to_drawio":
		b["namespace"] = "default"

	// ── Problems / logs ──────────────────────────────────────────────────────
	case "list_problems":
		b["filter"] = "pending"
	case "search_logs":
		b["regex"] = ".*"; b["namespace"] = podNS; b["max_results"] = 5

	// ── inspect_* (namespace-scoped) ─────────────────────────────────────────
	case "inspect_pod":
		b["namespace"] = podNS; b["name"] = pod
	case "inspect_namespace":
		b["name"] = "default"
	case "inspect_service":
		b["namespace"] = svcNS; b["name"] = svc
	case "inspect_ingress":
		b["namespace"] = "default"; b["name"] = "default-ingress"
	case "inspect_networkpolicy":
		b["namespace"] = "default"; b["name"] = "default-netpol"
	case "inspect_deployment":
		b["namespace"] = deployNS; b["name"] = deploy
	case "inspect_replicaset":
		b["namespace"] = deployNS; b["name"] = deploy
	case "inspect_statefulset":
		b["namespace"] = "default"; b["name"] = "default-sts"
	case "inspect_daemonset":
		b["namespace"] = dsNS; b["name"] = ds
	case "inspect_job":
		b["namespace"] = "default"; b["name"] = "default-job"
	case "inspect_cronjob":
		b["namespace"] = "default"; b["name"] = "default-cronjob"
	case "inspect_pvc":
		b["namespace"] = "default"; b["name"] = "default-pvc"
	case "inspect_pv":
		b["name"] = safeStr(cr.pvName, "default-pv")
	case "inspect_storageclass":
		b["name"] = safeStr(cr.storageclassName, "standard")
	case "inspect_role":
		b["namespace"] = "kube-system"; b["name"] = "extension-apiserver-authentication-reader"
	case "inspect_rolebinding":
		b["namespace"] = "kube-system"; b["name"] = "system:controller:token-cleaner"
	case "inspect_clusterrole":
		b["name"] = safeStr(cr.clusterroleName, "cluster-admin")
	case "inspect_clusterrolebinding":
		b["name"] = safeStr(cr.clusterrolebinding, "cluster-admin")
	case "inspect_secret":
		b["namespace"] = "kube-system"; b["name"] = "bootstrap-token-abcdef"
	case "inspect_configmap":
		b["namespace"] = "kube-system"; b["name"] = "kube-proxy"
	case "inspect_limitrange":
		b["namespace"] = "default"; b["name"] = "default-limitrange"
	case "inspect_resourcequota":
		b["namespace"] = "default"; b["name"] = "default-quota"
	case "inspect_hpa":
		b["namespace"] = "default"; b["name"] = "default-hpa"
	case "inspect_pdb":
		b["namespace"] = "default"; b["name"] = "default-pdb"
	case "inspect_vpa":
		b["namespace"] = "default"; b["name"] = "default-vpa"
	case "inspect_crd":
		b["name"] = "customresourcedefinitions.apiextensions.k8s.io"
	case "inspect_node":
		b["name"] = node

	// ── observe_* ────────────────────────────────────────────────────────────
	case "observe_pod_metrics":
		b["namespace"] = podNS
	case "observe_node_metrics":
		// cluster-scoped
	case "observe_top_pods_by_metric":
		b["metric"] = "cpu"; b["top_n"] = 5
	case "observe_services_by_filter", "observe_secrets_usage",
		"observe_flapping_services", "observe_noisy_neighbors",
		"observe_unhealthy_probes", "observe_missing_probes",
		"observe_orphaned_pods", "observe_stuck_rollouts",
		"observe_high_cardinality_labels", "observe_restart_storms",
		"observe_pending_scheduler_events", "observe_zombie_finalizers":
		b["namespace"] = "default"
	case "observe_ingresses_by_tls_expiry":
		b["days"] = 30
	case "observe_recent_changes":
		b["minutes"] = 60

	// ── analyze_* ────────────────────────────────────────────────────────────
	case "analyze_pod_health", "analyze_deployment_health", "analyze_statefulset_health",
		"analyze_daemonset_health", "analyze_replicaset_health", "analyze_job_health",
		"analyze_cronjob_health", "analyze_service_health", "analyze_ingress_health":
		b["namespace"] = "default"
	case "analyze_node_pressure", "detect_resource_contention", "analyze_network_connectivity",
		"analyze_rbac_permissions", "analyze_storage_health", "check_resource_limits",
		"analyze_hpa_behavior", "assess_security_posture":
		b["namespace"] = "default"
	case "analyze_log_patterns":
		b["namespace"] = podNS; b["pod_name"] = pod
	case "detect_configuration_drift":
		b["namespace"] = deployNS; b["kind"] = "Deployment"; b["name"] = deploy
	case "analyze_resource_efficiency", "analyze_failure_patterns", "analyze_dependencies",
		"analyze_capacity_trends", "analyze_performance_bottlenecks", "analyze_error_correlation",
		"analyze_rollout_risk", "analyze_pod_scheduling", "analyze_image_vulnerabilities",
		"analyze_workload_patterns":
		b["namespace"] = "default"
	case "analyze_blast_radius":
		b["namespace"] = deployNS; b["kind"] = "Deployment"; b["name"] = deploy
	case "who_can_do":
		b["verb"] = "get"; b["resource"] = "pods"

	// ── troubleshoot_* ───────────────────────────────────────────────────────
	case "troubleshoot_pod_failures", "troubleshoot_network_issues",
		"troubleshoot_performance_degradation", "troubleshoot_deployment_failures",
		"troubleshoot_resource_constraints", "troubleshoot_rbac_issues",
		"troubleshoot_storage_issues":
		b["namespace"] = "default"

	// ── diagnose_* ───────────────────────────────────────────────────────────
	// Each diagnose tool requires namespace+name. We pass discovered names as best-effort;
	// if the resource doesn't exist, the handler returns a graceful "not found" diag, not error.
	case "diagnose_pod_not_ready":
		b["namespace"] = podNS; b["name"] = pod
	case "diagnose_service_no_endpoints":
		b["namespace"] = svcNS; b["name"] = svc
	case "diagnose_pvc_pending":
		b["namespace"] = "default"; b["name"] = "default-pvc"
	case "diagnose_ingress_404":
		b["namespace"] = "default"; b["name"] = "default-ingress"
	case "diagnose_deployment_rollback_needed":
		b["namespace"] = deployNS; b["name"] = deploy
	case "diagnose_cronjob_missing_runs":
		b["namespace"] = "default"; b["name"] = "default-cronjob"
	case "diagnose_hpa_not_scaling":
		b["namespace"] = "default"; b["name"] = "default-hpa"
	case "diagnose_networkpolicy_blocking",
		"diagnose_certificate_failures":
		b["namespace"] = "default"
	case "diagnose_node_unschedulable":
		b["name"] = node

	// ── recommend_* ──────────────────────────────────────────────────────────
	case "recommend_resource_optimization", "recommend_cost_reduction",
		"recommend_security_hardening", "recommend_scaling_strategy",
		"recommend_architecture_improvements", "recommend_upgrade_path",
		"recommend_monitoring_improvements", "recommend_disaster_recovery":
		b["namespace"] = "default"

	// ── security_* / check_* ─────────────────────────────────────────────────
	case "security_scan_cluster", "security_audit_rbac", "security_scan_secrets",
		"security_check_pod_security", "security_compliance_report":
		b["namespace"] = "default"
	case "check_privileged_containers", "check_root_containers", "check_writable_root_fs",
		"check_capabilities_all_added", "check_host_path_mounts",
		"check_default_service_accounts_in_use", "check_secrets_in_env",
		"check_image_tag_latest", "check_ingress_tls_expiry_30d", "check_rbac_wildcards":
		b["namespace"] = "default"

	// ── cost_* ───────────────────────────────────────────────────────────────
	case "cost_analyze_spending", "cost_identify_waste", "cost_forecast_spending",
		"cost_optimization_plan":
		b["namespace"] = "default"

	// ── narrate_* ────────────────────────────────────────────────────────────
	case "narrate_incident_timeline":
		b["namespace"] = "default"; b["window_minutes"] = 60
	case "narrate_onboarding_for_user":
		b["service_account"] = "default"; b["namespace"] = "default"
	case "narrate_deploy_diff":
		b["namespace"] = deployNS; b["deployment"] = deploy
	case "narrate_service_dependency_graph":
		b["namespace"] = svcNS; b["service"] = svc
	case "narrate_migration_readiness":
		b["source_namespace"] = "default"; b["namespace"] = "default"
	case "narrate_change_impact":
		b["what_if"] = "scale deployment to zero"; b["namespace"] = deployNS
	case "narrate_weekly_status", "narrate_capacity_report",
		"narrate_cost_report", "narrate_security_posture":
		// cluster-wide

	// ── plan_* ───────────────────────────────────────────────────────────────
	case "plan_scale_deployment", "plan_rollout_safety", "plan_ha_upgrade",
		"plan_resource_quota", "plan_psa_enforcement", "plan_image_pull_secrets",
		"plan_backup_coverage", "plan_pdb_coverage", "plan_cost_reduction":
		b["namespace"] = "default"
	case "plan_drain_node":
		// cluster-wide

	// ── automation_* ─────────────────────────────────────────────────────────
	case "automation_generate_runbook", "automation_run_playbook",
		"automation_create_alert_rule", "automation_schedule_task":
		b["namespace"] = "default"
	}
	return b
}

func safeStr(val, fallback string) string {
	if val != "" {
		return val
	}
	return fallback
}

func outputKeys(out interface{}) []string {
	m, ok := out.(map[string]interface{})
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sampleOutput(out interface{}) string {
	b, err := json.Marshal(out)
	if err != nil {
		return ""
	}
	s := string(b)
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}

func isAISynthesis(out interface{}) bool {
	m, ok := out.(map[string]interface{})
	if !ok {
		return false
	}
	for k := range m {
		if strings.HasSuffix(k, "_hint") || strings.HasSuffix(k, "_context") ||
			strings.HasSuffix(k, "_recommendation") || k == "automation_hint" ||
			k == "plan_hint" || k == "recommendation_hint" || k == "security_hint" ||
			k == "cost_hint" {
			return true
		}
	}
	return false
}

func calcConfidence(latencyMs int64, keyCount int) string {
	if keyCount > 3 && latencyMs < 500 {
		return "HIGH"
	}
	if keyCount > 1 && latencyMs < 2000 {
		return "MEDIUM"
	}
	return "LOW"
}

func TestPhase2LiveToolValidation(t *testing.T) {
	clusterID := os.Getenv("CLUSTER_ID")
	if clusterID == "" {
		t.Fatal("CLUSTER_ID env var required (e.g. CLUSTER_ID=78b48d38-... go test ...)")
	}
	backendURL := os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = "http://localhost:8190"
	}
	outPath := os.Getenv("REPORT_OUT")
	if outPath == "" {
		outPath = "../../../../../reports/tool-validation/tool-report.json"
	}

	t.Logf("Backend: %s", backendURL)
	t.Logf("Cluster: %s", clusterID)
	t.Logf("Report:  %s", outPath)

	// Wire up the server exactly as production does
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"
	cfg.Backend.HTTPBaseURL = backendURL
	cfg.Backend.Timeout = 30

	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/phase2-audit.log",
		AppLogPath:   "/tmp/phase2-app.log",
		MaxSize:      10, MaxBackups: 3, MaxAge: 30,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("audit logger: %v", err)
	}
	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("backend proxy: %v", err)
	}
	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	srv, err := NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("mcp server: %v", err)
	}
	if err := srv.Start(context.Background()); err != nil {
		t.Fatalf("mcp start: %v", err)
	}

	// Pre-flight: discover real resource names for use in inspect_* args
	t.Log("── Pre-flight resource discovery ──")
	cr := discoverResources(t, srv, clusterID)

	allTools := tools.ToolTaxonomy
	results := make([]phase2Result, 0, len(allTools))
	catStats := map[string]categoryStat{}

	passed, failed, skipped := 0, 0, 0
	var totalLatencyMs int64
	var failedNames []string

	t.Logf("\n%-45s  %-8s  %6s  %s", "TOOL", "STATUS", "LATENCY", "CONFIDENCE")
	t.Logf("%s", strings.Repeat("─", 80))

	for _, td := range allTools {
		name := td.Name
		cat := string(td.Category)

		r := phase2Result{
			ID:          name,
			Category:    cat,
			Destructive: td.Destructive,
			RequiresAI:  td.RequiresAI,
		}

		if td.Destructive {
			r.Status = "SKIPPED"
			r.SkipReason = "destructive — requires explicit approval; validated via dry-run separately"
			r.Confidence = "N/A"
			skipped++
			t.Logf("%-45s  %-8s  %6s  %s", name, "SKIP", "─", r.SkipReason[:50])
			cs := catStats[cat]; cs.Total++; cs.Skipped++; catStats[cat] = cs
			results = append(results, r)
			continue
		}

		args := minimalArgs(name, clusterID, cr)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		start := time.Now()
		out, execErr := callTool(srv, ctx, name, args)
		elapsed := time.Since(start)
		cancel()

		ms := elapsed.Milliseconds()
		r.AvgLatencyMs = ms
		r.AvgLatency = elapsed.Round(time.Millisecond).String()

		cs := catStats[cat]
		cs.Total++
		cs.AvgMs = (cs.AvgMs*int64(cs.Total-1) + ms) / int64(cs.Total)

		if execErr != nil {
			if strings.Contains(execErr.Error(), "context deadline exceeded") {
				r.Status = "TIMEOUT"
				r.Timeout = true
			} else {
				r.Status = "FAILED"
			}
			r.Verified = false
			r.SuccessRate = 0
			r.Confidence = "NONE"
			r.ErrorMessage = execErr.Error()
			failed++
			cs.Failed++
			failedNames = append(failedNames, name)
			t.Logf("%-45s  %-8s  %5dms  ✗ %s", name, r.Status, ms, truncate(execErr.Error(), 60))
		} else {
			keys := outputKeys(out)
			r.OutputKeys = keys
			r.OutputSample = sampleOutput(out)
			totalLatencyMs += ms
			passed++
			cs.Passed++

			if isAISynthesis(out) {
				r.Status = "PARTIAL"
				r.Verified = false
				r.SuccessRate = 50
				r.Confidence = "MEDIUM"
			} else {
				r.Status = "VERIFIED"
				r.Verified = true
				r.SuccessRate = 100
				r.Confidence = calcConfidence(ms, len(keys))
			}
			t.Logf("%-45s  %-8s  %5dms  %s  keys=%v",
				name, r.Status, ms, r.Confidence, keys)
		}

		catStats[cat] = cs
		results = append(results, r)
	}

	nonSkip := len(allTools) - skipped
	var avgMs int64
	if passed > 0 {
		avgMs = totalLatencyMs / int64(passed)
	}
	successRate := 0.0
	if nonSkip > 0 {
		successRate = float64(passed) / float64(nonSkip) * 100
	}

	report := phase2Report{
		GeneratedAt:  time.Now().Format(time.RFC3339),
		BackendURL:   backendURL,
		ClusterID:    clusterID,
		TotalTools:   len(allTools),
		Passed:       passed,
		Failed:       failed,
		Skipped:      skipped,
		AvgLatencyMs: avgMs,
		SuccessRate:  successRate,
		Tools:        results,
		ByCategory:   catStats,
		FailedTools:  failedNames,
	}

	b, _ := json.MarshalIndent(report, "", "  ")
	_ = os.MkdirAll("../../../../../reports/tool-validation", 0755)
	if err := os.WriteFile(outPath, b, 0644); err != nil {
		t.Logf("WARN: could not write report: %v", err)
	}

	t.Logf("\n%s", strings.Repeat("═", 60))
	t.Logf("  PHASE 2 RESULTS")
	t.Logf("%s", strings.Repeat("═", 60))
	t.Logf("  Total:    %d", len(allTools))
	t.Logf("  Passed:   %d  (%.1f%%)", passed, successRate)
	t.Logf("  Failed:   %d", failed)
	t.Logf("  Skipped:  %d  (destructive)", skipped)
	t.Logf("  Avg ms:   %d", avgMs)
	t.Logf("  Report:   %s", outPath)
	t.Logf("%s", strings.Repeat("═", 60))

	if len(failedNames) > 0 {
		t.Logf("\nFAILED TOOLS:")
		for _, fn := range failedNames {
			for _, r := range results {
				if r.ID == fn {
					t.Logf("  ✗ %-45s %s", fn, r.ErrorMessage)
				}
			}
		}
	}

	// Enforce: failure rate must be below 20% (allows for missing resources in test cluster)
	failRate := float64(failed) / float64(nonSkip) * 100
	if failRate > 20 {
		t.Errorf("Failure rate %.1f%% exceeds 20%% threshold (%d/%d tools failed)", failRate, failed, nonSkip)
	}
}

func init() {
	_ = fmt.Sprintf // suppress unused import
}
