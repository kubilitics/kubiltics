package resolver

import "testing"

func TestDetectCycle(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "a"})
	g.AddNode(&GraphNode{AddonID: "b"})
	g.AddNode(&GraphNode{AddonID: "c"})
	g.AddEdge(GraphEdge{FromID: "a", ToID: "b"})
	g.AddEdge(GraphEdge{FromID: "b", ToID: "c"})
	g.AddEdge(GraphEdge{FromID: "c", ToID: "a"})

	hasCycle, path := DetectCycle(g)
	if !hasCycle {
		t.Fatalf("expected cycle")
	}
	if len(path) < 2 {
		t.Fatalf("expected non-empty cycle path, got %v", path)
	}
}

func TestDetectCycleNone(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "a"})
	g.AddNode(&GraphNode{AddonID: "b"})
	g.AddEdge(GraphEdge{FromID: "a", ToID: "b"})

	hasCycle, path := DetectCycle(g)
	if hasCycle {
		t.Fatalf("did not expect cycle, got %v", path)
	}
}
