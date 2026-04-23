package tools

import (
	"os"
	"strings"
	"testing"
)

// TestTaxonomy_NoRetiredObserveTools locks in the Week-1 retirement list.
// If a future commit re-introduces any of these, the build fails.
func TestTaxonomy_NoRetiredObserveTools(t *testing.T) {
	retired := []string{
		"observe_api_resources",
		"observe_cluster_overview",
		"observe_configmap_consumers",
		"observe_custom_resources",
		"observe_deployment_rollout_history",
		"observe_events",
		"observe_metrics",
		"observe_namespace_overview",
		"observe_network_policies",
		"observe_node_status",
		"observe_pod_dependencies",
		"observe_pod_logs",
		"observe_pod_logs_filtered",
		"observe_pvc_consumers",
		"observe_resource",
		"observe_resource_history",
		"observe_resource_links",
		"observe_resource_topology",
		"observe_resources_by_query",
		"observe_secret_consumers",
		"observe_service_endpoints",
		"observe_serviceaccount_detailed",
		"observe_serviceaccount_permissions",
		"observe_storage_status",
		"observe_workload_health",
	}
	names := map[string]bool{}
	for _, td := range ToolTaxonomy {
		names[td.Name] = true
	}
	for _, r := range retired {
		if names[r] {
			t.Errorf("retired tool %q still present in taxonomy", r)
		}
	}
}

// TestTaxonomy_NewWeek1ToolsPresent locks in the three new tools.
func TestTaxonomy_NewWeek1ToolsPresent(t *testing.T) {
	wanted := []string{"triage_cluster", "list_problems", "search_logs"}
	names := map[string]bool{}
	for _, td := range ToolTaxonomy {
		names[td.Name] = true
	}
	for _, w := range wanted {
		if !names[w] {
			t.Errorf("expected %q in taxonomy", w)
		}
	}
}

// TestTaxonomy_RetiredHaveAliases guards against a partial retirement that
// breaks bench scoring. Every retired name must map to something in
// cmd/bench/aliases.json (which is already true by our selection rule —
// this test locks it in).
func TestTaxonomy_RetiredHaveAliases(t *testing.T) {
	data, err := os.ReadFile("../../../cmd/bench/aliases.json")
	if err != nil {
		t.Skipf("aliases.json not reachable: %v", err)
		return
	}
	body := string(data)
	retired := []string{
		"observe_api_resources",
		"observe_cluster_overview",
		"observe_configmap_consumers",
		"observe_custom_resources",
		"observe_deployment_rollout_history",
		"observe_events",
		"observe_metrics",
		"observe_namespace_overview",
		"observe_network_policies",
		"observe_node_status",
		"observe_pod_dependencies",
		"observe_pod_logs",
		"observe_pod_logs_filtered",
		"observe_pvc_consumers",
		"observe_resource",
		"observe_resource_history",
		"observe_resource_links",
		"observe_resource_topology",
		"observe_resources_by_query",
		"observe_secret_consumers",
		"observe_service_endpoints",
		"observe_serviceaccount_detailed",
		"observe_serviceaccount_permissions",
		"observe_storage_status",
		"observe_workload_health",
	}
	for _, r := range retired {
		if !strings.Contains(body, `"`+r+`"`) {
			t.Errorf("retired tool %q has no alias entry — bench scoring will miss it", r)
		}
	}
}
