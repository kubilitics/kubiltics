package types

import "errors"

var (
	ErrAIDisabled         = errors.New("ai: feature disabled (ai.enabled=false)")
	ErrMissingCluster     = errors.New("ai: cluster_id is required")
	ErrSidecarUnavailable = errors.New("ai: sidecar unavailable")
	ErrRateLimited        = errors.New("ai: rate limit exceeded")
	ErrSpawnChanged       = errors.New("ai: sidecar respawned during stream")
)
