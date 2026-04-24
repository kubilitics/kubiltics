package toolrouter

import (
	"sort"
	"strings"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
)

// newMockTaxonomy builds a small-but-realistic tool list covering every
// topic. Each tool's name mirrors the real taxonomy so ToolTopics() is
// exercised by its production rules.
func newMockTaxonomy() []types.Tool {
	names := []string{
		// core
		"list_resources",
		"get_resource",
		"get_cluster_health",
		"observe_cluster_overview",
		"observe_resource",
		// pods
		"observe_pod_detailed",
		"observe_pod_events",
		"observe_pod_logs",
		"observe_pod_logs_filtered",
		"analyze_pod_health",
		"analyze_pod_scheduling",
		"troubleshoot_pod_failures",
		// workloads
		"observe_deployment_detailed",
		"observe_deployment_rollout_history",
		"observe_statefulset_detailed",
		"observe_daemonset_detailed",
		"observe_job_detailed",
		"observe_cronjob_detailed",
		"analyze_deployment_health",
		"analyze_rollout_risk",
		// networking
		"observe_service_detailed",
		"observe_ingress_detailed",
		"observe_networkpolicy_detailed",
		"analyze_service_health",
		"analyze_network_connectivity",
		"troubleshoot_network_issues",
		// storage
		"observe_pvc_detailed",
		"observe_pv_detailed",
		"observe_storageclass_detailed",
		"analyze_storage_health",
		// nodes
		"observe_node_status",
		"observe_node_detailed",
		"analyze_node_pressure",
		// rbac
		"observe_role_detailed",
		"observe_rolebinding_detailed",
		"observe_clusterrolebinding_detailed",
		"observe_serviceaccount_permissions",
		"analyze_rbac_permissions",
		"troubleshoot_rbac_issues",
		// security
		"security_scan_cluster",
		"security_audit_rbac",
		"security_scan_secrets",
		"assess_security_posture",
		"analyze_image_vulnerabilities",
		"observe_secret_detailed",
		// capacity
		"observe_hpa_detailed",
		"observe_vpa_detailed",
		"analyze_hpa_behavior",
		"analyze_capacity_trends",
		"analyze_resource_efficiency",
		"recommend_scaling_strategy",
		// cost
		"cost_analyze_spending",
		"cost_identify_waste",
		"cost_forecast_spending",
		"recommend_cost_reduction",
		// change
		"detect_configuration_drift",
		// events
		"observe_events",
		"observe_namespace_events",
		"analyze_error_correlation",
		// actions
		"action_restart_workload",
		"action_rollback_deployment",
		"restart_pod",
		"scale_deployment",
		"drain_node",
		// logs
		"analyze_log_patterns",
	}
	out := make([]types.Tool, len(names))
	for i, n := range names {
		out[i] = types.Tool{Name: n, Description: "mock " + n}
	}
	return out
}

func toolNames(ts []types.Tool) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.Name
	}
	sort.Strings(out)
	return out
}

func containsTopic(ts []Topic, want Topic) bool {
	for _, t := range ts {
		if t == want {
			return true
		}
	}
	return false
}

func TestClassify_GoldenCases(t *testing.T) {
	cases := []struct {
		name   string
		q      string
		expect []Topic // subset assertion — each listed topic MUST be in result
	}{
		// Direct from incident-scenarios-20.json
		{"cluster-health", "Give me a quick health check of the whole cluster — what's running, what's broken, what should I worry about right now?", []Topic{TopicCore}},
		{"namespace-triage", "Is anything unhealthy in the demo namespace? If so, what and why?", []Topic{TopicCore}},
		{"deployment-status", "Show me the web deployment in demo — how many replicas, are they all ready, any recent restarts?", []Topic{TopicWorkloads, TopicPods}},
		{"flake-detect", "Any pods that have restarted more than once in the last hour?", []Topic{TopicPods}},
		{"log-peek", "Grab the latest logs from one of the web pods in demo.", []Topic{TopicLogs, TopicPods}},
		{"log-errors", "What errors or warnings are showing up in redis in the data namespace recently?", []Topic{TopicEvents}},
		{"events-recent", "What happened in the demo namespace in the last 15 minutes? Any events I should know about?", []Topic{TopicEvents}},
		{"oom-hunt", "Have any pods been OOMKilled or evicted cluster-wide recently?", []Topic{TopicEvents, TopicPods}},
		{"node-pressure", "Are any of my nodes under pressure — CPU, memory, disk?", []Topic{TopicNodes}},
		{"node-specific", "How is the kubilitics-test-control-plane node doing?", []Topic{TopicNodes}},
		{"capacity-scale", "Do I have enough capacity to scale the web deployment from 3 to 10 replicas?", []Topic{TopicCapacity, TopicWorkloads}},
		{"rbac-delete", "Who has permission to delete pods in the demo namespace?", []Topic{TopicRBAC}},
		{"rbac-admin", "Are any service accounts granted cluster-admin by accident?", []Topic{TopicRBAC}},
		{"storage", "Are my PVCs healthy in the data namespace?", []Topic{TopicStorage}},
		{"cost", "What is my biggest cost driver this month?", []Topic{TopicCost}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classify(tc.q)
			if !containsTopic(got, TopicCore) {
				t.Fatalf("core topic missing from %v", got)
			}
			for _, want := range tc.expect {
				if !containsTopic(got, want) {
					t.Errorf("topic %q missing from classify(%q) = %v", want, tc.q, got)
				}
			}
		})
	}
}

