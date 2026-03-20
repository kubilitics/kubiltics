package builder

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// BuildTopology builds a topology from the cluster (via client) or returns mock data if client is nil.
func BuildTopology(ctx context.Context, opts v2.Options, client *k8s.Client) (*v2.TopologyResponse, error) {
	if client == nil {
		clusterName := opts.ClusterName
		if clusterName == "" {
			clusterName = opts.ClusterID
		}
		return v2.MockTopologyResponse(opts.ClusterID, clusterName, opts.Mode), nil
	}
	bundle, err := v2.CollectFromClient(ctx, client, opts.Namespace)
	if err != nil {
		return nil, err
	}
	return BuildGraph(ctx, opts, bundle)
}
