package builder

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

func TestBuildGraph_WithFixture(t *testing.T) {
	bundle := v2.NewTestFixtureBundle()
	opts := v2.Options{ClusterID: "test", ClusterName: "test-cluster", Mode: v2.ViewModeNamespace}
	resp, err := BuildGraph(context.Background(), opts, bundle)
	if err != nil {
		t.Fatalf("BuildGraph: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if len(resp.Nodes) < 20 {
		t.Errorf("expected at least 20 nodes, got %d", len(resp.Nodes))
	}
	if len(resp.Edges) < 30 {
		t.Errorf("expected at least 30 edges, got %d", len(resp.Edges))
	}
	if resp.Metadata.ClusterID != "test" || resp.Metadata.ClusterName != "test-cluster" {
		t.Errorf("metadata: got clusterId=%q clusterName=%q", resp.Metadata.ClusterID, resp.Metadata.ClusterName)
	}
}
