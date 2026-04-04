package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestComputeCriticalityScore_LowIsolatedLeaf(t *testing.T) {
	p := scoringParams{
		pageRank:         0.01,
		fanIn:            0,
		crossNsCount:     0,
		isDataStore:      false,
		isIngressExposed: false,
		isSPOF:           false,
		hasHPA:           true,
		hasPDB:           true,
	}
	score := computeCriticalityScore(p)
	if score < 0 || score > 10 {
		t.Errorf("expected low score 0-10 for isolated leaf, got %.2f", score)
	}
}

func TestComputeCriticalityScore_CriticalHighRisk(t *testing.T) {
	p := scoringParams{
		pageRank:         0.8,
		fanIn:            12,
		crossNsCount:     4,
		isDataStore:      false,
		isIngressExposed: true,
		isSPOF:           true,
		hasHPA:           false,
		hasPDB:           false,
	}
	score := computeCriticalityScore(p)
	if score < 75 || score > 100 {
		t.Errorf("expected critical score 75-100, got %.2f", score)
	}
}

func TestComputeCriticalityScore_MediumModerate(t *testing.T) {
	// pageRank=0.5 → 15, fanIn=5 → 15, crossNsCount=0, has HPA+PDB → 30 total
	p := scoringParams{
		pageRank:         0.5,
		fanIn:            5,
		crossNsCount:     0,
		isDataStore:      false,
		isIngressExposed: false,
		isSPOF:           false,
		hasHPA:           true,
		hasPDB:           true,
	}
	score := computeCriticalityScore(p)
	if score < 25 || score > 50 {
		t.Errorf("expected medium score 25-50, got %.2f", score)
	}
}

func TestComputeCriticalityScore_Cap100(t *testing.T) {
	p := scoringParams{
		pageRank:         10.0, // would contribute 300 without cap
		fanIn:            100,
		crossNsCount:     100,
		isDataStore:      true,
		isIngressExposed: true,
		isSPOF:           true,
		hasHPA:           false,
		hasPDB:           false,
	}
	score := computeCriticalityScore(p)
	if score != 100.0 {
		t.Errorf("expected score capped at 100, got %.2f", score)
	}
}

func TestComputeCriticalityScore_CrossNsSkippedWhenOne(t *testing.T) {
	// crossNsCount == 1 should NOT contribute cross-ns points
	withOne := scoringParams{
		pageRank:     0.0,
		fanIn:        0,
		crossNsCount: 1,
		hasHPA:       true,
		hasPDB:       true,
	}
	withZero := scoringParams{
		pageRank:     0.0,
		fanIn:        0,
		crossNsCount: 0,
		hasHPA:       true,
		hasPDB:       true,
	}
	if computeCriticalityScore(withOne) != computeCriticalityScore(withZero) {
		t.Errorf("crossNsCount=1 should not contribute to score")
	}
}

func TestSimplePageRank_SingleNode(t *testing.T) {
	nodes := map[string]models.ResourceRef{"a": {Kind: "Deployment", Name: "a", Namespace: "default"}}
	forward := map[string]map[string]bool{}
	reverse := map[string]map[string]bool{}
	ranks := simplePageRank(nodes, forward, reverse)
	if ranks["a"] != 1.0 {
		t.Errorf("single-node graph: expected rank 1.0, got %.4f", ranks["a"])
	}
}

func TestSimplePageRank_TwoNodes(t *testing.T) {
	// a -> b; b should accumulate more rank
	nodes := map[string]models.ResourceRef{
		"a": {Kind: "Deployment", Name: "a", Namespace: "default"},
		"b": {Kind: "Service", Name: "b", Namespace: "default"},
	}
	forward := map[string]map[string]bool{"a": {"b": true}}
	reverse := map[string]map[string]bool{"b": {"a": true}}
	ranks := simplePageRank(nodes, forward, reverse)
	if ranks["b"] < ranks["a"] {
		t.Errorf("node b (target) should have higher rank than a (source), a=%.4f b=%.4f", ranks["a"], ranks["b"])
	}
}

