package v2

// TopologyResponse is the root API response type for v2 topology.
// It mirrors the TopologyResponse TypeScript interface in the PRD.
type TopologyResponse struct {
	Metadata TopologyMetadata `json:"metadata"`
	Nodes    []TopologyNode   `json:"nodes"`
	Edges    []TopologyEdge   `json:"edges"`
	Groups   []TopologyGroup  `json:"groups"`
}

// TopologyMetadata captures high-level information about a topology build.
type TopologyMetadata struct {
	ClusterID     string  `json:"clusterId"`
	ClusterName   string  `json:"clusterName"`
	Mode          ViewMode `json:"mode"`
	Namespace     string  `json:"namespace,omitempty"`
	FocusResource string  `json:"focusResource,omitempty"`
	ResourceCount int     `json:"resourceCount"`
	EdgeCount     int     `json:"edgeCount"`
	BuildTimeMs   int64   `json:"buildTimeMs"`
	CachedAt      string  `json:"cachedAt,omitempty"`

	// Progressive disclosure fields
	Depth      int      `json:"depth"`                // current depth level (0-3)
	TotalNodes int      `json:"totalNodes"`            // total nodes before depth filtering
	Expandable []string `json:"expandable,omitempty"`  // node IDs that have hidden children
}

