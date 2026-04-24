package models

// Package models defines core data types used throughout kubilitics-ai.
//
// These types are used internally for investigations, insights, actions,
// recommendations, and audit trails.

// Investigation represents a single investigation session.
type Investigation struct {
	ID             string
	Type           string
	State          string
	CreatedAt      interface{}
	StartedAt      interface{}
	ConcludedAt    interface{}
	UserID         string
	Description    string
	Context        string
	Hypothesis     interface{}
	ToolCalls      []ToolCall
	Findings       []Finding
	Conclusion     interface{}
	Confidence     int
	Actions        []string
	TimeoutSeconds int
	CorrelationID  string
}

// Insight represents a finding or insight from investigation.
type Insight struct {
	ID                string
	Title             string
	Description       string
	Category          string
	ResourcesAffected []string
	Evidence          interface{}
	Severity          string
	CreatedAt         interface{}
	InvestigationID   string
}

// Action represents a proposed or executed action.
type Action struct {
	ID                string
	Type              string
	Status            string
	CreatedAt         interface{}
	ExecutedAt        interface{}
	OperationType     string // "patch", "scale", "delete", "apply", etc.
	ResourceID        string
	ResourceKind      string
	ResourceNamespace string
	ProposedChange    interface{}
	Result            interface{}
	ApprovedBy        string
	ApprovalTime      interface{}
	InvestigationID   string
	RiskLevel         string
	BlastRadius       interface{}
}

// Recommendation represents an action recommendation.
type Recommendation struct {
	ID              string
	Title           string
	Description     string
	Category        string
	Severity        string
	ProposedAction  interface{}
	Reasoning       string
	Evidence        interface{}
	Confidence      int
	InvestigationID string
	CreatedAt       interface{}
}

// ToolCall represents a single tool invocation by LLM.
type ToolCall struct {
	ID        string
	ToolName  string
	Input     interface{}
	Output    interface{}
	Duration  int
	Success   bool
	Error     string
	Timestamp interface{}
}

// Finding represents a finding discovered during investigation.
type Finding struct {
	ID         string
	Statement  string
	Evidence   interface{}
	Confidence int
	Tools      []string // tools that provided evidence
	Timestamp  interface{}
}

// AnalyticsData represents computed analytics.
type AnalyticsData struct {
	ID         string
	Type       string // "trend", "anomaly", "forecast", "score"
	ResourceID string
	MetricName string
	Value      float64
	Timestamp  interface{}
	Metadata   interface{}
}

// AuditEntry represents an action in the immutable audit log.
type AuditEntry struct {
	ID            string
	Timestamp     interface{}
	UserID        string
	Action        string
	ResourceID    string
	ResourceKind  string
	Details       interface{}
	Result        string
	ErrorMessage  string
	CorrelationID string
}

// PolicyViolation represents a policy rule violation.
type PolicyViolation struct {
	PolicyName string
	Severity   string
	Reason     string
	Evidence   interface{}
}

// ScoringResult represents a resource health/efficiency score.
type ScoringResult struct {
	ResourceID      string
	HealthScore     int
	EfficiencyScore int
	CostScore       int
	SecurityScore   int
	OverallScore    int
	ComputedAt      interface{}
	Details         interface{}
}

// StateSnapshot represents a point-in-time snapshot of cluster state.
type StateSnapshot struct {
	Timestamp interface{}
	Resources []interface{}
	Events    []interface{}
	Metrics   interface{}
	Metadata  interface{}
}

// ContextData represents the built context for an investigation.
type ContextData struct {
	TargetResources   []interface{}
	RelatedResources  []interface{}
	RecentEvents      []interface{}
	Metrics           interface{}
	Logs              string
	HistoricalContext interface{}
	ClusterContext    interface{}
	TokenCount        int
}
