package safety

import (
	"context"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/safety/autonomy"
	"github.com/kubilitics/kubilitics-ai/internal/safety/blastradius"
	"github.com/kubilitics/kubilitics-ai/internal/safety/policy"
	"github.com/kubilitics/kubilitics-ai/internal/safety/rollback"
)

// Package safety provides the unified Safety Engine for kubilitics-ai.
//
// The Safety Engine is the **critical safety layer** that sits between
// AI recommendations and cluster execution. It ensures NO unsafe action
// reaches the cluster, regardless of what the LLM suggests.
//
// Key Design Principle: LLM-INDEPENDENT SAFETY
//   - Safety rules are immutable and non-negotiable
//   - LLMs can suggest actions, but cannot bypass safety
//   - Even if LLM hallucinates or makes mistakes, safety rules prevent harm
//   - Safety is enforced via deterministic, rule-based logic (NO ML/LLM)
//
// Architecture Overview:
//   1. Policy Engine: Immutable + configurable safety rules
//   2. Blast Radius Calculator: Impact assessment
//   3. Autonomy Controller: User approval requirements
//   4. Rollback Manager: Undo mechanisms
//
// Safety Evaluation Flow:
//   Action Proposed (from LLM or user)
//      ↓
//   1. Policy Engine: Check safety rules
//      - Immutable rules (always enforced)
//      - Configurable policies (user settings)
//      → DENY if violation → reject immediately
//      ↓
//   2. Blast Radius Calculator: Assess impact
//      - How many resources affected?
//      - What's the severity?
//      - Any data loss risk?
//      → If high impact → escalate to human
//      ↓
//   3. Autonomy Controller: Check approval requirements
//      - Based on autonomy level (0-3)
//      - Based on resource criticality
//      - Based on blast radius
//      → REQUEST_APPROVAL if needed
//      ↓
//   4. Execution (if approved)
//      → Create rollback checkpoint
//      → Execute action
//      → Monitor for issues
//      → Auto-rollback if failure
//
// Immutable Safety Rules (Cannot be disabled):
//   1. No deletion of kube-system namespace resources
//   2. No scaling critical services to zero replicas
//   3. No drain of all nodes (cluster-wide DoS)
//   4. No changes breaking cluster access (RBAC policies)
//   5. No actions affecting monitoring/observability
//   6. Data loss prevention (require backup confirmation)
//   7. Rate limiting (max X operations per time period)
//
// User-Configurable Policies:
//   - Namespace restrictions (e.g., "don't touch production")
//   - Scaling limits (min/max replicas)
//   - Resource constraints (max CPU/memory)
//   - Time-based restrictions (business hours)
//   - Cost limits (budget caps)
//
// Autonomy Levels:
//   Level 0 (Observatory): Observe only, no actions
//   Level 1 (Assisted): Suggestions only, human executes
//   Level 2 (Semi-Autonomous): Execute safe actions, ask for risky
//   Level 3 (Autonomous): Execute all approved actions
//
// Integration Points:
//   - MCP Tools: Safety check before execution
//   - Reasoning Engine: Inform safety constraints
//   - Audit Logger: Log all safety evaluations
//   - World Model: Query cluster state for decisions
//   - REST API: Safety configuration endpoints

// Action represents a proposed cluster operation
type Action struct {
	ID            string                 `json:"id"`
	Operation     string                 `json:"operation"` // patch, scale, delete, apply
	ResourceType  string                 `json:"resource_type"`
	ResourceName  string                 `json:"resource_name"`
	Namespace     string                 `json:"namespace"`
	TargetState   map[string]interface{} `json:"target_state"`
	Justification string                 `json:"justification"`
	UserID        string                 `json:"user_id"`
	Timestamp     time.Time              `json:"timestamp"`
	Metadata      map[string]interface{} `json:"metadata"`
}

// ToMap converts Action to map[string]interface{} for sub-component consumption.
func (a *Action) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"operation":     a.Operation,
		"namespace":     a.Namespace,
		"resource_type": a.ResourceType,
		"resource_name": a.ResourceName,
		"target_state":  a.TargetState,
		"user_id":       a.UserID,
		"id":            a.ID,
	}
}

// SafetyResult represents the outcome of safety evaluation
type SafetyResult struct {
	Approved      bool                   `json:"approved"`
	Result        string                 `json:"result"` // approve, deny, request_approval, warn
	Reason        string                 `json:"reason"`
	RiskLevel     string                 `json:"risk_level"` // low, medium, high, critical
	BlastRadius   interface{}            `json:"blast_radius"`
	RequiresHuman bool                   `json:"requires_human"`
	PolicyChecks  []PolicyCheck          `json:"policy_checks"`
	Metadata      map[string]interface{} `json:"metadata"`
}

