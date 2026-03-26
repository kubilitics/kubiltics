package builder

import (
	"context"
	"fmt"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/relationships"
)

// TestNamespaceEdgesInResourceBFS verifies that Deployment→Namespace and
// StatefulSet→Namespace containment edges survive the BFS filtering in
// GetResourceTopology when starting from a Pod.
func TestNamespaceEdgesInResourceBFS(t *testing.T) {
	bundle := v2.NewTestFixtureBundle()
	reg := relationships.NewDefaultRegistry()
	ctx := context.Background()
	edges, err := reg.MatchAll(ctx, bundle)
	if err != nil {
		t.Fatalf("MatchAll: %v", err)
	}

	// Verify namespace edges were generated
	nsEdges := map[string]bool{}
	for _, e := range edges {
		if e.RelationshipType == "namespace" {
			nsEdges[e.Source+"|"+e.Target] = true
		}
	}
	t.Logf("Total namespace edges: %d", len(nsEdges))

	// Must have Deployment→Namespace edges
	if !nsEdges["Deployment/default/app-a|Namespace/default"] {
		t.Error("missing namespace edge: Deployment/default/app-a → Namespace/default")
	}

	// Simulate BFS from Pod/default/app-a-rs-pod-0 with hops=2
	// This mirrors the logic in handler.go GetResourceTopology
	targetID := "Pod/default/app-a-rs-pod-0"
	hops := 2
	ri := BuildReverseIndex(edges)

	connected := make(map[string]bool)
	connected[targetID] = true
	frontier := []string{targetID}
	for hop := 0; hop < hops; hop++ {
		var nextFrontier []string
		for _, id := range frontier {
			for _, dep := range ri.GetDependencies(id) {
				if !connected[dep] {
					connected[dep] = true
					nextFrontier = append(nextFrontier, dep)
				}
			}
			for _, dep := range ri.GetDependents(id) {
				if !connected[dep] {
					connected[dep] = true
					nextFrontier = append(nextFrontier, dep)
				}
			}
		}
		t.Logf("Hop %d: %d new nodes", hop+1, len(nextFrontier))
		for _, id := range nextFrontier {
			t.Logf("  + %s", id)
		}
		frontier = nextFrontier
	}

	// Key assertions: both Deployment and Namespace must be in connected set
	if !connected["Namespace/default"] {
		t.Error("Namespace/default NOT in connected set after BFS")
	}
	if !connected["Deployment/default/app-a"] {
		t.Error("Deployment/default/app-a NOT in connected set after BFS")
	}

	// The Deployment→Namespace edge must survive the edge filter
	foundDeployNS := false
	for _, e := range edges {
		if e.RelationshipType == "namespace" &&
			e.Source == "Deployment/default/app-a" &&
			e.Target == "Namespace/default" &&
			connected[e.Source] && connected[e.Target] {
			foundDeployNS = true
		}
	}
	if !foundDeployNS {
		t.Error("Deployment/default/app-a → Namespace/default edge NOT in filtered output")
		// Debug: show which namespace edges have both endpoints in connected
		for _, e := range edges {
			if e.RelationshipType == "namespace" {
				t.Logf("  ns edge: %s → %s (srcConn=%v, tgtConn=%v)",
					e.Source, e.Target, connected[e.Source], connected[e.Target])
			}
		}
	}

	// Also test hops=1 from Deployment (the other common entry point)
	t.Run("from_deployment_hops1", func(t *testing.T) {
		depID := "Deployment/default/app-a"
		connected2 := make(map[string]bool)
		connected2[depID] = true
		frontier2 := []string{depID}
		for hop := 0; hop < 1; hop++ {
			var next []string
			for _, id := range frontier2 {
				for _, dep := range ri.GetDependencies(id) {
					if !connected2[dep] {
						connected2[dep] = true
						next = append(next, dep)
					}
				}
				for _, dep := range ri.GetDependents(id) {
					if !connected2[dep] {
						connected2[dep] = true
						next = append(next, dep)
					}
				}
			}
			t.Logf("Hop %d from Deployment: %d new nodes", hop+1, len(next))
			for _, id := range next {
				t.Logf("  + %s", id)
			}
			frontier2 = next
		}

		if !connected2["Namespace/default"] {
			t.Error("Namespace/default NOT reachable in 1 hop from Deployment")
		}

		// Count namespace edges in filtered output
		nsCount := 0
		for _, e := range edges {
			if e.RelationshipType == "namespace" && connected2[e.Source] && connected2[e.Target] {
				nsCount++
				t.Logf("  included ns edge: %s → %s", e.Source, e.Target)
			}
		}
		if nsCount == 0 {
			t.Error("no namespace edges in filtered output from Deployment")
		}
		// The Deployment→Namespace edge specifically must be present
		found := false
		for _, e := range edges {
			if e.Source == depID && e.Target == "Namespace/default" && e.RelationshipType == "namespace" {
				if connected2[e.Source] && connected2[e.Target] {
					found = true
				} else {
					t.Logf("  edge exists but filtered: src=%v tgt=%v", connected2[e.Source], connected2[e.Target])
				}
			}
		}
		if !found {
			t.Error("Deployment/default/app-a → Namespace/default edge NOT in filtered output (hops=1 from Deployment)")
		}

		// Log total edges to verify
		totalFiltered := 0
		for _, e := range edges {
			if connected2[e.Source] && connected2[e.Target] {
				totalFiltered++
			}
		}
		t.Logf("Total filtered edges (hops=1 from Deployment): %d", totalFiltered)
		_ = fmt.Sprintf("") // avoid unused import
	})
}
