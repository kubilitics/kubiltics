package toolrouter

import "strings"

// Topic is a coarse bucket of capability the user is asking about. Topics
// exist purely for tool filtering — they are NOT taxonomy categories,
// autonomy levels, or safety classes. Keep the set small (the classifier
// is keyword-based; too many topics dilutes signal).
type Topic string

const (
	TopicCore       Topic = "core"       // always included: list/get/overview
	TopicLogs       Topic = "logs"       // pod/container logs, log patterns
	TopicEvents     Topic = "events"     // k8s events, error correlation
	TopicPods       Topic = "pods"       // pod health, restarts, scheduling
	TopicWorkloads  Topic = "workloads"  // deploy / sts / ds / job / cronjob / rs
	TopicNetworking Topic = "networking" // svc / ingress / endpoints / netpol / dns
	TopicStorage    Topic = "storage"    // pv / pvc / storageclass / volumes
	TopicNodes      Topic = "nodes"      // node status, pressure, capacity
	TopicRBAC       Topic = "rbac"       // roles / bindings / serviceaccounts / perms
	TopicSecurity   Topic = "security"   // vulns, secrets, pod security, compliance
	TopicCapacity   Topic = "capacity"   // rightsizing, HPA/VPA, scaling, efficiency
	TopicCost       Topic = "cost"       // cost analysis / forecast / optimization
	TopicChange     Topic = "change"     // drift, rollout history, deploy timeline
	TopicActions    Topic = "actions"    // mutation / execution / automation
)

// topicKeywords drives classification. Keep keywords lowercased; the
// classifier pads the message with spaces and matches on bounded
// substrings (see classify()). Favor high-precision terms — "error" goes in
// events (not logs) because "error" alone rarely means "grab logs".
//
// Principle: these are seed terms, not an exhaustive dictionary. The bench
// suite is the ground truth — tune when a prompt misclassifies.
var topicKeywords = map[Topic][]string{
	// core has no keywords — it is always selected.
	TopicLogs: {
		"log", "logs", "stdout", "stderr", "log pattern", "log patterns",
		"grep", "tail",
	},
	TopicEvents: {
		"event", "events", "oomkill", "oomkilled", "evicted", "warning",
		"warnings", "failed", "fail", "failing",
	},
	TopicPods: {
		"pod", "pods", "container", "containers", "restart", "restarts",
		"restarted", "crash", "crashloop", "crashloopbackoff", "pending",
		"scheduling", "schedule",
	},
	TopicWorkloads: {
		"deployment", "deployments", "deploy", "statefulset", "statefulsets",
		"sts", "daemonset", "daemonsets", "ds", "job", "jobs", "cronjob",
		"cronjobs", "replicaset", "replicasets", "rs", "replicas", "workload",
		"workloads",
	},
	TopicNetworking: {
		"services", "svc", "ingress", "ingresses", "endpoint",
		"endpoints", "networkpolicy", "network policy", "networkpolicies",
		"netpol", "dns", "connectivity", "network",
	},
	TopicStorage: {
		"pv", "pvc", "persistentvolume", "persistentvolumeclaim",
		"storageclass", "storage", "volume", "volumes", "snapshot",
	},
	TopicNodes: {
		"node", "nodes", "pressure", "capacity", "disk", "kernel",
		"kubelet", "control-plane", "control plane", "worker",
	},
	TopicRBAC: {
		"rbac", "role", "roles", "rolebinding", "rolebindings", "clusterrole",
		"clusterroles", "clusterrolebinding", "clusterrolebindings",
		"serviceaccount", "serviceaccounts", "service account",
		"service accounts", "sa", "permission",
		"permissions", "access", "privilege", "privileges", "who can",
		"cluster-admin", "cluster admin",
	},
	TopicSecurity: {
		"security", "vulnerability", "vulnerabilities", "cve", "secret",
		"secrets", "compliance", "audit", "exposure", "exposed", "hardening",
		"posture", "image scan",
	},
	TopicCapacity: {
		"hpa", "vpa", "autoscale", "autoscaler", "autoscaling", "scale",
		"scaling", "rightsize", "rightsizing", "efficiency", "limit",
		"limits", "request", "requests", "quota", "throttle", "throttling",
		"utilization", "capacity",
	},
	TopicCost: {
		"cost", "costs", "spend", "spending", "price", "pricing", "budget",
		"waste", "bill", "billing",
	},
	TopicChange: {
		"drift", "rollout", "rollback", "rolled back", "history", "changed",
		"changes", "diff", "revision", "deploy timeline",
	},
	TopicActions: {
		"restart pod", "restart the", "scale up", "scale down", "apply",
		"patch", "delete", "drain", "cordon", "rollback deployment",
		"run playbook", "automation",
	},
}

