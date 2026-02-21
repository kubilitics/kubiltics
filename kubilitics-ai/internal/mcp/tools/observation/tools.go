// Package observation provides Tier 1 observation tools for the LLM.
//
// All tools are read-only. They query the Backend Proxy (which queries
// the kubilitics-backend gRPC service or the World Model cache).
package observation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
)

// ObservationTools implements all read-only cluster observation tools.
type ObservationTools struct {
	proxy *backend.Proxy
}

// NewObservationTools creates an ObservationTools instance backed by the given proxy.
func NewObservationTools(proxy *backend.Proxy) *ObservationTools {
	return &ObservationTools{proxy: proxy}
}

// ─── list_resources ──────────────────────────────────────────────────────────

type listResourcesArgs struct {
	Kind          string `json:"kind"`
	Namespace     string `json:"namespace"`
	LabelSelector string `json:"label_selector"`
	Limit         int    `json:"limit,omitempty"`
}

// ResourceSummary is a lightweight resource representation.
type ResourceSummary struct {
	Kind      string            `json:"kind"`
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Status    string            `json:"status"`
	Labels    map[string]string `json:"labels,omitempty"`
}

// ListResources implements the list_resources MCP tool.
func (t *ObservationTools) ListResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a listResourcesArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("list_resources: invalid args: %w", err)
	}
	if a.Kind == "" {
		return nil, fmt.Errorf("list_resources: 'kind' is required")
	}
	if a.Limit <= 0 {
		a.Limit = 50
	}

	resources, err := t.proxy.ListResources(ctx, a.Kind, a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("list_resources: %w", err)
	}

	if a.LabelSelector != "" {
		resources = filterByLabels(resources, a.LabelSelector)
	}
	if len(resources) > a.Limit {
		resources = resources[:a.Limit]
	}

	summaries := make([]ResourceSummary, 0, len(resources))
	for _, r := range resources {
		summaries = append(summaries, ResourceSummary{
			Kind:      r.Kind,
			Name:      r.Name,
			Namespace: r.Namespace,
			Status:    r.Status,
			Labels:    r.Labels,
		})
	}

	return map[string]interface{}{
		"kind":      a.Kind,
		"namespace": a.Namespace,
		"count":     len(summaries),
		"items":     summaries,
	}, nil
}

// ─── get_resource ─────────────────────────────────────────────────────────────

type getResourceArgs struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// ResourceDetail is the full resource representation.
type ResourceDetail struct {
	Kind        string                 `json:"kind"`
	Name        string                 `json:"name"`
	Namespace   string                 `json:"namespace"`
	Status      string                 `json:"status"`
	Labels      map[string]string      `json:"labels,omitempty"`
	Annotations map[string]string      `json:"annotations,omitempty"`
	Spec        map[string]interface{} `json:"spec,omitempty"`
	StatusInfo  map[string]interface{} `json:"status_info,omitempty"`
	OwnerRefs   []ownerRefSummary      `json:"owner_refs,omitempty"`
}

type ownerRefSummary struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	UID  string `json:"uid,omitempty"`
}

// GetResource implements the get_resource MCP tool.
func (t *ObservationTools) GetResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a getResourceArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("get_resource: invalid args: %w", err)
	}
	if a.Kind == "" || a.Name == "" {
		return nil, fmt.Errorf("get_resource: 'kind' and 'name' are required")
	}

	r, err := t.proxy.GetResource(ctx, a.Kind, a.Namespace, a.Name)
	if err != nil {
		return nil, fmt.Errorf("get_resource: %w", err)
	}

	return protoToDetail(r), nil
}

// ─── get_events ───────────────────────────────────────────────────────────────

type getEventsArgs struct {
	Namespace      string `json:"namespace"`
	InvolvedObject string `json:"involved_object"`
	Reason         string `json:"reason"`
	Limit          int    `json:"limit,omitempty"`
}