func TestClassify_NoKeywordMatch_FallsBackToPodsAndWorkloads(t *testing.T) {
	got := classify("hello world")
	if !containsTopic(got, TopicCore) || !containsTopic(got, TopicPods) || !containsTopic(got, TopicWorkloads) {
		t.Fatalf("default topics missing: %v", got)
	}
}

func TestClassify_AtMostMaxTopicsPlusCore(t *testing.T) {
	// Kitchen-sink question that touches every topic; the classifier
	// must still cap at MaxTopicsPerQuery + core.
	got := classify("pod logs events deployment service pvc node role secret hpa cost drift restart")
	if got[0] != TopicCore {
		t.Fatalf("core not first: %v", got)
	}
	if len(got) > MaxTopicsPerQuery+1 {
		t.Fatalf("topic cap exceeded: %d > %d: %v", len(got), MaxTopicsPerQuery+1, got)
	}
}

func TestPodAliases_AllHitPodsTopic(t *testing.T) {
	for _, q := range []string{
		"why is my pod crashing",
		"container restarts are going up",
		"pod errors",
		"lots of pods are pending",
		"something is crashlooping",
	} {
		got := classify(q)
		if !containsTopic(got, TopicPods) {
			t.Errorf("pods topic missing for %q -> %v", q, got)
		}
	}
}

