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

// staticHubKinds are resource kinds that act as structural hubs. They are included
// as leaf nodes when connected but NEVER used as expansion sources during BFS.
// This prevents namespace/node explosion (Bugs 1, 2 from the topology spec).
var staticHubKinds = map[string]bool{
	"Namespace":     true,
	"Node":          true,
	"LimitRange":    true,
	"ResourceQuota": true,
	"PriorityClass": true,
	"RuntimeClass":  true,
	"IngressClass":  true,
	"StorageClass":  true,
}

// leafOnlyCategories are edge relationship categories that connect to leaf-only
// nodes. Traversal adds the neighbor but does NOT queue it for further expansion.
// Per spec: containment (Namespace) and scheduling (Node) are leaf-only edges.
var leafOnlyCategories = map[string]bool{
	"containment": true,
	"scheduling":  true,
}

// dynamicHubThreshold — any non-workload node with more than this many connections
// in the full graph is treated as a dynamic hub (included but not expanded).
const dynamicHubThreshold = 15

// filterResource builds a resource-centric view using edge-type-aware, hub-aware
// BFS traversal. This is the core USP topology per the final specification.
//
// Modes (mapped from depth parameter):
//
//	depth=1 (Direct):   immediate neighbors only (1 hop)
//	depth=2 (Extended): expand one level from direct nodes (2 hops)
//	depth=3 (Full):     complete dependency graph (unlimited hops)
//
// Invariants enforced:
//   - Selected resource is ALWAYS the center
//   - Every node shown MUST belong to its dependency chain
//   - Static/dynamic hubs are included as leaves, never expanded (except focus)
//   - Containment/scheduling edges produce leaf nodes, never expansion sources
//   - No namespace explosion, no node explosion, no cross-resource leakage
func (f *ViewFilter) filterResource(resp *TopologyResponse, resource, ns string, depth int) *TopologyResponse {
	if resource == "" {
		return resp
	}
	if depth <= 0 {
		depth = 2
	}

	// --- Find focus node ---
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

	// --- Build indexes ---
	nodeKind := make(map[string]string, len(resp.Nodes))
	for _, n := range resp.Nodes {
		nodeKind[n.ID] = n.Kind
	}

	outgoingAdj, incomingAdj := buildDirectedTypedAdjacency(resp.Edges)

	// Compute dynamic hubs: non-workload nodes with fan-out > threshold.
	dynamicHubs := computeDynamicHubs(outgoingAdj, incomingAdj, nodeKind)

	// isHub returns true if a node is a static or dynamic hub.
	isHub := func(nodeID string) bool {
		if staticHubKinds[nodeKind[nodeID]] {
			return true
		}
		return dynamicHubs[nodeID]
	}

	// --- Effective depth: Full mode = unlimited (capped at 100 for safety) ---
	maxDepth := depth
	if depth >= 3 {
		maxDepth = 100
	}

	// --- Edge-type-aware, hub-aware directional BFS ---
	// We traverse the graph in two monotonic directions:
	//   1. Outgoing chain: follow source -> target dependencies only
	//   2. Incoming chain: follow target <- source dependents/parents only
	//
	// This preserves the selected resource's dependency chain while preventing
	// sideways leakage through shared intermediaries such as ServiceAccounts,
	// ReplicaSets, Namespaces, or Nodes.
	type bfsEntry struct {
		id    string
		depth int
	}
	included := make(map[string]bool, len(resp.Nodes))
	included[focusID] = true

	focusKind := nodeKind[focusID]

	traverse := func(adj map[string][]adjacencyEntry) {
		visited := make(map[string]int)
		visited[focusID] = 0
		queue := []bfsEntry{{id: focusID, depth: 0}}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]

			if current.depth >= maxDepth {
				continue
			}
			if current.id != focusID && isHub(current.id) {
				continue
			}

			for _, neighbor := range adj[current.id] {
				if _, seen := visited[neighbor.nodeID]; seen {
					continue
				}

				// Skip siblings: same kind as the focus node reached through
				// an intermediate (e.g., sibling Pod via shared ReplicaSet).
				// The focus node's own chain goes UP (RS→Deployment) or DOWN
				// (Service→Endpoints), never sideways to peer pods.
				if current.id != focusID && nodeKind[neighbor.nodeID] == focusKind && neighbor.nodeID != focusID {
					continue
				}

				neighborDepth := current.depth + 1
				visited[neighbor.nodeID] = neighborDepth
				included[neighbor.nodeID] = true

				// Leaf-only edges (containment, scheduling) normally produce leaf
				// nodes that are never expanded further. BUT when the focus
				// resource IS the hub (e.g., user clicked a Node, Namespace, or
				// StorageClass), the neighbors reached via these edges MUST be
				// expandable — otherwise the topology is useless for the focus
				// resource. Example: StorageClass → PV → PVC → Pod → Deployment
				// must be fully traversable when StorageClass is the focus.
				isLeafEdge := leafOnlyCategories[neighbor.category]
				neighborIsHub := isHub(neighbor.nodeID)
				if current.id == focusID && isLeafEdge {
					// Focus node's direct neighbors via leaf-only edges: expand them
					queue = append(queue, bfsEntry{id: neighbor.nodeID, depth: neighborDepth})
					continue
				}
				if isLeafEdge || neighborIsHub {
					continue
				}
				queue = append(queue, bfsEntry{id: neighbor.nodeID, depth: neighborDepth})
			}
		}
	}

	traverse(outgoingAdj)
	traverse(incomingAdj)

	// --- Build filtered response ---
	var nodes []TopologyNode
	for _, n := range resp.Nodes {
		if included[n.ID] {
			nodes = append(nodes, n)
		}
	}
	edges := filterEdgesByNodes(resp.Edges, included)
	groups := filterGroupsByNodes(resp.Groups, included)
	meta := resp.Metadata
	meta.FocusResource = focusID
	return &TopologyResponse{Metadata: meta, Nodes: nodes, Edges: edges, Groups: groups}
}

