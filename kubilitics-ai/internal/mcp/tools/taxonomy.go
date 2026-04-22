package tools

// ToolCategory represents the category of MCP tools
type ToolCategory string

const (
	// Observation tools - Read-only cluster state queries
	CategoryObservation ToolCategory = "observation"

	// Analysis tools - Intelligent insights and diagnostics
	CategoryAnalysis ToolCategory = "analysis"

	// Recommendation tools - AI-powered suggestions
	CategoryRecommendation ToolCategory = "recommendation"

	// Action tools - Cluster modifications (requires approval)
	CategoryAction ToolCategory = "action"

	// Troubleshooting tools - Problem detection and resolution
	CategoryTroubleshooting ToolCategory = "troubleshooting"

	// Security tools - Security analysis and compliance
	CategorySecurity ToolCategory = "security"

	// Cost tools - Resource optimization and cost analysis
	CategoryCost ToolCategory = "cost"

	// Automation tools - Workflow and automation
	CategoryAutomation ToolCategory = "automation"

	// Execution tools - Safety-gated cluster mutations (A-CORE-004)
	// Every tool in this category passes through the Safety Engine before executing.
	CategoryExecution ToolCategory = "execution"
)

// ToolDefinition defines a complete MCP tool specification
type ToolDefinition struct {
	Name                  string       `json:"name"`
	Category              ToolCategory `json:"category"`
	Description           string       `json:"description"`
	InputSchema           interface{}  `json:"inputSchema"`
	Destructive           bool         `json:"destructive"`
	RequiresAI            bool         `json:"requiresAI"`
	RequiredAutonomyLevel int          `json:"requiredAutonomyLevel"` // 1=Observe, 2=Recommend, 3=Propose, 4=Act, 5=Autonomous
}

// Kubilitics AI MCP Tool Taxonomy - 100x More Powerful
//
// This taxonomy defines 50+ advanced tools organized into 8 categories,
// designed to be 100x more powerful than existing K8s MCP servers.
//
// Key Innovations:
// 1. AI-Powered Intelligence: Tools that reason, not just query
// 2. Autonomous Troubleshooting: Multi-step investigation workflows
// 3. Predictive Analysis: Future state predictions and anomaly detection
// 4. Security-First: Built-in security scanning and compliance checks
// 5. Cost Optimization: Real-time cost analysis and waste detection
// 6. Self-Healing: Automated remediation with human approval
// 7. Cross-Resource Analysis: Understanding relationships and dependencies
// 8. Natural Language: Conversational interface over CLI commands

