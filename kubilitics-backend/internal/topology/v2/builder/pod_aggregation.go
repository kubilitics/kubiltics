package builder

import (
	"fmt"
	"sort"
	"strings"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// podGroupThreshold is the minimum number of pods under a single owner
// before they are collapsed into a PodGroup summary node.
const podGroupThreshold = 3

// AggregatePods collapses pods that share the same ownerReference into a
// single "PodGroup" summary node when the group size exceeds podGroupThreshold.
// All edges that referenced individual pods are redirected to the summary node.
func AggregatePods(nodes []v2.TopologyNode, edges []v2.TopologyEdge) ([]v2.TopologyNode, []v2.TopologyEdge) {
	// Step 1: Identify pod nodes and their owner edges.
	// An owner edge is one where the target is a Pod node and the source is a
	// known owner kind (ReplicaSet, StatefulSet, DaemonSet, Job).
	podNodeIDs := make(map[string]int) // pod node ID -> index in nodes
	for i, n := range nodes {
		if n.Kind == "Pod" {
			podNodeIDs[n.ID] = i
		}
	}
	if len(podNodeIDs) == 0 {
		return nodes, edges
	}

	// Build owner -> list of pod IDs from edges.
	// The owner is determined by edges where the source is a workload controller
	// and the target is a Pod.
	ownerKinds := map[string]bool{
		"ReplicaSet":  true,
		"StatefulSet": true,
		"DaemonSet":   true,
		"Job":         true,
	}

	// Index all nodes by ID once to avoid O(N*M) inner-loop scans.
	nodeByID := make(map[string]*v2.TopologyNode, len(nodes))
	for i := range nodes {
		nodeByID[nodes[i].ID] = &nodes[i]
	}

	type ownerKey struct {
		ownerID   string
		namespace string
	}

	ownerToPods := make(map[ownerKey][]string) // ownerKey -> []podNodeID
	for _, e := range edges {
		if _, isPod := podNodeIDs[e.Target]; !isPod {
			continue
		}
		// Check if source is an owner kind using the pre-built index.
		if srcNode, ok := nodeByID[e.Source]; ok && ownerKinds[srcNode.Kind] {
			key := ownerKey{ownerID: e.Source, namespace: srcNode.Namespace}
			ownerToPods[key] = append(ownerToPods[key], e.Target)
		}
	}

	if len(ownerToPods) == 0 {
		return nodes, edges
	}

	// Step 2: For each owner group with > threshold pods, create a summary node.
	removePodIDs := make(map[string]bool)
	podToGroup := make(map[string]string) // old pod ID -> new PodGroup node ID
	var summaryNodes []v2.TopologyNode

	for key, podIDs := range ownerToPods {
		if len(podIDs) <= podGroupThreshold {
			continue
		}

		// Gather pod data for the summary.
		sort.Strings(podIDs)
		var podNames []string
		worstStatus := "Running"
		readyCount := 0

		for _, pid := range podIDs {
			idx := podNodeIDs[pid]
			pod := nodes[idx]
			podNames = append(podNames, pod.Name)

			// Determine worst status: Failed > Pending > Running/Succeeded/unknown
			worstStatus = worseStatus(worstStatus, pod.Status)

			// Count ready pods (Running phase).
			if strings.EqualFold(pod.Status, "Running") {
				readyCount++
			}
		}

		// Derive a human-friendly label from the owner name.
		ownerName := key.ownerID
		// ownerID is like "ReplicaSet/ns/name" — extract the name part.
		parts := strings.Split(ownerName, "/")
		shortOwner := parts[len(parts)-1]

		groupName := fmt.Sprintf("%s-pods (%d replicas)", shortOwner, len(podIDs))
		groupID := v2.NodeID("PodGroup", key.namespace, shortOwner)

		extra := map[string]interface{}{
			"podCount":   len(podIDs),
			"readyCount": readyCount,
			"podNames":   podNames,
		}

		summaryNodes = append(summaryNodes, v2.TopologyNode{
			ID:         groupID,
			Kind:       "PodGroup",
			Name:       groupName,
			Namespace:  key.namespace,
			APIVersion: "v1",
			Category:   "workload",
			Label:      groupName,
			Status:     worstStatus,
			Layer:      4,
			Group:      groupIDForNamespace(key.namespace),
			Extra:      extra,
		})

		for _, pid := range podIDs {
			removePodIDs[pid] = true
			podToGroup[pid] = groupID
		}
	}

	if len(summaryNodes) == 0 {
		return nodes, edges
	}

	// Step 3: Build new node list — keep non-removed pods, add summary nodes.
	newNodes := make([]v2.TopologyNode, 0, len(nodes)-len(removePodIDs)+len(summaryNodes))
	for _, n := range nodes {
		if !removePodIDs[n.ID] {
			newNodes = append(newNodes, n)
		}
	}
	newNodes = append(newNodes, summaryNodes...)

	// Step 4: Redirect edges.
	redirectedEdges := make(map[string]bool) // deduplicate redirected edges
	newEdges := make([]v2.TopologyEdge, 0, len(edges))
	for _, e := range edges {
		srcGroup, srcRedirect := podToGroup[e.Source]
		tgtGroup, tgtRedirect := podToGroup[e.Target]

		newSource := e.Source
		newTarget := e.Target
		if srcRedirect {
			newSource = srcGroup
		}
		if tgtRedirect {
			newTarget = tgtGroup
		}

		// Skip self-loops that may result from redirection.
		if newSource == newTarget {
			continue
		}

		// Deduplicate edges that now point to the same summary node.
		dedup := newSource + "|" + newTarget + "|" + string(e.RelationshipType)
		if redirectedEdges[dedup] {
			continue
		}
		redirectedEdges[dedup] = true

		newEdge := e
		newEdge.Source = newSource
		newEdge.Target = newTarget
		if srcRedirect || tgtRedirect {
			newEdge.ID = v2.EdgeID(newSource, newTarget, string(e.RelationshipType))
		}
		newEdges = append(newEdges, newEdge)
	}

	return newNodes, newEdges
}

// statusSeverity returns a numeric severity for a pod phase string.
// Higher number means worse status.
func statusSeverity(status string) int {
	switch strings.ToLower(status) {
	case "failed":
		return 3
	case "pending":
		return 2
	case "unknown":
		return 1
	default: // Running, Succeeded
		return 0
	}
}

// worseStatus returns whichever status is more severe.
func worseStatus(a, b string) string {
	if statusSeverity(b) > statusSeverity(a) {
		return b
	}
	return a
}