// adjacencyEntry tracks a neighbor and the category of the edge connecting to it.
type adjacencyEntry struct {
	nodeID   string
	category string
}

// buildDirectedTypedAdjacency builds source->target and target->source adjacency maps
// that preserve edge categories for directional resource traversal.
func buildDirectedTypedAdjacency(edges []TopologyEdge) (map[string][]adjacencyEntry, map[string][]adjacencyEntry) {
	outgoing := make(map[string][]adjacencyEntry, len(edges))
	incoming := make(map[string][]adjacencyEntry, len(edges))
	for _, e := range edges {
		outgoing[e.Source] = append(outgoing[e.Source], adjacencyEntry{nodeID: e.Target, category: e.RelationshipCategory})
		incoming[e.Target] = append(incoming[e.Target], adjacencyEntry{nodeID: e.Source, category: e.RelationshipCategory})
	}
	return outgoing, incoming
}

// computeDynamicHubs identifies non-workload, non-static-hub nodes with fan-out
// exceeding dynamicHubThreshold. These are treated as hubs at runtime.
func computeDynamicHubs(outgoingAdj, incomingAdj map[string][]adjacencyEntry, nodeKind map[string]string) map[string]bool {
	// Workload kinds are never dynamic hubs — they are core dependency chain members.
	neverDynamicHub := map[string]bool{
		"Deployment": true, "StatefulSet": true, "DaemonSet": true,
		"ReplicaSet": true, "CronJob": true, "Job": true,
		"Pod": true, "Service": true, "Endpoints": true,
		"EndpointSlice": true, "PersistentVolumeClaim": true,
		"PersistentVolume": true, "HorizontalPodAutoscaler": true,
		"PodDisruptionBudget": true, "Role": true, "ClusterRole": true,
		"RoleBinding": true, "ClusterRoleBinding": true,
		"Ingress": true, "NetworkPolicy": true,
	}

	hubs := make(map[string]bool)
	for nodeID, kind := range nodeKind {
		if staticHubKinds[kind] || neverDynamicHub[kind] {
			continue
		}
		neighborCount := len(outgoingAdj[nodeID]) + len(incomingAdj[nodeID])
		if neighborCount > dynamicHubThreshold {
			hubs[nodeID] = true
		}
	}
	return hubs
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