// EventSummary is a condensed Kubernetes event.
type EventSummary struct {
	Type           string `json:"type"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
	InvolvedObject string `json:"involved_object"`
	Count          int32  `json:"count"`
}

// GetEvents implements the get_events MCP tool.
func (t *ObservationTools) GetEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a getEventsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("get_events: invalid args: %w", err)
	}
	if a.Limit <= 0 {
		a.Limit = 20
	}

	resources, err := t.proxy.ListResources(ctx, "Event", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("get_events: %w", err)
	}

	events := make([]EventSummary, 0)
	for _, r := range resources {
		if a.Reason != "" && !strings.EqualFold(r.Labels["reason"], a.Reason) {
			continue
		}
		if a.InvolvedObject != "" && !strings.Contains(r.Name, a.InvolvedObject) {
			continue
		}
		events = append(events, EventSummary{
			Type:           r.Labels["type"],
			Reason:         r.Labels["reason"],
			Message:        r.Status,
			InvolvedObject: fmt.Sprintf("%s/%s", r.Kind, r.Name),
		})
		if len(events) >= a.Limit {
			break
		}
	}

	return map[string]interface{}{
		"namespace": a.Namespace,
		"count":     len(events),
		"events":    events,
	}, nil
}

// ─── get_logs ─────────────────────────────────────────────────────────────────

type getLogsArgs struct {
	Namespace     string `json:"namespace"`
	PodName       string `json:"pod_name"`
	ContainerName string `json:"container_name,omitempty"`
	TailLines     int    `json:"tail_lines,omitempty"`
	Since         string `json:"since,omitempty"`
}

// GetLogs implements the get_logs MCP tool.
func (t *ObservationTools) GetLogs(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a getLogsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("get_logs: invalid args: %w", err)
	}
	if a.Namespace == "" || a.PodName == "" {
		return nil, fmt.Errorf("get_logs: 'namespace' and 'pod_name' are required")
	}
	if a.TailLines <= 0 {
		a.TailLines = 100
	}

	params := map[string]interface{}{
		"container": a.ContainerName,
		"tail":      a.TailLines,
		"since":     a.Since,
	}
	paramsJSON, _ := json.Marshal(params)

	target := &pb.Resource{
		Kind:      "Pod",
		Namespace: a.Namespace,
		Name:      a.PodName,
	}

	result, err := t.proxy.ExecuteCommand(ctx, "get_logs", target, paramsJSON, true)
	if err != nil {
		return nil, fmt.Errorf("get_logs: %w", err)
	}

	return map[string]interface{}{
		"pod":       a.PodName,
		"namespace": a.Namespace,
		"container": a.ContainerName,
		"logs":      result.Message,
	}, nil
}

// ─── get_topology ─────────────────────────────────────────────────────────────

type getTopologyArgs struct {
	Namespace string `json:"namespace"`
	Depth     int    `json:"depth,omitempty"`
}

// GetTopology implements the get_topology MCP tool.
func (t *ObservationTools) GetTopology(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a getTopologyArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("get_topology: invalid args: %w", err)
	}
	if a.Depth <= 0 {
		a.Depth = 3
	}

	graph, err := t.proxy.GetTopologyGraph(ctx, a.Namespace, int32(a.Depth))
	if err != nil {
		return nil, fmt.Errorf("get_topology: %w", err)
	}

	nodes := make([]map[string]interface{}, 0, len(graph.Nodes))
	for _, n := range graph.Nodes {
		var kind, name, namespace, status string
		if n.Resource != nil {
			kind = n.Resource.Kind
			name = n.Resource.Name
			namespace = n.Resource.Namespace
			if n.Health != nil {
				status = n.Health.Status
			}
		}
		nodes = append(nodes, map[string]interface{}{
			"id":        n.NodeId,
			"kind":      kind,
			"name":      name,
			"namespace": namespace,
			"status":    status,
		})
	}

	edges := make([]map[string]interface{}, 0, len(graph.Edges))
	for _, d := range graph.Edges {
		edges = append(edges, map[string]interface{}{
			"from":         d.SourceId,
			"to":           d.TargetId,
			"relationship": d.DependencyType,
		})
	}

	return map[string]interface{}{
		"namespace":  a.Namespace,
		"node_count": len(nodes),
		"edge_count": len(edges),
		"nodes":      nodes,
		"edges":      edges,
	}, nil
}

// ─── search_resources ─────────────────────────────────────────────────────────

type searchResourcesArgs struct {
	Query     string `json:"query"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

// SearchResources implements the search_resources MCP tool.
func (t *ObservationTools) SearchResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a searchResourcesArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("search_resources: invalid args: %w", err)
	}
	if a.Query == "" {
		return nil, fmt.Errorf("search_resources: 'query' is required")
	}
	if a.Limit <= 0 {
		a.Limit = 20
	}

	kinds := []string{a.Kind}
	if a.Kind == "" {
		kinds = []string{"Pod", "Deployment", "Service", "ConfigMap", "Node", "Ingress", "StatefulSet", "DaemonSet"}
	}

	query := strings.ToLower(a.Query)
	results := make([]ResourceSummary, 0)

	for _, kind := range kinds {
		if len(results) >= a.Limit {
			break
		}
		resources, err := t.proxy.ListResources(ctx, kind, a.Namespace)
		if err != nil {
			continue
		}
		for _, r := range resources {
			if len(results) >= a.Limit {
				break
			}
			if resourceMatchesQuery(r, query) {
				results = append(results, ResourceSummary{
					Kind:      r.Kind,
					Name:      r.Name,
					Namespace: r.Namespace,
					Status:    r.Status,
					Labels:    r.Labels,
				})
			}
		}
	}

	return map[string]interface{}{
		"query":   a.Query,
		"count":   len(results),
		"results": results,
	}, nil
}

