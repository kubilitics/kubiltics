package policy

import "context"

// Package policy provides the Safety Policy Engine — the "Super-Ego" of kubilitics-ai.
//
// The Safety Policy Engine is the ultimate gatekeeper for ALL proposed cluster mutations.
//
// Responsibilities:
//   - Evaluate every proposed action against immutable safety rules
//   - Enforce user-configurable safety policies
//   - Block dangerous operations before they reach the cluster
//   - Provide clear denial reasons for debugging
//   - Support multiple policy rule types
//   - Log all policy evaluations for audit trail
//
// Two-Tier Policy System:
//
//   Tier 1: Immutable Rules (Cannot be disabled)
//      - No deletion of critical resources (kube-system, monitoring, etc.)
//      - No scaling to zero replicas for critical services
//      - No drain of all nodes (cluster-wide DoS prevention)
//      - No changes to RBAC policies that would break access
//      - Require explicit safety confirmation for dangerous ops
//
//   Tier 2: Configurable Policies (User can enable/disable)
//      - Scaling limits (min/max replicas)
//      - Resource request/limit constraints
//      - Namespace restrictions (don't touch production)
//      - Rate limits (max changes per time period)
//      - Cost limits (don't auto-scale beyond budget)
//
// Policy Rules:
//
//   1. Resource Type Restrictions
//      Example: "Block deletion of Deployments in namespace kube-system"
//      Example: "Block scaling of StatefulSets in namespace production"
//
//   2. Namespace Restrictions
//      Example: "Require human approval for changes in namespace production"
//      Example: "Allow unrestricted changes only in namespace sandbox"
//
//   3. Scaling Policies
//      Example: "Min replicas >= 2 for Deployments labeled critical=true"
//      Example: "Max replicas <= 100 to prevent runaway scaling"
//      Example: "Don't scale below current replica count -50%"
//
//   4. Resource Constraints
//      Example: "Pod memory requests <= 8Gi"
//      Example: "Pod CPU requests <= 4000m"
//
//   5. Rate Limiting
//      Example: "Max 10 scaling operations per hour"
//      Example: "Max 5 pod disruptions per minute"
//
//   6. Time-Based Policies
//      Example: "No risky operations during business hours (9am-5pm)"
//      Example: "Restrict to maintenance windows only (weekends)"
//
// Evaluation Process:
//   1. Check Tier 1 immutable rules
//   2. If immutable rule violated → DENY with reason
//   3. Check Tier 2 configurable rules
//   4. If configurable rule violated → DENY or REQUEST_APPROVAL (based on autonomy level)
//   5. If all rules pass → APPROVE
//
// Integration Points:
//   - Execution Tools: Called before executing patch, scale, delete, etc.
//   - Autonomy Controller: Coordination with autonomy level
//   - Audit Logger: Log all policy evaluations
//   - REST API: Policy management endpoints
//   - World Model: Query affected resources for policy check

// PolicyEvaluationResult enum
type PolicyEvaluationResult string

const (
	ResultApprove         PolicyEvaluationResult = "approve"
	ResultDeny            PolicyEvaluationResult = "deny"
	ResultRequestApproval PolicyEvaluationResult = "request_approval"
	ResultWarn            PolicyEvaluationResult = "warn"
)

// PolicyEngine defines the interface for policy evaluation.
type PolicyEngine interface {
	// Evaluate evaluates a proposed action against policy rules.
	// action: {operation: "patch"|"scale"|"delete"|"apply", resource: {...}, target_state: {...}}
	// Returns: result (approve/deny/request_approval/warn), reason, risk_level
	Evaluate(ctx context.Context, userID string, action interface{}) (PolicyEvaluationResult, string, string, error)

	// ValidateAction checks if action is valid and safe.
	// More detailed validation than Evaluate.
	ValidateAction(ctx context.Context, action interface{}) (bool, []string, error)

	// GetPolicies returns all active policies.
	GetPolicies(ctx context.Context) ([]interface{}, error)

	// CreatePolicy creates a new configurable policy.
	CreatePolicy(ctx context.Context, policyName string, policyRule interface{}) error

	// UpdatePolicy updates an existing policy.
	UpdatePolicy(ctx context.Context, policyName string, policyRule interface{}) error

	// DeletePolicy deletes a configurable policy (immutable policies cannot be deleted).
	DeletePolicy(ctx context.Context, policyName string) error

	// ListImmutableRules returns all immutable safety rules.
	ListImmutableRules(ctx context.Context) ([]string, error)

	// CheckCompliance checks if resource complies with all policies.
	// Returns: is_compliant (bool), violations (list of policy violations)
	CheckCompliance(ctx context.Context, resourceID string) (bool, []interface{}, error)

	// ScanForViolations finds all resources currently violating policies.
	// Returns: list of non-compliant resources with violations
	ScanForViolations(ctx context.Context) ([]interface{}, error)
}

// NewPolicyEngine creates a new policy engine.
// The concrete implementation is in engine_impl.go.
