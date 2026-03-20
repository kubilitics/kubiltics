package v2

import "strings"

// ViewFilter applies view-mode specific filtering to a fully built TopologyResponse.
type ViewFilter struct{}

// Filter returns a new TopologyResponse with only the nodes and edges relevant to the given Options.
func (f *ViewFilter) Filter(resp *TopologyResponse, opts Options) *TopologyResponse {
	if resp == nil {
		return nil
	}
	switch opts.Mode {
	case ViewModeCluster:
		return f.filterCluster(resp)
	case ViewModeNamespace:
		return f.filterNamespace(resp, opts.Namespace)
	case ViewModeWorkload:
		return f.filterWorkload(resp, opts.Namespace)
	case ViewModeResource:
		return f.filterResource(resp, opts.Resource, opts.Namespace, opts.Depth)
	case ViewModeRBAC:
		return f.filterRBAC(resp, opts.Namespace)
	default:
		return resp
	}
}

func (f *ViewFilter) filterCluster(resp *TopologyResponse) *TopologyResponse {
	allowed := map[string]bool{
		"Namespace": true, "Node": true, "Deployment": true, "StatefulSet": true, "DaemonSet": true,
	}
	return filterByKinds(resp, allowed)
}

func (f *ViewFilter) filterNamespace(resp *TopologyResponse, ns string) *TopologyResponse {
	if ns == "" {
		return resp
	}
	nodeIDs := make(map[string]bool)
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if n.Namespace == ns || n.Namespace == "" {
			nodes = append(nodes, n)
			nodeIDs[n.ID] = true
		}
	}
	edges := filterEdgesByNodes(resp.Edges, nodeIDs)
	groups := filterGroupsByNodes(resp.Groups, nodeIDs)
	return &TopologyResponse{Metadata: resp.Metadata, Nodes: nodes, Edges: edges, Groups: groups}
}

func (f *ViewFilter) filterWorkload(resp *TopologyResponse, ns string) *TopologyResponse {
	workloadKinds := map[string]bool{
		"Deployment": true, "StatefulSet": true, "DaemonSet": true,
		"ReplicaSet": true, "Pod": true, "Job": true, "CronJob": true,
		"Service": true, "HorizontalPodAutoscaler": true, "PodDisruptionBudget": true,
	}
	nodeIDs := make(map[string]bool)
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if workloadKinds[n.Kind] && (ns == "" || n.Namespace == ns || n.Namespace == "") {
			nodes = append(nodes, n)
			nodeIDs[n.ID] = true
		}
	}
	connectedIDs := findConnectedNodes(resp.Edges, nodeIDs)
	for _, n := range resp.Nodes {
		if connectedIDs[n.ID] && !nodeIDs[n.ID] {
			nodes = append(nodes, n)
			nodeIDs[n.ID] = true
		}
	}
	edges := filterEdgesByNodes(resp.Edges, nodeIDs)
	groups := filterGroupsByNodes(resp.Groups, nodeIDs)
	return &TopologyResponse{Metadata: resp.Metadata, Nodes: nodes, Edges: edges, Groups: groups}
}

// filterResource builds a resource-centric view showing a specific resource and ALL
// connections up to the given depth. This is the critical view per PRD.
func (f *ViewFilter) filterResource(resp *TopologyResponse, resource, ns string, depth int) *TopologyResponse {
	if resource == "" {
		return resp
	}
	if depth <= 0 {
		depth = 2
	}
	var focusID string
	for _, n := range resp.Nodes {
		if n.ID == resource {
			focusID = n.ID
			break
		}
		if matchesResourceQuery(n, resource, ns) {
			focusID = n.ID
			break
		}
	}
	if focusID == "" {
		return &TopologyResponse{Metadata: resp.Metadata}
	}

	adjacency := buildAdjacency(resp.Edges)
	visited := make(map[string]int)
	visited[focusID] = 0
	queue := []string{focusID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		currentDepth := visited[current]
		if currentDepth >= depth {
			continue
		}
		for _, neighbor := range adjacency[current] {
			if _, ok := visited[neighbor]; !ok {
				visited[neighbor] = currentDepth + 1
				queue = append(queue, neighbor)
			}
		}
	}

	nodeIDs := make(map[string]bool, len(visited))
	for id := range visited {
		nodeIDs[id] = true
	}
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if nodeIDs[n.ID] {
			nodes = append(nodes, n)
		}
	}
	edges := filterEdgesByNodes(resp.Edges, nodeIDs)
	groups := filterGroupsByNodes(resp.Groups, nodeIDs)
	meta := resp.Metadata
	meta.FocusResource = focusID
	return &TopologyResponse{Metadata: meta, Nodes: nodes, Edges: edges, Groups: groups}
}

