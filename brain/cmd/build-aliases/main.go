// build-aliases generates a high-precision alias map for the bench scoring
// step from /tmp/tools-catalog.json.
//
// Two tools alias each other when:
//   - They share the SAME primary resource noun (pod, deployment, …), AND
//   - They both belong to a "read-only / observation-equivalent" verb family
//     (observe_*, get_*, list_*, describe_*, analyze_*, diagnose_*).
//
// We deliberately exclude destructive verbs (delete_, drain_, restart_,
// scale_, rollback_, apply_, patch_, update_, create_, cordon_, uncordon_,
// remediate_, execute_, action_*, trigger_*) so a "delete pod" prompt
// isn't credited as semantic-equivalent of "list pods".
//
// Output: cmd/bench/aliases.json with bidirectional alias entries.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

type tool struct {
	Name     string `json:"name"`
	Category string `json:"category"`
}

// readVerbs are families considered semantically interchangeable for scoring
// purposes (the LLM picking either should still count as the right call).
var readVerbs = map[string]bool{
	"observe":    true,
	"get":        true,
	"list":       true,
	"describe":   true,
	"analyze":    true,
	"diagnose":   true,
	"check":      true,
	"detect":     true,
	"troubleshoot": true,
}

// destructiveVerbs are NEVER aliased even within their own resource group.
// Picking "delete_resource" when the prompt asked for "list_resources" is a
// hard miss, not a semantic match.
var destructiveVerbs = map[string]bool{
	"delete":    true,
	"drain":     true,
	"restart":   true,
	"scale":     true,
	"rollback":  true,
	"apply":     true,
	"patch":     true,
	"update":    true,
	"create":    true,
	"cordon":    true,
	"uncordon":  true,
	"remediate": true,
	"execute":   true,
	"trigger":   true,
	"approve":   true,
}

// canonicalNoun extracts the primary resource noun from a tool name.
// "observe_pod_detailed" → "pod"
// "analyze_deployment_health" → "deployment"
// "get_cluster_health" → "cluster"
// Returns "" if the name is too generic (one verb, no noun) — those tools
// won't be auto-aliased.
func canonicalNoun(name string) string {
	parts := strings.Split(name, "_")
	if len(parts) < 2 {
		return ""
	}
	// Strip the leading verb.
	rest := parts[1:]
	// Synonym normalisation (singular form).
	noun := rest[0]
	noun = strings.TrimSuffix(noun, "s")
	// Map close synonyms to one canonical bucket so e.g.
	// "resource" and "resources_by_query" land in the same group.
	switch noun {
	case "pod", "pods":
		return "pod"
	case "deployment":
		return "deployment"
	case "service":
		return "service"
	case "node":
		return "node"
	case "cluster":
		return "cluster"
	case "resource":
		return "resource"
	case "namespace":
		return "namespace"
	case "configmap":
		return "configmap"
	case "secret":
		return "secret"
	case "ingress":
		return "ingress"
	case "event":
		return "event"
	case "log":
		return "log"
	case "metric":
		return "metric"
	}
	return noun
}

