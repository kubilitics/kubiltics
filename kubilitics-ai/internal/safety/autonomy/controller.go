package autonomy

import "context"

// Package autonomy provides autonomy level control for the AI system.
//
// Responsibilities:
//   - Manage five autonomy levels for increasing AI automation
//   - Determine approval requirements based on autonomy level and risk
//   - Translate autonomy settings to execution constraints
//   - Handle user approval workflows
//   - Coordinate with Safety Engine for risk assessment
//
// The Five Autonomy Levels:
//
//   Level 1: Observe
//      - AI can only READ cluster state
//      - All observation tools (list_resources, get_logs, etc.) available
//      - All analysis tools available (analyze_trends, simulate_impact, etc.)
//      - NO execution tools available
//      - Use case: Learning mode, read-only operations
//
//   Level 2: Recommend
//      - AI can recommend actions but NOT propose them
//      - All observation and analysis tools available
//      - Recommendation tools available (draft_recommendation, create_insight, etc.)
//      - NO execution tools available
//      - Actions require manual creation in API
//      - Use case: Advisory mode, let LLM suggest but human decides all
//
//   Level 3: Propose
//      - AI can propose actions for human approval
//      - All tools up to recommendation available
//      - Execution tools AVAILABLE but REQUIRE explicit human approval
//      - LLM must propose action → human clicks "approve" → action executes
//      - Use case: Default mode for most users
//
//   Level 4: Act-with-Guard
//      - AI auto-executes low-risk actions
//      - Human approval required for medium/high-risk actions
//      - Risk assessment by Safety Engine + Blast Radius
//      - Examples of low-risk: restart pod (has replicas), scale up (within limits)
//      - Examples of high-risk: delete resource, scale to zero, drain node
//      - Use case: Advanced users with high confidence in system
//
//   Level 5: Full-Autonomous
//      - AI auto-executes all actions if policy allows
//      - NO human approval required
//      - Still blocked by Safety Engine policies
//      - Still respects blast radius and impact limits
//      - Use case: Mature systems with comprehensive policies and monitoring
//
// Risk Assessment:
//   - Low-risk: Read-only, informational, reversible, no data loss
//   - Medium-risk: Scaling with replicas, temporary disruption possible
//   - High-risk: Data mutation, deletion, node-level changes
//
// Autonomy Level Enforcement:
//   1. Observation Tool: Available at all levels
//   2. Analysis Tool: Available at Recommend+ levels
//   3. Recommendation Tool: Available at Recommend+ levels
//   4. Execution Tool: Availability depends on autonomy level
//      - Level 1: Blocked
//      - Level 2: Blocked
//      - Level 3: Requires explicit approval
//      - Level 4: Auto-approve if low-risk, approval if high-risk
//      - Level 5: Auto-approve if policy allows
//
// Integration Points:
//   - Policy Engine: Risk assessment and approval determination
//   - Blast Radius Calculator: Calculate impact for risk assessment
//   - Audit Logger: Record approval decisions
//   - REST API: Approval endpoints for level 3-4
//   - MCP Server: Tool availability determination

// AutonomyLevel enum
type AutonomyLevel int

const (
	LevelObserve        AutonomyLevel = 1
	LevelRecommend      AutonomyLevel = 2
	LevelPropose        AutonomyLevel = 3
	LevelActWithGuard   AutonomyLevel = 4
	LevelFullAutonomous AutonomyLevel = 5
)

// AutonomyController defines the interface for autonomy management.
type AutonomyController interface {
	// SetAutonomyLevel sets the autonomy level for a user.
	SetAutonomyLevel(ctx context.Context, userID string, level AutonomyLevel) error

	// GetAutonomyLevel returns current autonomy level for user.
	GetAutonomyLevel(ctx context.Context, userID string) (AutonomyLevel, error)

	// DetermineApprovalRequired determines if action requires approval.
	// Returns: requires_approval (bool), reason
	DetermineApprovalRequired(ctx context.Context, userID string, action interface{}) (bool, string, error)

	// ApproveAction records user approval for an action.
	ApproveAction(ctx context.Context, userID string, actionID string) error

	// RejectAction records user rejection for an action.
	RejectAction(ctx context.Context, userID string, actionID string) error

	// CanExecuteTool checks if tool is available at current autonomy level.
	CanExecuteTool(ctx context.Context, userID string, toolName string) (bool, error)

	// AssessRisk evaluates risk level of proposed action.
	// Returns: risk_level (low/medium/high), risk_factors
	AssessRisk(ctx context.Context, action interface{}) (string, []string, error)

	// GetApprovalPending returns pending approvals for user.
	GetApprovalPending(ctx context.Context, userID string) ([]interface{}, error)

	// GetAutonomyDescription returns human-readable description of autonomy level.
	GetAutonomyDescription(ctx context.Context, level AutonomyLevel) (string, error)
}

// NewAutonomyController creates a new autonomy controller.
// The concrete implementation is in controller_impl.go.