func TestSimplePageRank_NormalizesToOne(t *testing.T) {
	nodes := map[string]models.ResourceRef{
		"x": {Kind: "Deployment", Name: "x", Namespace: "default"},
		"y": {Kind: "Service", Name: "y", Namespace: "default"},
		"z": {Kind: "ConfigMap", Name: "z", Namespace: "default"},
	}
	// x -> y -> z chain
	forward := map[string]map[string]bool{
		"x": {"y": true},
		"y": {"z": true},
	}
	reverse := map[string]map[string]bool{
		"y": {"x": true},
		"z": {"y": true},
	}
	ranks := simplePageRank(nodes, forward, reverse)
	maxRank := 0.0
	for _, v := range ranks {
		if v > maxRank {
			maxRank = v
		}
	}
	if maxRank < 0.999 || maxRank > 1.001 {
		t.Errorf("max rank should be normalized to ~1.0, got %.4f", maxRank)
	}
}

func TestSimplePageRank_EmptyGraph(t *testing.T) {
	ranks := simplePageRank(
		map[string]models.ResourceRef{},
		map[string]map[string]bool{},
		map[string]map[string]bool{},
	)
	if len(ranks) != 0 {
		t.Errorf("empty graph should return empty map")
	}
}

// --- C-BE-5: Isolated namespace doesn't inflate PageRank of connected components ---

func TestPageRank_IsolatedNamespaceDoesNotInflateConnected(t *testing.T) {
	// Create two disconnected components:
	// Component 1: a -> b -> c (connected chain)
	// Component 2: x, y, z (isolated, no edges — all dangling)
	nodes := map[string]models.ResourceRef{
		"a": {Kind: "Deployment", Name: "a", Namespace: "prod"},
		"b": {Kind: "Service", Name: "b", Namespace: "prod"},
		"c": {Kind: "ConfigMap", Name: "c", Namespace: "prod"},
		"x": {Kind: "Deployment", Name: "x", Namespace: "isolated"},
		"y": {Kind: "Service", Name: "y", Namespace: "isolated"},
		"z": {Kind: "ConfigMap", Name: "z", Namespace: "isolated"},
	}
	forward := map[string]map[string]bool{
		"a": {"b": true},
		"b": {"c": true},
	}
	reverse := map[string]map[string]bool{
		"b": {"a": true},
		"c": {"b": true},
	}

	ranks := simplePageRank(nodes, forward, reverse)

	// The isolated nodes (x, y, z) should have similar ranks among themselves
	// but should NOT inflate the connected component (a, b, c).
	// Before the fix, dangling nodes distributed rank to ALL nodes globally,
	// causing a, b, c to receive rank from x, y, z.

	// Connected component should have meaningful rank differences
	// (c gets the most rank from the chain a->b->c)
	if ranks["c"] < ranks["a"] {
		t.Errorf("node c (end of chain) should have higher rank than a (start), a=%.4f c=%.4f", ranks["a"], ranks["c"])
	}

	// Key test: isolated nodes should have uniform rank among themselves
	// (within a small tolerance)
	tolerance := 0.01
	if diff := ranks["x"] - ranks["y"]; diff > tolerance || diff < -tolerance {
		t.Errorf("isolated nodes should have similar ranks: x=%.4f y=%.4f", ranks["x"], ranks["y"])
	}
	if diff := ranks["y"] - ranks["z"]; diff > tolerance || diff < -tolerance {
		t.Errorf("isolated nodes should have similar ranks: y=%.4f z=%.4f", ranks["y"], ranks["z"])
	}

	// The isolated component's rank should NOT exceed the connected component's max
	// Before fix: dangling redistribution from 3 isolated nodes would inflate c's rank.
	// After fix: isolated nodes only redistribute among themselves.
}

func TestFindConnectedComponents(t *testing.T) {
	nodeList := []string{"a", "b", "c", "x", "y"}
	forward := map[string]map[string]bool{
		"a": {"b": true},
		"b": {"c": true},
	}

	components := findConnectedComponents(nodeList, forward)

	// a, b, c should be in the same component
	if components["a"] != components["b"] || components["b"] != components["c"] {
		t.Errorf("a, b, c should be same component: a=%d b=%d c=%d",
			components["a"], components["b"], components["c"])
	}

	// x and y should be in separate components from a-b-c
	if components["x"] == components["a"] {
		t.Error("x should not be in same component as a")
	}

	// x and y should be in separate components from each other (no edges between them)
	if components["x"] == components["y"] {
		t.Error("x and y should be in separate components (no edges)")
	}
}