func (f *ViewFilter) filterRBAC(resp *TopologyResponse, ns string) *TopologyResponse {
	rbacKinds := map[string]bool{
		"ServiceAccount": true, "Role": true, "RoleBinding": true,
		"ClusterRole": true, "ClusterRoleBinding": true,
	}
	nodeIDs := make(map[string]bool)
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if rbacKinds[n.Kind] && (ns == "" || n.Namespace == ns || n.Namespace == "") {
			nodes = append(nodes, n)
			nodeIDs[n.ID] = true
		}
	}
	edges := filterEdgesByNodes(resp.Edges, nodeIDs)
	groups := filterGroupsByNodes(resp.Groups, nodeIDs)
	return &TopologyResponse{Metadata: resp.Metadata, Nodes: nodes, Edges: edges, Groups: groups}
}

func filterByKinds(resp *TopologyResponse, allowed map[string]bool) *TopologyResponse {
	nodeIDs := make(map[string]bool)
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if allowed[n.Kind] {
			nodes = append(nodes, n)
			nodeIDs[n.ID] = true
		}
	}
	edges := filterEdgesByNodes(resp.Edges, nodeIDs)
	groups := filterGroupsByNodes(resp.Groups, nodeIDs)
	return &TopologyResponse{Metadata: resp.Metadata, Nodes: nodes, Edges: edges, Groups: groups}
}

func filterEdgesByNodes(edges []TopologyEdge, nodeIDs map[string]bool) []TopologyEdge {
	var out []TopologyEdge
	for _, e := range edges {
		if nodeIDs[e.Source] && nodeIDs[e.Target] {
			out = append(out, e)
		}
	}
	return out
}

func filterGroupsByNodes(groups []TopologyGroup, nodeIDs map[string]bool) []TopologyGroup {
	var out []TopologyGroup
	for _, g := range groups {
		var members []string
		for _, m := range g.Members {
			if nodeIDs[m] {
				members = append(members, m)
			}
		}
		if len(members) > 0 {
			g2 := g
			g2.Members = members
			out = append(out, g2)
		}
	}
	return out
}

func findConnectedNodes(edges []TopologyEdge, seeds map[string]bool) map[string]bool {
	connected := make(map[string]bool)
	for _, e := range edges {
		if seeds[e.Source] {
			connected[e.Target] = true
		}
		if seeds[e.Target] {
			connected[e.Source] = true
		}
	}
	return connected
}

func buildAdjacency(edges []TopologyEdge) map[string][]string {
	adj := make(map[string][]string)
	for _, e := range edges {
		adj[e.Source] = append(adj[e.Source], e.Target)
		adj[e.Target] = append(adj[e.Target], e.Source)
	}
	return adj
}

func matchesResourceQuery(n TopologyNode, resource, ns string) bool {
	parts := strings.Split(resource, "/")
	switch len(parts) {
	case 3:
		return strings.EqualFold(n.Kind, parts[0]) && n.Namespace == parts[1] && n.Name == parts[2]
	case 2:
		return strings.EqualFold(n.Kind, parts[0]) && n.Name == parts[1] && (ns == "" || n.Namespace == ns)
	case 1:
		return n.Name == parts[0] && (ns == "" || n.Namespace == ns)
	}
	return false
}

