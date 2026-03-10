package v2

import "context"

// GraphBuilder is responsible for orchestrating collection, relationship matching,
// enrichment, view filtering and assembly of the final TopologyResponse.
type GraphBuilder interface {
	BuildGraph(ctx context.Context, opts Options) (*TopologyResponse, error)
}

