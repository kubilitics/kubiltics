package investigation

import "context"

// Package investigation provides investigation session state management.
//
// Responsibilities:
//   - Manage the complete lifecycle of a single investigation
//   - Maintain investigation state machine (Created → Investigating → Concluded → Archived)
//   - Track hypothesis generation and evolution
//   - Record tool calls and results
//   - Accumulate findings with evidence and confidence scores
//   - Manage investigation timeout and cancellation
//   - Calculate final confidence in conclusions
//   - Persist investigation state for audit trail
//
// Investigation State Machine:
//
//   Created
//     ↓ (Reasoning Engine starts investigation)
//   Investigating
//     ↓ (Gathering context, generating hypotheses, calling tools)
//     ↓ (Multiple tool calls as LLM explores hypotheses)
//     ↓ (Validating findings and drawing conclusions)
//   Concluded
//     ↓ (Investigation complete, action proposed or archived)
//   Archived (if no action taken)
//     ↓ (Retained for historical reference)
//
// Investigation State Transitions:
//   - Created → Investigating: Automatic when Reasoning Engine starts
//   - Investigating → Concluded: When LLM generates final conclusion
//   - Investigating → Cancelled: If user cancels or timeout reached
//   - Concluded → Archived: After N days of no activity
//
// Investigation Fields:
//   - ID: Unique identifier (UUID)
//   - Type: Type of investigation (pod-crash, performance, security, cost, etc.)
//   - State: Current state in state machine
//   - CreatedAt: Timestamp when investigation started
//   - StartedAt: Timestamp when investigation began (may differ from created)
//   - ConcludedAt: Timestamp when investigation finished
//   - UserID: User who triggered investigation
//   - Description: Initial problem description
//   - Context: Built cluster context used
//   - Hypothesis: Current/final hypothesis
//   - ToolCalls: List of all tool calls made during investigation
//   - Findings: List of findings with evidence and confidence
//   - Conclusion: Final conclusion and root cause
//   - Confidence: Overall confidence in conclusion (0-100%)
//   - Actions: Proposed or executed actions
//   - Status: Current status code
//
// Integration Points:
//   - Reasoning Engine: Manages investigation lifecycle
//   - Audit Logger: Persists all state changes
//   - Backend Proxy: Query cluster data
//   - MCP Server: Execute tools
//   - World Model: Fetch cluster state
//   - Prompt Manager: Render prompts with investigation context

// InvestigationState enum
type InvestigationState string

const (
	StateCreated       InvestigationState = "created"
	StateInvestigating InvestigationState = "investigating"
	StateConcluded     InvestigationState = "concluded"
	StateCancelled     InvestigationState = "cancelled"
	StateArchived      InvestigationState = "archived"
)

// InvestigationType enum
type InvestigationType string

const (
	TypePodCrash    InvestigationType = "pod_crash"
	TypePerformance InvestigationType = "performance"
	TypeSecurity    InvestigationType = "security"
	TypeCost        InvestigationType = "cost"
	TypeReliability InvestigationType = "reliability"
	TypeProactive   InvestigationType = "proactive"
	TypeAnomalies   InvestigationType = "anomalies"
	TypeConfigCheck InvestigationType = "config_check"
)

// Investigation represents the complete state of a single investigation.
type Investigation struct {
	// ID is the unique identifier for this investigation
	ID string

	// Type categorizes the investigation (pod-crash, performance, etc.)
	Type InvestigationType

	// State tracks position in state machine
	State InvestigationState

	// CreatedAt is when investigation record was created
	CreatedAt interface{}

	// StartedAt is when investigation began processing
	StartedAt interface{}

	// ConcludedAt is when investigation finished
	ConcludedAt interface{}

	// UserID identifies who triggered this investigation
	UserID string

	// Description is the initial problem statement
	Description string

	// Context is the built cluster context used for investigation
	Context string

	// Hypothesis is the current or final hypothesis
	Hypothesis interface{}

	// ToolCalls tracks all tools invoked during investigation
	ToolCalls []interface{}

	// Findings accumulates findings with evidence
	Findings []interface{}

	// Conclusion is the final root cause analysis
	Conclusion interface{}

	// Confidence is overall confidence in conclusion (0-100%)
	Confidence int

	// Actions are proposed or executed actions from investigation
	Actions []interface{}

	// TimeoutSeconds is investigation timeout duration
	TimeoutSeconds int

	// CorrelationID links to REST request that started investigation
	CorrelationID string
}

// InvestigationSession defines the interface for investigation state management.
type InvestigationSession interface {
	// CreateInvestigation initializes a new investigation session.
	CreateInvestigation(ctx context.Context, itype InvestigationType, description string, userID string) (*Investigation, error)

	// GetInvestigation retrieves investigation by ID.
	GetInvestigation(ctx context.Context, id string) (*Investigation, error)

	// UpdateState transitions investigation to a new state.
	UpdateState(ctx context.Context, id string, newState InvestigationState) error

	// AddHypothesis adds a hypothesis to the investigation.
	AddHypothesis(ctx context.Context, id string, hypothesis interface{}) error

	// AddToolCall records a tool call.
	AddToolCall(ctx context.Context, id string, toolName string, args interface{}, result interface{}) error

	// AddFinding records a finding with evidence and confidence.
	AddFinding(ctx context.Context, id string, statement string, evidence interface{}, confidence int) error

	// SetConclusion sets the final conclusion.
	SetConclusion(ctx context.Context, id string, conclusion interface{}, confidence int) error

	// AddAction associates an action with the investigation.
	AddAction(ctx context.Context, id string, actionID string) error

	// CancelInvestigation cancels an in-progress investigation.
	CancelInvestigation(ctx context.Context, id string) error

	// ArchiveInvestigation moves investigation to archived state.
	ArchiveInvestigation(ctx context.Context, id string) error

	// ListInvestigations returns investigations matching filter criteria.
	ListInvestigations(ctx context.Context, filter interface{}) ([]Investigation, error)
}

// NewInvestigationSession is now implemented in session_impl.go
