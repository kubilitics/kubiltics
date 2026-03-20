package financial

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/addon/resolver"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	prometheusAddonID = "kubilitics/kube-prometheus-stack"
	opencostAddonID   = "kubilitics/opencost"
)

// BuildFinancialStackPlan returns a merged install plan for Prometheus and OpenCost when the stack is incomplete.
// If both are already installed, returns nil, nil. Deduplicates steps by AddonID and preserves order.
func BuildFinancialStackPlan(ctx context.Context, clusterID string, stack *FinancialStack, r resolver.Resolver) (*models.InstallPlan, error) {
	if stack == nil {
		return nil, nil
	}
	if stack.PrometheusInstalled && stack.OpenCostInstalled {
		return nil, nil
	}
	var plans []*models.InstallPlan
	if !stack.PrometheusInstalled {
		p, err := r.Resolve(ctx, prometheusAddonID, clusterID)
		if err != nil {
			return nil, err
		}
		if p != nil {
			plans = append(plans, p)
		}
	}
	if !stack.OpenCostInstalled {
		p, err := r.Resolve(ctx, opencostAddonID, clusterID)
		if err != nil {
			return nil, err
		}
		if p != nil {
			plans = append(plans, p)
		}
	}
	if len(plans) == 0 {
		return nil, nil
	}
	merged := mergePlans(plans, clusterID)
	return merged, nil
}

func mergePlans(plans []*models.InstallPlan, clusterID string) *models.InstallPlan {
	seen := make(map[string]struct{})
	var steps []models.InstallStep
	var totalDuration int
	var totalCost float64
	for _, p := range plans {
		for _, s := range p.Steps {
			if _, ok := seen[s.AddonID]; ok {
				continue
			}
			seen[s.AddonID] = struct{}{}
			steps = append(steps, s)
			totalDuration += s.EstimatedDurationSec
			totalCost += s.EstimatedCostDeltaUSD
		}
	}
	return &models.InstallPlan{
		RequestedAddonID:           "",
		Steps:                      steps,
		TotalEstimatedDurationSec:  totalDuration,
		TotalEstimatedCostDeltaUSD: totalCost,
		ClusterID:                  clusterID,
		GeneratedAt:                time.Now().UTC(),
	}
}

// GenerateOpenCostValues returns Helm values so OpenCost uses the detected Prometheus endpoint.
func GenerateOpenCostValues(stack *FinancialStack) map[string]interface{} {
	if stack == nil || stack.PrometheusEndpoint == "" {
		return nil
	}
	return map[string]interface{}{
		"opencost": map[string]interface{}{
			"prometheus": map[string]interface{}{
				"external_url": stack.PrometheusEndpoint,
			},
		},
	}
}