var ToolTaxonomy = []ToolDefinition{
	// === OBSERVATION TOOLS (15 tools) ===
	// Read-only cluster state queries with intelligent filtering
	// Autonomy Level: 1 (Observe)

	{
		Name:                  "observe_cluster_overview",
		Category:              CategoryObservation,
		Description:           "Get comprehensive cluster overview with health, capacity, and resource distribution. Returns intelligent summary with anomaly detection.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 1,
	},
	{
		Name:        "observe_resource",
		Category:    CategoryObservation,
		Description: "Get detailed information about a specific resource (Pod, Deployment, Service, etc.) with intelligent context about relationships and dependencies.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_resources_by_query",
		Category:    CategoryObservation,
		Description: "Query resources using natural language. Example: 'all pods in production with high CPU' or 'failing deployments in last hour'.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "resolve_resource",
		Category:    CategoryObservation,
		Description: "Resolve a resource kind + fuzzy name hint to its concrete {namespace, name} across the whole cluster. Call this FIRST when you know the kind (e.g. 'deployment', 'configmap', 'service') but are not sure which namespace the resource lives in. Returns up to 5 matches (exact → prefix → substring) with a suggestions list if nothing matches.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":   map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"kind":         map[string]interface{}{"type": "string", "description": "Resource kind e.g. 'Deployment', 'Service', 'ConfigMap' (required)"},
				"name_hint":    map[string]interface{}{"type": "string", "description": "Resource name or fuzzy substring hint (required)"},
				"cluster_wide": map[string]interface{}{"type": "boolean", "description": "Whether to search across all namespaces (default true)"},
			},
			"required": []string{"kind", "name_hint"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_pod_detailed retired 2026-04-22: folded into inspect_pod (along with
	// observe_pod_events + observe_pod_ownership_chain). Underlying handler
	// handlePodDetailed stays alive in handlers_observation.go.
	{
		Name:        "inspect_pod",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Pod: current spec+status, recent events, ownership chain (RS → Deployment). Replaces observe_pod_detailed + observe_pod_events + observe_pod_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Pod name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pod_dependencies",
		Category:    CategoryObservation,
		Description: "Map all configuration and storage dependencies for a pod (ConfigMaps, Secrets, PVCs, PVs). Useful for diagnosing 'stuck' pods due to missing secrets/volumes.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Pod name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pod_logs",
		Category:    CategoryObservation,
		Description: "Stream or retrieve pod logs with intelligent filtering. Supports 'filter' (regex for error/warning) and 'tail_lines' (default 10).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Optional container name"},
				"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of lines to return (default 10)"},
				"filter":         map[string]interface{}{"type": "string", "description": "Optional regex/text filter (e.g. 'error', 'warning', 'timeout')"},
			},
			"required": []string{"namespace", "pod_name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_pod_logs_filtered",
		Category:    CategoryObservation,
		Description: "Retrieve pod logs filtered by 'error' or 'warn' (PRD: error logs + warning logs). Use filter=error or filter=warn. Same as observe_pod_logs with filter set.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Optional container name"},
				"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of lines to return (default 10)"},
				"filter":         map[string]interface{}{"type": "string", "description": "Filter: 'error' or 'warn' (required for this tool)"},
			},
			"required": []string{"namespace", "pod_name", "filter"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_pod_ownership_chain retired 2026-04-22: folded into inspect_pod.
	{
		Name:        "observe_resource_links",
		Category:    CategoryObservation,
		Description: "Trace and return relationships between resources (e.g. which Service points to which Pods, which Deployment owns which ReplicaSet).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"kind":      map[string]interface{}{"type": "string", "description": "Resource kind (e.g. Deployment, Service)"},
				"name":      map[string]interface{}{"type": "string", "description": "Resource name"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_events",
		Category:    CategoryObservation,
		Description: "Get cluster events with intelligent grouping, correlation, and impact analysis.",
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_pod_events retired 2026-04-22: folded into inspect_pod.
	{
		Name:        "observe_resource_topology",
		Category:    CategoryObservation,
		Description: "Visualize resource relationships and dependencies with intelligent graph analysis.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "export_topology_to_drawio",
		Category:    CategoryObservation,
		Description: "Export cluster topology as an editable diagram. Returns a draw.io URL that opens the architecture diagram in a new tab. Use when user asks for 'architecture diagram', 'show me the topology', or 'export to draw.io'.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_resource_history",
		Category:    CategoryObservation,
		Description: "Get temporal history of resource changes, revisions, and state transitions.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_metrics",
		Category:    CategoryObservation,
		Description: "Get current CPU/memory metrics for a resource. For pod, deployment, replicaset, statefulset, daemonset, job, cronjob namespace is required. For node only name is required.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":     map[string]interface{}{"type": "string", "description": "Cluster ID (optional; defaults to first cluster)"},
				"namespace":      map[string]interface{}{"type": "string", "description": "Namespace (required for pod, deployment, replicaset, statefulset, daemonset, job, cronjob)"},
				"kind":           map[string]interface{}{"type": "string", "description": "Resource kind: pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob"},
				"resource_type":  map[string]interface{}{"type": "string", "description": "Alias for kind"},
				"name":           map[string]interface{}{"type": "string", "description": "Resource name"},
				"resource_name":  map[string]interface{}{"type": "string", "description": "Alias for name"},
			},
			"required": []string{"kind", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_node_status",
		Category:    CategoryObservation,
		Description: "Get detailed node health, capacity, and workload distribution with recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_node_detailed + observe_node_events retired 2026-04-22: folded into inspect_node.
	{
		Name:        "inspect_node",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Node: spec+status (capacity, taints, conditions) and recent events. Replaces observe_node_detailed + observe_node_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Node name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_namespace_overview",
		Category:    CategoryObservation,
		Description: "Get comprehensive namespace overview with quotas, limits, and resource usage.",
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_namespace_detailed + observe_namespace_events retired 2026-04-22: folded into inspect_namespace.
	{
		Name:        "inspect_namespace",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Namespace: metadata, status phase, pod count and recent events. Replaces observe_namespace_detailed + observe_namespace_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Namespace name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_workload_health",
		Category:    CategoryObservation,
		Description: "Get intelligent health assessment of workloads (Deployments, StatefulSets, DaemonSets).",
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_service_detailed + observe_service_events retired 2026-04-22: folded into inspect_service.
	{
		Name:        "inspect_service",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Service: spec (type, ports, selector), endpoints, pods selected and recent events. Replaces observe_service_detailed + observe_service_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Service name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_service_endpoints",
		Category:    CategoryObservation,
		Description: "Return Service endpoints (subsets/addresses) and summary of which pods back the service. Use for 'which pods back this service?'.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Service name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_ingress_detailed + observe_ingress_events retired 2026-04-22: folded into inspect_ingress.
	{
		Name:        "inspect_ingress",
		Category:    CategoryObservation,
		Description: "One-call deep dive into an Ingress: spec (rules, tls, ingressClassName), backend services and recent events. Replaces observe_ingress_detailed + observe_ingress_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Ingress name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_networkpolicy_detailed + observe_networkpolicy_events retired 2026-04-22: folded into inspect_networkpolicy.
	{
		Name:        "inspect_networkpolicy",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a NetworkPolicy: spec (podSelector, policyTypes, ingress/egress), pods selected and recent events. Replaces observe_networkpolicy_detailed + observe_networkpolicy_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "NetworkPolicy name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_network_policies",
		Category:    CategoryObservation,
		Description: "Analyze network policies with traffic flow visualization and gap detection.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_deployment_rollout_history",
		Category:    CategoryObservation,
		Description: "Retrieve detailed rollout history for a deployment, including revisions, image changes, and timestamps. Essential for rollback decision making.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_deployment_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_deployment.
	{
		Name:        "inspect_deployment",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Deployment: spec+status, rollout history, recent events, child ReplicaSets. Replaces observe_deployment_detailed + observe_deployment_events + observe_deployment_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_replicaset_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_replicaset.
	{
		Name:        "inspect_replicaset",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a ReplicaSet: spec+status, recent events, ownership chain (parent Deployment → child Pods). Replaces observe_replicaset_detailed + observe_replicaset_events + observe_replicaset_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ReplicaSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_statefulset_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_statefulset.
	{
		Name:        "inspect_statefulset",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a StatefulSet: spec+status, update strategy, recent events, child Pods. Replaces observe_statefulset_detailed + observe_statefulset_events + observe_statefulset_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "StatefulSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_daemonset_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_daemonset.
	{
		Name:        "inspect_daemonset",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a DaemonSet: spec+status, recent events, child Pods. Replaces observe_daemonset_detailed + observe_daemonset_events + observe_daemonset_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "DaemonSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_job_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_job.
	{
		Name:        "inspect_job",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Job: spec+status, completion/backoff state, recent events, ownership chain (parent CronJob → child Pods). Replaces observe_job_detailed + observe_job_events + observe_job_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Job name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_cronjob_detailed + _events + _ownership_chain retired 2026-04-22: folded into inspect_cronjob.
	{
		Name:        "inspect_cronjob",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a CronJob: schedule, suspend, last run, recent events, child Jobs. Replaces observe_cronjob_detailed + observe_cronjob_events + observe_cronjob_ownership_chain.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "CronJob name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_pvc_detailed + observe_pvc_events retired 2026-04-22: folded into inspect_pvc.
	{
		Name:        "inspect_pvc",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a PersistentVolumeClaim: spec (accessModes, storage, storageClassName), status (phase, capacity), bound volume and recent events. Replaces observe_pvc_detailed + observe_pvc_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "PVC name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pvc_consumers",
		Category:    CategoryObservation,
		Description: "Return pods and workloads (Deployments, StatefulSets, etc.) that use this PVC. Use for 'which pods use this PVC?'.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "PVC name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_pv_detailed + observe_pv_events retired 2026-04-22: folded into inspect_pv.
	{
		Name:        "inspect_pv",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a PersistentVolume (cluster-scoped): spec (capacity, accessModes, reclaimPolicy, claimRef), status and recent events. Replaces observe_pv_detailed + observe_pv_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "PV name (required); cluster-scoped"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_storageclass_detailed + observe_storageclass_events retired 2026-04-22: folded into inspect_storageclass.
	{
		Name:        "inspect_storageclass",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a StorageClass (cluster-scoped): provisioner, parameters, volumeBindingMode, pv count and recent events. Replaces observe_storageclass_detailed + observe_storageclass_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "StorageClass name (required); cluster-scoped"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_storage_status",
		Category:    CategoryObservation,
		Description: "Get storage utilization, PV/PVC status, and capacity planning insights.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_serviceaccount_detailed",
		Category:    CategoryObservation,
		Description: "ServiceAccount detail: metadata, token count, pods using this SA, RoleBindings and ClusterRoleBindings that reference it, risk flags.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ServiceAccount name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_serviceaccount_events retired 2026-04-22: SA events are empty on the
	// happy path, which caused the LLM to call this tool 15+ times in a row
	// (bench-scen-workload-17.jsonl) trying to extract signal that isn't there.
	// Use observe_serviceaccount_permissions for RBAC questions and observe_events
	// for the rare SA-related event. See docs/strategy/2026-04-22-tool-audit.md.
	{
		Name:        "observe_serviceaccount_permissions",
		Category:    CategoryObservation,
		Description: "Resolved permissions for a ServiceAccount: RoleBindings, ClusterRoleBindings, and summary of Role/ClusterRole rules (PRD Layer 7).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ServiceAccount name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	// observe_role_detailed + observe_role_events retired 2026-04-22: folded into inspect_role.
	{
		Name:        "inspect_role",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Role: rules, referencing RoleBindings and recent events. Replaces observe_role_detailed + observe_role_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Role name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_rolebinding_detailed + observe_rolebinding_events retired 2026-04-22: folded into inspect_rolebinding.
	{
		Name:        "inspect_rolebinding",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a RoleBinding: roleRef, subjects, resolved Role/ClusterRole summary and recent events. Replaces observe_rolebinding_detailed + observe_rolebinding_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "RoleBinding name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_clusterrole_detailed + observe_clusterrole_events retired 2026-04-22: folded into inspect_clusterrole.
	{
		Name:        "inspect_clusterrole",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a ClusterRole (cluster-scoped): rules, referencing ClusterRoleBindings and recent events. Replaces observe_clusterrole_detailed + observe_clusterrole_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRole name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_clusterrolebinding_detailed + observe_clusterrolebinding_events retired 2026-04-22: folded into inspect_clusterrolebinding.
	{
		Name:        "inspect_clusterrolebinding",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a ClusterRoleBinding (cluster-scoped): roleRef, subjects, resolved ClusterRole and recent events. Replaces observe_clusterrolebinding_detailed + observe_clusterrolebinding_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRoleBinding name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_secret_detailed + observe_secret_events retired 2026-04-22: folded into inspect_secret.
	{
		Name:        "inspect_secret",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a Secret: metadata, type, data keys (values redacted), TLS info and recent events. Replaces observe_secret_detailed + observe_secret_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Secret name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_secret_consumers",
		Category:    CategoryObservation,
		Description: "Pods and workloads (Deployments) that reference this Secret.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Secret name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// Resources: ConfigMaps, LimitRanges, ResourceQuotas, HPA, PDB (Layer 1)
	// observe_configmap_detailed + observe_configmap_events retired 2026-04-22: folded into inspect_configmap.
	{
		Name:        "inspect_configmap",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a ConfigMap: metadata, data keys, consumers and recent events. Replaces observe_configmap_detailed + observe_configmap_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ConfigMap name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_configmap_consumers",
		Category:    CategoryObservation,
		Description: "Pods and workloads (Deployments) that reference this ConfigMap. PRD: observe_configmap_usage.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ConfigMap name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_limitrange_detailed + observe_limitrange_events retired 2026-04-22: folded into inspect_limitrange.
	{
		Name:        "inspect_limitrange",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a LimitRange: spec (limits: type, default, defaultRequest, max, min) and recent events. Replaces observe_limitrange_detailed + observe_limitrange_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "LimitRange name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_resourcequota_detailed + observe_resourcequota_events retired 2026-04-22: folded into inspect_resourcequota.
	{
		Name:        "inspect_resourcequota",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a ResourceQuota: spec (hard), status (used) and recent events. Replaces observe_resourcequota_detailed + observe_resourcequota_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ResourceQuota name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_hpa_detailed + observe_hpa_events retired 2026-04-22: folded into inspect_hpa.
	{
		Name:        "inspect_hpa",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a HorizontalPodAutoscaler: spec (minReplicas/maxReplicas/scaleTargetRef), status and recent events. Replaces observe_hpa_detailed + observe_hpa_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "HPA name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_pdb_detailed + observe_pdb_events retired 2026-04-22: folded into inspect_pdb.
	{
		Name:        "inspect_pdb",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a PodDisruptionBudget: spec (minAvailable/maxUnavailable/selector), status and recent events. Replaces observe_pdb_detailed + observe_pdb_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "PDB name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// Scaling: VerticalPodAutoscalers (VPA)
	// observe_vpa_detailed + observe_vpa_events retired 2026-04-22: folded into inspect_vpa.
	{
		Name:        "inspect_vpa",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a VerticalPodAutoscaler: spec (targetRef, updatePolicy, resourcePolicy), status and recent events. Replaces observe_vpa_detailed + observe_vpa_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "VPA name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_api_resources",
		Category:    CategoryObservation,
		Description: "List all available API resources with intelligent categorization and usage examples.",
		Destructive: false,
		RequiresAI:  false,
	},
	// observe_crd_detailed + observe_crd_events retired 2026-04-22: folded into inspect_crd.
	{
		Name:        "inspect_crd",
		Category:    CategoryObservation,
		Description: "One-call deep dive into a CustomResourceDefinition (cluster-scoped): spec (group, names, scope, versions), instances count and recent events. Replaces observe_crd_detailed + observe_crd_events.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "CustomResourceDefinition name (required); cluster-scoped"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_custom_resources",
		Category:    CategoryObservation,
		Description: "Get CRDs and custom resources with validation schema analysis.",
		Destructive: false,
		RequiresAI:  true,
	},

	// ─── Live metrics adapter (gap 1, 2026-04-22 bench) ───
	{
		Name:        "observe_pod_metrics",
		Category:    CategoryObservation,
		Description: "Get live CPU/memory for a pod (name+namespace) OR an aggregate summary for a namespace (namespace only, no name). Returns a structured metrics-unavailable fallback if metrics-server is not installed.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":  map[string]interface{}{"type": "string"},
				"namespace":   map[string]interface{}{"type": "string", "description": "Namespace (required when 'name' is given)"},
				"name":        map[string]interface{}{"type": "string", "description": "Pod name (optional; omit for namespace/cluster aggregate)"},
				"metric_type": map[string]interface{}{"type": "string", "enum": []string{"cpu", "memory", "all"}, "description": "Metric to emphasize (default 'all')"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_node_metrics",
		Category:    CategoryObservation,
		Description: "Get live CPU/memory/disk metrics for a specific node (if 'name' given) or all nodes. Returns a metrics-unavailable fallback when metrics-server is absent.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"name":       map[string]interface{}{"type": "string", "description": "Node name (optional)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_top_pods_by_metric",
		Category:    CategoryObservation,
		Description: "Return the top-N pods sorted by a live metric (cpu or memory). Useful for 'which pod uses most CPU right now' without enumerating every pod. Returns a metrics-unavailable fallback when metrics-server is absent.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":  map[string]interface{}{"type": "string"},
				"metric_type": map[string]interface{}{"type": "string", "enum": []string{"cpu", "memory"}, "description": "Which metric to rank by (required)"},
				"namespace":   map[string]interface{}{"type": "string", "description": "Restrict to a namespace (optional)"},
				"limit":       map[string]interface{}{"type": "integer", "description": "Max pods to return (default 10)"},
			},
			"required": []string{"metric_type"},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// ─── Iteration 3 aggregators (2026-04-22 v2 bench) ───
	{
		Name:        "observe_services_by_filter",
		Category:    CategoryObservation,
		Description: "ALWAYS use this for 'flapping services' / 'services with no endpoints' / cluster-wide service-health questions. Returns Services matching any requested filter with a short reason. Filters: flapping=true (endpoint churn events in last 15m), no_endpoints=true (zero ready endpoints). When no filter is passed, both are implied.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":   map[string]interface{}{"type": "string"},
				"flapping":     map[string]interface{}{"type": "boolean", "description": "Include services whose endpoints have churned in the last 15 minutes"},
				"no_endpoints": map[string]interface{}{"type": "boolean", "description": "Include services with zero ready endpoints"},
				"namespace":    map[string]interface{}{"type": "string", "description": "Restrict to a namespace (optional — default is cluster-wide)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_secrets_usage",
		Category:    CategoryObservation,
		Description: "ALWAYS use this for 'unused secrets' / 'which secrets are referenced by workloads' questions. Returns every Secret with a reference graph {mounted_by_pods, mounted_as_env_by_pods, unused}. Filters out service-account and helm ownership secrets from the unused count so the signal is real.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Restrict to a namespace (optional — default is cluster-wide)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_ingresses_by_tls_expiry",
		Category:    CategoryObservation,
		Description: "ALWAYS use this for 'certs about to expire' / 'which ingresses have TLS expiring soon' questions. Returns Ingresses whose TLS certs expire within 'days' (default 30). Falls back gracefully with {tls_inspection_unavailable:true, reason} on clusters that don't expose TLS inspection.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"days":       map[string]interface{}{"type": "integer", "description": "Expiry window in days (default 30)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Restrict to a namespace (optional)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// ─── Timeline fusion (gap 4, 2026-04-22 bench) ───
	{
		Name:        "observe_recent_changes",
		Category:    CategoryObservation,
		Description: "Return all meaningful changes (deployment rollouts, pod create/delete, configmap/secret updates, scaling events, failures) inside a time window. Fuses k8s events + deployment rollout history. Answers 'what changed in the last N minutes?'.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":     map[string]interface{}{"type": "string"},
				"window_minutes": map[string]interface{}{"type": "integer", "description": "Look-back window in minutes (default 60)"},
				"namespace":      map[string]interface{}{"type": "string", "description": "Restrict to a namespace (optional)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// === OBSERVABILITY AGGREGATORS — Phase 3 C1 (10 tools) ===
	// Cluster-wide health signals that per-resource observation tools can't
	// answer directly. All are read-only; many degrade gracefully when the
	// underlying backend endpoint is absent so the LLM can narrate the gap.
	{
		Name:        "observe_flapping_services",
		Category:    CategoryObservation,
		Description: "Find services whose endpoint set churned more than `threshold` times in the last `window_minutes`. Reveals services whose backends are unstable under the hood.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":     map[string]interface{}{"type": "string"},
				"namespace":      map[string]interface{}{"type": "string"},
				"window_minutes": map[string]interface{}{"type": "integer", "description": "Look-back window (default 15)"},
				"threshold":      map[string]interface{}{"type": "integer", "description": "Churn-count minimum (default 5)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_noisy_neighbors",
		Category:    CategoryObservation,
		Description: "Pods using more than `cpu_threshold_pct`/`mem_threshold_pct` of their node's capacity. Uses /metrics/summary aggregate. Great for 'who is starving my tenants?' questions.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":        map[string]interface{}{"type": "string"},
				"cpu_threshold_pct": map[string]interface{}{"type": "integer", "description": "CPU utilization threshold (default 80)"},
				"mem_threshold_pct": map[string]interface{}{"type": "integer", "description": "Memory utilization threshold (default 80)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_unhealthy_probes",
		Category:    CategoryObservation,
		Description: "Pods whose liveness/readiness probes fired Unhealthy / ProbeWarning / ContainerNotReady events in the window. Aggregated by pod+reason for a denoised view.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":     map[string]interface{}{"type": "string"},
				"namespace":      map[string]interface{}{"type": "string"},
				"window_minutes": map[string]interface{}{"type": "integer", "description": "Look-back window (default 60)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_missing_probes",
		Category:    CategoryObservation,
		Description: "Workloads (Deployment/StatefulSet/DaemonSet) whose containers have NEITHER liveness NOR readiness probes. The canonical 'you're flying blind here' hygiene check.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"namespace":  map[string]interface{}{"type": "string"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_orphaned_pods",
		Category:    CategoryObservation,
		Description: "Pods whose ownerReference points at a ReplicaSet/Job that no longer exists. Indicates a controller bug or partial deletion. Owner-existence cached per call.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"namespace":  map[string]interface{}{"type": "string"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_stuck_rollouts",
		Category:    CategoryObservation,
		Description: "Deployments whose Progressing condition hasn't advanced in `stuck_minutes` AND ready<desired. Points straight at the rollouts that need human attention.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":    map[string]interface{}{"type": "string"},
				"namespace":     map[string]interface{}{"type": "string"},
				"stuck_minutes": map[string]interface{}{"type": "integer", "description": "Transition-age cutoff (default 10)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_high_cardinality_labels",
		Category:    CategoryObservation,
		Description: "Label keys whose distinct-value count exceeds `threshold` cluster-wide (Prometheus cardinality risk). Currently degrades gracefully — backend label-cardinality index not yet exposed.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"threshold":  map[string]interface{}{"type": "integer", "description": "Cardinality threshold (default 1000)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_restart_storms",
		Category:    CategoryObservation,
		Description: "Containers whose cumulative restartCount is above `threshold`. Note: restartCount is cumulative since pod start; no per-window history is available from backend today.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"namespace":  map[string]interface{}{"type": "string"},
				"threshold":  map[string]interface{}{"type": "integer", "description": "Restart-count minimum (default 5)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pending_scheduler_events",
		Category:    CategoryObservation,
		Description: "Pending pods that emitted FailedScheduling events in the window. Answers 'why won't this pod land?' — taint / affinity / capacity reason comes from message field.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":     map[string]interface{}{"type": "string"},
				"namespace":      map[string]interface{}{"type": "string"},
				"window_minutes": map[string]interface{}{"type": "integer", "description": "Look-back window (default 60)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_zombie_finalizers",
		Category:    CategoryObservation,
		Description: "Resources whose deletionTimestamp is older than `stuck_minutes` — strong signal a finalizer is holding them in Terminating. Default kinds: pods, namespaces, pvcs.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id":    map[string]interface{}{"type": "string"},
				"namespace":     map[string]interface{}{"type": "string"},
				"stuck_minutes": map[string]interface{}{"type": "integer", "description": "Terminating-age cutoff (default 10)"},
				"kinds":         map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "Override kinds to scan (default pods/namespaces/pvcs)"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// === DEEP ANALYSIS TOOLS (12 tools) ===
	// === DEEP ANALYSIS TOOLS (12 tools) ===
	// Tier-2 specialized analysis tools — compute real intelligence from K8s data
	// These tools use the gRPC backend proxy and run deterministic algorithms.
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "analyze_pod_health",
		Category:              CategoryAnalysis,
		Description:           "Analyze pod health across a namespace: detect OOMKills, restart loops, eviction patterns, and stuck-pending pods. Returns per-pod severity findings with actionable messages.",
		RequiredAutonomyLevel: 2,
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific pod name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_deployment_health",
		Category:    CategoryAnalysis,
		Description: "Senior-level Deployment analysis: rollout stall detection, replica availability, image version drift, and HPA integration. Detects 'Progressing=False' conditions and resource misalignment.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific deployment name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_replicaset_health",
		Category:    CategoryAnalysis,
		Description: "ReplicaSet health: desired vs available replicas, condition-based issues. Single name or namespace-wide.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific ReplicaSet name"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_job_health",
		Category:    CategoryAnalysis,
		Description: "Job health: completion status, failed count, backoff limit, deadline. Single name or namespace-wide.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific Job name"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_cronjob_health",
		Category:    CategoryAnalysis,
		Description: "CronJob health: suspended, last run, failed child Jobs. Single name or namespace-wide.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific CronJob name"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_statefulset_health",
		Category:    CategoryAnalysis,
		Description: "Deep analysis of StatefulSet health: ordinal readiness, volume provisioning patterns, and update strategy alignment. Detects stuck rollouts and quorum risks.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific StatefulSet name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_daemonset_health",
		Category:    CategoryAnalysis,
		Description: "Analyze DaemonSet health: node coverage gaps, scheduling taints/tolerations, and rolling update progress across the fleet. Detects pods stuck on specific nodes.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific DaemonSet name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_node_pressure",
		Category:    CategoryAnalysis,
		Description: "Analyze node pressure conditions: MemoryPressure, DiskPressure, PIDPressure. Identifies nodes under stress with severity HIGH. Use to diagnose cluster-wide resource exhaustion.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name": map[string]interface{}{"type": "string", "description": "Optional specific node name to analyze"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "detect_resource_contention",
		Category:    CategoryAnalysis,
		Description: "Detect CPU throttling risk and memory overcommit by finding containers without resource limits/requests. Returns contention risk level (LOW/MEDIUM/HIGH) and list of violating containers.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to scan for resource contention (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_service_health",
		Category:    CategoryAnalysis,
		Description: "Analyze Service health: endpoint readiness, orphan services (no pods match selector), exposure risk (NodePort/LoadBalancer). Single service or namespace list. Returns status, risk_flags, recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific service name; if omitted, analyzes all services in namespace"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_ingress_health",
		Category:    CategoryAnalysis,
		Description: "Analyze Ingress health: backend services exist, no empty rules. Single Ingress or namespace list. Returns status, risk_flags, recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific Ingress name; if omitted, analyzes all Ingresses in namespace"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_network_connectivity",
		Category:    CategoryAnalysis,
		Description: "Analyze network connectivity: check service endpoint readiness, count active NetworkPolicies, and detect services with no ready endpoints. Use to diagnose connectivity failures.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific service name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_rbac_permissions",
		Category:    CategoryAnalysis,
		Description: "Analyze RBAC permissions for over-privileged service accounts. Checks RoleBindings and ClusterRoleBindings for dangerous roles (cluster-admin, admin, edit). Returns risk level and per-binding findings.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":            map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"service_account_name": map[string]interface{}{"type": "string", "description": "Optional specific service account name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_storage_health",
		Category:    CategoryAnalysis,
		Description: "Analyze storage health: detect unbound PVCs, failed provisioning, and storage class issues. Returns storage health status (Healthy/Degraded) with list of problematic PVCs.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "check_resource_limits",
		Category:    CategoryAnalysis,
		Description: "Check for containers missing CPU/memory limits and requests. Returns compliance rate and list of violations with per-container recommendations. Critical for cluster stability.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to check (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_hpa_behavior",
		Category:    CategoryAnalysis,
		Description: "Analyze HorizontalPodAutoscaler behavior: detect flapping, scaling delays, inactive HPAs, and HPAs at max replicas. Returns per-HPA warnings with scaling context.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific HPA name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_log_patterns",
		Category:    CategoryAnalysis,
		Description: "Extract and classify error/warning patterns from pod logs. Detects error keywords (panic, fatal, exception, OOM), counts patterns by type, and returns sample error lines with severity.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name to analyze logs from (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Optional specific container name within the pod"},
				"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of log lines to analyze (default: 100)"},
			},
			"required": []string{"namespace", "pod_name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "assess_security_posture",
		Category:    CategoryAnalysis,
		Description: "Assess security posture with CIS Kubernetes Benchmark checks: hostNetwork, hostPID, privileged containers, runAsRoot, writable root filesystems. Returns security score (0-100) and per-finding CIS IDs.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to assess (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "detect_configuration_drift",
		Category:    CategoryAnalysis,
		Description: "Detect configuration drift between a resource's live state and a provided desired state specification. Returns drift count, field-level differences, and drift summary for GitOps validation.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Kubernetes namespace of the resource (required)"},
				"kind":          map[string]interface{}{"type": "string", "description": "Resource kind (e.g., Deployment, ConfigMap) (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"desired_state": map[string]interface{}{"type": "object", "description": "Desired state specification to compare against live state"},
			},
			"required": []string{"namespace", "kind", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// === ANALYSIS TOOLS (12 tools) ===
	// Intelligent insights and diagnostics

	{
		Name:        "analyze_resource_efficiency",
		Category:    CategoryAnalysis,
		Description: "Analyze resource requests vs actual usage with rightsizing recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_failure_patterns",
		Category:    CategoryAnalysis,
		Description: "Detect recurring failure patterns across pods, deployments, and nodes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_dependencies",
		Category:    CategoryAnalysis,
		Description: "Map service dependencies and identify potential single points of failure.",
		Destructive: false,
		RequiresAI:  true,
	},
	// analyze_configuration_drift retired 2026-04-22: stub grade (no InputSchema,
	// no handler differentiation from detect_configuration_drift). The LLM cannot
	// disambiguate "analyze_" vs "detect_" variants of the same concept; keeping
	// only detect_configuration_drift which has a real schema + GitOps semantics.
	// See docs/strategy/2026-04-22-tool-audit.md (name-overlap failure pattern).
	{
		Name:        "analyze_capacity_trends",
		Category:    CategoryAnalysis,
		Description: "Predict future capacity needs based on historical trends and growth patterns.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_performance_bottlenecks",
		Category:    CategoryAnalysis,
		Description: "Identify performance bottlenecks across compute, network, and storage.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_error_correlation",
		Category:    CategoryAnalysis,
		Description: "Correlate errors across logs, events, and metrics to find root causes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_blast_radius",
		Category:    CategoryAnalysis,
		Description: "Assess potential impact of a change or failure. Scope-aware: scope=resource requires kind+name (single workload); scope=namespace needs only namespace (all workloads in that namespace); scope=cluster takes no args and returns node-loss + critical-path summary cluster-wide.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"scope":      map[string]interface{}{"type": "string", "enum": []string{"resource", "namespace", "cluster"}, "description": "Blast radius scope (default 'resource')"},
				"kind":       map[string]interface{}{"type": "string", "description": "Resource kind (required when scope=resource)"},
				"name":       map[string]interface{}{"type": "string", "description": "Resource name (required when scope=resource)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required when scope=namespace; optional for scope=resource)"},
			},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_rollout_risk",
		Category:    CategoryAnalysis,
		Description: "Assess risk of deployments, updates, and configuration changes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_pod_scheduling",
		Category:    CategoryAnalysis,
		Description: "Analyze pod scheduling decisions, affinity rules, and placement optimization.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_image_vulnerabilities",
		Category:    CategoryAnalysis,
		Description: "Scan container images for vulnerabilities with severity prioritization.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_workload_patterns",
		Category:    CategoryAnalysis,
		Description: "Identify traffic patterns, peak hours, and scaling opportunities.",
		Destructive: false,
		RequiresAI:  true,
	},

	// ─── RBAC aggregator (gap 3, 2026-04-22 bench) ───
	{
		Name:        "who_can_do",
		Category:    CategoryAnalysis,
		Description: "Answer 'who can <verb> <resource> in <namespace>?' in ONE call. Aggregates Roles, ClusterRoles, RoleBindings, ClusterRoleBindings and returns principals + the roles that granted the permission. Call this INSTEAD of enumerating clusterroles one-by-one — the old approach fanned out to 95 tool calls per question.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string"},
				"verb":       map[string]interface{}{"type": "string", "description": "RBAC verb e.g. get, list, create, delete, patch (required)"},
				"resource":   map[string]interface{}{"type": "string", "description": "Resource plural e.g. pods, deployments, secrets (required)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Scope to a single namespace (optional — default is cluster-wide)"},
			},
			"required": []string{"verb", "resource"},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// === RECOMMENDATION TOOLS (8 tools) ===
	// AI-powered suggestions and optimizations
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "recommend_resource_optimization",
		Category:              CategoryRecommendation,
		Description:           "Generate actionable recommendations for resource optimization (CPU, memory, storage).",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "recommend_cost_reduction",
		Category:    CategoryRecommendation,
		Description: "Identify cost-saving opportunities with projected savings estimates.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_security_hardening",
		Category:    CategoryRecommendation,
		Description: "Provide security hardening recommendations based on best practices and CVEs.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_scaling_strategy",
		Category:    CategoryRecommendation,
		Description: "Suggest HPA/VPA configurations and scaling strategies based on workload patterns.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_architecture_improvements",
		Category:    CategoryRecommendation,
		Description: "Suggest architectural improvements for resilience, performance, and cost.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_upgrade_path",
		Category:    CategoryRecommendation,
		Description: "Plan Kubernetes and application upgrade paths with risk assessment.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_monitoring_improvements",
		Category:    CategoryRecommendation,
		Description: "Suggest monitoring, alerting, and observability enhancements.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_disaster_recovery",
		Category:    CategoryRecommendation,
		Description: "Provide disaster recovery and backup strategy recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === TROUBLESHOOTING TOOLS (7 tools) ===
	// Problem detection and resolution
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "troubleshoot_pod_failures",
		Category:              CategoryTroubleshooting,
		Description:           "Autonomous investigation of pod failures with root cause analysis and fix suggestions.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "troubleshoot_network_issues",
		Category:    CategoryTroubleshooting,
		Description: "Diagnose network connectivity, DNS, and service discovery issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_performance_degradation",
		Category:    CategoryTroubleshooting,
		Description: "Investigate performance issues with metric correlation and bottleneck identification.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_deployment_failures",
		Category:    CategoryTroubleshooting,
		Description: "Analyze failed deployments, rollouts, and update issues with remediation steps.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_resource_constraints",
		Category:    CategoryTroubleshooting,
		Description: "Identify resource exhaustion, OOM kills, and capacity issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_rbac_issues",
		Category:    CategoryTroubleshooting,
		Description: "Debug RBAC permission issues and suggest proper role configurations.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_storage_issues",
		Category:    CategoryTroubleshooting,
		Description: "Diagnose PV/PVC issues, mount failures, and storage provisioning problems.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === ROOT-CAUSE DIAGNOSTICS — Phase 3 C2 (10 tools) ===
	// Take a specific subject and return findings + probable_cause.
	{
		Name:        "diagnose_pod_not_ready",
		Category:    CategoryTroubleshooting,
		Description: "Why is this pod not Ready? Inspects phase, container waiting/terminated states, restart counts. Classifies as CrashLoopBackOff / OOMKilled / ImagePullBackOff / ProbeFailure when possible.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_service_no_endpoints",
		Category:    CategoryTroubleshooting,
		Description: "Why does this service have no ready endpoints? Reports selector mismatch, zero backing pods, or headless/external configuration.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_pvc_pending",
		Category:    CategoryTroubleshooting,
		Description: "Why is this PVC stuck Pending? Checks storageClassName presence, class existence, and provisioner failure events.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_ingress_404",
		Category:    CategoryTroubleshooting,
		Description: "Why does this ingress return 404? Walks rules → backend service → endpoints and reports which link is broken.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_deployment_rollback_needed",
		Category:    CategoryTroubleshooting,
		Description: "Is this deployment degraded after its latest revision? Compares current revision cause to the prior cause and reports readiness delta.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_cronjob_missing_runs",
		Category:    CategoryTroubleshooting,
		Description: "Why did this CronJob not fire? Checks suspend flag, concurrencyPolicy, and lastScheduleTime.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_node_unschedulable",
		Category:    CategoryTroubleshooting,
		Description: "Why won't pods land on this node? Inspects cordon flag, taints (NoSchedule/NoExecute), and node conditions (Pressure / Ready).",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_hpa_not_scaling",
		Category:    CategoryTroubleshooting,
		Description: "Why isn't this HPA scaling? Checks min=max, and ScalingActive/AbleToScale condition reasons (metrics unavailable, target unreachable, etc.).",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "name": map[string]interface{}{"type": "string"}}, "required": []string{"namespace", "name"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_networkpolicy_blocking",
		Category:    CategoryTroubleshooting,
		Description: "Is a NetworkPolicy blocking from_pod → to_pod? Detects default-deny policies and reports manual-review when per-pod simulation isn't available.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "from_pod": map[string]interface{}{"type": "string"}, "to_pod": map[string]interface{}{"type": "string"}}, "required": []string{"namespace"}},
		Destructive: false, RequiresAI: false,
	},
	{
		Name:        "diagnose_certificate_failures",
		Category:    CategoryTroubleshooting,
		Description: "cert-manager issuance failures in the window. Reads Certificate/CertificateRequest events whose reason matches Failed/Error.",
		InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"cluster_id": map[string]interface{}{"type": "string"}, "namespace": map[string]interface{}{"type": "string"}, "window_minutes": map[string]interface{}{"type": "integer", "description": "Default 1440 (24h)"}}},
		Destructive: false, RequiresAI: false,
	},

	// === SECURITY TOOLS (5 tools) ===
	// Security analysis and compliance
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "security_scan_cluster",
		Category:              CategorySecurity,
		Description:           "Comprehensive cluster security scan with CIS benchmarks and compliance checks.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "security_audit_rbac",
		Category:    CategorySecurity,
		Description: "Audit RBAC configurations, identify overprivileged accounts and security risks.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_scan_secrets",
		Category:    CategorySecurity,
		Description: "Scan for exposed secrets, weak encryption, and secret management issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_check_pod_security",
		Category:    CategorySecurity,
		Description: "Validate pod security policies, admission controls, and runtime security.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_compliance_report",
		Category:    CategorySecurity,
		Description: "Generate compliance reports for SOC2, HIPAA, PCI-DSS, etc.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === COST TOOLS (4 tools) ===
	// Resource optimization and cost analysis
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "cost_analyze_spending",
		Category:              CategoryCost,
		Description:           "Analyze cluster costs with breakdown by namespace, workload, and and resource type.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "cost_identify_waste",
		Category:    CategoryCost,
		Description: "Identify wasted resources: over-provisioned pods, unused PVs, idle nodes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "cost_forecast_spending",
		Category:    CategoryCost,
		Description: "Forecast future costs based on trends and planned changes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "cost_optimization_plan",
		Category:    CategoryCost,
		Description: "Generate comprehensive cost optimization plan with ROI estimates.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === ACTION TOOLS (5 tools) ===
	// Cluster modifications (requires approval)
	// Autonomy Level: 4 (Act)

	// action_scale_workload retired 2026-04-22: stub (no InputSchema, no blast-
	// radius analysis in handler). scale_deployment is the real implementation —
	// proper schema (namespace/name/replicas/justification/dry_run), blast-radius
	// analysis, Destructive=true so the safety engine runs pre-flight.
	// Keeping two scale tools silently bypassed the approval UX when the LLM
	// picked the stub. See docs/strategy/2026-04-22-tool-audit.md.
	{
		Name:                  "action_restart_workload",
		Category:              CategoryAction,
		Description:           "Restart pods or workloads with rolling update strategy.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_apply_manifest",
		Category:              CategoryAction,
		Description:           "Apply Kubernetes manifests with validation and dry-run support.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_rollback_deployment",
		Category:              CategoryAction,
		Description:           "Rollback deployment to previous revision with impact analysis.",
		Destructive:           true,
		RequiresAI:            true,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_execute_command",
		Category:              CategoryAction,
		Description:           "Execute command in pod container with security validation.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},

	// === AUTOMATION TOOLS (3 tools) ===
	// Multi-step automation workflows
	// Autonomy Level: 4 (Act)

	{
		Name:                  "automation_run_playbook",
		Category:              CategoryAutomation,
		Description:           "Run a predefined remediation playbook (e.g., 'clear-logs', 'restart-deployment', 'cordon-node').",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:        "automation_schedule_task",
		Category:    CategoryAutomation,
		Description: "Schedule recurring tasks like backups, cleanups, and health checks.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "automation_create_alert_rule",
		Category:    CategoryAutomation,
		Description: "Create intelligent alert rules with auto-remediation triggers.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "automation_generate_runbook",
		Category:    CategoryAutomation,
		Description: "Generate runbooks for common operational scenarios.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === EXECUTION TOOLS (9 tools) — A-CORE-004 ===
	// === EXECUTION TOOLS (9 tools) — A-CORE-004 ===
	// Safety-gated cluster mutations. EVERY tool passes through the Safety Engine
	// (autonomy level check + blast radius + policy) before any cluster change.
	// All tools support dry_run=true for impact preview without execution.
	// Autonomy Level: 3 (Active execution)

	{
		Name:     "restart_pod",
		Category: CategoryExecution,
		Description: "Restart a pod by deleting it (its controller will recreate it). Safety Level 2 — semi-autonomous. " +
			"Passes through policy + blast-radius check. Supports dry_run for impact preview. Requires namespace and pod name.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Pod namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Pod name to restart (required)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for restart (recommended for audit log)"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "scale_deployment",
		Category: CategoryExecution,
		Description: "Scale a Deployment to a target replica count. Safety Level 3 — requires explicit user confirmation unless autonomy level allows. " +
			"Blast radius analysis is performed. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Deployment namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
				"replicas":      map[string]interface{}{"type": "integer", "description": "Target replica count (required)", "minimum": 0},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for scaling"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name", "replicas"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "cordon_node",
		Category: CategoryExecution,
		Description: "Mark a node as unschedulable (cordon) to prevent new pods from being scheduled. Safety Level 3. " +
			"Existing pods are NOT evicted. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":          map[string]interface{}{"type": "string", "description": "Node name to cordon (required)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for cordoning"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "drain_node",
		Category: CategoryExecution,
		Description: "Evict all pods from a node (drain) to prepare for maintenance. Safety Level 4 — highest restriction, always reviewed by policy engine. " +
			"Supports grace period, ignore-daemonsets, and delete-emptydir options. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":                 map[string]interface{}{"type": "string", "description": "Node name to drain (required)"},
				"grace_period_seconds": map[string]interface{}{"type": "integer", "description": "Grace period for pod eviction in seconds (default: 30)"},
				"ignore_daemon_sets":   map[string]interface{}{"type": "boolean", "description": "Ignore DaemonSet-managed pods (default: true)"},
				"delete_emptydir_data": map[string]interface{}{"type": "boolean", "description": "Allow deleting pods with emptyDir volumes"},
				"justification":        map[string]interface{}{"type": "string", "description": "Reason for draining"},
				"dry_run":              map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "apply_resource_patch",
		Category: CategoryExecution,
		Description: "Apply a JSON merge or strategic merge patch to any Kubernetes resource. Safety Level 4. " +
			"Use for targeted field updates (e.g., updating container image, annotations). Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Resource namespace"},
				"kind":          map[string]interface{}{"type": "string", "description": "Resource kind (e.g., Deployment) (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"patch":         map[string]interface{}{"type": "object", "description": "JSON patch object (required)"},
				"patch_type":    map[string]interface{}{"type": "string", "enum": []string{"merge", "strategic"}, "description": "Patch type: merge or strategic"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for patch"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"kind", "name", "patch"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "delete_resource",
		Category: CategoryExecution,
		Description: "Delete a Kubernetes resource. Safety Level 5 — most restrictive, always requires human approval regardless of autonomy level. " +
			"Supports optional grace period. Supports dry_run (strongly recommended first).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":            map[string]interface{}{"type": "string", "description": "Resource namespace"},
				"kind":                 map[string]interface{}{"type": "string", "description": "Resource kind (required)"},
				"name":                 map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"grace_period_seconds": map[string]interface{}{"type": "integer", "description": "Grace period before deletion"},
				"justification":        map[string]interface{}{"type": "string", "description": "Reason for deletion (required for audit)"},
				"dry_run":              map[string]interface{}{"type": "boolean", "description": "Preview without deleting (strongly recommended)"},
			},
			"required": []string{"kind", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "rollback_deployment",
		Category: CategoryExecution,
		Description: "Roll back a Deployment to a previous revision. Safety Level 3. " +
			"Specify revision number (0 = previous revision). Returns rollback plan before execution. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Deployment namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
				"revision":      map[string]interface{}{"type": "integer", "description": "Revision to roll back to (0 = previous revision)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for rollback"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "update_resource_limits",
		Category: CategoryExecution,
		Description: "Update CPU/memory requests and limits for a specific container in a workload. Safety Level 3. " +
			"Builds a strategic merge patch and applies it. Requires container_name. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Workload namespace (required)"},
				"kind":           map[string]interface{}{"type": "string", "description": "Resource kind: Deployment, StatefulSet, DaemonSet (required)"},
				"name":           map[string]interface{}{"type": "string", "description": "Workload name (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Container name to update (required)"},
				"cpu_request":    map[string]interface{}{"type": "string", "description": "CPU request (e.g., '250m')"},
				"cpu_limit":      map[string]interface{}{"type": "string", "description": "CPU limit (e.g., '500m')"},
				"memory_request": map[string]interface{}{"type": "string", "description": "Memory request (e.g., '256Mi')"},
				"memory_limit":   map[string]interface{}{"type": "string", "description": "Memory limit (e.g., '512Mi')"},
				"justification":  map[string]interface{}{"type": "string", "description": "Reason for limit change"},
				"dry_run":        map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "kind", "name", "container_name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "trigger_hpa_scale",
		Category: CategoryExecution,
		Description: "Manually override an HPA's current desired replica count by patching its status. Safety Level 4. " +
			"Use when immediate scaling is needed before the HPA's metric-based decisions take effect. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":       map[string]interface{}{"type": "string", "description": "HPA namespace (required)"},
				"name":            map[string]interface{}{"type": "string", "description": "HPA name (required)"},
				"target_replicas": map[string]interface{}{"type": "integer", "description": "Target replica count (required)", "minimum": 0},
				"justification":   map[string]interface{}{"type": "string", "description": "Reason for manual scale trigger"},
				"dry_run":         map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name", "target_replicas"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
}

// GetToolsByCategory returns all tools in a specific category
func GetToolsByCategory(category ToolCategory) []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if tool.Category == category {
			tools = append(tools, tool)
		}
	}
	return tools
}

// GetToolByName returns a tool definition by name
func GetToolByName(name string) *ToolDefinition {
	for _, tool := range ToolTaxonomy {
		if tool.Name == name {
			return &tool
		}
	}
	return nil
}

// GetNonDestructiveTools returns all non-destructive tools
func GetNonDestructiveTools() []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if !tool.Destructive {
			tools = append(tools, tool)
		}
	}
	return tools
}

// GetAIPoweredTools returns all tools that require AI capabilities
func GetAIPoweredTools() []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if tool.RequiresAI {
			tools = append(tools, tool)
		}
	}
	return tools
}
