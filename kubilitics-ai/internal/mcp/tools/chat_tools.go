// Package tools provides chat-scoped tool subsets and ToolDefinition to LLM type conversion.
//
// GetChatTools returns a pod-first subset of tools that fit within API limits (e.g. 128)
// and align with the observation and analysis HandlerMaps so the executor can run them.

package tools

import (
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// GetChatToolDefinitions returns ToolDefinitions for chat-only tool names that the MCP server
// must register so ExecuteTool(name, args) finds them. These route to the same observation
// handlers as observe_resources_by_query, observe_resource, observe_pod_logs, observe_events,
// observe_cluster_overview. analyze_pod_health and observe_metrics are already in the taxonomy.
func GetChatToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "list_resources",
			Category:    CategoryObservation,
			Description: "List Kubernetes resources by kind and optional namespace. Use kind=Pod for pods, kind=Deployment for deployments, etc. Returns count and item summaries (name, namespace, status). Use this to answer 'how many pods', 'list pods in namespace X', 'pod names'.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"kind":           map[string]interface{}{"type": "string", "description": "Resource kind (required), e.g. Pod, Deployment, Node, Service"},
					"namespace":      map[string]interface{}{"type": "string", "description": "Namespace to filter (optional); omit for cluster-scoped or all namespaces"},
					"label_selector": map[string]interface{}{"type": "string", "description": "Optional label selector"},
					"limit":          map[string]interface{}{"type": "integer", "description": "Max items to return (default 50)"},
				},
				"required": []interface{}{"kind"},
			},
			RequiredAutonomyLevel: 1,
		},
		{
			Name:        "get_resource",
			Category:    CategoryObservation,
			Description: "Get detailed information about a single resource by kind, namespace, and name. Use for full pod/details, metrics context, or when you need one resource's spec/status.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"kind":      map[string]interface{}{"type": "string", "description": "Resource kind (required), e.g. Pod, Deployment"},
					"namespace": map[string]interface{}{"type": "string", "description": "Namespace (required for namespaced resources)"},
					"name":      map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				},
				"required": []interface{}{"kind", "name"},
			},
			RequiredAutonomyLevel: 1,
		},
		{
			Name:        "get_logs",
			Category:    CategoryObservation,
			Description: "Get logs from a pod. Use for debugging, error inspection, or when the user asks for pod logs.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"namespace":      map[string]interface{}{"type": "string", "description": "Namespace (required)"},
					"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name (required)"},
					"container_name": map[string]interface{}{"type": "string", "description": "Optional container name"},
					"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of lines (default 100)"},
					"since":          map[string]interface{}{"type": "string", "description": "Optional time duration (e.g. 1h)"},
				},
				"required": []interface{}{"namespace", "pod_name"},
			},
			RequiredAutonomyLevel: 1,
		},
		{
			Name:        "get_events",
			Category:    CategoryObservation,
			Description: "List recent Kubernetes events, optionally filtered by namespace, involved object, or reason. Use to diagnose failures, scheduling, or pod issues.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"namespace":       map[string]interface{}{"type": "string", "description": "Namespace to list events from"},
					"involved_object": map[string]interface{}{"type": "string", "description": "Filter by involved object name"},
					"reason":          map[string]interface{}{"type": "string", "description": "Filter by event reason"},
					"limit":           map[string]interface{}{"type": "integer", "description": "Max events (default 20)"},
				},
			},
			RequiredAutonomyLevel: 1,
		},
		{
			Name:        "get_cluster_health",
			Category:    CategoryObservation,
			Description: "Get overall cluster health: status, score, node count, pod count, and component statuses. Use for 'cluster health', 'how is the cluster doing'.",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
			RequiredAutonomyLevel: 1,
		},
	}
}

