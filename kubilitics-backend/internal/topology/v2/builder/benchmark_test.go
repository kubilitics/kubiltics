package builder

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

func BenchmarkBuildGraph_WithFixture(b *testing.B) {
	bundle := v2.NewTestFixtureBundle()
	opts := v2.Options{ClusterID: "bench", ClusterName: "bench-cluster", Mode: v2.ViewModeNamespace}
	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = BuildGraph(ctx, opts, bundle)
	}
}