// verbOf returns the leading verb of a tool name ("observe_pod_*" → "observe").
func verbOf(name string) string {
	parts := strings.SplitN(name, "_", 2)
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func main() {
	in := flag.String("in", "/tmp/tools-catalog.json", "tools-catalog JSON")
	out := flag.String("out", "cmd/bench/aliases.json", "output aliases JSON")
	flag.Parse()

	data, err := os.ReadFile(*in)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(1)
	}
	var tools []tool
	if err := json.Unmarshal(data, &tools); err != nil {
		fmt.Fprintln(os.Stderr, "parse:", err)
		os.Exit(1)
	}

	// Group read-verb tools by canonical noun.
	groups := map[string][]string{}
	for _, t := range tools {
		v := verbOf(t.Name)
		if destructiveVerbs[v] {
			continue
		}
		if !readVerbs[v] {
			continue
		}
		noun := canonicalNoun(t.Name)
		if noun == "" {
			continue
		}
		groups[noun] = append(groups[noun], t.Name)
	}

	// Build bidirectional alias map. Only emit a sibling list when the group
	// has 2+ entries; sort for determinism.
	aliases := map[string][]string{}
	for _, names := range groups {
		if len(names) < 2 {
			continue
		}
		sort.Strings(names)
		for _, n := range names {
			for _, m := range names {
				if m == n {
					continue
				}
				aliases[n] = append(aliases[n], m)
			}
		}
	}

	// Manual high-value cross-noun aliases the noun-grouping misses.
	manual := map[string][]string{
		"observe_pod_logs":          {"get_logs", "observe_pod_logs_filtered"},
		"get_logs":                  {"observe_pod_logs", "observe_pod_logs_filtered"},
		"observe_pod_logs_filtered": {"observe_pod_logs", "get_logs"},
		"observe_events":            {"get_events", "observe_pod_events"},
		"get_events":                {"observe_events"},
		// (observe_metrics aliases live in the cost block below to avoid duplicate keys)
		"observe_cluster_overview":  {"get_cluster_health", "observe_namespace_overview", "analyze_workload_patterns"},
		"get_cluster_health":        {"observe_cluster_overview", "analyze_workload_patterns"},
		// Workload-shaped overlap (deployment / replicaset / statefulset / daemonset / pod)
		"observe_workload_health":   {"analyze_deployment_health", "analyze_pod_health", "analyze_replicaset_health", "analyze_statefulset_health", "analyze_daemonset_health"},
		"analyze_workload_patterns": {"observe_cluster_overview", "analyze_resource_efficiency"},
		// Topology / dependencies overlap
		"observe_resource_topology": {"export_topology_to_drawio", "observe_resource_links", "analyze_dependencies"},
		"observe_resource_links":    {"observe_resource_topology", "analyze_dependencies"},
		"analyze_dependencies":      {"observe_resource_topology", "observe_resource_links", "observe_pod_dependencies"},
		// Storage
		"observe_storage_status":    {"observe_pvc_detailed", "observe_pv_detailed", "analyze_storage_health"},
		"analyze_storage_health":    {"observe_storage_status"},
		// Networking
		"analyze_network_connectivity": {"troubleshoot_network_issues", "observe_network_policies"},
		"troubleshoot_network_issues":  {"analyze_network_connectivity", "observe_network_policies"},
		// Security
		"security_audit_rbac":            {"analyze_rbac_permissions", "troubleshoot_rbac_issues"},
		"analyze_rbac_permissions":       {"security_audit_rbac", "troubleshoot_rbac_issues"},
		"troubleshoot_rbac_issues":       {"security_audit_rbac", "analyze_rbac_permissions"},
		"security_scan_cluster":          {"assess_security_posture", "security_check_pod_security"},
		"assess_security_posture":        {"security_scan_cluster", "security_compliance_report"},
		// Cost — forecast / analyze share the same intent surface for "what
		// is my spending doing?" prompts; the LLM picks them interchangeably.
		"cost_analyze_spending":          {"cost_identify_waste", "cost_optimization_plan", "cost_forecast_spending"},
		"cost_forecast_spending":         {"cost_analyze_spending", "cost_optimization_plan"},
		"cost_optimization_plan":         {"cost_analyze_spending", "cost_identify_waste", "recommend_cost_reduction", "cost_forecast_spending"},
		"recommend_cost_reduction":       {"cost_optimization_plan", "cost_identify_waste"},
		// API / custom resource discovery
		"observe_custom_resources": {"observe_api_resources"},
		"observe_api_resources":    {"observe_custom_resources"},
		// Topology export
		"export_topology_to_drawio": {"observe_resource_topology"},
		// Metrics → cluster overview is a common LLM substitution for "show metrics"
		"observe_metrics":           {"observe_cluster_overview", "get_cluster_health"},
		// action_scale_workload retired 2026-04-22 (see docs/strategy/2026-04-22-tool-audit.md).
		// action_restart_workload, action_rollback_deployment, action_apply_manifest retired d9215a06.
		"scale_deployment":  {"trigger_hpa_scale"},
		// Resource fetch family (intentionally crosses verbs — read-only)
		"get_resource":              {"observe_resource", "list_resources", "observe_resources_by_query"},
		"observe_resource":          {"get_resource", "list_resources", "observe_resources_by_query"},
		"list_resources":            {"get_resource", "observe_resource", "observe_resources_by_query"},
		"observe_resources_by_query": {"get_resource", "observe_resource", "list_resources"},
	}
	for k, v := range manual {
		// Merge with auto-generated, dedupe.
		set := map[string]bool{}
		for _, e := range aliases[k] {
			set[e] = true
		}
		for _, e := range v {
			set[e] = true
		}
		merged := make([]string, 0, len(set))
		for e := range set {
			if e != k {
				merged = append(merged, e)
			}
		}
		sort.Strings(merged)
		aliases[k] = merged
	}

	// Emit JSON with stable key ordering + a _doc header.
	keys := make([]string, 0, len(aliases))
	for k := range aliases {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("{\n")
	b.WriteString(`  "_doc": "Tools that are functionally siblings — picking either should count as a semantic match. Auto-built by cmd/build-aliases from /tmp/tools-catalog.json. Read-only verb families only; destructive verbs intentionally excluded."`)
	for _, k := range keys {
		b.WriteString(",\n  ")
		kj, _ := json.Marshal(k)
		vj, _ := json.Marshal(aliases[k])
		b.Write(kj)
		b.WriteString(": ")
		b.Write(vj)
	}
	b.WriteString("\n}\n")

	if err := os.WriteFile(*out, []byte(b.String()), 0644); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "wrote %d alias entries -> %s\n", len(aliases), *out)
}