// ToolTopics returns the topics a tool belongs to, derived from its name.
//
// The vast majority of the 163-tool taxonomy follows regular prefixes
// (observe_pod_*, analyze_service_*, security_*, cost_*), so we avoid a
// hand-maintained 163-entry map and derive topics structurally. An override
// map handles edge cases where the prefix is ambiguous or the tool
// legitimately spans multiple topics.
//
// A tool may return multiple topics. The filter pipeline prefers tools
// whose topic best matches the user's primary intent.
func ToolTopics(name string) []Topic {
	if override, ok := toolTopicOverrides[name]; ok {
		return override
	}
	n := strings.ToLower(name)

	topics := map[Topic]bool{}

	// Core: universal lookup tools. Keep this set tiny — these are sent on
	// every call.
	switch n {
	case "list_resources", "get_resource", "get_cluster_health",
		"observe_cluster_overview", "observe_resource",
		"observe_resources_by_query", "observe_resource_links",
		"observe_namespace_overview":
		topics[TopicCore] = true
	}

	// Logs
	if strings.Contains(n, "log") || strings.Contains(n, "_logs") ||
		strings.Contains(n, "log_pattern") {
		topics[TopicLogs] = true
	}

	// Events
	if strings.Contains(n, "event") || strings.Contains(n, "_events") ||
		strings.Contains(n, "error_correlation") {
		topics[TopicEvents] = true
	}

	// Pods
	if strings.Contains(n, "pod") || strings.Contains(n, "scheduling") ||
		strings.Contains(n, "oom") || strings.Contains(n, "evict") {
		topics[TopicPods] = true
	}

	// Workloads (deploy/sts/ds/job/cronjob/rs + generic workload)
	for _, kw := range []string{
		"deployment", "statefulset", "daemonset", "replicaset",
		"cronjob", "_job_", "workload", "rollout",
	} {
		if strings.Contains(n, kw) {
			topics[TopicWorkloads] = true
			break
		}
	}
	if strings.HasSuffix(n, "_job") || strings.HasPrefix(n, "analyze_job") ||
		strings.HasPrefix(n, "observe_job") {
		topics[TopicWorkloads] = true
	}

	// Networking
	for _, kw := range []string{
		"service_", "_service", "ingress", "endpoint", "networkpolicy",
		"network_", "_network", "dns",
	} {
		if strings.Contains(n, kw) {
			topics[TopicNetworking] = true
			break
		}
	}

	// Storage
	for _, kw := range []string{
		"pvc", "_pv_", "storageclass", "storage_", "_storage", "volume",
	} {
		if strings.Contains(n, kw) {
			topics[TopicStorage] = true
			break
		}
	}

	// Nodes
	if strings.Contains(n, "node") {
		topics[TopicNodes] = true
	}

	// RBAC
	for _, kw := range []string{
		"rbac", "role", "rolebinding", "clusterrole", "serviceaccount",
		"permission",
	} {
		if strings.Contains(n, kw) {
			topics[TopicRBAC] = true
			break
		}
	}

	// Security
	for _, kw := range []string{
		"security", "vulnerabilit", "_secret", "secret_", "compliance",
		"audit",
	} {
		if strings.Contains(n, kw) {
			topics[TopicSecurity] = true
			break
		}
	}

	// Capacity
	for _, kw := range []string{
		"hpa", "vpa", "scale", "scaling", "rightsizing", "efficiency",
		"resource_limit", "capacity", "resourcequota", "limitrange",
		"pdb",
	} {
		if strings.Contains(n, kw) {
			topics[TopicCapacity] = true
			break
		}
	}

	// Cost
	if strings.HasPrefix(n, "cost_") || strings.Contains(n, "cost") {
		topics[TopicCost] = true
	}

	// Change
	for _, kw := range []string{
		"drift", "rollout_history", "rollback", "history",
		"configuration_drift",
	} {
		if strings.Contains(n, kw) {
			topics[TopicChange] = true
			break
		}
	}

	// Actions / mutations
	for _, prefix := range []string{
		"action_", "automation_", "restart_pod", "scale_deployment",
		"cordon_", "drain_", "apply_resource", "delete_resource",
		"rollback_deployment", "update_resource_limits", "trigger_hpa",
	} {
		if strings.HasPrefix(n, prefix) || strings.Contains(n, prefix) {
			topics[TopicActions] = true
			break
		}
	}

	out := make([]Topic, 0, len(topics))
	for t := range topics {
		out = append(out, t)
	}
	return out
}

