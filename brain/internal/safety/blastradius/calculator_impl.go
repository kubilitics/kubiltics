package blastradius

// Package blastradius — concrete BlastRadiusCalculator implementation.

import (
	"context"
	"fmt"
	"strings"
)

type blastRadiusImpl struct{}

// NewBlastRadiusCalculator creates a new blast radius calculator.
func NewBlastRadiusCalculator() BlastRadiusCalculator {
	return &blastRadiusImpl{}
}

func (c *blastRadiusImpl) CalculateBlastRadius(_ context.Context, action interface{}) ([]interface{}, interface{}, error) {
	op := extractOp(action)
	affected := estimateAffected(action)

	severity := "low"
	switch strings.ToLower(op) {
	case "delete", "drain":
		severity = "high"
	case "scale", "patch", "rollback", "cordon", "hpa_scale":
		severity = "medium"
	}

	summary := map[string]interface{}{
		"operation":          op,
		"severity":           severity,
		"estimated_affected": len(affected),
		"description":        fmt.Sprintf("Operation '%s' may affect %d resources", op, len(affected)),
	}

	return affected, summary, nil
}

func (c *blastRadiusImpl) GetAffectedResources(_ context.Context, action interface{}, groupBy string) ([]interface{}, error) {
	affected := estimateAffected(action)
	if groupBy == "severity" {
		return []interface{}{
			map[string]interface{}{"severity": "medium", "resources": affected},
		}, nil
	}
	return affected, nil
}

func (c *blastRadiusImpl) AssessDataLossRisk(_ context.Context, action interface{}) (bool, []interface{}, interface{}, error) {
	op := extractOp(action)
	resType := extractResType(action)

	// Data loss risk applies to deleting StatefulSets, PVCs, or other stateful resources
	dataLossOps := []string{"delete", "drain"}
	dataLossTypes := []string{"StatefulSet", "PersistentVolumeClaim", "PersistentVolume", "Pod"}

	for _, dop := range dataLossOps {
		if strings.EqualFold(op, dop) {
			for _, dt := range dataLossTypes {
				if strings.EqualFold(resType, dt) {
					return true, []interface{}{
						map[string]string{
							"resource_type": resType,
							"risk":          "potential data loss if resource has associated storage",
						},
					}, map[string]string{"status": "backup_unknown"}, nil
				}
			}
		}
	}

	return false, nil, nil, nil
}

func (c *blastRadiusImpl) EstimateDowntime(_ context.Context, action interface{}) (int, int, error) {
	op := extractOp(action)
	switch strings.ToLower(op) {
	case "restart", "delete_pod":
		return 30, 1, nil // ~30s downtime, 1 service affected
	case "drain":
		return 300, 5, nil // ~5min, multiple services
	case "scale":
		return 0, 0, nil // no downtime if scaling up
	default:
		return 60, 1, nil
	}
}

func (c *blastRadiusImpl) FindDependencies(_ context.Context, resourceID string) ([]interface{}, []interface{}, error) {
	// Would query topology graph in a full implementation
	return []interface{}{}, []interface{}{}, nil
}

func (c *blastRadiusImpl) FindDependents(_ context.Context, resourceID string) ([]interface{}, []interface{}, error) {
	// Would query topology graph in a full implementation
	return []interface{}{}, []interface{}{}, nil
}

func (c *blastRadiusImpl) QueryTopologyDistance(_ context.Context, action interface{}) (int, interface{}, error) {
	op := extractOp(action)
	maxHops := 1
	if strings.EqualFold(op, "delete") || strings.EqualFold(op, "drain") {
		maxHops = 3
	}
	return maxHops, map[string]interface{}{"estimated_hops": maxHops}, nil
}

func (c *blastRadiusImpl) CompareAlternatives(_ context.Context, primaryAction interface{}, alternatives []interface{}) (interface{}, error) {
	primary := extractOp(primaryAction)
	comparison := map[string]interface{}{
		"primary_action":    primary,
		"alternative_count": len(alternatives),
		"recommendation":    fmt.Sprintf("Consider lower-risk alternatives to '%s' if available", primary),
	}
	return comparison, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func extractOp(action interface{}) string {
	if m, ok := action.(map[string]interface{}); ok {
		if v, ok := m["operation"].(string); ok {
			return v
		}
	}
	return "unknown"
}

func extractResType(action interface{}) string {
	if m, ok := action.(map[string]interface{}); ok {
		if v, ok := m["resource_type"].(string); ok {
			return v
		}
	}
	return ""
}

func estimateAffected(action interface{}) []interface{} {
	op := extractOp(action)
	resType := extractResType(action)
	var m map[string]interface{}
	if am, ok := action.(map[string]interface{}); ok {
		m = am
	}
	ns := ""
	name := ""
	if m != nil {
		if v, ok := m["namespace"].(string); ok {
			ns = v
		}
		if v, ok := m["resource_name"].(string); ok {
			name = v
		}
	}

	affected := []interface{}{
		map[string]string{
			"kind":      resType,
			"namespace": ns,
			"name":      name,
			"reason":    fmt.Sprintf("direct target of %s operation", op),
		},
	}
	return affected
}