// PolicyCheck represents a single policy evaluation
type PolicyCheck struct {
	PolicyName string `json:"policy_name"`
	Passed     bool   `json:"passed"`
	Reason     string `json:"reason"`
	Severity   string `json:"severity"` // critical, high, medium, low
}

// Engine is the unified safety engine
type Engine struct {
	policyEngine       policy.PolicyEngine
	blastCalculator    blastradius.BlastRadiusCalculator
	autonomyController autonomy.AutonomyController
	rollbackManager    rollback.RollbackManager
}

// NewEngine creates a new safety engine with all components
func NewEngine(store db.Store) (*Engine, error) {
	return &Engine{
		policyEngine:       policy.NewPolicyEngine(store),
		blastCalculator:    blastradius.NewBlastRadiusCalculator(),
		autonomyController: autonomy.NewAutonomyController(),
		rollbackManager:    rollback.NewRollbackManager(),
	}, nil
}

// checkComponents verifies all components are initialized
func (e *Engine) checkComponents() error {
	if e.policyEngine == nil {
		return fmt.Errorf("policy engine not initialized - safety components not yet fully implemented")
	}
	if e.blastCalculator == nil {
		return fmt.Errorf("blast radius calculator not initialized - safety components not yet fully implemented")
	}
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized - safety components not yet fully implemented")
	}
	if e.rollbackManager == nil {
		return fmt.Errorf("rollback manager not initialized - safety components not yet fully implemented")
	}
	return nil
}

// EvaluateAction performs comprehensive safety evaluation of a proposed action
func (e *Engine) EvaluateAction(ctx context.Context, action *Action) (*SafetyResult, error) {
	result := &SafetyResult{
		PolicyChecks: make([]PolicyCheck, 0),
		Metadata:     make(map[string]interface{}),
	}

	// Check if components are initialized
	if e.policyEngine == nil {
		return nil, fmt.Errorf("policy engine not initialized - safety components not yet implemented")
	}
	if e.blastCalculator == nil {
		return nil, fmt.Errorf("blast radius calculator not initialized - safety components not yet implemented")
	}
	if e.autonomyController == nil {
		return nil, fmt.Errorf("autonomy controller not initialized - safety components not yet implemented")
	}

	// Step 1: Policy Engine - Check immutable and configurable rules
	// Pass action.ToMap() so sub-components can use map[string]interface{} extraction helpers.
	policyResult, reason, riskLevel, err := e.policyEngine.Evaluate(ctx, action.UserID, action.ToMap())
	if err != nil {
		return nil, fmt.Errorf("policy evaluation failed: %w", err)
	}

	// Populate PolicyChecks from policy result
	result.PolicyChecks = append(result.PolicyChecks, PolicyCheck{
		PolicyName: "immutable_rules_check",
		Passed:     policyResult != policy.ResultDeny,
		Reason:     reason,
		Severity:   riskLevel,
	})

	result.Result = string(policyResult)
	result.Reason = reason
	result.RiskLevel = riskLevel

	// If policy denies, stop immediately
	if policyResult == policy.ResultDeny {
		result.Approved = false
		result.RequiresHuman = false
		return result, nil
	}

	// Step 2: Blast Radius - Assess impact
	affectedResources, impactSummary, err := e.blastCalculator.CalculateBlastRadius(ctx, action.ToMap())
	if err != nil {
		return nil, fmt.Errorf("blast radius calculation failed: %w", err)
	}

	result.BlastRadius = map[string]interface{}{
		"affected_resources": affectedResources,
		"impact_summary":     impactSummary,
	}

	affectedCount := len(affectedResources)
	result.Metadata["affected_count"] = affectedCount

	// Step 3: Data Loss Risk Assessment
	hasDataLossRisk, affectedVolumes, backupStatus, err := e.blastCalculator.AssessDataLossRisk(ctx, action.ToMap())
	if err != nil {
		return nil, fmt.Errorf("data loss risk assessment failed: %w", err)
	}

	if hasDataLossRisk {
		result.Metadata["data_loss_risk"] = true
		result.Metadata["affected_volumes"] = affectedVolumes
		result.Metadata["backup_status"] = backupStatus
		// Escalate to human if data loss risk
		result.RequiresHuman = true
		result.Result = "request_approval"
		result.Reason = "Action involves risk of data loss - requires human approval"
		result.RiskLevel = "high"
	}

	// Step 4: Autonomy Level Check
	requiresApproval, approvalReason, err := e.autonomyController.DetermineApprovalRequired(ctx, action.UserID, action.ToMap())
	if err != nil {
		// Log error but don't fail - default to requiring approval for safety
		requiresApproval = true
		approvalReason = "Error determining approval requirement - defaulting to safe mode"
	}
	if requiresApproval {
		result.RequiresHuman = true
		result.Result = "request_approval"
		if result.Reason == "" {
			if approvalReason != "" {
				result.Reason = approvalReason
			} else {
				result.Reason = fmt.Sprintf("Action requires approval: risk_level=%s, affected=%d", riskLevel, affectedCount)
			}
		}
	}

	// Step 5: Final Decision
	if policyResult == policy.ResultApprove && !result.RequiresHuman {
		result.Approved = true
		result.Result = "approve"
		if result.RiskLevel == "" {
			result.RiskLevel = riskLevel
		}
	} else if policyResult == policy.ResultRequestApproval || result.RequiresHuman {
		result.Approved = false
		result.Result = "request_approval"
	} else if policyResult == policy.ResultWarn {
		result.Approved = true
		result.Result = "warn"
	}

	// Ensure RiskLevel is always set
	if result.RiskLevel == "" {
		result.RiskLevel = riskLevel
	}

	return result, nil
}

