package policy

// Package policy — concrete PolicyEngine implementation with immutable and configurable rules.

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/metrics"
)

// ─── Immutable safety rules (always enforced, cannot be overridden) ───────────

var immutableRules = []struct {
	name  string
	check func(action interface{}) (bool, string) // returns (violated, reason)
	risk  string
}{
	{
		name: "no_production_namespace_delete",
		check: func(action interface{}) (bool, string) {
			a, ok := action.(actionMap)
			if !ok {
				return false, ""
			}
			if a.operation() == "delete" {
				ns := strings.ToLower(a.namespace())
				if ns == "production" || ns == "prod" || ns == "kube-system" {
					return true, fmt.Sprintf("Cannot delete resources in critical namespace: %s", ns)
				}
			}
			return false, ""
		},
		risk: "critical",
	},
	{
		name: "no_scale_to_zero_production",
		check: func(action interface{}) (bool, string) {
			a, ok := action.(actionMap)
			if !ok {
				return false, ""
			}
			if a.operation() == "scale" {
				ns := strings.ToLower(a.namespace())
				if (ns == "production" || ns == "prod") && a.targetReplicas() == 0 {
					return true, fmt.Sprintf("Cannot scale to zero in production namespace: %s", ns)
				}
			}
			return false, ""
		},
		risk: "critical",
	},
	{
		name: "no_kube_system_mutations",
		check: func(action interface{}) (bool, string) {
			a, ok := action.(actionMap)
			if !ok {
				return false, ""
			}
			ns := strings.ToLower(a.namespace())
			op := a.operation()
			if ns == "kube-system" && (op == "delete" || op == "patch" || op == "scale") {
				return true, "Mutations to kube-system namespace require manual review"
			}
			return false, ""
		},
		risk: "high",
	},
}

// ─── actionMap helpers to extract action fields ───────────────────────────────

type actionMap interface {
	operation() string
	namespace() string
	resourceType() string
	resourceName() string
	targetReplicas() int
}

// safetyAction wraps the generic action interface for policy evaluation.
type safetyAction struct {
	op       string
	ns       string
	resType  string
	resName  string
	replicas int
}

func (a *safetyAction) operation() string    { return a.op }
func (a *safetyAction) namespace() string    { return a.ns }
func (a *safetyAction) resourceType() string { return a.resType }
func (a *safetyAction) resourceName() string { return a.resName }
func (a *safetyAction) targetReplicas() int  { return a.replicas }

// extractSafetyAction converts the generic action interface to safetyAction.
func extractSafetyAction(action interface{}) *safetyAction {
	if action == nil {
		return &safetyAction{}
	}
	// Type-assert to map (most common case from execution tools)
	if m, ok := action.(map[string]interface{}); ok {
		sa := &safetyAction{}
		if v, ok := m["operation"].(string); ok {
			sa.op = v
		}
		if v, ok := m["namespace"].(string); ok {
			sa.ns = v
		}
		if v, ok := m["resource_type"].(string); ok {
			sa.resType = v
		}
		if v, ok := m["resource_name"].(string); ok {
			sa.resName = v
		}
		if ts, ok := m["target_state"].(map[string]interface{}); ok {
			if r, ok := ts["replicas"].(int); ok {
				sa.replicas = r
			}
		}
		return sa
	}
	// Use reflection-like approach via JSON round-trip if needed
	return &safetyAction{}
}

