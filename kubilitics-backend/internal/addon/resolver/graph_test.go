package resolver

import "testing"

func TestDependencyGraphTopologicalSortDependenciesFirst(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "root"})
	g.AddNode(&GraphNode{AddonID: "dep-a"})
	g.AddNode(&GraphNode{AddonID: "dep-b"})
	g.AddEdge(GraphEdge{FromID: "root", ToID: "dep-a"})
	g.AddEdge(GraphEdge{FromID: "dep-a", ToID: "dep-b"})

	ordered, err := g.TopologicalSort()
	if err != nil {
		t.Fatalf("topological sort failed: %v", err)
	}
	if len(ordered) != 3 {
		t.Fatalf("unexpected sorted size: %d", len(ordered))
	}
	index := make(map[string]int, len(ordered))
	for i := range ordered {
		index[ordered[i]] = i
	}
	if !(index["dep-b"] < index["dep-a"] && index["dep-a"] < index["root"]) {
		t.Fatalf("expected dependency-first order, got %v", ordered)
	}
}

func TestDependencyGraphSubgraphFor(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "a"})
	g.AddNode(&GraphNode{AddonID: "b"})
	g.AddNode(&GraphNode{AddonID: "c"})
	g.AddNode(&GraphNode{AddonID: "d"})
	g.AddEdge(GraphEdge{FromID: "a", ToID: "b"})
	g.AddEdge(GraphEdge{FromID: "b", ToID: "c"})

	sub := g.SubgraphFor("a")
	if _, ok := sub.GetNode("a"); !ok {
		t.Fatalf("expected node a in subgraph")
	}
	if _, ok := sub.GetNode("b"); !ok {
		t.Fatalf("expected node b in subgraph")
	}
	if _, ok := sub.GetNode("c"); !ok {
		t.Fatalf("expected node c in subgraph")
	}
	if _, ok := sub.GetNode("d"); ok {
		t.Fatalf("did not expect node d in subgraph")
	}
}
