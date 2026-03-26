package builder

import (
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// EdgeNeighbor pairs a neighbor node ID with the relationship category of
// the edge that connects them. This enables edge-type-aware traversal.
type EdgeNeighbor struct {
	ID       string
	Category string
}

// ReverseIndex provides bidirectional dependency lookups over topology edges.
// Given a resource ID it can answer both "what does this resource depend on?"
// (forward / dependencies) and "what depends on this resource?" (reverse / dependents).
//
// Edge-type awareness: each neighbor is tagged with the edge's relationship
// category so callers can filter traversal by edge type (e.g. expand through
// ownership/networking but not through containment/scheduling).
type ReverseIndex struct {
	// dependents maps a resourceID to neighbors that depend on it.
	// If edge A→B exists, then dependents[B] contains {A, category}.
	dependents map[string][]EdgeNeighbor

	// dependencies maps a resourceID to its upstream dependencies.
	// If edge A→B exists, then dependencies[A] contains {B, category}.
	dependencies map[string][]EdgeNeighbor
}

// BuildReverseIndex constructs a ReverseIndex from a slice of TopologyEdge.
// Edge semantics: Source depends on Target (Source→Target means Source uses/consumes Target).
// Therefore: dependents[Target] includes Source, dependencies[Source] includes Target.
func BuildReverseIndex(edges []v2.TopologyEdge) *ReverseIndex {
	ri := &ReverseIndex{
		dependents:   make(map[string][]EdgeNeighbor),
		dependencies: make(map[string][]EdgeNeighbor),
	}

	for i := range edges {
		src := edges[i].Source
		tgt := edges[i].Target
		cat := edges[i].RelationshipCategory

		ri.dependencies[src] = append(ri.dependencies[src], EdgeNeighbor{ID: tgt, Category: cat})
		ri.dependents[tgt] = append(ri.dependents[tgt], EdgeNeighbor{ID: src, Category: cat})
	}

	return ri
}

// GetDependents returns the IDs of direct dependents of the given resource.
func (ri *ReverseIndex) GetDependents(resourceID string) []string {
	if ri == nil {
		return nil
	}
	neighbors := ri.dependents[resourceID]
	ids := make([]string, len(neighbors))
	for i, n := range neighbors {
		ids[i] = n.ID
	}
	return ids
}

// GetDependencies returns the IDs of direct dependencies of the given resource.
func (ri *ReverseIndex) GetDependencies(resourceID string) []string {
	if ri == nil {
		return nil
	}
	neighbors := ri.dependencies[resourceID]
	ids := make([]string, len(neighbors))
	for i, n := range neighbors {
		ids[i] = n.ID
	}
	return ids
}

// GetDependentsEdgeAware returns dependents with their edge categories.
func (ri *ReverseIndex) GetDependentsEdgeAware(resourceID string) []EdgeNeighbor {
	if ri == nil {
		return nil
	}
	return ri.dependents[resourceID]
}

// GetDependenciesEdgeAware returns dependencies with their edge categories.
func (ri *ReverseIndex) GetDependenciesEdgeAware(resourceID string) []EdgeNeighbor {
	if ri == nil {
		return nil
	}
	return ri.dependencies[resourceID]
}

// GetImpact performs a BFS traversal through the dependents graph up to
// maxDepth levels and returns ALL transitively dependent resources. This
// powers "what breaks if I delete this ConfigMap?" analysis.
//
// A maxDepth of 0 returns no results; a maxDepth of 1 returns only direct
// dependents; higher values follow the chain further.
func (ri *ReverseIndex) GetImpact(resourceID string, maxDepth int) []string {
	if ri == nil || maxDepth <= 0 {
		return nil
	}

	visited := make(map[string]bool)
	visited[resourceID] = true // exclude the root itself

	type queueItem struct {
		id    string
		depth int
	}

	queue := []queueItem{{id: resourceID, depth: 0}}
	var result []string

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		if item.depth >= maxDepth {
			continue
		}

		for _, dep := range ri.dependents[item.id] {
			if visited[dep.ID] {
				continue
			}
			visited[dep.ID] = true
			result = append(result, dep.ID)
			queue = append(queue, queueItem{id: dep.ID, depth: item.depth + 1})
		}
	}

	return result
}

// ImpactedResource represents a resource affected by a change, with parsed
// kind, namespace, and name extracted from the canonical node ID.
type ImpactedResource struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// GetImpactDetailed performs the same BFS as GetImpact but returns structured
// ImpactedResource values with kind/namespace/name parsed from the node IDs.
func (ri *ReverseIndex) GetImpactDetailed(resourceID string, maxDepth int) []ImpactedResource {
	ids := ri.GetImpact(resourceID, maxDepth)
	result := make([]ImpactedResource, 0, len(ids))
	for _, id := range ids {
		kind, ns, name := parseNodeID(id)
		result = append(result, ImpactedResource{
			ID:        id,
			Kind:      kind,
			Namespace: ns,
			Name:      name,
		})
	}
	return result
}

// parseNodeID splits a canonical node ID ("Kind/namespace/name" or "Kind/name")
// into its components.
func parseNodeID(id string) (kind, namespace, name string) {
	parts := strings.SplitN(id, "/", 3)
	switch len(parts) {
	case 3:
		return parts[0], parts[1], parts[2]
	case 2:
		return parts[0], "", parts[1]
	default:
		return id, "", ""
	}
}
