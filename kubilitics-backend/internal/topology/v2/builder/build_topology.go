package builder

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// BuildTopology builds a topology from the cluster via client. Returns an error if client is nil.
func BuildTopology(ctx context.Context, opts v2.Options, client *k8s.Client) (*v2.TopologyResponse, error) {
	if client == nil {
		return nil, fmt.Errorf("cluster client is required to build topology")
	}
	bundle, err := v2.CollectFromClient(ctx, client, opts.Namespace)
	if err != nil {
		return nil, err
	}
	return BuildGraph(ctx, opts, bundle)
}
