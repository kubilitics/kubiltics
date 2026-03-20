package resolver

import (
	"fmt"
	"slices"
)

type DependencyGraph struct {
	nodes     map[string]*GraphNode
	edges     []GraphEdge
	adjacency map[string][]string
}

func NewDependencyGraph() *DependencyGraph {
	return &DependencyGraph{
		nodes:     make(map[string]*GraphNode),
		edges:     make([]GraphEdge, 0),
		adjacency: make(map[string][]string),
	}
}

func (g *DependencyGraph) AddNode(node *GraphNode) {
	if node == nil || node.AddonID == "" {
		return
	}
	if existing, ok := g.nodes[node.AddonID]; ok {
		if node.Depth < existing.Depth {
			existing.Depth = node.Depth
		}
		existing.IsRequired = existing.IsRequired || node.IsRequired
		if node.Version != "" {
			existing.Version = node.Version
		}
		if node.IsInstalled {
			existing.IsInstalled = true
			existing.InstalledVersion = node.InstalledVersion
			existing.InstalledReleaseID = node.InstalledReleaseID
		}
		return
	}
	g.nodes[node.AddonID] = node
	if _, ok := g.adjacency[node.AddonID]; !ok {
		g.adjacency[node.AddonID] = []string{}
	}
}

func (g *DependencyGraph) AddEdge(edge GraphEdge) {
	if edge.FromID == "" || edge.ToID == "" {
		return
	}
	g.edges = append(g.edges, edge)
	neighbors := g.adjacency[edge.FromID]
	if !slices.Contains(neighbors, edge.ToID) {
		g.adjacency[edge.FromID] = append(g.adjacency[edge.FromID], edge.ToID)
	}
	if _, ok := g.adjacency[edge.ToID]; !ok {
		g.adjacency[edge.ToID] = []string{}
	}
}

func (g *DependencyGraph) GetNode(id string) (*GraphNode, bool) {
	n, ok := g.nodes[id]
	return n, ok
}

func (g *DependencyGraph) Neighbors(id string) []string {
	neighbors := g.adjacency[id]
	out := make([]string, len(neighbors))
	copy(out, neighbors)
	return out
}

func (g *DependencyGraph) AllNodes() []*GraphNode {
	out := make([]*GraphNode, 0, len(g.nodes))
	for _, node := range g.nodes {
		out = append(out, node)
	}
	return out
}

func (g *DependencyGraph) AllEdges() []GraphEdge {
	out := make([]GraphEdge, len(g.edges))
	copy(out, g.edges)
	return out
}

func (g *DependencyGraph) TopologicalSort() ([]string, error) {
	dependencyCount := make(map[string]int, len(g.nodes))
	reverseAdjacency := make(map[string][]string, len(g.nodes))
	for id := range g.nodes {
		dependencyCount[id] = len(g.adjacency[id])
		reverseAdjacency[id] = []string{}
	}
	for from, deps := range g.adjacency {
		for _, dep := range deps {
			reverseAdjacency[dep] = append(reverseAdjacency[dep], from)
		}
	}

	queue := make([]string, 0, len(g.nodes))
	for id, degree := range dependencyCount {
		if degree == 0 {
			queue = append(queue, id)
		}
	}

	result := make([]string, 0, len(g.nodes))
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		result = append(result, node)

		for _, dependent := range reverseAdjacency[node] {
			dependencyCount[dependent]--
			if dependencyCount[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}

	if len(result) != len(g.nodes) {
		return nil, &ResolutionError{
			Code:    ErrCycle,
			Message: "dependency cycle detected during topological sort",
		}
	}
	return result, nil
}

func (g *DependencyGraph) SubgraphFor(rootID string) *DependencyGraph {
	sub := NewDependencyGraph()
	if rootID == "" {
		return sub
	}
	if _, ok := g.nodes[rootID]; !ok {
		return sub
	}

	queue := []string{rootID}
	visited := map[string]struct{}{rootID: {}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		node := g.nodes[current]
		sub.AddNode(&GraphNode{
			AddonID:            node.AddonID,
			Version:            node.Version,
			IsInstalled:        node.IsInstalled,
			InstalledVersion:   node.InstalledVersion,
			InstalledReleaseID: node.InstalledReleaseID,
			Depth:              node.Depth,
			IsRequired:         node.IsRequired,
		})

		for _, neighbor := range g.adjacency[current] {
			edge, ok := g.findEdge(current, neighbor)
			if !ok {
				continue
			}
			sub.AddEdge(edge)
			if _, seen := visited[neighbor]; !seen {
				visited[neighbor] = struct{}{}
				queue = append(queue, neighbor)
			}
		}
	}
	return sub
}

func (g *DependencyGraph) findEdge(fromID, toID string) (GraphEdge, bool) {
	for i := range g.edges {
		if g.edges[i].FromID == fromID && g.edges[i].ToID == toID {
			return g.edges[i], true
		}
	}
	return GraphEdge{}, false
}

func edgeConstraint(g *DependencyGraph, fromID, toID string) string {
	for i := range g.edges {
		if g.edges[i].FromID == fromID && g.edges[i].ToID == toID {
			return g.edges[i].VersionConstraint
		}
	}
	return ""
}

func validateEdgeVersion(g *DependencyGraph, fromID, toID string) error {
	constraint := edgeConstraint(g, fromID, toID)
	if constraint == "" {
		return nil
	}
	dep, ok := g.GetNode(toID)
	if !ok {
		return fmt.Errorf("missing dependency node %s", toID)
	}
	okConstraint, err := VersionSatisfies(dep.Version, constraint)
	if err != nil {
		return err
	}
	if !okConstraint {
		return &ResolutionError{
			Code:    ErrVersionConflict,
			Message: fmt.Sprintf("dependency %s does not satisfy constraint %s", dep.AddonID, constraint),
			AddonID: dep.AddonID,
		}
	}
	return nil
}
