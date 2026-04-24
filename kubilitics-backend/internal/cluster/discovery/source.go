// Package discovery defines the pluggable cluster-discovery layer.
// Every implementation (kubeconfig file, in-cluster Secret, manual
// registration) satisfies DiscoverySource; DiscoveryManager composes
// them into a single deduplicated view. See
// docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §3.2.
package discovery

import (
	"context"
	"errors"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// ErrNotSupported may be returned from Watch() by sources that only
// support Enumerate() (polling).
var ErrNotSupported = errors.New("operation not supported by this source")

// DiscoveredCluster is the minimum identity a source produces.
type DiscoveredCluster struct {
	Identity identity.LogicalIdentity `json:"identity"`
	Source   string                   `json:"source"`
	// ContextName is the kubeconfig context name if applicable.
	ContextName string `json:"context_name,omitempty"`
	// KubeconfigPath is the on-disk path that produced this entry, if any.
	KubeconfigPath string `json:"kubeconfig_path,omitempty"`
	// SessionID is the backend-issued UUID for clusters that have been
	// registered (ManualSource populates it; file/secret sources leave it
	// empty). Promoted to presence.RegisteredCluster by the Manager.
	SessionID string `json:"session_id,omitempty"`
	// Provider is the cloud/local provider classification when known.
	Provider string `json:"provider,omitempty"`
}

// EventKind describes a discovery event's type.
type EventKind string

const (
	EventAdd    EventKind = "add"
	EventUpdate EventKind = "update"
	EventRemove EventKind = "remove"
)

// DiscoveryEvent is streamed from Watch() as the world changes.
type DiscoveryEvent struct {
	Kind    EventKind         `json:"kind"`
	Cluster DiscoveredCluster `json:"cluster"`
}

// DiscoverySource is implemented by every pluggable source.
type DiscoverySource interface {
	Name() string
	Enumerate(ctx context.Context) ([]DiscoveredCluster, error)
	Watch(ctx context.Context) (<-chan DiscoveryEvent, error)
}