func TestFilter_AlwaysIncludesCore(t *testing.T) {
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	sel := r.SelectTools("what is my biggest cost driver", all)
	names := toolNames(sel.Tools)
	for _, core := range []string{
		"list_resources", "get_resource", "get_cluster_health",
		"observe_cluster_overview", "observe_resource",
	} {
		found := false
		for _, n := range names {
			if n == core {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("core tool %q missing from cost query selection: %v", core, names)
		}
	}
}

func TestFilter_CapsAtMaxToolsPerCall(t *testing.T) {
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	// Query that legitimately spans multiple topics, many candidates.
	sel := r.SelectTools("pod logs events deployment node", all)
	if len(sel.Tools) > MaxToolsPerCall {
		t.Fatalf("selection %d exceeds cap %d", len(sel.Tools), MaxToolsPerCall)
	}
}

func TestFilter_PodsQueryIncludesPodTools(t *testing.T) {
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	sel := r.SelectTools("show me pods with restarts", all)
	names := strings.Join(toolNames(sel.Tools), ",")
	for _, want := range []string{"analyze_pod_health", "observe_pod_detailed"} {
		if !strings.Contains(names, want) {
			t.Errorf("expected %q in selection: %s", want, names)
		}
	}
}

func TestFilter_CostQueryPullsCostTools(t *testing.T) {
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	sel := r.SelectTools("forecast my cloud spend next month", all)
	names := strings.Join(toolNames(sel.Tools), ",")
	for _, want := range []string{"cost_forecast_spending", "cost_analyze_spending"} {
		if !strings.Contains(names, want) {
			t.Errorf("expected %q in cost-query selection: %s", want, names)
		}
	}
}

func TestFilter_RBACQueryPullsRBACTools(t *testing.T) {
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	sel := r.SelectTools("who has permission to delete pods", all)
	names := strings.Join(toolNames(sel.Tools), ",")
	for _, want := range []string{"analyze_rbac_permissions", "observe_rolebinding_detailed"} {
		if !strings.Contains(names, want) {
			t.Errorf("expected %q in rbac-query selection: %s", want, names)
		}
	}
}

func TestToolTopics_DerivedPrefixes(t *testing.T) {
	cases := map[string]Topic{
		"observe_pod_detailed":               TopicPods,
		"observe_deployment_rollout_history": TopicWorkloads,
		"observe_service_detailed":           TopicNetworking,
		"observe_pvc_detailed":               TopicStorage,
		"observe_node_status":                TopicNodes,
		"observe_rolebinding_detailed":       TopicRBAC,
		"security_scan_cluster":              TopicSecurity,
		"cost_analyze_spending":              TopicCost,
		"analyze_hpa_behavior":               TopicCapacity,
		"analyze_log_patterns":               TopicLogs,
		"observe_events":                     TopicEvents,
		"detect_configuration_drift":         TopicChange,
		"action_restart_workload":            TopicActions,
	}
	for name, want := range cases {
		got := ToolTopics(name)
		if !containsTopic(got, want) {
			t.Errorf("ToolTopics(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestToolTopics_OverridesWin(t *testing.T) {
	got := ToolTopics("observe_cluster_overview")
	if len(got) != 1 || got[0] != TopicCore {
		t.Errorf("override failed: got %v want [core]", got)
	}
}

// TestInspectComposites_RouteCorrectly locks the topic mapping for the
// inspect_<kind> composites introduced in 2026-04-22. Each composite must
// land in the topic(s) most engineers reach for on the matching incident.
func TestInspectComposites_RouteCorrectly(t *testing.T) {
	cases := []struct {
		name  string
		topic Topic
	}{
		{"inspect_pod", TopicPods},
		{"inspect_deployment", TopicWorkloads},
		{"inspect_service", TopicNetworking},
		{"inspect_pv", TopicStorage},
		{"inspect_node", TopicNodes},
		{"inspect_rolebinding", TopicRBAC},
		{"inspect_secret", TopicSecurity},
		{"inspect_hpa", TopicCapacity},
	}
	for _, tc := range cases {
		got := ToolTopics(tc.name)
		if !containsTopic(got, tc.topic) {
			t.Errorf("ToolTopics(%q) missing %v: %v", tc.name, tc.topic, got)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Iteration-3: priorityKey + aggregator-first sort
// ──────────────────────────────────────────────────────────────────────────

func TestPriorityKey_ClassifiesShapes(t *testing.T) {
	cases := map[string]int{
		// Aggregators
		"who_can_do":                     0,
		"analyze_blast_radius":           0,
		"resolve_resource":               0,
		"observe_recent_changes":         0,
		"observe_top_pods_by_metric":     0,
		"observe_pod_metrics":            0,
		"observe_node_metrics":           0,
		"observe_services_by_filter":     0,
		"observe_secrets_usage":          0,
		"observe_ingresses_by_tls_expiry": 0,
		// Composites
		"inspect_pod":        1,
		"inspect_deployment": 1,
		// Legacy
		"observe_pod_detailed":      2,
		"observe_deployment_events": 2,
		"list_resources":            2,
		"get_resource":              2,
	}
	for name, want := range cases {
		if got := priorityKey(name); got != want {
			t.Errorf("priorityKey(%q)=%d, want %d", name, got, want)
		}
	}
}

func TestFilterTools_AggregatorsSurfaceFirst(t *testing.T) {
	// Build a taxonomy where one aggregator, one composite and one legacy
	// tool all share the pods topic. Aggregator must come first.
	tools := []types.Tool{
		{Name: "observe_pod_detailed"},       // legacy, topic=pods
		{Name: "inspect_pod"},                // composite, topic=pods
		{Name: "observe_top_pods_by_metric"}, // aggregator, topic=pods+capacity
	}
	selected := filterTools([]Topic{TopicCore, TopicPods}, tools)
	if len(selected) < 3 {
		t.Fatalf("expected all 3 tools, got %d: %+v", len(selected), names(selected))
	}
	if selected[0].Name != "observe_top_pods_by_metric" {
		t.Errorf("expected aggregator first, got %q (all: %v)", selected[0].Name, names(selected))
	}
}

func TestFilterTools_CompositesBeatLegacyObservers(t *testing.T) {
	tools := []types.Tool{
		{Name: "observe_pod_detailed"}, // legacy
		{Name: "observe_pod_events"},   // legacy
		{Name: "inspect_pod"},          // composite
	}
	selected := filterTools([]Topic{TopicCore, TopicPods}, tools)
	// Composite must appear before either legacy per-resource observer.
	positions := map[string]int{}
	for i, tl := range selected {
		positions[tl.Name] = i
	}
	if positions["inspect_pod"] > positions["observe_pod_detailed"] ||
		positions["inspect_pod"] > positions["observe_pod_events"] {
		t.Errorf("composite must precede legacy observers, got order %v", names(selected))
	}
}

func TestFilterTools_LegacyObserversLast(t *testing.T) {
	tools := []types.Tool{
		{Name: "observe_service_detailed"},           // legacy
		{Name: "observe_services_by_filter"},         // aggregator
		{Name: "inspect_service"},                    // composite
		{Name: "observe_ingresses_by_tls_expiry"},    // aggregator
	}
	selected := filterTools([]Topic{TopicCore, TopicNetworking}, tools)
	positions := map[string]int{}
	for i, tl := range selected {
		positions[tl.Name] = i
	}
	// Both aggregators must come before composite and legacy observers.
	if positions["observe_service_detailed"] < positions["observe_services_by_filter"] {
		t.Errorf("legacy observer must come after aggregator, got %v", names(selected))
	}
	if positions["observe_service_detailed"] < positions["inspect_service"] {
		t.Errorf("legacy observer must come after composite, got %v", names(selected))
	}
}

func names(tools []types.Tool) []string {
	out := make([]string, 0, len(tools))
	for _, t := range tools {
		out = append(out, t.Name)
	}
	return out
}