// ValidateAction performs validation without full safety evaluation
func (e *Engine) ValidateAction(ctx context.Context, action *Action) (bool, []string, error) {
	if e.policyEngine == nil {
		return false, nil, fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.ValidateAction(ctx, action.ToMap())
}

// CreateRollbackCheckpoint creates a checkpoint before executing action
func (e *Engine) CreateRollbackCheckpoint(ctx context.Context, action *Action) (string, error) {
	if err := e.checkComponents(); err != nil {
		return "", err
	}

	// Create baseline metrics snapshot
	baseline := map[string]interface{}{
		"timestamp": time.Now(),
		"resource":  action.ResourceName,
		"namespace": action.Namespace,
		"operation": action.Operation,
	}

	// Start monitoring the action
	return e.rollbackManager.MonitorAction(ctx, action.ID, action.ToMap(), baseline)
}

// RollbackAction rolls back to previous state
func (e *Engine) RollbackAction(ctx context.Context, actionID string) error {
	if err := e.checkComponents(); err != nil {
		return err
	}
	_, _, err := e.rollbackManager.RollbackAction(ctx, actionID)
	return err
}

// GetImmutableRules returns all immutable safety rules
func (e *Engine) GetImmutableRules(ctx context.Context) ([]string, error) {
	if e.policyEngine == nil {
		return nil, fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.ListImmutableRules(ctx)
}

// GetPolicies returns all configurable policies
func (e *Engine) GetPolicies(ctx context.Context) ([]interface{}, error) {
	if e.policyEngine == nil {
		return nil, fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.GetPolicies(ctx)
}

// CreatePolicy creates a new configurable policy
func (e *Engine) CreatePolicy(ctx context.Context, name string, rule interface{}) error {
	if e.policyEngine == nil {
		return fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.CreatePolicy(ctx, name, rule)
}

// UpdatePolicy updates an existing policy
func (e *Engine) UpdatePolicy(ctx context.Context, name string, rule interface{}) error {
	if e.policyEngine == nil {
		return fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.UpdatePolicy(ctx, name, rule)
}

// DeletePolicy deletes a configurable policy
func (e *Engine) DeletePolicy(ctx context.Context, name string) error {
	if e.policyEngine == nil {
		return fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.DeletePolicy(ctx, name)
}

// ScanForViolations scans cluster for policy violations
func (e *Engine) ScanForViolations(ctx context.Context) ([]interface{}, error) {
	if e.policyEngine == nil {
		return nil, fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.ScanForViolations(ctx)
}

// SetAutonomyLevel configures the autonomy level (0-4) for a user
func (e *Engine) SetAutonomyLevel(ctx context.Context, userID string, level int) error {
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized")
	}
	// Convert int to AutonomyLevel enum
	autonomyLevel := autonomy.AutonomyLevel(level)
	return e.autonomyController.SetAutonomyLevel(ctx, userID, autonomyLevel)
}

// GetAutonomyLevel returns current autonomy level for a user
func (e *Engine) GetAutonomyLevel(ctx context.Context, userID string) (int, error) {
	if e.autonomyController == nil {
		return 0, fmt.Errorf("autonomy controller not initialized")
	}
	level, err := e.autonomyController.GetAutonomyLevel(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(level), nil
}

// EstimateDowntime estimates service disruption from action
func (e *Engine) EstimateDowntime(ctx context.Context, action *Action) (int, int, error) {
	if e.blastCalculator == nil {
		return 0, 0, fmt.Errorf("blast radius calculator not initialized")
	}
	return e.blastCalculator.EstimateDowntime(ctx, action.ToMap())
}

// CompareAlternatives compares safety of multiple action options
func (e *Engine) CompareAlternatives(ctx context.Context, primary *Action, alternatives []*Action) (interface{}, error) {
	if e.blastCalculator == nil {
		return nil, fmt.Errorf("blast radius calculator not initialized")
	}
	// Convert to interface{} slice for blast calculator
	altInterfaces := make([]interface{}, len(alternatives))
	for i, alt := range alternatives {
		altInterfaces[i] = alt.ToMap()
	}
	return e.blastCalculator.CompareAlternatives(ctx, primary.ToMap(), altInterfaces)
}

// CheckCompliance checks if a resource is compliant with policies
func (e *Engine) CheckCompliance(ctx context.Context, resourceID string) (bool, []interface{}, error) {
	if e.policyEngine == nil {
		return false, nil, fmt.Errorf("policy engine not initialized")
	}
	return e.policyEngine.CheckCompliance(ctx, resourceID)
}

// ─── Namespace autonomy overrides ────────────────────────────────────────────

// SetNamespaceAutonomyLevel sets a per-namespace autonomy override for a user.
func (e *Engine) SetNamespaceAutonomyLevel(ctx context.Context, userID, namespace string, level int) error {
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized")
	}
	type nsLevelSetter interface {
		SetNamespaceAutonomyLevel(ctx context.Context, userID, namespace string, level autonomy.AutonomyLevel) error
	}
	if setter, ok := e.autonomyController.(nsLevelSetter); ok {
		return setter.SetNamespaceAutonomyLevel(ctx, userID, namespace, autonomy.AutonomyLevel(level))
	}
	return fmt.Errorf("autonomy controller does not support namespace overrides")
}

// ListNamespaceOverrides returns all namespace-level autonomy overrides for a user.
func (e *Engine) ListNamespaceOverrides(ctx context.Context, userID string) (interface{}, error) {
	if e.autonomyController == nil {
		return nil, fmt.Errorf("autonomy controller not initialized")
	}
	type nsLister interface {
		ListNamespaceOverrides(ctx context.Context, userID string) ([]autonomy.NamespaceOverride, error)
	}
	if lister, ok := e.autonomyController.(nsLister); ok {
		return lister.ListNamespaceOverrides(ctx, userID)
	}
	return nil, fmt.Errorf("autonomy controller does not support namespace overrides")
}

// DeleteNamespaceOverride removes a namespace-level autonomy override for a user.
func (e *Engine) DeleteNamespaceOverride(ctx context.Context, userID, namespace string) error {
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized")
	}
	type nsDeleter interface {
		DeleteNamespaceOverride(ctx context.Context, userID, namespace string) error
	}
	if deleter, ok := e.autonomyController.(nsDeleter); ok {
		return deleter.DeleteNamespaceOverride(ctx, userID, namespace)
	}
	return fmt.Errorf("autonomy controller does not support namespace overrides")
}

// ─── Approval management ─────────────────────────────────────────────────────

// ApproveAction marks a pending action as approved by the given user.
func (e *Engine) ApproveAction(ctx context.Context, userID, actionID string) error {
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized")
	}
	return e.autonomyController.ApproveAction(ctx, userID, actionID)
}

// RejectAction marks a pending action as rejected by the given user.
func (e *Engine) RejectAction(ctx context.Context, userID, actionID string) error {
	if e.autonomyController == nil {
		return fmt.Errorf("autonomy controller not initialized")
	}
	return e.autonomyController.RejectAction(ctx, userID, actionID)
}

// ListPendingApprovals returns pending approval requests (optionally filtered by userID).
func (e *Engine) ListPendingApprovals(ctx context.Context, userID string) (interface{}, error) {
	if e.autonomyController == nil {
		return nil, fmt.Errorf("autonomy controller not initialized")
	}
	type approvalLister interface {
		ListPendingApprovals(ctx context.Context, userID string) ([]*autonomy.PendingApproval, error)
	}
	if lister, ok := e.autonomyController.(approvalLister); ok {
		return lister.ListPendingApprovals(ctx, userID)
	}
	// Fall back to legacy interface
	return e.autonomyController.GetApprovalPending(ctx, userID)
}