// toolTopicOverrides captures names whose prefix-derived topics are wrong
// or incomplete. Keep this list short — every entry is tech debt.
var toolTopicOverrides = map[string][]Topic{
	// Cluster-wide observability belongs to core, not any single topic.
	"observe_cluster_overview": {TopicCore},
	"get_cluster_health":       {TopicCore},
	"list_resources":           {TopicCore},
	"get_resource":             {TopicCore},
	"observe_resource":         {TopicCore},
	"observe_resources_by_query": {TopicCore},

	// Metrics is technically observation; we route it via capacity + pods
	// because that's where it lives in real troubleshooting flows.
	"observe_metrics": {TopicCapacity, TopicPods, TopicNodes},

	// Topology tools are analysis, not a specific resource kind.
	"observe_resource_topology": {TopicCore},
	"export_topology_to_drawio": {TopicCore},

	// Blast-radius reasoning spans many topics; mark it as workloads+change
	// so it shows up on both rollout questions and incident triage.
	"analyze_blast_radius":   {TopicWorkloads, TopicChange},
	"analyze_rollout_risk":   {TopicWorkloads, TopicChange},
	"analyze_dependencies":   {TopicWorkloads, TopicNetworking},

	// Secret handlers are security-tagged; the raw "secret" substring in
	// topic detection above already does this but the override locks it.
	"observe_secret_detailed": {TopicSecurity, TopicRBAC},
	"observe_secret_events":   {TopicSecurity, TopicEvents},
	"observe_secret_consumers": {TopicSecurity},
	"security_scan_secrets":    {TopicSecurity},

	// Image vulns live under security even though the word "image" isn't
	// in our security keyword list.
	"analyze_image_vulnerabilities": {TopicSecurity},

	// Capacity trend/performance — multi-topic tools most engineers reach
	// for on incidents.
	"analyze_capacity_trends":        {TopicCapacity, TopicNodes},
	"analyze_performance_bottlenecks": {TopicCapacity, TopicPods},
	"analyze_resource_efficiency":    {TopicCapacity, TopicCost},

	// Recommendations: steer them by the noun they recommend over.
	"recommend_resource_optimization": {TopicCapacity, TopicCost},
	"recommend_cost_reduction":        {TopicCost},
	"recommend_security_hardening":    {TopicSecurity},
	"recommend_scaling_strategy":      {TopicCapacity, TopicWorkloads},
	"recommend_architecture_improvements": {TopicCore},
	"recommend_upgrade_path":           {TopicChange},
	"recommend_monitoring_improvements": {TopicCore},
	"recommend_disaster_recovery":      {TopicStorage, TopicChange},

	// inspect_<kind> composites (replaces per-kind detailed+events+ownership
	// since 2026-04-22). The prefix-based classifier catches most of them
	// via the substring of the kind name (e.g. "inspect_pod" contains "pod",
	// "inspect_deployment" contains "deployment"). These overrides nail down
	// the few whose kind doesn't appear in any topic keyword list.
	"inspect_pv":                  {TopicStorage},
	"inspect_pvc":                 {TopicStorage},
	"inspect_storageclass":        {TopicStorage},
	"inspect_namespace":           {TopicCore},
	"inspect_crd":                 {TopicCore, TopicChange},
	"inspect_secret":              {TopicSecurity, TopicRBAC},
	"inspect_configmap":           {TopicCore, TopicChange},
	"inspect_limitrange":          {TopicCapacity},
	"inspect_resourcequota":       {TopicCapacity},
	"inspect_role":                {TopicRBAC},
	"inspect_rolebinding":         {TopicRBAC},
	"inspect_clusterrole":         {TopicRBAC},
	"inspect_clusterrolebinding":  {TopicRBAC},
	"inspect_pdb":                 {TopicCapacity, TopicWorkloads},
	"inspect_hpa":                 {TopicCapacity, TopicWorkloads},
	"inspect_vpa":                 {TopicCapacity, TopicWorkloads},
	"inspect_networkpolicy":       {TopicNetworking, TopicSecurity},
	"inspect_ingress":             {TopicNetworking},
	"inspect_service":             {TopicNetworking},
	"inspect_node":                {TopicNodes},
	"inspect_pod":                 {TopicPods, TopicEvents},
	"inspect_deployment":          {TopicWorkloads, TopicChange, TopicEvents},
	"inspect_replicaset":          {TopicWorkloads, TopicEvents},
	"inspect_statefulset":         {TopicWorkloads, TopicEvents},
	"inspect_daemonset":           {TopicWorkloads, TopicEvents},
	"inspect_job":                 {TopicWorkloads, TopicEvents},
	"inspect_cronjob":             {TopicWorkloads, TopicEvents},

	// Gap closures (2026-04-22 bench): new tools must ship with explicit
	// topic routing so the router emits them for the right prompts.
	"resolve_resource":           {TopicCore},
	"observe_recent_changes":     {TopicChange, TopicEvents},
	"who_can_do":                 {TopicRBAC},
	"observe_pod_metrics":        {TopicPods, TopicCapacity},
	"observe_node_metrics":       {TopicNodes, TopicCapacity},
	"observe_top_pods_by_metric": {TopicPods, TopicCapacity},

	// Iteration 3 aggregators (2026-04-22 v2 bench).
	"observe_services_by_filter":      {TopicNetworking, TopicEvents},
	"observe_secrets_usage":           {TopicSecurity, TopicCore},
	"observe_ingresses_by_tls_expiry": {TopicNetworking, TopicSecurity},

	// Phase 3 Category 4 compliance checks.
	"check_privileged_containers":           {TopicSecurity, TopicPods},
	"check_root_containers":                 {TopicSecurity, TopicPods},
	"check_writable_root_fs":                {TopicSecurity, TopicPods},
	"check_capabilities_all_added":          {TopicSecurity, TopicPods},
	"check_host_path_mounts":                {TopicSecurity, TopicPods, TopicStorage},
	"check_default_service_accounts_in_use": {TopicSecurity, TopicRBAC},
	"check_secrets_in_env":                  {TopicSecurity},
	"check_image_tag_latest":                {TopicSecurity, TopicWorkloads},
	"check_ingress_tls_expiry_30d":          {TopicSecurity, TopicNetworking},
	"check_rbac_wildcards":                  {TopicSecurity, TopicRBAC},

	// Phase 3 Category 3 planning tools.
	"plan_scale_deployment":     {TopicCapacity, TopicWorkloads},
	"plan_drain_node":           {TopicNodes, TopicCapacity},
	"plan_rollout_safety":       {TopicWorkloads, TopicChange},
	"plan_cost_reduction":       {TopicCost, TopicCapacity},
	"plan_ha_upgrade":           {TopicWorkloads, TopicCapacity},
	"plan_resource_quota":       {TopicCapacity, TopicCore},
	"plan_psa_enforcement":      {TopicSecurity, TopicCore},
	"plan_image_pull_secrets":   {TopicSecurity, TopicCore},
	"plan_backup_coverage":      {TopicStorage, TopicWorkloads},
	"plan_pdb_coverage":         {TopicWorkloads, TopicCapacity},

	// Phase 3 Category 2 root-cause diagnostics.
	"diagnose_pod_not_ready":            {TopicPods, TopicEvents},
	"diagnose_service_no_endpoints":     {TopicNetworking, TopicPods},
	"diagnose_pvc_pending":              {TopicStorage, TopicEvents},
	"diagnose_ingress_404":              {TopicNetworking},
	"diagnose_deployment_rollback_needed": {TopicWorkloads, TopicChange},
	"diagnose_cronjob_missing_runs":     {TopicWorkloads},
	"diagnose_node_unschedulable":       {TopicNodes, TopicPods},
	"diagnose_hpa_not_scaling":          {TopicCapacity, TopicWorkloads},
	"diagnose_networkpolicy_blocking":   {TopicNetworking, TopicSecurity},
	"diagnose_certificate_failures":     {TopicSecurity, TopicNetworking, TopicEvents},

	// Phase 3 Category 1 observability aggregators — prefix-based topic
	// derivation doesn't catch most of these names, so pin them explicitly.
	"observe_flapping_services":        {TopicNetworking, TopicEvents},
	"observe_noisy_neighbors":          {TopicCapacity, TopicPods, TopicNodes},
	"observe_unhealthy_probes":         {TopicPods, TopicEvents},
	"observe_missing_probes":           {TopicWorkloads, TopicPods},
	"observe_orphaned_pods":            {TopicPods, TopicWorkloads},
	"observe_stuck_rollouts":           {TopicWorkloads, TopicChange},
	"observe_high_cardinality_labels":  {TopicCore},
	"observe_restart_storms":           {TopicPods, TopicEvents},
	"observe_pending_scheduler_events": {TopicPods, TopicEvents, TopicNodes},
	"observe_zombie_finalizers":        {TopicCore, TopicStorage},

	// Troubleshoot tools — route by the subsystem they troubleshoot.
	"troubleshoot_pod_failures":             {TopicPods, TopicEvents},
	"troubleshoot_network_issues":           {TopicNetworking},
	"troubleshoot_performance_degradation":  {TopicCapacity, TopicPods},
	"troubleshoot_deployment_failures":      {TopicWorkloads, TopicEvents},
	"troubleshoot_resource_constraints":     {TopicCapacity},
	"troubleshoot_rbac_issues":              {TopicRBAC},
	"troubleshoot_storage_issues":           {TopicStorage},
}