// GetChatTools returns the pod-first tool subset for AI chat/stream.
// Uses the same names as the observation and analysis HandlerMaps so the
// executor can execute them without mapping. Stays well under the 128-tool API limit.
// Intentionally excludes execution tools (e.g. delete_resource); delete is not
// exposed to natural language — use UI or explicit workflow for destructive actions.
func GetChatTools() []types.Tool {
	return []types.Tool{
		{
			Name:        "list_resources",
			Description: "List Kubernetes resources by kind and optional namespace. Use kind=Pod for pods, kind=Deployment for deployments, etc. Returns count and item summaries (name, namespace, status). Use this to answer 'how many pods', 'list pods in namespace X', 'pod names'.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"kind":          map[string]interface{}{"type": "string", "description": "Resource kind (required), e.g. Pod, Deployment, Node, Service"},
					"namespace":     map[string]interface{}{"type": "string", "description": "Namespace to filter (optional); omit for cluster-scoped or all namespaces"},
					"label_selector": map[string]interface{}{"type": "string", "description": "Optional label selector"},
					"limit":         map[string]interface{}{"type": "integer", "description": "Max items to return (default 50)"},
				},
				"required": []interface{}{"kind"},
			},
		},
		{
			Name:        "get_resource",
			Description: "Get detailed information about a single resource by kind, namespace, and name. Use for full pod/details, metrics context, or when you need one resource's spec/status.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"kind":      map[string]interface{}{"type": "string", "description": "Resource kind (required), e.g. Pod, Deployment"},
					"namespace": map[string]interface{}{"type": "string", "description": "Namespace (required for namespaced resources)"},
					"name":      map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				},
				"required": []interface{}{"kind", "name"},
			},
		},
		{
			Name:        "get_logs",
			Description: "Get logs from a pod. Use for debugging, error inspection, or when the user asks for pod logs.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"namespace":      map[string]interface{}{"type": "string", "description": "Namespace (required)"},
					"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name (required)"},
					"container_name": map[string]interface{}{"type": "string", "description": "Optional container name"},
					"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of lines (default 100)"},
					"since":          map[string]interface{}{"type": "string", "description": "Optional time duration (e.g. 1h)"},
				},
				"required": []interface{}{"namespace", "pod_name"},
			},
		},
		{
			Name:        "get_events",
			Description: "List recent Kubernetes events, optionally filtered by namespace, involved object, or reason. Use to diagnose failures, scheduling, or pod issues.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"namespace":       map[string]interface{}{"type": "string", "description": "Namespace to list events from"},
					"involved_object": map[string]interface{}{"type": "string", "description": "Filter by involved object name"},
					"reason":          map[string]interface{}{"type": "string", "description": "Filter by event reason"},
					"limit":           map[string]interface{}{"type": "integer", "description": "Max events (default 20)"},
				},
			},
		},
		{
			Name:        "get_cluster_health",
			Description: "Get overall cluster health: status, score, node count, pod count, and component statuses. Use for 'cluster health', 'how is the cluster doing'.",
			Parameters: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "analyze_pod_health",
			Description: "Analyze pod health in a namespace: restart counts, OOMKills, eviction patterns, and issues. Use for 'why is pod X restarting', 'pod health in namespace Y', or when list_resources shows pods and you need health analysis.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"namespace": map[string]interface{}{"type": "string", "description": "Namespace (required)"},
					"name":      map[string]interface{}{"type": "string", "description": "Optional pod name to analyze a single pod"},
				},
				"required": []interface{}{"namespace"},
			},
		},
		{
			Name:        "observe_metrics",
			Description: "Get current CPU/memory metrics for a resource. For pod, deployment, etc. provide kind, name, and namespace. For node provide kind=node and name. Use for 'memory utilization of pod X', 'CPU usage for deployment Y'.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"kind":      map[string]interface{}{"type": "string", "description": "Resource kind: pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob"},
					"name":      map[string]interface{}{"type": "string", "description": "Resource name (required)"},
					"namespace": map[string]interface{}{"type": "string", "description": "Namespace (required for pod, deployment, and other namespaced kinds)"},
				},
				"required": []interface{}{"kind", "name"},
			},
		},
	}
}

// ToolDefinitionToLLMTool converts a taxonomy ToolDefinition to the LLM types.Tool format.
// Use this when building tool lists from taxonomy subsets (e.g. observe_pod_* tools
// once the executor exposes those names).
func ToolDefinitionToLLMTool(def ToolDefinition) types.Tool {
	params := def.InputSchema
	if params == nil {
		params = map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		}
	}
	if m, ok := params.(map[string]interface{}); ok {
		if _, hasType := m["type"]; !hasType {
			m["type"] = "object"
		}
		if _, hasProps := m["properties"]; !hasProps {
			m["properties"] = map[string]interface{}{}
		}
	}
	return types.Tool{
		Name:                  def.Name,
		Description:           def.Description,
		Parameters:           asParamsMap(params),
		RequiredAutonomyLevel: def.RequiredAutonomyLevel,
	}
}

func asParamsMap(schema interface{}) map[string]interface{} {
	if m, ok := schema.(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{
		"type":       "object",
		"properties": map[string]interface{}{},
	}
}
