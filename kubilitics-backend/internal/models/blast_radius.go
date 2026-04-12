package models

// BlastRadiusResult is the complete blast-radius analysis response for a target resource.
type BlastRadiusResult struct {
	// Target
	TargetResource ResourceRef `json:"targetResource"`
	FailureMode    string      `json:"failureMode"`

	// Core metrics
	BlastRadiusPercent float64 `json:"blastRadiusPercent"`
	CriticalityScore   float64 `json:"criticalityScore"`
	CriticalityLevel   string  `json:"criticalityLevel"`

	// Sub-scores
	SubScores SubScores `json:"subScores"`

	// Impact classification
	ImpactSummary     ImpactSummary    `json:"impactSummary"`
	AffectedServices  []ServiceImpact  `json:"affectedServices"`
	AffectedIngresses []IngressImpact  `json:"affectedIngresses,omitempty"`
	AffectedConsumers []ConsumerImpact `json:"affectedConsumers,omitempty"`

	// Explainability
	ScoreBreakdown ScoreBreakdown `json:"scoreBreakdown"`
	Verdict        string         `json:"verdict"`
	AuditTrail     *AuditTrail    `json:"auditTrail,omitempty"`

	// Coverage
	CoverageLevel string `json:"coverageLevel"`
	CoverageNote  string `json:"coverageNote,omitempty"`

	// Confidence
	ConfidenceScore int    `json:"confidenceScore"` // 0-100: how much to trust this result
	ConfidenceNote  string `json:"confidenceNote"`  // human-readable explanation

	// Resource characteristics
	ReplicaCount     int           `json:"replicaCount"`
	IsSPOF           bool          `json:"isSPOF"`
	HasHPA           bool          `json:"hasHPA"`
	HasPDB           bool          `json:"hasPDB"`
	IsIngressExposed bool          `json:"isIngressExposed"`
	IngressHosts     []string      `json:"ingressHosts"`
	Remediations     []Remediation `json:"remediations"`

	// Backward compat fields for topology rendering
	FanIn              int  `json:"fanIn"`
	FanOut             int  `json:"fanOut"`
	TotalAffected      int  `json:"totalAffected"`
	AffectedNamespaces int  `json:"affectedNamespaces"`

	Waves           []BlastWave           `json:"waves"`
	DependencyChain []BlastDependencyEdge `json:"dependencyChain"`
	RiskIndicators  []RiskIndicator       `json:"riskIndicators"`

	// Graph metadata
	GraphNodeCount   int   `json:"graphNodeCount"`
	GraphEdgeCount   int   `json:"graphEdgeCount"`
	GraphStalenessMs int64 `json:"graphStalenessMs"`
}

// Remediation is a suggested action to reduce the blast radius of a resource.
type Remediation struct {
	Type        string `json:"type"`        // "add-pdb", "increase-replicas", "add-hpa", etc.
	Description string `json:"description"` // Human-readable
	Priority    string `json:"priority"`    // "critical", "high", "medium", "low"
	Impact      string `json:"impact"`      // "Reduces blast radius score by ~X points"
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

// SubScores holds the four transparent sub-scores for the composite criticality model.
type SubScores struct {
	Resilience SubScoreDetail `json:"resilience"`
	Exposure   SubScoreDetail `json:"exposure"`
	Recovery   SubScoreDetail `json:"recovery"`
	Impact     SubScoreDetail `json:"impact"`
}

// SubScoreDetail holds a single sub-score with its contributing factors.
type SubScoreDetail struct {
	Score      int             `json:"score"`
	Factors    []ScoringFactor `json:"factors"`
	Source     string          `json:"source,omitempty"`
	Confidence string          `json:"confidence,omitempty"`
}

// ScoringFactor is one contributing factor to a sub-score.
type ScoringFactor struct {
	Name   string  `json:"name"`
	Value  string  `json:"value"`
	Effect float64 `json:"effect"`
	Note   string  `json:"note"`
}

// ScoreBreakdown is the full explainability structure for the criticality score.
type ScoreBreakdown struct {
	Resilience SubScoreDetail `json:"resilience"`
	Exposure   SubScoreDetail `json:"exposure"`
	Recovery   SubScoreDetail `json:"recovery"`
	Impact     SubScoreDetail `json:"impact"`
	Overall    float64        `json:"overall"`
	Level      string         `json:"level"`
}

// ImpactSummary summarizes the classification results across the cluster.
type ImpactSummary struct {
	BrokenCount      int      `json:"brokenCount"`
	DegradedCount    int      `json:"degradedCount"`
	SelfHealingCount int      `json:"selfHealingCount"`
	TotalWorkloads   int      `json:"totalWorkloads"`
	CapacityNotes    []string `json:"capacityNotes"`
}

// ServiceImpact is the impact classification for a single Service.
type ServiceImpact struct {
	Service            ResourceRef `json:"service"`
	Classification     string      `json:"classification"`
	TotalEndpoints     int         `json:"totalEndpoints"`
	RemainingEndpoints int         `json:"remainingEndpoints"`
	Threshold          float64     `json:"threshold"`
	ThresholdSource    string      `json:"thresholdSource"`
	Note               string      `json:"note"`
}

// IngressImpact is the impact classification for a single Ingress.
type IngressImpact struct {
	Ingress        ResourceRef `json:"ingress"`
	Classification string      `json:"classification"`
	Host           string      `json:"host"`
	BackendService string      `json:"backendService"`
	Note           string      `json:"note"`
}

// ConsumerImpact is the impact classification for a consumer workload identified via OTel traces.
type ConsumerImpact struct {
	Workload       ResourceRef `json:"workload"`
	Classification string      `json:"classification"`
	DependsOn      string      `json:"dependsOn"`
	Note           string      `json:"note"`
}

// AuditTrail is the full calculation trace returned when ?audit=true is set.
type AuditTrail struct {
	Timestamp            string               `json:"timestamp"`
	TargetResource       ResourceRef          `json:"targetResource"`
	FailureMode          string               `json:"failureMode"`
	GraphStalenessMs     int64                `json:"graphStalenessMs"`
	TraceDataAgeMs       *int64               `json:"traceDataAgeMs,omitempty"`
	LostPods             []ResourceRef        `json:"lostPods"`
	ServiceImpacts       []ServiceImpactAudit `json:"serviceImpacts"`
	IngressImpacts       []IngressImpact      `json:"ingressImpacts"`
	ConsumerImpacts      []ConsumerImpact     `json:"consumerImpacts,omitempty"`
	ScoreBreakdown       ScoreBreakdown       `json:"scoreBreakdown"`
	ClusterWorkloadCount int                  `json:"clusterWorkloadCount"`
	CoverageLevel        string               `json:"coverageLevel"`
}

// ServiceImpactAudit is the detailed audit entry for a single Service's impact computation.
type ServiceImpactAudit struct {
	Service         string  `json:"service"`
	TotalEndpoints  int     `json:"totalEndpoints"`
	LostEndpoints   int     `json:"lostEndpoints"`
	RemainingPct    float64 `json:"remainingPercent"`
	Threshold       float64 `json:"threshold"`
	ThresholdSource string  `json:"thresholdSource"`
	Classification  string  `json:"classification"`
}
