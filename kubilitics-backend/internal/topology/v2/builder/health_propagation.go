package builder

import (
	"strings"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// Normalised pod-phase statuses used for propagation scoring.
const (
	statusHealthy     = "healthy"
	statusProgressing = "progressing"
	statusDegraded    = "degraded"
	statusUnknown     = "unknown"
)

// Workload kinds that participate in ownership-based health propagation.
var propagationKinds = map[string]bool{
	"Pod":         true,
	"ReplicaSet":  true,
	"Deployment":  true,
	"StatefulSet": true,
	"DaemonSet":   true,
	"Job":         true,
	"CronJob":     true,
}

// PropagateHealth computes health status for workload nodes by walking the
// ownership graph from leaf Pods up to root controllers (Deployments,
// StatefulSets, DaemonSets, CronJobs). It uses only the graph edges of type
// "ownerRef" so it does not require the original ResourceBundle.
//
// Vocabulary note: PropagateHealth outputs "healthy"/"progressing"/"degraded"/"unknown".
// HealthEnricher (which runs later in the handler pipeline when a ResourceBundle
// is available) outputs "healthy"/"warning"/"error"/"unknown". The enricher
// overwrites statuses for Pods, Nodes, Deployments, StatefulSets, and DaemonSets,
// so in practice PropagateHealth's values only survive for CronJobs, Jobs, and
// ReplicaSets that HealthEnricher does not cover. To avoid clobbering a status
// already set by the graph builder (e.g. from live conditions), PropagateHealth
// skips nodes that already carry a non-empty, non-generic status.
//
// The returned slice is a copy of nodes with updated Status fields; the
// original slice is not mutated.
func PropagateHealth(nodes []v2.TopologyNode, edges []v2.TopologyEdge) []v2.TopologyNode {
	// Index nodes by ID.
	nodeByID := make(map[string]*v2.TopologyNode, len(nodes))
	result := make([]v2.TopologyNode, len(nodes))
	copy(result, nodes)
	for i := range result {
		nodeByID[result[i].ID] = &result[i]
	}

	// Build parent→children adjacency from ownerRef edges.
	// ownerRef edges are Source=child, Target=parent ("owned by").
	childrenOf := make(map[string][]string) // parent → []child
	parentOf := make(map[string]string)     // child  → parent
	for _, e := range edges {
		if e.RelationshipType != "ownerRef" {
			continue
		}
		parent := e.Target
		child := e.Source
		childrenOf[parent] = append(childrenOf[parent], child)
		parentOf[child] = parent
	}

	// Normalise Pod status to our internal vocabulary.
	podStatus := make(map[string]string, len(nodes))
	for i := range result {
		n := &result[i]
		if n.Kind != "Pod" {
			continue
		}
		podStatus[n.ID] = normalisePodStatus(n.Status)
		// Also write the normalised status back to the node so the frontend
		// sees a consistent vocabulary for pods that haven't been through the
		// full HealthEnricher yet.
		n.Status = podStatus[n.ID]
	}

	// Compute health bottom-up. We use memoisation to avoid recomputation.
	computed := make(map[string]string, len(nodes))
	for id := range podStatus {
		computed[id] = podStatus[id]
	}

	// computeHealth recursively resolves a node's health from its children.
	var computeHealth func(id string) string
	computeHealth = func(id string) string {
		if s, ok := computed[id]; ok {
			return s
		}
		node, exists := nodeByID[id]
		if !exists {
			return statusUnknown // missing node — treat as unknown, not healthy
		}
		if !propagationKinds[node.Kind] {
			return statusHealthy
		}
		children := childrenOf[id]
		if len(children) == 0 {
			// Leaf non-Pod (e.g. a ReplicaSet with no pods in the graph).
			// Keep whatever graph_builder assigned.
			computed[id] = normaliseControllerStatus(node.Status)
			return computed[id]
		}
		computed[id] = aggregateChildHealth(children, computeHealth)
		return computed[id]
	}

	// Walk every propagation-eligible node so everything gets resolved.
	for id, node := range nodeByID {
		if propagationKinds[node.Kind] {
			computeHealth(id)
		}
	}

	// Write computed statuses back to result nodes. Skip nodes that already
	// carry a non-empty, non-generic status (e.g. set by the graph builder
	// from live K8s conditions) to avoid overwriting more specific information
	// that HealthEnricher will later refine.
	for i := range result {
		n := &result[i]
		if s, ok := computed[n.ID]; ok {
			if hasSpecificStatus(n.Status) {
				continue
			}
			n.Status = s
			n.StatusReason = reasonForStatus(s)
		}
	}

	return result
}

// aggregateChildHealth determines a parent's status from its children's resolved
// statuses using weighted aggregation. Instead of the binary "any degraded =
// parent degraded" approach, it considers the ratio of healthy children.
//
// Rules:
//  1. All children healthy → parent is "healthy"
//  2. Any children not fully healthy but some progressing → "progressing"
//  3. Some children degraded/unknown → "degraded"
//  4. No children → "healthy"
func aggregateChildHealth(childIDs []string, resolve func(string) string) string {
	if len(childIDs) == 0 {
		return statusHealthy
	}

	total := 0
	healthy := 0
	progressing := 0

	for _, cid := range childIDs {
		h := resolve(cid)
		total++
		switch h {
		case statusHealthy:
			healthy++
		case statusProgressing:
			progressing++
		}
	}

	if total == 0 {
		return statusHealthy
	}

	ratio := float64(healthy) / float64(total)

	switch {
	case ratio == 1.0:
		return statusHealthy
	case progressing > 0 && healthy+progressing == total:
		return statusProgressing
	default:
		return statusDegraded
	}
}

// normalisePodStatus maps Kubernetes Pod.Status.Phase strings (and the graph
// builder's existing status values) into the propagation vocabulary.
func normalisePodStatus(raw string) string {
	switch strings.ToLower(raw) {
	case "running", "succeeded", "healthy":
		return statusHealthy
	case "pending", "progressing":
		return statusProgressing
	case "failed", "error", "degraded", "crashloopbackoff":
		return statusDegraded
	default:
		return statusUnknown
	}
}

// normaliseControllerStatus maps existing graph_builder statuses for
// controllers (ReplicaSet, Job, etc.) into the propagation vocabulary.
func normaliseControllerStatus(raw string) string {
	switch strings.ToLower(raw) {
	case "healthy", "active", "ready", "complete", "succeeded":
		return statusHealthy
	case "progressing":
		return statusProgressing
	case "degraded", "error", "failed":
		return statusDegraded
	default:
		return statusUnknown
	}
}

// hasSpecificStatus returns true when a node already carries a non-empty status
// that is not one of the generic placeholder values. This prevents PropagateHealth
// from overwriting statuses that were set from live K8s resource conditions by
// the graph builder.
func hasSpecificStatus(status string) bool {
	if status == "" {
		return false
	}
	switch strings.ToLower(status) {
	case "unknown", "":
		return false
	default:
		return true
	}
}

// reasonForStatus returns a human-readable StatusReason for the propagated status.
func reasonForStatus(s string) string {
	switch s {
	case statusHealthy:
		return "AllChildrenHealthy"
	case statusProgressing:
		return "ChildProgressing"
	case statusDegraded:
		return "ChildDegraded"
	case statusUnknown:
		return "ChildStatusUnknown"
	default:
		return ""
	}
}