// ─── get_cluster_health ───────────────────────────────────────────────────────

// GetClusterHealth implements the get_cluster_health MCP tool.
func (t *ObservationTools) GetClusterHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	health, err := t.proxy.GetClusterHealth(ctx)
	if err != nil {
		return nil, fmt.Errorf("get_cluster_health: %w", err)
	}

	components := make([]map[string]interface{}, 0, len(health.Components))
	for _, c := range health.Components {
		components = append(components, map[string]interface{}{
			"name":    c.Name,
			"status":  c.Status,
			"message": c.Message,
		})
	}

	var nodeCount, podCount int32
	if rc := health.ResourceCounts; rc != nil {
		nodeCount = rc.Nodes
		podCount = rc.Pods
	}

	return map[string]interface{}{
		"overall_status": health.Status,
		"score":          health.Score,
		"node_count":     nodeCount,
		"pod_count":      podCount,
		"components":     components,
	}, nil
}

// ─── HandlerMap ───────────────────────────────────────────────────────────────

// HandlerMap returns all tool handlers keyed by tool name.
// Use this to register tools with an MCPServer.
func (t *ObservationTools) HandlerMap() map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	return map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error){
		"list_resources":     t.ListResources,
		"get_resource":       t.GetResource,
		"get_events":         t.GetEvents,
		"get_logs":           t.GetLogs,
		"get_topology":       t.GetTopology,
		"search_resources":   t.SearchResources,
		"get_cluster_health": t.GetClusterHealth,
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func decodeArgs(args map[string]interface{}, target interface{}) error {
	b, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, target)
}

func protoToDetail(r *pb.Resource) ResourceDetail {
	owners := make([]ownerRefSummary, 0, len(r.OwnerRefs))
	for _, o := range r.OwnerRefs {
		owners = append(owners, ownerRefSummary{Kind: o.Kind, Name: o.Name, UID: o.Uid})
	}

	// Raw data is stored as JSON bytes in the Data field.
	var raw map[string]interface{}
	if len(r.Data) > 0 {
		_ = json.Unmarshal(r.Data, &raw)
	}
	var spec, statusInfo map[string]interface{}
	if raw != nil {
		if s, ok := raw["spec"].(map[string]interface{}); ok {
			spec = s
		}
		if s, ok := raw["status"].(map[string]interface{}); ok {
			statusInfo = s
		}
	}

	return ResourceDetail{
		Kind:        r.Kind,
		Name:        r.Name,
		Namespace:   r.Namespace,
		Status:      r.Status,
		Labels:      r.Labels,
		Annotations: r.Annotations,
		Spec:        spec,
		StatusInfo:  statusInfo,
		OwnerRefs:   owners,
	}
}

func filterByLabels(resources []*pb.Resource, selector string) []*pb.Resource {
	filters := make(map[string]string)
	for _, part := range strings.Split(selector, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			filters[kv[0]] = kv[1]
		}
	}
	if len(filters) == 0 {
		return resources
	}
	out := make([]*pb.Resource, 0)
	for _, r := range resources {
		match := true
		for k, v := range filters {
			if r.Labels[k] != v {
				match = false
				break
			}
		}
		if match {
			out = append(out, r)
		}
	}
	return out
}

func resourceMatchesQuery(r *pb.Resource, query string) bool {
	if strings.Contains(strings.ToLower(r.Name), query) {
		return true
	}
	if strings.Contains(strings.ToLower(r.Status), query) {
		return true
	}
	for k, v := range r.Labels {
		if strings.Contains(strings.ToLower(k+v), query) {
			return true
		}
	}
	return false
}