// extractFromAction handles the *Action type from the safety package
// without creating a circular import (we use interface{} instead).
func extractFromAnyAction(action interface{}) *safetyAction {
	// Try to extract via interface methods
	type opProvider interface{ GetOperation() string }
	type nsProvider interface{ GetNamespace() string }

	sa := &safetyAction{}

	// The safety.Action struct is passed as interface{} — use type switch on common patterns
	switch v := action.(type) {
	case map[string]interface{}:
		if op, ok := v["operation"].(string); ok {
			sa.op = op
		}
		if ns, ok := v["namespace"].(string); ok {
			sa.ns = ns
		}
		if rt, ok := v["resource_type"].(string); ok {
			sa.resType = rt
		}
		if rn, ok := v["resource_name"].(string); ok {
			sa.resName = rn
		}
		if ts, ok := v["target_state"].(map[string]interface{}); ok {
			if r, ok := ts["replicas"].(int); ok {
				sa.replicas = r
			}
		}
	default:
		_ = v
	}
	return sa
}

// ─── policyEngineImpl ─────────────────────────────────────────────────────────

// ─── policyEngineImpl ─────────────────────────────────────────────────────────

type configPolicy struct {
	Name      string `json:"name"`
	Condition string `json:"condition"` // e.g. "namespace=staging"
	Effect    string `json:"effect"`    // "deny" or "warn"
	Reason    string `json:"reason"`
}

type Store interface {
	ListPolicies(ctx context.Context) ([]*db.SafetyPolicyRecord, error)
	GetPolicy(ctx context.Context, name string) (*db.SafetyPolicyRecord, error)
	CreatePolicy(ctx context.Context, rec *db.SafetyPolicyRecord) error
	UpdatePolicy(ctx context.Context, rec *db.SafetyPolicyRecord) error
	DeletePolicy(ctx context.Context, name string) error
}

type policyEngineImpl struct {
	mu    sync.RWMutex
	store Store // db.SafetyPolicyStore
}

func NewPolicyEngine(store Store) PolicyEngine {
	return &policyEngineImpl{
		store: store,
	}
}

func (e *policyEngineImpl) Evaluate(ctx context.Context, _ string, action interface{}) (PolicyEvaluationResult, string, string, error) {
	sa := extractFromAnyAction(action)

	// Check immutable rules first
	for _, rule := range immutableRules {
		// Build the actionMap wrapper
		wrapper := &safetyAction{
			op:       sa.op,
			ns:       sa.ns,
			resType:  sa.resType,
			resName:  sa.resName,
			replicas: sa.replicas,
		}
		violated, reason := rule.check(wrapper)
		if violated {
			metrics.SafetyPolicyEvaluations.WithLabelValues(rule.name, "deny").Inc()
			metrics.SafetyBlocked.WithLabelValues(rule.name, sa.op).Inc()
			return ResultDeny, reason, rule.risk, nil
		}
	}

	// Fetch configurable policies from DB
	// Note: For high traffic, we would cache this. But for now, direct DB query is fine and safer.
	records, err := e.store.ListPolicies(ctx)
	if err != nil {
		// If DB fails, we should probably fail safe (deny) or warn?
		// For safety, let's log and warn, but maybe not block unless critical?
		// Actually, if we can't load safety rules, failing open is dangerous.
		// Failing closed (deny) is safer.
		metrics.SafetyPolicyEvaluations.WithLabelValues("db_load_error", "deny").Inc()
		return ResultDeny, "Failed to load safety policies", "critical", err
	}

	riskLevel := "low"
	// Escalate risk based on operation type
	switch strings.ToLower(sa.op) {
	case "delete":
		riskLevel = "high"
	case "drain", "cordon":
		riskLevel = "high"
	case "scale", "rollback", "patch", "update_limits", "hpa_scale":
		riskLevel = "medium"
	case "restart":
		riskLevel = "low"
	}

	for _, r := range records {
		// Simple condition matching: "namespace=X"
		// Only supporting simple equality for now, as per original implementation
		parts := strings.SplitN(r.Condition, "=", 2)
		if len(parts) == 2 {
			field, value := parts[0], parts[1]
			var actual string
			switch field {
			case "namespace":
				actual = sa.ns
			case "operation":
				actual = sa.op
			case "resource_type":
				actual = sa.resType
			}
			if strings.EqualFold(actual, value) {
				if r.Effect == "deny" {
					metrics.SafetyPolicyEvaluations.WithLabelValues(r.Name, "deny").Inc()
					metrics.SafetyBlocked.WithLabelValues(r.Name, sa.op).Inc()
					return ResultDeny, r.Reason, "high", nil
				}
				metrics.SafetyPolicyEvaluations.WithLabelValues(r.Name, "warn").Inc()
				return ResultWarn, r.Reason, riskLevel, nil
			}
		}
	}

	metrics.SafetyPolicyEvaluations.WithLabelValues("default", "allow").Inc()
	return ResultApprove, "Action approved by policy engine", riskLevel, nil
}

