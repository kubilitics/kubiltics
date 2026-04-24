package types

// Package types defines public API types shared between kubilitics-ai and kubilitics-frontend.
//
// These types define the REST API contracts.

// Request types

// CreateInvestigationRequest initiates a new investigation.
type CreateInvestigationRequest struct {
	Description string `json:"description"`
	Type        string `json:"type"` // "pod_crash", "performance", "security", etc.
}

// CreateActionRequest creates an action from a recommendation.
type CreateActionRequest struct {
	RecommendationID string `json:"recommendation_id"`
	ApprovedBy       string `json:"approved_by"`
	ExecutionNotes   string `json:"execution_notes"`
}

// ApproveActionRequest approves pending action.
type ApproveActionRequest struct {
	ApprovedBy string `json:"approved_by"`
	Notes      string `json:"notes"`
}

// RejectActionRequest rejects pending action.
type RejectActionRequest struct {
	RejectedBy string `json:"rejected_by"`
	Reason     string `json:"reason"`
}

// PostChatMessageRequest sends a chat message.
type PostChatMessageRequest struct {
	Message string `json:"message"`
}

// UpdateConfigRequest updates configuration.
type UpdateConfigRequest struct {
	AutonomyLevel  int                    `json:"autonomy_level"`
	SafetyPolicies map[string]bool        `json:"safety_policies"`
	LLMSettings    map[string]interface{} `json:"llm_settings"`
}

// Response types

// Investigation represents investigation state.
type Investigation struct {
	ID          string        `json:"id"`
	Type        string        `json:"type"`
	State       string        `json:"state"`
	CreatedAt   int64         `json:"created_at"`
	StartedAt   int64         `json:"started_at"`
	ConcludedAt int64         `json:"concluded_at"`
	Description string        `json:"description"`
	Hypothesis  interface{}   `json:"hypothesis"`
	Findings    []interface{} `json:"findings"`
	Conclusion  interface{}   `json:"conclusion"`
	Confidence  int           `json:"confidence"`
	Actions     []string      `json:"actions"`
}

// Insight represents a finding or insight.
type Insight struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	Description       string   `json:"description"`
	Category          string   `json:"category"`
	ResourcesAffected []string `json:"resources_affected"`
	Severity          string   `json:"severity"`
	CreatedAt         int64    `json:"created_at"`
}

// Action represents proposed or executed action.
type Action struct {
	ID                string      `json:"id"`
	Type              string      `json:"type"`
	Status            string      `json:"status"`
	CreatedAt         int64       `json:"created_at"`
	ExecutedAt        int64       `json:"executed_at"`
	OperationType     string      `json:"operation_type"`
	ResourceID        string      `json:"resource_id"`
	ResourceKind      string      `json:"resource_kind"`
	ResourceNamespace string      `json:"resource_namespace"`
	ProposedChange    interface{} `json:"proposed_change"`
	Result            interface{} `json:"result"`
	RiskLevel         string      `json:"risk_level"`
}

// Recommendation represents action recommendation.
type Recommendation struct {
	ID             string      `json:"id"`
	Title          string      `json:"title"`
	Description    string      `json:"description"`
	Category       string      `json:"category"`
	Severity       string      `json:"severity"`
	ProposedAction interface{} `json:"proposed_action"`
	Confidence     int         `json:"confidence"`
	CreatedAt      int64       `json:"created_at"`
}

// ChatMessage represents message in chat.
type ChatMessage struct {
	ID        string `json:"id"`
	Role      string `json:"role"` // "user", "assistant"
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

// MetricsResponse contains metrics data.
type MetricsResponse struct {
	ResourceID string        `json:"resource_id"`
	MetricName string        `json:"metric_name"`
	DataPoints []interface{} `json:"data_points"`
	Summary    interface{}   `json:"summary"`
}

// AnomalyResponse contains anomaly data.
type AnomalyResponse struct {
	ID              string  `json:"id"`
	ResourceID      string  `json:"resource_id"`
	MetricName      string  `json:"metric_name"`
	DetectedValue   float64 `json:"detected_value"`
	Baseline        float64 `json:"baseline"`
	Severity        string  `json:"severity"`
	DetectionMethod string  `json:"detection_method"`
	Confidence      int     `json:"confidence"`
	DetectedAt      int64   `json:"detected_at"`
}

// ForecastResponse contains forecast data.
type ForecastResponse struct {
	ResourceID    string  `json:"resource_id"`
	MetricName    string  `json:"metric_name"`
	Horizon       string  `json:"horizon"`
	PointEstimate float64 `json:"point_estimate"`
	LowerBound    float64 `json:"lower_bound"`
	UpperBound    float64 `json:"upper_bound"`
	Confidence    int     `json:"confidence"`
}

// HealthScoreResponse contains resource health score.
type HealthScoreResponse struct {
	ResourceID      string        `json:"resource_id"`
	OverallScore    int           `json:"overall_score"`
	HealthScore     int           `json:"health_score"`
	EfficiencyScore int           `json:"efficiency_score"`
	CostScore       int           `json:"cost_score"`
	SecurityScore   int           `json:"security_score"`
	Status          string        `json:"status"` // "green", "yellow", "red"
	Issues          []interface{} `json:"issues"`
}

// ConfigResponse contains current configuration.
type ConfigResponse struct {
	AutonomyLevel  int                    `json:"autonomy_level"`
	SafetyPolicies map[string]bool        `json:"safety_policies"`
	LLMProvider    string                 `json:"llm_provider"`
	LLMSettings    map[string]interface{} `json:"llm_settings"`
}

// UsageSummaryResponse contains usage statistics.
type UsageSummaryResponse struct {
	TotalTokensUsed       int                    `json:"total_tokens_used"`
	TotalCost             float64                `json:"total_cost"`
	ByProvider            map[string]interface{} `json:"by_provider"`
	MonthlyBudget         float64                `json:"monthly_budget"`
	BudgetUsedPercent     int                    `json:"budget_used_percent"`
	ProjectedMonthlySpend float64                `json:"projected_monthly_spend"`
}

// ErrorResponse standard error response.
type ErrorResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details"`
}

// ListResponse generic paginated list response.
type ListResponse struct {
	Items      []interface{} `json:"items"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalPages int           `json:"total_pages"`
}
