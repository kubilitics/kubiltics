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
		Name:        "observe_pod_detailed",
		Category:    CategoryObservation,
		Description: "Comprehensive 'Senior Engineer' view of a Pod. Returns metadata, status (with restart reasons), ownership chain (RS -> Deployment), resource analytics (CPU/RAM vs limits), service associations, and dependency summaries.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Pod name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
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
	{
		Name:        "observe_pod_ownership_chain",
		Category:    CategoryObservation,
		Description: "Return ownership chain for a pod: Pod → ReplicaSet → Deployment (or Job). Use when tracing who owns the pod for rollback or debugging.",
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
	{
		Name:        "observe_pod_events",
		Category:    CategoryObservation,
		Description: "Get last N events for a specific pod (e.g. OOMKilled, Failed, Killing). Use for 'why is this pod restarting?' and crash analysis. Returns events sorted by lastTimestamp descending.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Pod namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Pod name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events to return (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
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
		Description: "Get time-series metrics for resources with trend analysis and anomaly detection.",
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
	{
		Name:        "observe_node_detailed",
		Category:    CategoryObservation,
		Description: "Senior-engineer view of a single node: spec (taints), status (capacity, allocatable, conditions), metrics, events, pods on node, and risk flags (NotReady, DiskPressure, MemoryPressure, PIDPressure).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Node name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_node_events",
		Category:    CategoryObservation,
		Description: "List recent events for a node (cluster-scoped).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Node name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events to return (default 10)"},
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
	{
		Name:        "observe_namespace_detailed",
		Category:    CategoryObservation,
		Description: "Detailed view of a namespace: metadata (labels, annotations), status phase, events, pod count, and risk flags (e.g. Terminating).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Namespace name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_namespace_events",
		Category:    CategoryObservation,
		Description: "List recent events for a namespace (cluster-scoped).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "Namespace name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events to return (default 10)"},
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
	{
		Name:        "observe_service_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a Service: metadata, spec (type, ports, selector), status, endpoints, events, pods selected, risk flags (NO_ENDPOINTS, ORPHAN_SERVICE, EXPOSURE_RISK).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Service name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_service_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific Service. Use for diagnosing endpoint or exposure changes.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Service name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_ingress_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of an Ingress: metadata, spec (rules, tls, ingressClassName), status, events, backend_services (with exists check), risk flags (NO_RULES, BACKEND_SERVICE_NOT_FOUND).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Ingress name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_ingress_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific Ingress. Use for diagnosing load balancer or backend changes.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Ingress name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_networkpolicy_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a NetworkPolicy: metadata, spec (podSelector, policyTypes, ingress/egress rule counts), events, pods selected by the policy.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "NetworkPolicy name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_networkpolicy_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific NetworkPolicy. Use for diagnosing policy updates or conflicts.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "NetworkPolicy name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_deployment_detailed",
		Category:    CategoryObservation,
		Description: "Senior Engineer view of a Deployment: metadata, spec/status, rollout history, events, metrics, child ReplicaSets, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_deployment_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific Deployment (e.g. scaling, rollout). Use for diagnosing rollout stalls or replica issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events to return (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_deployment_ownership_chain",
		Category:    CategoryObservation,
		Description: "Deployment to child ReplicaSets (and replica counts). No parent; use to see which ReplicaSets belong to this deployment.",
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
	{
		Name:        "observe_replicaset_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a ReplicaSet: metadata, spec/status, events, metrics, owner (Deployment), child pods, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "ReplicaSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_replicaset_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific ReplicaSet. Use for diagnosing replica or scaling issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "ReplicaSet name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_replicaset_ownership_chain",
		Category:    CategoryObservation,
		Description: "ReplicaSet to parent (Deployment) and child Pods. Returns ownership chain and pod list.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "ReplicaSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_statefulset_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a StatefulSet: metadata, spec/status, update strategy, events, metrics, child pods, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "StatefulSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_statefulset_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific StatefulSet. Use for diagnosing rollout or ordinal issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "StatefulSet name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_statefulset_ownership_chain",
		Category:    CategoryObservation,
		Description: "StatefulSet to child Pods (no parent). Returns ownership chain and pod list.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "StatefulSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_daemonset_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a DaemonSet: metadata, spec/status, events, metrics, child pods, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "DaemonSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_daemonset_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific DaemonSet. Use for diagnosing node coverage or rollout issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "DaemonSet name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_daemonset_ownership_chain",
		Category:    CategoryObservation,
		Description: "DaemonSet to child Pods (no parent). Returns ownership chain and pod list.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "DaemonSet name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_job_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a Job: metadata, spec/status, completion, events, metrics, owner (CronJob if any), child pods, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Job name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_job_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific Job. Use for diagnosing job failures or backoff.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Job name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_job_ownership_chain",
		Category:    CategoryObservation,
		Description: "Job to parent (CronJob if any) and child Pods. Returns ownership chain and pod list.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Job name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_cronjob_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a CronJob: metadata, schedule, suspend, last run, child Jobs, events, metrics, risk flags and recommendations.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "CronJob name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_cronjob_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific CronJob. Use for diagnosing schedule or trigger issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "CronJob name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_cronjob_ownership_chain",
		Category:    CategoryObservation,
		Description: "CronJob to child Jobs (no parent). Returns ownership chain and list of Jobs created by this CronJob.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "CronJob name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pvc_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a PersistentVolumeClaim: metadata, spec (accessModes, requested storage, storageClassName), status (phase, capacity), events, relationships (consumers, bound_volume), risk_flags (PVC_PENDING, PVC_LOST).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "PVC name (required)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_pvc_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific PersistentVolumeClaim. Use for diagnosing binding or provisioner issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "PVC name (required)"},
				"limit":     map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_pv_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a PersistentVolume (cluster-scoped): metadata, spec (capacity, accessModes, reclaimPolicy, storageClassName, claimRef), status (phase), events, relationships (claim, claim_exists), risk_flags (PV_AVAILABLE, PV_RELEASED, ORPHAN_PV).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name": map[string]interface{}{"type": "string", "description": "PV name (required); PV is cluster-scoped (no namespace)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_pv_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific PersistentVolume. Use for diagnosing provisioning or reclaim issues.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":  map[string]interface{}{"type": "string", "description": "PV name (required)"},
				"limit": map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_storageclass_detailed",
		Category:    CategoryObservation,
		Description: "Senior view of a StorageClass (cluster-scoped): metadata, provisioner, parameters, allowVolumeExpansion, volumeBindingMode, events, relationships (pv_count), risk_flags (NO_PROVISIONER).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name": map[string]interface{}{"type": "string", "description": "StorageClass name (required); cluster-scoped"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_storageclass_events",
		Category:    CategoryObservation,
		Description: "Last N events for a specific StorageClass. Use for diagnosing provisioner or admin changes.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":  map[string]interface{}{"type": "string", "description": "StorageClass name (required)"},
				"limit": map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_serviceaccount_events",
		Category:    CategoryObservation,
		Description: "Last N events for a ServiceAccount.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ServiceAccount name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
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
	{
		Name:        "observe_role_detailed",
		Category:    CategoryObservation,
		Description: "Role detail: rules (verbs, resources), RoleBindings that reference this Role, risk flags (wildcard verbs/resources).",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_role_events",
		Category:    CategoryObservation,
		Description: "Last N events for a Role.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Role name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_rolebinding_detailed",
		Category:    CategoryObservation,
		Description: "RoleBinding detail: roleRef, subjects, resolved Role/ClusterRole summary, risk flags (cluster-admin, overprivileged).",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_rolebinding_events",
		Category:    CategoryObservation,
		Description: "Last N events for a RoleBinding.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "RoleBinding name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_clusterrole_detailed",
		Category:    CategoryObservation,
		Description: "ClusterRole detail (cluster-scoped): rules, ClusterRoleBindings that reference it, risk flags (cluster-admin, wildcards).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRole name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_clusterrole_events",
		Category:    CategoryObservation,
		Description: "Last N events for a ClusterRole.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRole name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_clusterrolebinding_detailed",
		Category:    CategoryObservation,
		Description: "ClusterRoleBinding detail (cluster-scoped): roleRef, subjects, resolved ClusterRole, risk flags (cluster-admin to non-system SA).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRoleBinding name (required)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_clusterrolebinding_events",
		Category:    CategoryObservation,
		Description: "Last N events for a ClusterRoleBinding.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "ClusterRoleBinding name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_secret_detailed",
		Category:    CategoryObservation,
		Description: "Secret detail: metadata, type, data keys (values redacted), consumers, TLS info when applicable, risk flags.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_secret_events",
		Category:    CategoryObservation,
		Description: "Last N events for a Secret.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "Secret name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_configmap_detailed",
		Category:    CategoryObservation,
		Description: "ConfigMap detail: metadata, data keys (no values), consumers (pods/deployments), events, risk flags (UNUSED_CONFIGMAP, MANY_CONSUMERS). PRD: observe_configmap_usage.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_configmap_events",
		Category:    CategoryObservation,
		Description: "Last N events for a ConfigMap.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ConfigMap name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_limitrange_detailed",
		Category:    CategoryObservation,
		Description: "LimitRange detail: metadata, spec (limits: type, default, defaultRequest, max, min), events. No metrics.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_limitrange_events",
		Category:    CategoryObservation,
		Description: "Last N events for a LimitRange.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "LimitRange name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_resourcequota_detailed",
		Category:    CategoryObservation,
		Description: "ResourceQuota detail: metadata, spec (hard), status (used), events, risk QUOTA_EXHAUSTED when used >= hard.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_resourcequota_events",
		Category:    CategoryObservation,
		Description: "Last N events for a ResourceQuota.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "ResourceQuota name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_hpa_detailed",
		Category:    CategoryObservation,
		Description: "HorizontalPodAutoscaler detail: metadata, spec (minReplicas, maxReplicas, scaleTargetRef), status (current/desiredReplicas), events, scale_target relationship, risk HPA_AT_MAX, HPA_AT_MIN, TARGET_NOT_FOUND.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_hpa_events",
		Category:    CategoryObservation,
		Description: "Last N events for a HorizontalPodAutoscaler.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "HPA name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_pdb_detailed",
		Category:    CategoryObservation,
		Description: "PodDisruptionBudget detail: metadata, spec (minAvailable, maxUnavailable, selector), status (currentHealthy, desiredHealthy, disruptedPodsAllowed), events, matching_pods_count, risk PDB_BLOCKING_DRAIN.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_pdb_events",
		Category:    CategoryObservation,
		Description: "Last N events for a PodDisruptionBudget.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "PDB name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	// Scaling: VerticalPodAutoscalers (VPA)
	{
		Name:        "observe_vpa_detailed",
		Category:    CategoryObservation,
		Description: "VerticalPodAutoscaler detail: metadata, spec (targetRef, updatePolicy, resourcePolicy), status summary, events, target relationship, risk TARGET_NOT_FOUND, VPA_OFF.",
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
		RequiresAI:  true,
	},
	{
		Name:        "observe_vpa_events",
		Category:    CategoryObservation,
		Description: "Last N events for a VerticalPodAutoscaler.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"namespace":  map[string]interface{}{"type": "string", "description": "Namespace (required)"},
				"name":       map[string]interface{}{"type": "string", "description": "VPA name (required)"},
				"limit":      map[string]interface{}{"type": "number", "description": "Max events (default 10)"},
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
	{
		Name:        "observe_crd_detailed",
		Category:    CategoryObservation,
		Description: "Get a single CustomResourceDefinition by name: spec (group, names, scope, versions), status, events, relationships (instances_count), risk flags.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "CustomResourceDefinition name (required); cluster-scoped"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_crd_events",
		Category:    CategoryObservation,
		Description: "Get events for a CustomResourceDefinition (cluster-scoped) by name.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional)"},
				"name":       map[string]interface{}{"type": "string", "description": "CustomResourceDefinition name (required)"},
				"limit":      map[string]interface{}{"type": "integer", "description": "Max events (default 10)"},
			},
			"required": []string{"name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_custom_resources",
		Category:    CategoryObservation,
		Description: "Get CRDs and custom resources with validation schema analysis.",
		Destructive: false,
		RequiresAI:  true,
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
	{
		Name:        "analyze_configuration_drift",
		Category:    CategoryAnalysis,
		Description: "Detect configuration drift from desired state with remediation suggestions.",
		Destructive: false,
		RequiresAI:  true,
	},
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
		Description: "Assess potential impact of resource changes or failures on dependent services.",
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

	{
		Name:                  "action_scale_workload",
		Category:              CategoryAction,
		Description:           "Scale deployments, statefulsets, or replicasets with safety checks.",
		Destructive:           false,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
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
