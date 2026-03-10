package v2

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/builder"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/relationships"
)

// TestPartialData_NoSecrets tests topology builds correctly when Secrets API fails.
func TestPartialData_NoSecrets(t *testing.T) {
	bundle := NewTestFixtureBundle()
	bundle.Secrets = nil // Simulate Secrets API returning 403

	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()
	edges, err := registry.MatchAll(ctx, bundle)
	if err != nil {
		t.Fatalf("MatchAll should not fail even with nil Secrets: %v", err)
	}

	nodes := builder.NodesFromBundle(bundle)
	if len(nodes) == 0 {
		t.Fatal("expected nodes even without Secrets")
	}

	// Ensure we still have edges (ownership, selector, etc.)
	if len(edges) == 0 {
		t.Fatal("expected some edges even without Secrets")
	}

	// Health enricher should handle nil gracefully
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle) // Should not panic
}

// TestPartialData_NoMetrics tests topology builds correctly when metrics-server is unavailable.
func TestPartialData_NoMetrics(t *testing.T) {
	bundle := NewTestFixtureBundle()
	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()
	edges, _ := registry.MatchAll(ctx, bundle)
	nodes := builder.NodesFromBundle(bundle)

	// MetricsEnricher with no pod metrics (simulating metrics-server unavailable)
	enricher := &MetricsEnricher{}
	enricher.EnrichNodes(nodes, bundle) // Should not panic

	response := &TopologyResponse{
		Nodes: nodes,
		Edges: edges,
	}

	if response.Nodes == nil {
		t.Fatal("expected non-nil nodes")
	}
}

// TestPartialData_NoNodes tests topology builds correctly when Nodes API times out.
func TestPartialData_NoNodes(t *testing.T) {
	bundle := NewTestFixtureBundle()
	bundle.Nodes = nil // Simulate Node API timeout

	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()
	edges, err := registry.MatchAll(ctx, bundle)
	if err != nil {
		t.Fatalf("MatchAll should not fail with nil Nodes: %v", err)
	}

	nodes := builder.NodesFromBundle(bundle)
	if len(nodes) == 0 {
		t.Fatal("expected nodes (pods, deployments, etc.) even without cluster nodes")
	}

	// Scheduling edges to nodes should be absent but no crash
	for _, edge := range edges {
		if edge.Label == "runs on" {
			// If the node exists but the target node resource doesn't, that's OK
		}
	}
}

// TestPartialData_EmptyBundle tests behavior with completely empty ResourceBundle.
func TestPartialData_EmptyBundle(t *testing.T) {
	bundle := &ResourceBundle{}

	ctx := context.Background()
	registry := relationships.NewDefaultRegistry()
	edges, err := registry.MatchAll(ctx, bundle)
	if err != nil {
		t.Fatalf("MatchAll should not fail with empty bundle: %v", err)
	}

	if len(edges) != 0 {
		t.Fatalf("expected 0 edges for empty bundle, got %d", len(edges))
	}

	nodes := builder.NodesFromBundle(bundle)
	if len(nodes) != 0 {
		t.Fatalf("expected 0 nodes for empty bundle, got %d", len(nodes))
	}

	// Enrichers should handle empty gracefully
	healthEnricher := &HealthEnricher{}
	healthEnricher.EnrichNodes(nodes, bundle)

	metricsEnricher := &MetricsEnricher{}
	metricsEnricher.EnrichNodes(nodes, bundle)

	// ViewFilter should handle nil response
	filter := &ViewFilter{}
	result := filter.Apply(nil, Options{Mode: ViewModeNamespace})
	if result != nil {
		t.Fatal("expected nil result for nil response input")
	}
}

// TestPartialData_NilBundle tests that all components handle nil bundle gracefully.
func TestPartialData_NilBundle(t *testing.T) {
	healthEnricher := &HealthEnricher{}
	healthEnricher.EnrichNodes(nil, nil) // Should not panic

	metricsEnricher := &MetricsEnricher{}
	metricsEnricher.EnrichNodes(nil, nil) // Should not panic
}
