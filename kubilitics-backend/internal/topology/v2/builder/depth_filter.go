package builder

import (
	"strings"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// Depth levels for progressive disclosure topology.
// depth=0: executive view — top-level controllers, networking entry points, infrastructure
// depth=1: intermediary controllers and policies
// depth=2: workload units, configuration, and storage
// depth=3: everything (RBAC details, events, webhooks, etc.)
var depthKinds = []map[string]bool{
	// depth 0: executive view (10-20 nodes typical)
	{
		"Deployment":  true,
		"StatefulSet": true,
		"DaemonSet":   true,
		"CronJob":     true,
		"Service":     true,
		"Ingress":     true,
		"Node":        true,
		"Namespace":   true,
	},
	// depth 1: intermediary controllers
	{
		"ReplicaSet":              true,
		"Job":                     true,
		"Endpoints":               true,
		"EndpointSlice":           true,
		"HorizontalPodAutoscaler": true,
		"PodDisruptionBudget":     true,
	},
	// depth 2: workload units + configuration + storage
	{
		"Pod":                   true,
		"ConfigMap":             true,
		"Secret":                true,
		"PersistentVolumeClaim": true,
		"PersistentVolume":      true,
		"StorageClass":          true,
		"ServiceAccount":        true,
	},
	// depth 3: everything else — implicitly, anything not in the above sets
}

// kindDepthLevel returns the depth level at which a given Kind becomes visible.
// Returns 3 for any Kind not explicitly listed in levels 0-2.
func kindDepthLevel(kind string) int {
	for level := 0; level < len(depthKinds); level++ {
		if depthKinds[level][kind] {
			return level
		}
	}
	return 3
}

// FilterByDepth keeps only nodes matching the requested depth level and below.
// depth=0: top-level controllers + networking + infrastructure
// depth=1: above + intermediary controllers
// depth=2: above + workload units + configuration
// depth=3: everything
// It returns the filtered nodes, filtered edges (only between visible nodes),
// and the list of node IDs that have hidden children (expandable nodes).
func FilterByDepth(nodes []v2.TopologyNode, edges []v2.TopologyEdge, depth int) ([]v2.TopologyNode, []v2.TopologyEdge, []string) {
	if depth < 0 {
		depth = 0
	}
	if depth >= 3 {
		// depth 3 means everything — no filtering needed
		return nodes, edges, nil
	}

	// Build visible set
	visibleIDs := make(map[string]bool, len(nodes))
	var filtered []v2.TopologyNode
	for _, n := range nodes {
		if kindDepthLevel(n.Kind) <= depth {
			filtered = append(filtered, n)
			visibleIDs[n.ID] = true
		}
	}

	// Collapse edges through hidden nodes to their nearest visible ancestor
	// instead of simply deleting edges to hidden nodes.
	ownerOf := buildOwnerMap(edges)
	filteredEdges := collapseEdges(edges, visibleIDs, ownerOf)

	// Find expandable nodes: visible nodes that have at least one hidden neighbor
	expandable := findExpandable(nodes, edges, visibleIDs)

	return filtered, filteredEdges, expandable
}

// ExpandNode adds all direct neighbors of the given nodeID to the visible set.
// It takes the full graph (allNodes, allEdges), the currently visible nodes,
// and the ID to expand. Returns the new combined node and edge sets.
func ExpandNode(allNodes []v2.TopologyNode, allEdges []v2.TopologyEdge, visibleNodes []v2.TopologyNode, expandNodeID string) ([]v2.TopologyNode, []v2.TopologyEdge) {
	// Build index of all nodes by ID
	allNodeMap := make(map[string]v2.TopologyNode, len(allNodes))
	for _, n := range allNodes {
		allNodeMap[n.ID] = n
	}

	// Current visible set
	visibleIDs := make(map[string]bool, len(visibleNodes))
	for _, n := range visibleNodes {
		visibleIDs[n.ID] = true
	}

	// Find all direct neighbors of expandNodeID in the full graph
	for _, e := range allEdges {
		if e.Source == expandNodeID {
			if !visibleIDs[e.Target] {
				if n, ok := allNodeMap[e.Target]; ok {
					visibleNodes = append(visibleNodes, n)
					visibleIDs[e.Target] = true
				}
			}
		}
		if e.Target == expandNodeID {
			if !visibleIDs[e.Source] {
				if n, ok := allNodeMap[e.Source]; ok {
					visibleNodes = append(visibleNodes, n)
					visibleIDs[e.Source] = true
				}
			}
		}
	}

	// Prune edges to only connect visible nodes
	filteredEdges := pruneEdges(allEdges, visibleIDs)

	return visibleNodes, filteredEdges
}

// pruneEdges returns only edges where both source and target are in the visible set.
func pruneEdges(edges []v2.TopologyEdge, visibleIDs map[string]bool) []v2.TopologyEdge {
	var out []v2.TopologyEdge
	for _, e := range edges {
		if visibleIDs[e.Source] && visibleIDs[e.Target] {
			out = append(out, e)
		}
	}
	return out
}

// kindFromID extracts the Kind portion from a node ID ("Kind/namespace/name" or "Kind/name").
func kindFromID(id string) string {
	if idx := strings.IndexByte(id, '/'); idx >= 0 {
		return id[:idx]
	}
	return id
}

// buildOwnerMap builds a child->owner map from ownerRef edges.
// It handles both edge directions (Source=child,Target=parent and
// Source=parent,Target=child) by comparing depth levels.
func buildOwnerMap(edges []v2.TopologyEdge) map[string]string {
	ownerOf := make(map[string]string)
	for _, e := range edges {
		if e.RelationshipType != "ownerRef" {
			continue
		}
		srcDepth := kindDepthLevel(kindFromID(e.Source))
		tgtDepth := kindDepthLevel(kindFromID(e.Target))
		if srcDepth > tgtDepth {
			// Source is deeper (child), Target is shallower (owner)
			ownerOf[e.Source] = e.Target
		} else if tgtDepth > srcDepth {
			// Target is deeper (child), Source is shallower (owner)
			ownerOf[e.Target] = e.Source
		}
		// If same depth, skip — ambiguous ownership
	}
	return ownerOf
}

// collapseEdges reroutes edges through hidden nodes to their nearest visible ancestor.
// If A->B->C and B is hidden, creates A->C with metadata indicating the collapse.
func collapseEdges(edges []v2.TopologyEdge, visibleIDs map[string]bool, ownerOf map[string]string) []v2.TopologyEdge {
	// Build a map: nodeID -> nearest visible ancestor
	visibleAncestor := make(map[string]string)
	for id := range visibleIDs {
		visibleAncestor[id] = id // visible nodes map to themselves
	}

	// For hidden nodes, walk up the ownership chain to find visible ancestor
	var findAncestor func(id string) string
	findAncestor = func(id string) string {
		if a, ok := visibleAncestor[id]; ok {
			return a
		}
		owner, hasOwner := ownerOf[id]
		if !hasOwner || owner == "" {
			visibleAncestor[id] = "" // no visible ancestor
			return ""
		}
		ancestor := findAncestor(owner)
		visibleAncestor[id] = ancestor
		return ancestor
	}

	// Reroute edges
	seen := make(map[string]bool)
	var out []v2.TopologyEdge
	for _, e := range edges {
		src := e.Source
		tgt := e.Target

		// Remap hidden endpoints to visible ancestors
		if !visibleIDs[src] {
			src = findAncestor(src)
		}
		if !visibleIDs[tgt] {
			tgt = findAncestor(tgt)
		}

		// Skip if either endpoint has no visible ancestor, or self-loop
		if src == "" || tgt == "" || src == tgt {
			continue
		}

		// Dedup
		key := src + "|" + tgt + "|" + string(e.RelationshipType)
		if seen[key] {
			continue
		}
		seen[key] = true

		collapsed := e
		collapsed.Source = src
		collapsed.Target = tgt
		if src != e.Source || tgt != e.Target {
			// Mark as collapsed edge
			if collapsed.Detail == "" {
				collapsed.Detail = "via hidden resources"
			} else {
				collapsed.Detail += " (collapsed)"
			}
		}
		out = append(out, collapsed)
	}
	return out
}

// findExpandable returns IDs of visible nodes that have at least one hidden neighbor.
func findExpandable(allNodes []v2.TopologyNode, allEdges []v2.TopologyEdge, visibleIDs map[string]bool) []string {
	// Build set of all node IDs for quick lookup
	allNodeIDs := make(map[string]bool, len(allNodes))
	for _, n := range allNodes {
		allNodeIDs[n.ID] = true
	}

	// For each edge, if one end is visible and the other is hidden, the visible end is expandable
	expandableSet := make(map[string]bool)
	for _, e := range allEdges {
		srcVisible := visibleIDs[e.Source]
		tgtVisible := visibleIDs[e.Target]
		if srcVisible && !tgtVisible && allNodeIDs[e.Target] {
			expandableSet[e.Source] = true
		}
		if tgtVisible && !srcVisible && allNodeIDs[e.Source] {
			expandableSet[e.Target] = true
		}
	}

	expandable := make([]string, 0, len(expandableSet))
	for id := range expandableSet {
		expandable = append(expandable, id)
	}
	return expandable
}
