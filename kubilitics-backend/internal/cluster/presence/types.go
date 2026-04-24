// Package presence defines the shared wire types for the presence layer.
// These types are consumed by both the REST handler (internal/api/rest) and
// the discovery Manager (internal/cluster/discovery); placing them in a
// neutral package breaks the cycle that would otherwise form between
// those two packages.
package presence

import (
	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// DiscoveredCluster is the smallest identity record — known to exist,
// not yet touched. Source indicates which DiscoverySource produced it.
type DiscoveredCluster struct {
	Identity identity.LogicalIdentity `json:"identity"`
	Source   string                   `json:"source"` // kubeconfig | secret | manual
	// LastSeenAt records when this cluster was last observed by its source.
	LastSeenAt string `json:"last_seen_at,omitempty"`
}

// RegisteredCluster adds backend-side registration details — the backend
// has parsed/stored enough to connect on demand.
type RegisteredCluster struct {
	DiscoveredCluster
	// RegisteredAt is the ISO-8601 timestamp of first registration.
	RegisteredAt string `json:"registered_at"`
	// Reachable is the last known reachability status (from preflight or
	// any cached envelope). Frontend treats this as a hint, not truth.
	Reachable bool `json:"reachable"`
}

// ConnectedCluster is registered + has an active backend session.
type ConnectedCluster struct {
	RegisteredCluster
	// ConnectedAt is when the current session began.
	ConnectedAt string `json:"connected_at"`
}

// Snapshot is the whole-world view at one instant.
type Snapshot struct {
	Discovered []DiscoveredCluster `json:"discovered"`
	Registered []RegisteredCluster `json:"registered"`
	Connected  []ConnectedCluster  `json:"connected"`
	// LastUsed is the logical identity of the most-recently-active cluster.
	LastUsed *identity.LogicalIdentity `json:"last_used,omitempty"`
}
