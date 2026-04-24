package autonomy

// Package autonomy — concrete AutonomyController implementation.

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// operationRisk maps operations to their minimum required autonomy level.
// Higher level = more trusted / less approval needed.
var operationRisk = map[string]struct {
	minLevel  AutonomyLevel
	riskLevel string
}{
	"restart":       {LevelRecommend, "low"},
	"delete_pod":    {LevelRecommend, "low"},
	"scale":         {LevelPropose, "medium"},
	"rollback":      {LevelPropose, "medium"},
	"update_limits": {LevelPropose, "medium"},
	"cordon":        {LevelPropose, "medium"},
	"patch":         {LevelActWithGuard, "medium"},
	"hpa_scale":     {LevelActWithGuard, "high"},
	"drain":         {LevelActWithGuard, "high"},
	"delete":        {LevelFullAutonomous, "high"},
}

// PendingApproval is a typed action awaiting human approval.
type PendingApproval struct {
	ID          string                 `json:"id"`
	UserID      string                 `json:"user_id"`
	Operation   string                 `json:"operation"`
	Namespace   string                 `json:"namespace,omitempty"`
	ResourceID  string                 `json:"resource_id,omitempty"`
	Description string                 `json:"description"`
	RiskLevel   string                 `json:"risk_level"`
	Status      string                 `json:"status"` // "pending" | "approved" | "rejected"
	CreatedAt   time.Time              `json:"created_at"`
	ResolvedAt  *time.Time             `json:"resolved_at,omitempty"`
	ResolvedBy  string                 `json:"resolved_by,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// NamespaceOverride holds a per-namespace autonomy override for a user.
type NamespaceOverride struct {
	UserID    string        `json:"user_id"`
	Namespace string        `json:"namespace"`
	Level     AutonomyLevel `json:"level"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type autonomyControllerImpl struct {
	mu sync.RWMutex

	// Global per-user autonomy levels
	userLevels   map[string]AutonomyLevel
	defaultLevel AutonomyLevel

	// Per-namespace overrides: userID → namespace → level
	namespaceOverrides map[string]map[string]NamespaceOverride

	// Pending approvals by action ID
	pendingApprovals map[string]*PendingApproval
}

// NewAutonomyController creates a new autonomy controller.
func NewAutonomyController() AutonomyController {
	return &autonomyControllerImpl{
		userLevels:         make(map[string]AutonomyLevel),
		defaultLevel:       LevelRecommend, // Default: semi-autonomous
		namespaceOverrides: make(map[string]map[string]NamespaceOverride),
		pendingApprovals:   make(map[string]*PendingApproval),
	}
}

func (c *autonomyControllerImpl) SetAutonomyLevel(_ context.Context, userID string, level AutonomyLevel) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.userLevels[userID] = level
	return nil
}

func (c *autonomyControllerImpl) GetAutonomyLevel(_ context.Context, userID string) (AutonomyLevel, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if level, ok := c.userLevels[userID]; ok {
		return level, nil
	}
	return c.defaultLevel, nil
}

// SetNamespaceAutonomyLevel sets a per-namespace autonomy override for a user.
func (c *autonomyControllerImpl) SetNamespaceAutonomyLevel(_ context.Context, userID, namespace string, level AutonomyLevel) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.namespaceOverrides[userID]; !ok {
		c.namespaceOverrides[userID] = make(map[string]NamespaceOverride)
	}
	c.namespaceOverrides[userID][namespace] = NamespaceOverride{
		UserID:    userID,
		Namespace: namespace,
		Level:     level,
		UpdatedAt: time.Now(),
	}
	return nil
}

// GetNamespaceAutonomyLevel returns the effective autonomy level for a user in a namespace.
// If no override exists it returns the global user level.
func (c *autonomyControllerImpl) GetNamespaceAutonomyLevel(ctx context.Context, userID, namespace string) (AutonomyLevel, bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if nsMap, ok := c.namespaceOverrides[userID]; ok {
		if ovr, ok := nsMap[namespace]; ok {
			return ovr.Level, true, nil
		}
	}
	// Fall back to global level
	global, err := c.GetAutonomyLevel(ctx, userID)
	return global, false, err
}

// ListNamespaceOverrides returns all namespace overrides for a user.
func (c *autonomyControllerImpl) ListNamespaceOverrides(_ context.Context, userID string) ([]NamespaceOverride, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var out []NamespaceOverride
	if nsMap, ok := c.namespaceOverrides[userID]; ok {
		for _, v := range nsMap {
			out = append(out, v)
		}
	}
	return out, nil
}

