package v2

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/builder"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/relationships"
)

// BenchmarkTopologyBuild_100Resources benchmarks topology build for ~100 resources.
// Target: < 500ms
func BenchmarkTopologyBuild_100Resources(b *testing.B) {
	opts := FixtureOptions{
		Namespaces: 2, Deployments: 10, PodsPerDeploy: 3,
		Services: 10, ConfigMaps: 5, Secrets: 5, Nodes: 3,
	}
	bundle := NewLargeFixture(opts)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		registry := relationships.NewDefaultRegistry()
		edges, _ := registry.MatchAll(ctx, bundle)
		nodes := builder.NodesFromBundle(bundle)
		_ = &TopologyResponse{
			Nodes: nodes,
			Edges: edges,
		}
	}
}

// BenchmarkTopologyBuild_500Resources benchmarks topology build for ~500 resources.
// Target: < 1.5s
func BenchmarkTopologyBuild_500Resources(b *testing.B) {
	opts := FixtureOptions{
		Namespaces: 5, Deployments: 50, PodsPerDeploy: 3,
		Services: 50, ConfigMaps: 20, Secrets: 20, Nodes: 10,
	}
	bundle := NewLargeFixture(opts)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		registry := relationships.NewDefaultRegistry()
		edges, _ := registry.MatchAll(ctx, bundle)
		nodes := builder.NodesFromBundle(bundle)
		_ = &TopologyResponse{
			Nodes: nodes,
			Edges: edges,
		}
	}
}

// BenchmarkTopologyBuild_1000Resources benchmarks topology build for ~1000 resources.
// Target: < 3s
func BenchmarkTopologyBuild_1000Resources(b *testing.B) {
	opts := FixtureOptions{
		Namespaces: 5, Deployments: 100, PodsPerDeploy: 3,
		Services: 100, ConfigMaps: 30, Secrets: 30, Nodes: 10,
	}
	bundle := NewLargeFixture(opts)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		registry := relationships.NewDefaultRegistry()
		edges, _ := registry.MatchAll(ctx, bundle)
		nodes := builder.NodesFromBundle(bundle)
		_ = &TopologyResponse{
			Nodes: nodes,
			Edges: edges,
		}
	}
}

// BenchmarkTopologyBuild_2000Resources benchmarks topology build for ~2000 resources.
// Target: < 5s
func BenchmarkTopologyBuild_2000Resources(b *testing.B) {
	opts := FixtureOptions{
		Namespaces: 10, Deployments: 200, PodsPerDeploy: 3,
		Services: 200, ConfigMaps: 50, Secrets: 50, Nodes: 20,
	}
	bundle := NewLargeFixture(opts)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		registry := relationships.NewDefaultRegistry()
		edges, _ := registry.MatchAll(ctx, bundle)
		nodes := builder.NodesFromBundle(bundle)
		_ = &TopologyResponse{
			Nodes: nodes,
			Edges: edges,
		}
	}
}

// BenchmarkMatchAll_StandardFixture benchmarks MatchAll on the standard test fixture.
// Target: < 100ms
func BenchmarkMatchAll_StandardFixture(b *testing.B) {
	bundle := NewTestFixtureBundle()
	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = registry.MatchAll(ctx, bundle)
	}
}

// BenchmarkViewFilter_ResourceCentric_Depth3 benchmarks resource-centric BFS filtering.
// Target: < 50ms
func BenchmarkViewFilter_ResourceCentric_Depth3(b *testing.B) {
	bundle := NewTestFixtureBundle()
	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()
	edges, _ := registry.MatchAll(ctx, bundle)
	nodes := builder.NodesFromBundle(bundle)

	response := &TopologyResponse{
		Nodes: nodes,
		Edges: edges,
	}

	filter := &ViewFilter{}
	opts := Options{
		Mode:     ViewModeResource,
		Resource: "Pod/production/payment-api-0",
		Depth:    3,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = filter.Apply(response, opts)
	}
}

// BenchmarkDeterminism verifies that two identical builds produce identical output.
func TestDeterminism(t *testing.T) {
	bundle := NewTestFixtureBundle()
	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()

	edges1, _ := registry.MatchAll(ctx, bundle)
	edges2, _ := registry.MatchAll(ctx, bundle)

	if len(edges1) != len(edges2) {
		t.Fatalf("edge count mismatch: %d vs %d", len(edges1), len(edges2))
	}

	for i := range edges1 {
		if edges1[i].ID != edges2[i].ID {
			t.Fatalf("edge %d: ID mismatch %q vs %q", i, edges1[i].ID, edges2[i].ID)
		}
	}
}