func (e *policyEngineImpl) ValidateAction(_ context.Context, action interface{}) (bool, []string, error) {
	sa := extractFromAnyAction(action)
	violations := []string{}
	if sa.op == "" {
		violations = append(violations, "operation is required")
	}
	if sa.resType == "" {
		violations = append(violations, "resource_type is required")
	}
	if sa.resName == "" {
		violations = append(violations, "resource_name is required")
	}
	return len(violations) == 0, violations, nil
}

func (e *policyEngineImpl) GetPolicies(ctx context.Context) ([]interface{}, error) {
	records, err := e.store.ListPolicies(ctx)
	if err != nil {
		return nil, err
	}
	// Convert to interface slice as expected by interface
	result := make([]interface{}, len(records))
	for i, r := range records {
		result[i] = map[string]interface{}{
			"name":       r.Name,
			"condition":  r.Condition,
			"effect":     r.Effect,
			"reason":     r.Reason,
			"updated_at": r.UpdatedAt,
		}
	}
	return result, nil
}

func (e *policyEngineImpl) CreatePolicy(ctx context.Context, policyName string, policyRule interface{}) error {
	// Cast rule to map
	m, ok := policyRule.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid policy rule format: expected map")
	}

	rec := &db.SafetyPolicyRecord{
		Name: policyName,
	}
	if v, ok := m["condition"].(string); ok {
		rec.Condition = v
	}
	if v, ok := m["effect"].(string); ok {
		rec.Effect = v
	}
	if v, ok := m["reason"].(string); ok {
		rec.Reason = v
	}

	return e.store.CreatePolicy(ctx, rec)
}

func (e *policyEngineImpl) UpdatePolicy(ctx context.Context, policyName string, policyRule interface{}) error {
	// Cast rule to map
	m, ok := policyRule.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid policy rule format: expected map")
	}

	rec := &db.SafetyPolicyRecord{
		Name: policyName,
	}
	if v, ok := m["condition"].(string); ok {
		rec.Condition = v
	}
	if v, ok := m["effect"].(string); ok {
		rec.Effect = v
	}
	if v, ok := m["reason"].(string); ok {
		rec.Reason = v
	}

	return e.store.UpdatePolicy(ctx, rec)
}

func (e *policyEngineImpl) DeletePolicy(ctx context.Context, policyName string) error {
	return e.store.DeletePolicy(ctx, policyName)
}

func (e *policyEngineImpl) ListImmutableRules(_ context.Context) ([]string, error) {
	names := make([]string, len(immutableRules))
	for i, r := range immutableRules {
		names[i] = r.name
	}
	return names, nil
}

func (e *policyEngineImpl) CheckCompliance(_ context.Context, resourceID string) (bool, []interface{}, error) {
	// Basic compliance check — no violations for non-production resources by default
	if strings.Contains(strings.ToLower(resourceID), "prod") {
		return false, []interface{}{
			map[string]string{
				"rule":   "production_resource_protection",
				"reason": "Production resources require elevated review",
			},
		}, nil
	}
	return true, nil, nil
}

func (e *policyEngineImpl) ScanForViolations(_ context.Context) ([]interface{}, error) {
	// Would scan all resources against policies
	// For now return empty — real implementation would iterate backend resources
	return []interface{}{}, nil
}
