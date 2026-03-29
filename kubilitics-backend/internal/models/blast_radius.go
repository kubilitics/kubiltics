package models

// BlastRadiusResult contains the full cluster-wide blast radius analysis for a single resource.
type BlastRadiusResult struct {
	TargetResource     ResourceRef           `json:"target_resource"`
	CriticalityScore   float64               `json:"criticality_score"`    // 0-100
	CriticalityLevel   string                `json:"criticality_level"`    // low / medium / high / critical
	BlastRadiusPercent float64               `json:"blast_radius_percent"` // % of cluster workloads affected

	FanIn              int                   `json:"fan_in"`               // direct dependents
	FanOut             int                   `json:"fan_out"`              // direct dependencies
	TotalAffected      int                   `json:"total_affected"`       // transitive impact count
	AffectedNamespaces int                   `json:"affected_namespaces"`  // cross-namespace reach

	IsSPOF             bool                  `json:"is_spof"`
	HasHPA             bool                  `json:"has_hpa"`
	HasPDB             bool                  `json:"has_pdb"`
	IsIngressExposed   bool                  `json:"is_ingress_exposed"`
	IngressHosts       []string              `json:"ingress_hosts,omitempty"`
	ReplicaCount       int                   `json:"replica_count"`

	Waves              []BlastWave           `json:"waves"`
	DependencyChain    []BlastDependencyEdge `json:"dependency_chain"`
	RiskIndicators     []RiskIndicator       `json:"risk_indicators"`

	GraphNodeCount     int                   `json:"graph_node_count"`
	GraphEdgeCount     int                   `json:"graph_edge_count"`
	GraphStalenessMs   int64                 `json:"graph_staleness_ms"`
}

// BlastWave groups affected resources by their BFS depth from the target.
type BlastWave struct {
	Depth     int                `json:"depth"`
	Resources []AffectedResource `json:"resources"`
}

// AffectedResource is a resource impacted by the target's failure.
type AffectedResource struct {
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	Namespace   string    `json:"namespace"`
	Impact      string    `json:"impact"`    // "direct" | "transitive"
	WaveDepth   int       `json:"wave_depth"`
	FailurePath []PathHop `json:"failure_path"`
}

// PathHop is one hop in the failure propagation chain.
type PathHop struct {
	From     ResourceRef `json:"from"`
	To       ResourceRef `json:"to"`
	EdgeType string      `json:"edge_type"`
	Detail   string      `json:"detail"`
}

// RiskIndicator is a human-readable risk flag for a resource.
type RiskIndicator struct {
	Severity string `json:"severity"` // critical, warning, info
	Title    string `json:"title"`
	Detail   string `json:"detail"`
}

// ResourceRef identifies a Kubernetes resource by kind, name, and namespace.
type ResourceRef struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// BlastDependencyEdge represents a directed dependency between two resources.
type BlastDependencyEdge struct {
	Source ResourceRef `json:"source"`
	Target ResourceRef `json:"target"`
	Type   string      `json:"type"`
	Detail string      `json:"detail,omitempty"`
}

// GraphStatus reports the health of the cluster-wide dependency graph.
type GraphStatus struct {
	Ready          bool   `json:"ready"`
	NodeCount      int    `json:"node_count"`
	EdgeCount      int    `json:"edge_count"`
	NamespaceCount int    `json:"namespace_count"`
	LastRebuildMs  int64  `json:"last_rebuild_ms"`
	StalenessMs    int64  `json:"staleness_ms"`
	RebuildCount   int64  `json:"rebuild_count"`
	Error          string `json:"error,omitempty"`
}

// BlastRadiusSummaryEntry is one resource in the cluster-wide criticality summary.
type BlastRadiusSummaryEntry struct {
	Resource           ResourceRef `json:"resource"`
	CriticalityScore   float64     `json:"criticality_score"`
	CriticalityLevel   string      `json:"criticality_level"`
	BlastRadiusPercent float64     `json:"blast_radius_percent"`
	FanIn              int         `json:"fan_in"`
	IsSPOF             bool        `json:"is_spof"`
	AffectedNamespaces int         `json:"affected_namespaces"`
}