// DeleteNamespaceOverride removes a per-namespace override for a user.
func (c *autonomyControllerImpl) DeleteNamespaceOverride(_ context.Context, userID, namespace string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if nsMap, ok := c.namespaceOverrides[userID]; ok {
		delete(nsMap, namespace)
	}
	return nil
}

// SubmitApprovalRequest adds an action to the pending approvals queue and returns its ID.
func (c *autonomyControllerImpl) SubmitApprovalRequest(_ context.Context, approval *PendingApproval) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	approval.Status = "pending"
	if approval.CreatedAt.IsZero() {
		approval.CreatedAt = time.Now()
	}
	c.pendingApprovals[approval.ID] = approval
	return nil
}

// ListPendingApprovals returns all pending approvals (optionally filtered by userID).
func (c *autonomyControllerImpl) ListPendingApprovals(_ context.Context, userID string) ([]*PendingApproval, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var out []*PendingApproval
	for _, v := range c.pendingApprovals {
		if userID == "" || v.UserID == userID {
			out = append(out, v)
		}
	}
	return out, nil
}

func (c *autonomyControllerImpl) DetermineApprovalRequired(ctx context.Context, userID string, action interface{}) (bool, string, error) {
	userLevel, err := c.GetAutonomyLevel(ctx, userID)
	if err != nil {
		return true, "Could not determine user autonomy level", err
	}

	op := extractOperation(action)
	if op == "" {
		return false, "", nil
	}

	rule, ok := operationRisk[strings.ToLower(op)]
	if !ok {
		// Unknown operation — require approval to be safe
		return true, fmt.Sprintf("Unknown operation '%s' requires explicit approval", op), nil
	}

	if userLevel < rule.minLevel {
		return true, fmt.Sprintf("Operation '%s' requires autonomy level %d, current level %d — human approval needed",
			op, rule.minLevel, userLevel), nil
	}

	return false, "", nil
}

func (c *autonomyControllerImpl) ApproveAction(_ context.Context, userID string, actionID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ap, ok := c.pendingApprovals[actionID]; ok {
		now := time.Now()
		ap.Status = "approved"
		ap.ResolvedAt = &now
		ap.ResolvedBy = userID
	}
	return nil
}

func (c *autonomyControllerImpl) RejectAction(_ context.Context, userID string, actionID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ap, ok := c.pendingApprovals[actionID]; ok {
		now := time.Now()
		ap.Status = "rejected"
		ap.ResolvedAt = &now
		ap.ResolvedBy = userID
	}
	return nil
}

func (c *autonomyControllerImpl) CanExecuteTool(ctx context.Context, userID string, toolName string) (bool, error) {
	userLevel, err := c.GetAutonomyLevel(ctx, userID)
	if err != nil {
		return false, err
	}
	// Observation and analysis tools are always available
	// Execution tools require at least Level 2
	if strings.HasPrefix(toolName, "restart_") || strings.HasPrefix(toolName, "analyze_") || strings.HasPrefix(toolName, "list_") {
		return true, nil
	}
	return userLevel >= LevelRecommend, nil
}

func (c *autonomyControllerImpl) AssessRisk(_ context.Context, action interface{}) (string, []string, error) {
	op := extractOperation(action)
	rule, ok := operationRisk[strings.ToLower(op)]
	if !ok {
		return "unknown", []string{"unknown operation"}, nil
	}
	factors := []string{fmt.Sprintf("operation '%s' has inherent risk level: %s", op, rule.riskLevel)}
	return rule.riskLevel, factors, nil
}

func (c *autonomyControllerImpl) GetApprovalPending(_ context.Context, userID string) ([]interface{}, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]interface{}, 0)
	for _, v := range c.pendingApprovals {
		if (userID == "" || v.UserID == userID) && v.Status == "pending" {
			result = append(result, v)
		}
	}
	return result, nil
}

func (c *autonomyControllerImpl) GetAutonomyDescription(_ context.Context, level AutonomyLevel) (string, error) {
	descriptions := map[AutonomyLevel]string{
		LevelObserve:        "Observe: Observe only, no actions allowed",
		LevelRecommend:      "Recommend: Safe actions auto-executed (restarts), risky ones require approval",
		LevelPropose:        "Propose: Scale/rollback auto-executed, destructive actions need approval",
		LevelActWithGuard:   "Act with Guard: Most actions auto-executed, drain/delete need approval",
		LevelFullAutonomous: "Full Autonomous: All approved actions executed automatically (use with caution)",
	}
	desc, ok := descriptions[level]
	if !ok {
		return "", fmt.Errorf("unknown autonomy level: %d", level)
	}
	return desc, nil
}

func extractOperation(action interface{}) string {
	if m, ok := action.(map[string]interface{}); ok {
		if op, ok := m["operation"].(string); ok {
			return op
		}
	}
	return ""
}
