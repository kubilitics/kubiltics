package recommendation

import "context"

// Package recommendation provides Tier 3 recommendation tools for the LLM.
//
// Tier 3: Recommendation Tools (Generate Recommendations and Insights)
//
// Responsibilities:
//   - Generate actionable recommendations for cluster improvements
//   - Create structured insights from investigations
//   - Generate detailed reports with findings and recommendations
//   - Format recommendations for different autonomy levels
//   - Attach reasoning chains and evidence to recommendations
//   - Calculate confidence scores for recommendations
//
// Tools Provided:
//
//   1. draft_recommendation
//      - Args: investigation_id, issue_description, severity, proposed_action, blast_radius, risk_level
//      - Returns: Structured recommendation with reasoning, evidence, risk assessment
//      - Use: Convert analysis into actionable recommendation
//
//   2. create_insight
//      - Args: title, description, category (performance/security/cost/reliability), resources_affected, evidence
//      - Returns: Persisted insight ID, formatted insight
//      - Use: Record findings for later reference
//
//   3. generate_report
//      - Args: investigation_id, insights, recommendations, time_period
//      - Returns: Formatted report (markdown/JSON), executive summary, detailed findings
//      - Use: Create documentation of investigations and recommendations
//
// Integration Points:
//   - Reasoning Engine: Coordinates recommendation creation
//   - Backend Proxy: Fetch context for recommendations
//   - Safety Engine: Assess risk of recommendations
//   - Audit Logger: Record all recommendations
//   - Prompt Manager: Format recommendations according to templates
//
// Performance Considerations:
//   - Report generation uses cached analysis results
//   - Recommendations are validated before persistence
//   - Insight storage is append-only for auditability

// RecommendationTool defines the interface for recommendation tools.
type RecommendationTool interface {
	// DraftRecommendation creates a new recommendation from investigation findings.
	DraftRecommendation(ctx context.Context, investigationID string, issueDescription string, severity string, proposedAction interface{}, blastRadius interface{}, riskLevel string) (interface{}, error)

	// CreateInsight persists a new insight from investigation analysis.
	CreateInsight(ctx context.Context, title string, description string, category string, resourcesAffected []string, evidence interface{}) (string, error)

	// GenerateReport creates a comprehensive report of an investigation.
	GenerateReport(ctx context.Context, investigationID string, insights []string, recommendations []string, timePeriod string) (interface{}, error)
}

// NewRecommendationTool creates a new recommendation tool with dependencies.
func NewRecommendationTool() RecommendationTool {
	// Inject Reasoning Engine, Backend Proxy, Safety Engine, Audit Logger, Prompt Manager
	return nil
}
